
import express from 'express';
import { Sequelize } from 'sequelize';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer } from 'ws';

import statRoutes from './routes/statRoutes.js';
import { initStatModel, Stat } from './models/stat_schema.js';

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
          data: {
            type: payload.type,
            group: payload.group,
            timestamp: payload.ts,
            values: payload.d,
            receivedAt: new Date().toISOString()
          }
        });
        
        // ส่งการยืนยันกลับไปยังอุปกรณ์
        ws.send(JSON.stringify({ 
          status: "ok", 
          received: true,
          ts: Date.now()
        }));
      } else if (payload.type === "register") {
        // รองรับการลงทะเบียนอุปกรณ์
        ws.send(JSON.stringify({ 
          status: "registered",
          client_name: payload.client_name,
          ts: Date.now()
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
app.get('/', (req, res) => res.json({ status: 'ok' }));

(async () => {
  await sequelize.authenticate();
  await sequelize.sync();
  server.listen(PORT, () => console.log("running on", PORT));
})();
