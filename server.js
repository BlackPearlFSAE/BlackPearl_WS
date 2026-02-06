
import express from 'express';
import { Sequelize } from 'sequelize';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer } from 'ws';

import statRoutes from './routes/statRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import { activeSession, setActiveSession } from './routes/sessionRoutes.js';
import { initStatModel, Stat } from './models/stat_schema.js';
import { initSessionModel, Session } from './models/session_schema.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

initStatModel(sequelize);
initSessionModel(sequelize);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());

      // ตรวจสอบโครงสร้างข้อมูลตามรูปแบบใหม่
      if (payload.type === "data" && payload.group && payload.ts && payload.d) {
        // บันทึกข้อมูลลงฐานข้อมูลพร้อมกับ metadata
        await Stat.create({
          session_id: activeSession?.session_id || null, // Stamp session_id if active
          data: {
            type: payload.type,
            group: payload.group,
            timestamp: payload.ts,
            values: payload.d,
            receivedAt: new Date().toISOString()
          }
        });

        // Increment session data_point_count if active
        if (activeSession && Session) {
          await Session.increment('data_point_count', {
            where: { session_id: activeSession.session_id }
          });
        }

        // ส่งการยืนยันกลับไปยังอุปกรณ์
        ws.send(JSON.stringify({
          type: "registration_response",
          status: "accepted",
          system_time: {
            timestamp_ms: Date.now()
          }
        }));
      } else if (payload.type === "register") {
        // รองรับการลงทะเบียนอุปกรณ์ตามรูปแบบใหม่
        // บันทึก schema สำหรับการประมวลผลข้อมูลในภายหลัง
        if (payload.groups && payload.schema) {
          console.log(`[REGISTRATION] Client: ${payload.client_name}, Groups: ${payload.groups.map(g => g.group).join(', ')}`);
        }

        // ส่งคำตอบ registration_response ตามรูปแบบที่ client คาดหวัง
        ws.send(JSON.stringify({
          type: "registration_response",
          status: "accepted",
          system_time: {
            timestamp_ms: Date.now()
          }
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
      start_time: activeSessionRecord.start_time
    });
    console.log(`[SESSION] Restored active session: ${activeSessionRecord.session_id}`);
  }

  server.listen(PORT, () => console.log("running on", PORT));
})();
