
import express from 'express';
import { Sequelize } from 'sequelize';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer } from 'ws';

import statRoutes from './routes/statRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import { activeSession, setActiveSession, setFlushDbBuffer } from './routes/sessionRoutes.js';
import { initStatModel, Stat } from './models/stat_schema.js';
import { initSessionModel, Session } from './models/session_schema.js';
import { normalizeTelemetry } from './utils/dataProcessor.js';
dotenv.config();

// initial expressjs config
// cors
const app = express();
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_DEPLOY_URL,
].filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
// app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

// init the 
initStatModel(sequelize);
initSessionModel(sequelize);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track dashboard (frontend) clients vs device clients
const dashboardClients = new Set();

// Broadcast pre-normalized telemetry to all connected dashboard clients
const broadcastToDashboards = (message) => {
  const data = JSON.stringify(message);
  for (const client of dashboardClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
};

// --- Batch DB write buffer ---
let dbWriteBuffer = [];
const DB_FLUSH_INTERVAL_MS = 1000;

const flushDbBuffer = async () => {
  if (dbWriteBuffer.length === 0) return;
  const batch = dbWriteBuffer.splice(0);
  const sessionId = batch[0].session_id;
  try {
    await Stat.bulkCreate(batch);
    await Session.increment('data_point_count', {
      by: batch.length,
      where: { session_id: sessionId }
    });
  } catch (err) {
    console.error('[DB] Batch write error:', err.message);
  }
};

setInterval(flushDbBuffer, DB_FLUSH_INTERVAL_MS);
setFlushDbBuffer(flushDbBuffer);

wss.on("connection", (ws, req) => {
  // Dashboard clients connect with ?role=dashboard
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role');

  if (role === 'dashboard') {
    dashboardClients.add(ws);
    console.log(`[DASHBOARD] Client connected (${dashboardClients.size} total)`);
    ws.on("close", () => {
      dashboardClients.delete(ws);
      console.log(`[DASHBOARD] Client disconnected (${dashboardClients.size} total)`);
    });
    return; // Dashboard clients only receive, they don't send telemetry
  }

  // Device client (MCU nodes)
  ws.on("message", async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());

      if (payload.type === "data" && payload.group && payload.ts && payload.d) {
        const now = new Date().toISOString();
        const msgId = Date.now();
        const sessionId = activeSession?.session_id || null;
        const sessionName = activeSession?.name || null;

        // Build raw data object (stored in DB as-is)
        const statData = {
          type: payload.type,
          group: payload.group,
          timestamp: payload.ts,
          values: payload.d,
          receivedAt: now
        };

        // Pre-normalize for dashboard (frontend skips normalizeData for live)
        const normalized = normalizeTelemetry(statData, msgId, sessionId, sessionName, now);
        broadcastToDashboards(normalized);

        // Only buffer to DB when a session is recording
        if (activeSession) {
          dbWriteBuffer.push({
            session_id: activeSession.session_id,
            session_name: activeSession.name,
            data: statData
          });
        }

        ws.send(JSON.stringify({
          type: "registration_response",
          status: "accepted",
          system_time: { timestamp_ms: Date.now() }
        }));
      } else if (payload.type === "register") {
        if (payload.groups && payload.schema) {
          console.log(`[REGISTRATION] Client: ${payload.client_name}, Groups: ${payload.groups.map(g => g.group).join(', ')}`);
        }

        ws.send(JSON.stringify({
          type: "registration_response",
          status: "accepted",
          system_time: { timestamp_ms: Date.now() }
        }));
      } else {
        ws.send(JSON.stringify({
          status: "error",
          message: "Invalid message format",
          ts: Date.now()
        }));
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(JSON.stringify({
        status: "error",
        message: error.message,
        ts: Date.now()
      }));
    }
  });
});

app.use('/api/stat', statRoutes);
app.use('/api/session', sessionRoutes);
app.get('/', (req, res) => res.json({ status: 'ok' }));

(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  // Sync active session on startup
  const activeSessionRecord = await Session.findOne({
    where: { status: 'recording' }
  });
  if (activeSessionRecord) {
    setActiveSession({
      session_id: activeSessionRecord.session_id,
      name: activeSessionRecord.name,
      start_time: activeSessionRecord.start_time
    });
    console.log(`[SESSION] Restored active session: ${activeSessionRecord.session_id}`);
  }

  server.listen(PORT, () => console.log(`running on http://localhost:${PORT}`));
})();
