import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import GeofencePanel from "./GeofencePanel";
import AlertPanel from "./AlertPanel";
import TeamPanel from "./TeamPanel";
import { API_URL, WS_URL } from "../config";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEVICE_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899",
];

function getDeviceColor(deviceId: string, deviceIds: string[]): string {
  const index = deviceIds.indexOf(deviceId);
  return DEVICE_COLORS[index % DEVICE_COLORS.length];
}

function createColoredIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

type LivePoint = {
  deviceId: string;
  receivedAt: string;
  lat: number | null;
  lon: number | null;
  altM?: number | null;
  batteryV: number | null;
  batteryPct: number | null;
  tempC?: number | null;
  rssi: number | null;
  snr: number | null;
};

type UplinkMessage =
  | { type: "uplink"; data: LivePoint }
  | { type: "alert"; data: any }
  | { type: "connected" }
  | { type: "hello"; ts: string };

type DeviceRow = { deviceId: string; devEui: string | null; lastSeen: string };
type WsStatus = "connecting" | "connected" | "reconnecting" | "closed" | "error";
type LoadStatus = "loading" | "ready" | "error";

function MapRecenter({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const lastCenter = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (!center) return;
    if (
      !lastCenter.current ||
      Math.abs(lastCenter.current[0] - center[0]) > 0.0001 ||
      Math.abs(lastCenter.current[1] - center[1]) > 0.0001
    ) {
      map.panTo(center, { animate: true });
      lastCenter.current = center;
    }
  }, [center, map]);
  return null;
}

const WS_MAX_RETRIES = 10;
const WS_BASE_DELAY_MS = 1000;

function useReconnectingWebSocket(
  url: string,
  onMessage: (msg: UplinkMessage) => void,
  onStatusChange: (status: WsStatus) => void
) {
  const retryCount = useRef(0);
  const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const connect = useCallback(() => {
    if (!isMounted.current) return;
    onStatusChange(retryCount.current === 0 ? "connecting" : "reconnecting");

    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (!isMounted.current) return;
      retryCount.current = 0;
      onStatusChange("connected");
    };

    ws.onmessage = (event) => {
      if (!isMounted.current) return;
      try {
        onMessage(JSON.parse(event.data) as UplinkMessage);
      } catch {
        console.warn("Failed to parse WS message:", event.data);
      }
    };

    ws.onerror = () => {
      if (isMounted.current) onStatusChange("error");
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      if (retryCount.current < WS_MAX_RETRIES) {
        const delay = Math.min(WS_BASE_DELAY_MS * 2 ** retryCount.current, 30000);
        retryCount.current++;
        onStatusChange("reconnecting");
        retryTimeout.current = setTimeout(connect, delay);
      } else {
        onStatusChange("closed");
      }
    };

    return ws;
  }, [url, onMessage, onStatusChange]);

  useEffect(() => {
    isMounted.current = true;
    const ws = connect();
    return () => {
      isMounted.current = false;
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
      ws?.close();
    };
  }, [connect]);
}

function batteryColor(pct: number | null): string {
  if (pct == null) return "#9ca3af";
  if (pct > 50) return "#22c55e";
  if (pct > 20) return "#f59e0b";
  return "#ef4444";
}

function StatusDot({ status }: { status: WsStatus }) {
  const colors: Record<WsStatus, string> = {
    connected: "#22c55e",
    connecting: "#f59e0b",
    reconnecting: "#f59e0b",
    closed: "#6b7280",
    error: "#ef4444",
  };
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors[status],
        marginRight: 6,
        boxShadow: status === "connected" ? `0 0 6px ${colors[status]}` : "none",
      }}
    />
  );
}

type DashboardProps = {
  user: any;
  onLogout: () => void;
};

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [pointsByDevice, setPointsByDevice] = useState<Record<string, LivePoint[]>>({});
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState<"none" | "alerts" | "geofences" | "team">("none");
  const [alertCenter, setAlertCenter] = useState<[number, number] | null>(null);

  const token = localStorage.getItem("token");

  const loadInitial = useCallback(async () => {
    try {
      setLoadStatus("loading");

      const devices = (await fetch(`${API_URL}/api/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json())) as DeviceRow[];

      const latestList = await Promise.allSettled(
        devices.map((d) =>
          // ✅ FIX: this was the last remaining relative /api call
          fetch(`${API_URL}/api/devices/${encodeURIComponent(d.deviceId)}/latest`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json())
        )
      );

      const seeded: Record<string, LivePoint[]> = {};
      for (const result of latestList) {
        if (result.status === "fulfilled") {
          const item = result.value as LivePoint | null;
          if (item?.deviceId) seeded[item.deviceId] = [item];
        }
      }

      setPointsByDevice(seeded);
      setLoadStatus("ready");
    } catch (e) {
      console.error("Initial load failed:", e);
      setLoadStatus("error");
    }
  }, [token]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const handleMessage = useCallback(
    (msg: UplinkMessage) => {
      if (msg.type === "uplink") {
        const p = msg.data;
        if (!p.deviceId) return;
        setPointsByDevice((prev) => {
          const existing = prev[p.deviceId] ?? [];
          return { ...prev, [p.deviceId]: [...existing, p].slice(-100) };
        });
      } else if (msg.type === "alert") {
        loadInitial();
      }
    },
    [loadInitial]
  );

  // ✅ FIX: WebSocket must connect to BACKEND domain, not frontend domain
  // Backend websocket endpoint is /live (not /api/live) based on your server.ts
  const wsUrl = `${WS_URL}/live`;

  useReconnectingWebSocket(wsUrl, handleMessage, setWsStatus);

  const deviceIds = Object.keys(pointsByDevice);

  const mapCenter = useMemo<[number, number] | null>(() => {
    if (alertCenter) return alertCenter;

    const points = selectedDevice
      ? pointsByDevice[selectedDevice] ?? []
      : Object.values(pointsByDevice).flat();

    const valid = points.filter((p) => p.lat != null && p.lon != null);
    const last = valid[valid.length - 1];
    return last?.lat != null && last?.lon != null ? [last.lat, last.lon] : null;
  }, [pointsByDevice, selectedDevice, alertCenter]);

  const handleAlertClick = (lat: number, lon: number) => {
    setAlertCenter([lat, lon]);
    setTimeout(() => setAlertCenter(null), 100);
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "340px 1fr",
        background: "#0f1117",
        color: "#e5e7eb",
        fontFamily: "'Inter', system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "#161b27",
          borderRight: "1px solid #1f2937",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid #1f2937", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Range Herd</div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <StatusDot status={wsStatus} />
              <span style={{ fontSize: 12, color: "#9ca3af" }}>{wsStatus}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setShowPanel("alerts")} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #273244", background: showPanel === "alerts" ? "#1f2937" : "#0b1220", color: "#e5e7eb", cursor: "pointer" }}>
              Alerts
            </button>
            <button onClick={() => setShowPanel("geofences")} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #273244", background: showPanel === "geofences" ? "#1f2937" : "#0b1220", color: "#e5e7eb", cursor: "pointer" }}>
              Geofences
            </button>
            <button onClick={() => setShowPanel("team")} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #273244", background: showPanel === "team" ? "#1f2937" : "#0b1220", color: "#e5e7eb", cursor: "pointer" }}>
              Team
            </button>
            <button onClick={onLogout} style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 10, border: "1px solid #273244", background: "#0b1220", color: "#e5e7eb", cursor: "pointer" }}>
              Logout
            </button>
          </div>
        </div>

        <div style={{ overflow: "auto", padding: 12 }}>
          {/* Panels */}
          {showPanel === "alerts" && (
            <AlertPanel token={token || ""} onAlertClick={handleAlertClick} />
          )}
          {showPanel === "geofences" && (
            <GeofencePanel token={token || ""} onGeofenceCreated={loadInitial} onGeofenceDeleted={loadInitial} />
          )}
          {showPanel === "team" && <TeamPanel token={token || ""} />}

          {/* Device list */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>Devices</div>
            {deviceIds.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af" }}>
                {loadStatus === "loading" ? "Loading..." : "No devices yet."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {deviceIds.map((id) => {
                  const pts = pointsByDevice[id] ?? [];
                  const last = pts[pts.length - 1];
                  const pct = last?.batteryPct ?? null;
                  const color = getDeviceColor(id, deviceIds);
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedDevice(id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: selectedDevice === id ? `1px solid ${color}` : "1px solid #273244",
                        background: selectedDevice === id ? "#0b1220" : "#0a0f1a",
                        color: "#e5e7eb",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: color,
                          }}
                        />
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{id}</div>
                        <div style={{ marginLeft: "auto", fontSize: 12, color: batteryColor(pct) }}>
                          {pct == null ? "—" : `${Math.round(pct)}%`}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>
                        {last?.lat != null && last?.lon != null
                          ? `Last GPS: ${last.lat.toFixed(5)}, ${last.lon.toFixed(5)}`
                          : "No GPS yet"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <MapContainer
          center={mapCenter ?? [32.9565, -96.3893]}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapRecenter center={mapCenter} />

          {deviceIds.map((id) => {
            const pts = pointsByDevice[id] ?? [];
            const valid = pts.filter((p) => p.lat != null && p.lon != null) as Array<
              LivePoint & { lat: number; lon: number }
            >;
            if (valid.length === 0) return null;

            const color = getDeviceColor(id, deviceIds);
            const last = valid[valid.length - 1];

            return (
              <div key={id as any}>
                <Polyline
                  positions={valid.map((p) => [p.lat, p.lon] as [number, number])}
                  pathOptions={{ color, weight: 3 }}
                />
                <Marker position={[last.lat, last.lon]} icon={createColoredIcon(color)}>
                  <Popup>
                    <div style={{ minWidth: 200 }}>
                      <div style={{ fontWeight: 700, marginBottom: 8 }}>{id}</div>
                      <div style={{ fontSize: 12, color: "#111827" }}>
                        Battery: {last.batteryPct == null ? "—" : `${Math.round(last.batteryPct)}%`}
                      </div>
                      <div style={{ fontSize: 12, color: "#111827" }}>
                        RSSI: {last.rssi ?? "—"} | SNR: {last.snr ?? "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "#111827" }}>
                        Time: {new Date(last.receivedAt).toLocaleString()}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              </div>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
