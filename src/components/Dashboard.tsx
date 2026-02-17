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

    ws.onerror = () => { if (isMounted.current) onStatusChange("error"); };

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
    connected: "#22c55e", connecting: "#f59e0b", reconnecting: "#f59e0b",
    closed: "#6b7280", error: "#ef4444",
  };
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: colors[status], marginRight: 6,
      boxShadow: status === "connected" ? `0 0 6px ${colors[status]}` : "none",
    }} />
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
      const devices = (await fetch("/api/devices", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json())) as DeviceRow[];

      const latestList = await Promise.allSettled(
        devices.map((d) =>
          fetch(`/api/devices/${encodeURIComponent(d.deviceId)}/latest`, {
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

  const handleMessage = useCallback((msg: UplinkMessage) => {
    if (msg.type === "uplink") {
      const p = msg.data;
      if (!p.deviceId) return;
      setPointsByDevice((prev) => {
        const existing = prev[p.deviceId] ?? [];
        return { ...prev, [p.deviceId]: [...existing, p].slice(-100) };
      });
    } else if (msg.type === "alert") {
      // Reload panels when new alert arrives
      loadInitial();
    }
  }, [loadInitial]);

  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/live`;

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
    <div style={{
      height: "100vh", width: "100vw",
      display: "grid", gridTemplateColumns: "340px 1fr",
      background: "#0f1117", color: "#e5e7eb",
      fontFamily: "'Inter', system-ui, sans-serif", overflow: "hidden",
    }}>

      <div style={{
        display: "flex", flexDirection: "column",
        background: "#161b27", borderRight: "1px solid #1f2937", overflow: "hidden",
      }}>
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid #1f2937", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 22 }}>🐄</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", flex: 1 }}>
              Range Herd Tech
            </h1>
            <button
              onClick={() => setShowPanel(showPanel === "alerts" ? "none" : "alerts")}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 500,
                background: showPanel === "alerts" ? "#22c55e" : "#374151",
                color: "#e5e7eb", border: "1px solid #4b5563",
                borderRadius: 4, cursor: "pointer", marginRight: 4,
              }}
            >
              🚨
            </button>
            <button
              onClick={() => setShowPanel(showPanel === "geofences" ? "none" : "geofences")}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 500,
                background: showPanel === "geofences" ? "#22c55e" : "#374151",
                color: "#e5e7eb", border: "1px solid #4b5563",
                borderRadius: 4, cursor: "pointer", marginRight: 4,
              }}
            >
              🗺️
            </button>

            <button
              onClick={() => setShowPanel(showPanel === "team" ? "none" : "team")}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 500,
                background: showPanel === "team" ? "#22c55e" : "#374151",
                color: "#e5e7eb", border: "1px solid #4b5563",
                borderRadius: 4, cursor: "pointer", marginRight: 4,
     }}
   >
     👥
   </button>
            <button
              onClick={onLogout}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 500,
                background: "#374151", color: "#e5e7eb",
                border: "1px solid #4b5563", borderRadius: 4,
                cursor: "pointer", transition: "all 0.15s",
              }}
              
              onMouseEnter={(e) => { e.currentTarget.style.background = "#4b5563"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#374151"; }}
            >
              Logout
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            {user.ranchName || "My Ranch"} • {user.name || user.email}
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#9ca3af", flexWrap: "wrap" }}>
            <span>
              <StatusDot status={wsStatus} />
              {wsStatus === "reconnecting" ? "Reconnecting…" : wsStatus}
            </span>
            <span style={{ color: loadStatus === "error" ? "#ef4444" : "#9ca3af" }}>
              {loadStatus === "loading" && "⏳ Loading…"}
              {loadStatus === "ready" && `✓ ${deviceIds.length} device${deviceIds.length !== 1 ? "s" : ""}`}
              {loadStatus === "error" && "⚠ Load failed"}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
          {showPanel === "team" && (
            <TeamPanel
            token={token!}
            currentUserId={user.id}
     />
   )}
          {showPanel === "alerts" && (
            <AlertPanel
              token={token!}
              onAlertClick={handleAlertClick}
            />
          )}

          {showPanel === "geofences" && (
            <GeofencePanel
              token={token!}
              onGeofenceCreated={loadInitial}
              onGeofenceDeleted={loadInitial}
            />
          )}

          {showPanel === "none" && (
            <>
              {loadStatus === "loading" && (
                <div style={{ padding: "24px 16px", color: "#6b7280", textAlign: "center", fontSize: 13 }}>
                  Loading devices…
                </div>
              )}
              {loadStatus === "ready" && deviceIds.length === 0 && (
                <div style={{ padding: "24px 16px", color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 8, fontSize: 28 }}>📡</div>
                  No devices yet. Waiting for uplinks from TTN…
                </div>
              )}
              {loadStatus === "error" && (
                <div style={{ padding: "16px", color: "#ef4444", fontSize: 13 }}>
                  ⚠ Failed to load devices. Check backend.
                </div>
              )}

              {deviceIds.map((id) => {
                const arr = pointsByDevice[id];
                const last = arr[arr.length - 1];
                const color = getDeviceColor(id, deviceIds);
                const isSelected = selectedDevice === id;
                const bPct = last?.batteryPct ?? null;

                return (
                  <div key={id} onClick={() => setSelectedDevice(isSelected ? null : id)}
                    style={{
                      margin: "4px 8px", padding: "12px", borderRadius: 8, cursor: "pointer",
                      background: isSelected ? "#1e2a3a" : "transparent",
                      border: `1px solid ${isSelected ? color + "60" : "transparent"}`,
                      transition: "all 0.15s ease",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%", background: color,
                        flexShrink: 0, boxShadow: `0 0 6px ${color}`,
                      }} />
                      <strong style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {id}
                      </strong>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px", fontSize: 12, color: "#9ca3af" }}>
                      <div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>Last seen</div>
                        <div style={{ color: "#e5e7eb" }}>
                          {last?.receivedAt ? new Date(last.receivedAt).toLocaleTimeString() : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>Battery</div>
                        <div style={{ color: batteryColor(bPct), fontWeight: 600 }}>
                          {bPct != null ? `${bPct.toFixed(0)}%` : "—"}
                          {last?.batteryV != null ? ` (${last.batteryV.toFixed(2)}V)` : ""}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>RSSI / SNR</div>
                        <div style={{ color: "#e5e7eb" }}>{last?.rssi ?? "—"} / {last?.snr ?? "—"}</div>
                      </div>
                      <div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>GPS</div>
                        <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                          {last?.lat != null && last?.lon != null
                            ? `${last.lat.toFixed(4)}, ${last.lon.toFixed(4)}`
                            : "—"}
                        </div>
                      </div>
                      {last?.tempC != null && (
                        <div>
                          <div style={{ color: "#6b7280", fontSize: 11 }}>Temp</div>
                          <div style={{ color: "#e5e7eb" }}>{last.tempC.toFixed(1)}°C</div>
                        </div>
                      )}
                      {last?.altM != null && (
                        <div>
                          <div style={{ color: "#6b7280", fontSize: 11 }}>Altitude</div>
                          <div style={{ color: "#e5e7eb" }}>{last.altM.toFixed(0)}m</div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 8, fontSize: 11, color: "#4b5563" }}>
                      {arr.length} point{arr.length !== 1 ? "s" : ""} in trail
                      {isSelected && <span style={{ color, marginLeft: 6 }}>● focused</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div style={{
          padding: "10px 16px", borderTop: "1px solid #1f2937",
          fontSize: 11, color: "#374151", flexShrink: 0,
        }}>
          Range Herd Tech · LoRa Cattle Tracking
        </div>
      </div>

      <MapContainer
        center={mapCenter ?? [32.9563, -96.3894]}
        zoom={15}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapCenter && <MapRecenter center={mapCenter} />}

        {deviceIds.map((id) => {
          if (selectedDevice && selectedDevice !== id) return null;
          const arr = pointsByDevice[id];
          const last = arr[arr.length - 1];
          const color = getDeviceColor(id, deviceIds);
          const trail: [number, number][] = arr
            .filter((p) => p.lat != null && p.lon != null)
            .map((p) => [p.lat as number, p.lon as number]);

          if (!last || last.lat == null || last.lon == null) return null;

          return (
            <div key={id}>
              {trail.length > 1 && (
                <Polyline positions={trail} pathOptions={{ color, weight: 2, opacity: 0.7 }} />
              )}
              <Marker position={[last.lat, last.lon]} icon={createColoredIcon(color)}>
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <strong style={{ display: "block", marginBottom: 6 }}>{id}</strong>
                    <div style={{ fontSize: 12, lineHeight: 1.8, color: "#374151" }}>
                      <div>🕐 {new Date(last.receivedAt).toLocaleString()}</div>
                      <div>🔋 {last.batteryPct != null ? `${last.batteryPct.toFixed(0)}%` : "—"} ({last.batteryV ?? "—"}V)</div>
                      <div>📡 RSSI: {last.rssi ?? "—"} / SNR: {last.snr ?? "—"}</div>
                      {last.tempC != null && <div>🌡 {last.tempC.toFixed(1)}°C</div>}
                      {last.altM != null && <div>⛰ {last.altM.toFixed(0)}m alt</div>}
                    </div>
                  </div>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>
    </div>
  );
}
