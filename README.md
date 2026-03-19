# BlackPearl WS — Backend ↔ Frontend API Bridge

## Architecture Overview

```
Vehicle MCU
    │  WebSocket (device)
    ▼
BlackPearl_WS (Node.js)
    │  normalize + scale (utils/dataProcessor.js)
    ├─── WS broadcast ──────────────────► BP_dashboard_FE (live view)
    └─── bulkCreate (1s batch) ────────► PostgreSQL
                                              │
                                   GET /api/session/:id/data?normalized=true
                                              │
                                              ▼
                                        BP_dashboard_FE (history playback)
```

---

## 1. Live Data — WebSocket

**Backend sends:** pre-normalized, pre-scaled flat object
**Frontend receives:** ready to render, no processing needed

### Payload shape (broadcast to dashboard clients)
```json
{
  "id": 1710000000000,
  "session_id": "uuid-or-null",
  "session_name": "run_01-or-null",
  "timestamp": 1773465819178,
  "createdAt": "2026-03-14T05:23:39.225Z",
  "group": "bmu6.cells",
  "V_CELL.0": 3.78,
  "V_CELL.1": 3.76,
  "TEMP_SENSE.0": -23.0,
  "V_MODULE": 37.76,
  "DV": 0.1,
  "connected": true
}
```

### Frontend connection (`src/utils/websocket.js`)
```
Dev:  ws://<host>/ws?role=dashboard   (proxied by Vite → localhost:3000)
Prod: wss://blackpearl-ws-8z9a.onrender.com/?role=dashboard
```
Auto-reconnects every 2s on disconnect.

### Frontend render (`src/hooks/useTelemetryStream.js`)
- Buffers every WS message into a ref (no state update per message)
- Flushes to React state at **100ms interval (~10fps)**
- Marks data as **STALE** if no message received for 10s

---

## 2. REST API Endpoints

Base URL:
- **Dev:** relative (proxied by Vite)
- **Prod:** `https://blackpearl-ws-8z9a.onrender.com`

### Session
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/session/start` | Begin recording — sets `activeSession` in-memory |
| POST | `/api/session/stop` | Stop recording — flushes DB buffer, clears `activeSession` |
| GET | `/api/session/active` | Get currently recording session |
| GET | `/api/session/list` | Paginated session list |
| GET | `/api/session/:id/data?normalized=true` | History data, pre-normalized by backend |
| PATCH | `/api/session/:id/rename` | Rename session (syncs activeSession if live) |
| DELETE | `/api/session/:id` | Delete session + its stats |
| DELETE | `/api/session/delete-unnamed` | Delete sessions with null name |
| DELETE | `/api/session/delete-all` | Nuke all sessions + stats |

### Stats
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/stat/` | Fetch all stats (optional `?since=ISO`) |
| DELETE | `/api/stat/delete` | Delete by session_name (body: `{session_name}`) |
| DELETE | `/api/stat/delete-unnamed` | Delete stats with null session_name |
| DELETE | `/api/stat/delete-all` | Delete all stats |

### `?normalized=true` flag
When set on `/api/session/:id/data`, the backend runs each DB record through
`normalizeStatRecord()` before responding — same flatten + scale pipeline as
live WS data. Frontend receives identical shape in both live and history paths.

---

## 3. DB Write Strategy

- **No active session:** WS messages broadcast only, zero DB writes
- **Active session:** messages buffered in memory, flushed via `Stat.bulkCreate()` every **1 second**
- On session stop: buffer is flushed immediately before clearing `activeSession`

---

## 4. Normalization Pipeline (`utils/dataProcessor.js`)

Single source of truth for scaling. Applied server-side for both live and history.

```
SCALE_CONFIG:
  V_MODULE, V_CELL  → × 0.02        (raw int → Volts)
  TEMP_SENSE        → × 0.5 − 40    (raw int → °C)
  DV                → × 0.1         (raw int → Volts)
```

`normalizeTelemetry()` — live WS path
`normalizeStatRecord()` — history REST path

---

## 5. Local Development — Skip Deployment

Set `VITE_BACKEND=local` to proxy everything to `localhost:3000` instead of the
production Render instance.

### `.env.local` (create in `BP_dashboard_FE/`)
```env
VITE_BACKEND=local
```

### Start both servers
```bash
# Terminal 1 — backend
cd BlackPearl_WS
node server.js

# Terminal 2 — frontend
cd BP_dashboard_FE
npm run dev
```

Vite proxy config (`vite.config.js`) reads `VITE_BACKEND`:
- `local` → `/api` and `/ws` proxy to `http://localhost:3000`
- anything else → proxy to `https://blackpearl-ws-8z9a.onrender.com`

No code changes needed to switch between local and production.
