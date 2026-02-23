import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { API_URL, WS_URL } from "../config";

type LivePoint = {
  id?: string;
  deviceId: string;

  lat: number;
  lon: number;

  receivedAt?: string;
  ts?: string;

  batteryPct?: number | null;
  batteryV?: number | null;
  rssi?: number | null;
  snr?: number | null;

  temperatureC?: number | null;
};

type DeviceRow = {
  id: string;
  name: string;
  batteryPct: number | null;
  lastLat: number | null;
  lastLon: number | null;
  lastSeenAt: string | null;
};

type WsStatus = "connecting" | "connected" | "reconnecting" | "error";
type LoadStatus = "loading" | "ready" | "error";

type DashboardProps = {
  token: string;
  user?: any;
  onLogout?: () => void;
};

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function createColoredIcon(color: string) {
  return new L.DivIcon({
    className: "",
    html: `
      <div style="
        width: 14px; height: 14px;
        background: ${color};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 1px 6px rgba(0,0,0,0.35);
      "></div>
    `,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// ===============================
// Movement filtering (GPS drift)
// Mark as MOVING only if last TWO consecutive moves exceed threshold.
// ===============================
const MOVEMENT_THRESHOLD_M = 10;

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export default function Dashboard({ token, user, onLogout }: DashboardProps) {
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [pointsByDevice, setPointsByDevice] = useState<Record<string, LivePoint[]>>({});
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  const [alertCenter, setAlertCenter] = useState<[number, number] | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const fetchJson = useCallback(
    async (path: string) => {
      const url = `${API_URL}${path}`;

      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, { headers });

      // If auth dies, force logout to re-login cleanly
      if (res.status === 401) {
        try {
          onLogout?.();
        } catch {}
        throw new Error("401 Unauthorized");
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} ${text}`);
      }

      return res.json();
    },
    [token, onLogout]
  );

  const loadDevices = useCallback(async () => {
    const data = await fetchJson("/api/devices");
    setDevices(data);
  }, [fetchJson]);

  const loadLatestPoints = useCallback(async () => {
    const data = await fetchJson("/api/live/latest");

    const by: Record<string, LivePoint[]> = {};
    for (const p of data as LivePoint[]) {
      if (!by[p.deviceId]) by[p.deviceId] = [];
      by[p.deviceId].push(p);
    }

    setPointsByDevice((prev) => {
      const merged: Record<string, LivePoint[]> = { ...prev };

      for (const [id, pts] of Object.entries(by)) {
        const existing = merged[id] || [];
        const next = [...existing, ...pts];

        const seen = new Set<string>();
        const deduped: LivePoint[] = [];
        for (const x of next) {
          const key = `${x.ts || x.receivedAt || ""}-${x.lat}-${x.lon}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(x);
        }

        deduped.sort(
          (a, b) =>
            new Date(a.ts || a.receivedAt || 0).getTime() -
            new Date(b.ts || b.receivedAt || 0).getTime()
        );

        merged[id] = deduped.slice(-60);
      }

      return merged;
    });
  }, [fetchJson]);

  // Initial load + polling
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoadStatus("loading");
        await loadDevices();
        await loadLatestPoints();
        if (!mounted) return;
        setLoadStatus("ready");
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setLoadStatus("error");
      }
    })();

    pollTimerRef.current = window.setInterval(async () => {
      try {
        await loadDevices();
        await loadLatestPoints();
      } catch (e) {
        console.error("poll error", e);
      }
    }, 60000);

    return () => {
      mounted = false;
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [loadDevices, loadLatestPoints]);

  // WebSocket – connect to BACKEND host, not window.location.host
  const connectWs = useCallback(() => {
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setWsStatus("connecting");

      // Backend has /api/live websocket route
      const ws = new WebSocket(`${WS_URL}/api/live`);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("connected");

      ws.onmessage = async (evt) => {
        try {
          const msg = JSON.parse(evt.data || "{}");
          if (msg?.type === "live_point" || msg?.type === "tick" || msg?.type === "ttn_uplink") {
            await loadLatestPoints();
            await loadDevices();
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => setWsStatus("error");

      ws.onclose = () => {
        setWsStatus("reconnecting");
        if (reconnectTimerRef.current) window.clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => connectWs(), 1500) as any;
      };
    } catch (e) {
      console.error("WS connect failed", e);
      setWsStatus("error");
    }
  }, [loadLatestPoints, loadDevices]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWs]);

  const allPoints = useMemo(() => Object.values(pointsByDevice).flat(), [pointsByDevice]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (alertCenter) return alertCenter;

    const latest = allPoints
      .slice()
      .sort(
        (a, b) =>
          new Date(a.ts || a.receivedAt || 0).getTime() -
          new Date(b.ts || b.receivedAt || 0).getTime()
      )
      .at(-1);

    if (latest) return [latest.lat, latest.lon];
    return [32.9565, -96.3893];
  }, [alertCenter, allPoints]);

  const deviceIds = Object.keys(pointsByDevice);

  type MotionState = "moving" | "stationary" | "unknown";
  const motionByDevice = useMemo(() => {
    const out: Record<string, MotionState> = {};

    for (const [deviceId, pts] of Object.entries(pointsByDevice)) {
      if (!pts || pts.length < 3) {
        out[deviceId] = "unknown";
        continue;
      }

      const sorted = [...pts].sort(
        (a, b) =>
          new Date(a.ts || a.receivedAt || 0).getTime() -
          new Date(b.ts || b.receivedAt || 0).getTime()
      );

      const p1 = sorted[sorted.length - 3];
      const p2 = sorted[sorted.length - 2];
      const p3 = sorted[sorted.length - 1];

      const d1 = haversineMeters({ lat: p1.lat, lon: p1.lon }, { lat: p2.lat, lon: p2.lon });
      const d2 = haversineMeters({ lat: p2.lat, lon: p2.lon }, { lat: p3.lat, lon: p3.lon });

      out[deviceId] = d1 > MOVEMENT_THRESHOLD_M && d2 > MOVEMENT_THRESHOLD_M ? "moving" : "stationary";
    }

    return out;
  }, [pointsByDevice]);

  const selectedPoints = useMemo(() => {
    if (!selectedDevice) return [];
    return pointsByDevice[selectedDevice] || [];
  }, [selectedDevice, pointsByDevice]);

  const routePolyline = useMemo(() => {
    if (!selectedDevice) return null;
    if (selectedPoints.length < 2) return null;
    return selectedPoints.map((p) => [p.lat, p.lon]) as [number, number][];
  }, [selectedDevice, selectedPoints]);

  const wsDotColor =
    wsStatus === "connected"
      ? "#22c55e"
      : wsStatus === "reconnecting"
      ? "#f59e0b"
      : wsStatus === "error"
      ? "#ef4444"
      : "#9ca3af";

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#0b1020" }}>
      {/* Left sidebar */}
      <div
        style={{
          width: 320,
          borderRight: "1px solid rgba(255,255,255,0.08)",
          padding: 14,
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Range Herd</div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onLogout ? (
              <button
                onClick={onLogout}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "#e5e7eb",
                  borderRadius: 10,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Logout
              </button>
            ) : null}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 50, background: wsDotColor }} />
              <div style={{ fontSize: 12, color: "#cbd5e1" }}>{wsStatus}</div>
            </div>
          </div>
        </div>

        <div style={{ height: 12 }} />

        <div style={{ fontSize: 12, color: "#cbd5e1", opacity: 0.9, marginBottom: 10 }}>
          {loadStatus === "loading" ? "Loading…" : loadStatus === "error" ? "Error loading data" : "Live map"}
        </div>

        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Devices</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {deviceIds.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>No devices yet.</div>
          ) : (
            deviceIds.map((id) => {
              const pts = pointsByDevice[id] || [];
              const last = pts[pts.length - 1];
              const bPct = last?.batteryPct ?? null;

              const motion = motionByDevice[id] ?? "unknown";
              const motionLabel = motion === "moving" ? "Moving" : motion === "stationary" ? "Stationary" : "—";
              const motionColor = motion === "moving" ? "#22c55e" : motion === "stationary" ? "#93c5fd" : "#6b7280";

              const isSelected = selectedDevice === id;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedDevice((cur) => (cur === id ? null : id))}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    borderRadius: 12,
                    border: isSelected ? "1px solid rgba(34,197,94,0.9)" : "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 10,
                    cursor: "pointer",
                    color: "white",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{id}</div>
                    <div style={{ fontSize: 12, color: "#cbd5e1" }}>{bPct != null ? `${bPct.toFixed(0)}%` : "—"}</div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>Last</div>
                      <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                        {last?.receivedAt
                          ? new Date(last.receivedAt).toLocaleTimeString()
                          : last?.ts
                          ? new Date(last.ts).toLocaleTimeString()
                          : "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>Battery</div>
                      <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                        {last?.batteryPct != null ? `${last.batteryPct.toFixed(0)}%` : "—"}{" "}
                        {last?.batteryV != null ? `(${last.batteryV.toFixed(2)}V)` : ""}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>GPS</div>
                      <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                        {last?.lat != null && last?.lon != null ? `${last.lat.toFixed(4)}, ${last.lon.toFixed(4)}` : "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>Status</div>
                      <div style={{ color: motionColor, fontWeight: 700 }}>{motionLabel}</div>
                    </div>

                    {last?.temperatureC != null ? (
                      <div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>Temp</div>
                        <div style={{ color: "#e5e7eb", fontSize: 11 }}>{last.temperatureC.toFixed(1)}°C</div>
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1 }}>
        <MapContainer center={mapCenter} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Device markers */}
          {deviceIds.map((id) => {
            const pts = pointsByDevice[id] || [];
            const p = pts[pts.length - 1];
            if (!p) return null;

            const motion = motionByDevice[id] ?? "unknown";
            const color = motion === "moving" ? "#22c55e" : motion === "stationary" ? "#93c5fd" : "#9ca3af";
            const icon = createColoredIcon(color);

            return (
              <Marker key={id} position={[p.lat, p.lon]} icon={icon}>
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 800 }}>{id}</div>
                    <div>🕐 {p.receivedAt ? new Date(p.receivedAt).toLocaleString() : p.ts ? new Date(p.ts).toLocaleString() : "—"}</div>
                    <div>📍 Status: {motion === "moving" ? "Moving" : motion === "stationary" ? "Stationary" : "—"}</div>
                    <div>🔋 {p.batteryPct != null ? `${p.batteryPct.toFixed(0)}%` : "—"} {p.batteryV != null ? `(${p.batteryV.toFixed(2)}V)` : ""}</div>
                    <div>📶 RSSI/SNR: {p.rssi ?? "—"} / {p.snr ?? "—"}</div>
                    {p.temperatureC != null ? <div>🌡️ {p.temperatureC.toFixed(1)}°C</div> : null}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Selected route */}
          {routePolyline ? <Polyline positions={routePolyline} /> : null}
        </MapContainer>
      </div>
    </div>
  );
}