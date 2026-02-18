// src/config.ts
// Central config for API + WebSocket endpoints (Railway + local dev)

export const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8080"
).replace(/\/+$/, "");

// Convert http(s) -> ws(s) for websocket connections
export const WS_URL = API_URL.startsWith("https://")
  ? API_URL.replace(/^https:\/\//, "wss://")
  : API_URL.replace(/^http:\/\//, "ws://");
