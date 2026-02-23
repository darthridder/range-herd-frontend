import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  Circle,
  Polygon,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { API_URL, WS_URL } from "../config";

type LivePoint = {
  deviceId: string;
  lat: number;
  lon: number;
  altM?: number | null;
  receivedAt?: string;
  ts?: string;

  batteryPct?: number | null;
  batteryV?: number | null;
  rssi?: number | null;
  snr?: number | null;
  temperatureC?: number | null;
  fCnt?: number | null;
};

type DeviceRow = {
  deviceId: string;
  devEui?: string | null;
  name?: string | null;
  lastSeen?: string | null;
  createdAt?: string;
};

type Geofence = {
  id: string;
  name: string;
  type: "circle" | "polygon" | string;
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  polygon: any; // stored JSON
  createdAt?: string;
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

// Movement filtering: moving only if last 2 consecutive moves exceed threshold
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

// ---- Geofence helpers ----
function coercePolygonLatLngs(polygon: any): [number, number][] | null {
  if (!polygon) return null;

  // Accept common shapes:
  // 1) [[lat, lon], [lat, lon], ...]
  if (Array.isArray(polygon) && polygon.length > 0 && Array.isArray(polygon[0])) {
    const first = polygon[0];

    // [[lat, lon], ...]
    if (typeof first[0] === "number" && typeof first[1] === "number") {
      return polygon.map((pair: any) => [Number(pair[0]), Number(pair[1])] as [number, number]);
    }

    // [[{lat, lon}, ...]]  (nested ring)
    if (typeof first[0] === "object" && first[0]?.lat != null && first[0]?.lon != null) {
      return (polygon[0] as any[]).map(
        (pt: any) => [Number(pt.lat), Number(pt.lon)] as [number, number]
      );
    }
  }

  // 2) [{lat, lon}, ...]
  if (Array.isArray(polygon) && polygon.length > 0 && typeof polygon[0] === "object") {
    const pt = polygon[0];
    if (pt?.lat != null && pt?.lon != null) {
      return (polygon as any[]).map(
        (x: any) => [Number(x.lat), Number(x.lon)] as [number, number]
      );
    }
  }

  // 3) GeoJSON-ish: { coordinates: [[[lon,lat],...]] }
  if (typeof polygon === "object" && polygon?.coordinates) {
    const coords = polygon.coordinates;
    // Expect first ring
    const ring = coords?.[0];
    if (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0])) {
      const c0 = ring[0];
      if (typeof c0[0] === "number" && typeof c0[1] === "number") {
        // GeoJSON is [lon,lat]
        return ring.map((c: any) => [Number(c[1]), Number(c[0])] as [number, number]);
      }
    }
  }

  return null;
}

export default function Dashboard({ token, user, onLogout }: DashboardProps) {
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [unclaimed, setUnclaimed] = useState<DeviceRow[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const [pointsByDevice, setPointsByDevice] = useState<Record<string, LivePoint[]>>({});
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  // Geofences
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [showGeofences, setShowGeofences] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const fetchJson = useCallback(
    async (path: string) => {
      const url = `${API_URL}${path}`;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, { headers });

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

  const loadUnclaimed = useCallback(async () => {
    const data = await fetchJson("/api/devices/unclaimed");
    setUnclaimed(data);
  }, [fetchJson]);

  const loadLatestPoints = useCallback(async () => {
    const data = await fetchJson("/api/live/latest");

    const by: Record<string, LivePoint[]> = {};
    for (const p of data as LivePoint[]) {
      if (!p?.deviceId) continue;
      if (!by[p.deviceId]) by[p.deviceId] = [];
      by[p.deviceId].push(p);
    }

    setPointsByDevice((prev) => {
      const merged: Record<string, LivePoint[]> = { ...prev };

      for (const [id, pts] of Object.entries(by)) {
        const existing = merged[id] || [];
        const next = [...existing, ...pts];

        // de-dupe
        const seen = new Set<string>();
        const deduped: LivePoint[] = [];
        for (const x of next) {
          const key = `${x.ts || x.receivedAt || ""}-${x.lat}-${x.lon}-${x.fCnt ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(x);
        }

        deduped.sort(
          (a, b) =>
            new Date(a.ts || a.receivedAt || 0).getTime() -
            new Date(b.ts || b.receivedAt || 0).getTime()
        );

        merged[id] = deduped.slice(-120);
      }

      return merged;
    });
  }, [fetchJson]);

  const loadGeofences = useCallback(async () => {
    const data = await fetchJson("/api/geofences");
    setGeofences(data);
  }, [fetchJson]);

  const claimDevice = useCallback(
    async (deviceId: string) => {
      setClaimingId(deviceId);
      try {
        const res = await fetch(`${API_URL}/api/devices/claim`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ deviceId }),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Claim failed: ${res.status} ${res.statusText} ${t}`);
        }

        await loadDevices();
        await loadUnclaimed();
        await loadLatestPoints();
        await loadGeofences();
      } finally {
        setClaimingId(null);
      }
    },
    [token, loadDevices, loadUnclaimed, loadLatestPoints, loadGeofences]
  );

  // Initial load + polling
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoadStatus("loading");
        await loadDevices();
        await loadUnclaimed();
        await loadLatestPoints();
        await loadGeofences();
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
        await loadUnclaimed();
        await loadLatestPoints();
        // geofences change less often; refresh every poll anyway is fine
        await loadGeofences();
      } catch (e) {
        console.error("poll error", e);
      }
    }, 30000);

    return () => {
      mounted = false;
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [loadDevices, loadUnclaimed, loadLatestPoints, loadGeofences]);

  // WebSocket – connect to backend
  const connectWs = useCallback(() => {
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setWsStatus("connecting");

      const ws = new WebSocket(`${WS_URL}/api/live`);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("connected");

      ws.onmessage = async () => {
        try {
          await loadLatestPoints();
          await loadDevices();
          await loadUnclaimed();
        } catch {}
      };

      ws.onerror = () => setWsStatus("error");

      ws.onclose = () => {
        setWsStatus("reconnecting");
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => connectWs(), 1500) as any;
      };
    } catch (e) {
      console.error("WS connect failed", e);
      setWsStatus("error");
    }
  }, [loadLatestPoints, loadDevices, loadUnclaimed]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWs]);

  const deviceIds = useMemo(() => Object.keys(pointsByDevice), [pointsByDevice]);

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

  const allPoints = useMemo(() => Object.values(pointsByDevice).flat(), [pointsByDevice]);

  const mapCenter = useMemo<[number, number]>(() => {
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
  }, [allPoints]);

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
          width: 340,
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

        <div style={{ height: 10 }} />
        <div style={{ fontSize: 12, color: "#cbd5e1", opacity: 0.9, marginBottom: 10 }}>
          {loadStatus === "loading" ? "Loading…" : loadStatus === "error" ? "Error loading data" : "Live map"}
        </div>

        {/* Geofence toggle */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showGeofences}
              onChange={(e) => setShowGeofences(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "#e5e7eb", fontWeight: 800 }}>Show geofences</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>({geofences.length})</span>
          </label>
        </div>

        {/* Unclaimed devices */}
        <div style={{ marginTop: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Unclaimed devices</div>

          {unclaimed.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>None found.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {unclaimed.slice(0, 8).map((d) => (
                <div
                  key={d.deviceId}
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 10,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13, color: "white" }}>{d.deviceId}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                    Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "—"}
                  </div>

                  <button
                    onClick={() => claimDevice(d.deviceId)}
                    disabled={claimingId === d.deviceId}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      borderRadius: 10,
                      border: "1px solid rgba(34,197,94,0.7)",
                      background: "rgba(34,197,94,0.12)",
                      color: "#e5e7eb",
                      padding: "8px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 800,
                      opacity: claimingId === d.deviceId ? 0.7 : 1,
                    }}
                  >
                    {claimingId === d.deviceId ? "Claiming…" : "Claim to my ranch"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Claimed devices */}
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Devices</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {devices.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>No devices yet.</div>
          ) : (
            devices.map((d) => {
              const id = d.deviceId;
              const pts = pointsByDevice[id] || [];
              const last = pts[pts.length - 1];

              const motion = motionByDevice[id] ?? "unknown";
              const motionLabel = motion === "moving" ? "Moving" : motion === "stationary" ? "Stationary" : "—";
              const motionColor = motion === "moving" ? "#22c55e" : motion === "stationary" ? "#93c5fd" : "#6b7280";

              const bPct = last?.batteryPct ?? null;

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
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{d.name || id}</div>
                    <div style={{ fontSize: 12, color: "#cbd5e1" }}>{bPct != null ? `${bPct.toFixed(0)}%` : "—"}</div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>Last</div>
                      <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                        {last?.receivedAt
                          ? new Date(last.receivedAt).toLocaleTimeString()
                          : d.lastSeen
                          ? new Date(d.lastSeen).toLocaleTimeString()
                          : "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>Status</div>
                      <div style={{ color: motionColor, fontWeight: 800, fontSize: 12 }}>{motionLabel}</div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>GPS</div>
                      <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                        {last?.lat != null && last?.lon != null ? `${last.lat.toFixed(4)}, ${last.lon.toFixed(4)}` : "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>Battery</div>
                      <div style={{ color: "#e5e7eb", fontSize: 11 }}>
                        {last?.batteryPct != null ? `${last.batteryPct.toFixed(0)}%` : "—"}{" "}
                        {last?.batteryV != null ? `(${last.batteryV.toFixed(2)}V)` : ""}
                      </div>
                    </div>
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

          {/* Geofences overlay */}
          {showGeofences &&
            geofences.map((g) => {
              if (g.type === "circle") {
                if (g.centerLat == null || g.centerLon == null || g.radiusM == null) return null;
                return (
                  <Circle
                    key={g.id}
                    center={[g.centerLat, g.centerLon]}
                    radius={g.radiusM}
                    pathOptions={{ weight: 2 }}
                  >
                    <Tooltip sticky>{g.name}</Tooltip>
                  </Circle>
                );
              }

              if (g.type === "polygon") {
                const latlngs = coercePolygonLatLngs(g.polygon);
                if (!latlngs || latlngs.length < 3) return null;

                return (
                  <Polygon key={g.id} positions={latlngs} pathOptions={{ weight: 2 }}>
                    <Tooltip sticky>{g.name}</Tooltip>
                  </Polygon>
                );
              }

              return null;
            })}

          {/* Markers for claimed devices */}
          {devices.map((d) => {
            const id = d.deviceId;
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
                    <div style={{ fontWeight: 900 }}>{d.name || id}</div>
                    <div>🕐 {p.receivedAt ? new Date(p.receivedAt).toLocaleString() : "—"}</div>
                    <div>
                      📍 {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                    </div>
                    <div>
                      🔋 {p.batteryPct != null ? `${p.batteryPct.toFixed(0)}%` : "—"}{" "}
                      {p.batteryV != null ? `(${p.batteryV.toFixed(2)}V)` : ""}
                    </div>
                    <div>
                      📶 RSSI/SNR: {p.rssi ?? "—"} / {p.snr ?? "—"}
                    </div>
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