# Range Herd Tech — Frontend

React + TypeScript + Vite dashboard for LoRa cattle tracking.

## Prerequisites

- Node.js 18+
- Backend server running (see `/backend` folder)
- PostgreSQL database running

## Setup

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API/WebSocket calls to the backend at `http://localhost:8080`.

## Environment

No `.env` needed for the frontend — all API calls are proxied through Vite to the backend.

## Project Structure

```
src/
  App.tsx       # Main dashboard component
  main.tsx      # React entry point
  index.css     # Global styles (minimal)
  App.css       # App-level styles (minimal)
```

## How it works

1. On load, fetches all devices from `/api/devices` and their latest telemetry
2. Opens a WebSocket to `/live` for real-time updates
3. If WebSocket drops, automatically reconnects with exponential backoff
4. Map shows live GPS trail per device with unique color per tag

## Architecture

```
TTN (LoRaWAN) → Backend (Fastify + MQTT) → PostgreSQL
                           ↓ WebSocket
              React Frontend (Leaflet Map)
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Lint TypeScript/React code |

## Key Features

- 🗺 Live GPS map with per-device color-coded trails
- 🔋 Battery level monitoring with color alerts (green/amber/red)
- 📡 RSSI/SNR signal quality display
- 🔄 Auto-reconnecting WebSocket (exponential backoff, 10 retries)
- 🎯 Click any device in sidebar to focus its trail on the map
- 💾 Loads last-known position from DB on page load

## Known Limitations / Next Up

- [ ] Authentication (Priority 2)
- [ ] Geofencing & alerts (Priority 3)
- [ ] Historical playback
- [ ] Multi-ranch support
- [ ] Production deployment config
