import { useState, useEffect } from "react";
import { API_URL } from "../config";

type Alert = {
  id: string;
  deviceId: string;
  type: string;
  severity: string;
  message: string;
  lat: number | null;
  lon: number | null;
  isRead: boolean;
  createdAt: string;
  device: { name: string | null; deviceId: string };
  geofence: { name: string };
};

type AlertPanelProps = {
  token: string;
  onAlertClick: (lat: number, lon: number) => void;
};

export default function AlertPanel({ token, onAlertClick }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 10000); // Refresh alerts every 10s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, showUnreadOnly]);

  const loadAlerts = async () => {
    try {
      const params = showUnreadOnly ? "?unreadOnly=true" : "";
      const res = await fetch(`${API_URL}/api/alerts${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error("Failed to load alerts:", err);
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/alerts/${id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)));
      }
    } catch (err) {
      console.error("Failed to mark alert as read:", err);
    }
  };

  const markAllRead = async () => {
    try {
      const res = await fetch(`${API_URL}/api/alerts/read-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
      }
    } catch (err) {
      console.error("Failed to mark all alerts read:", err);
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>Loading alerts…</div>;
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#e5e7eb" }}>
          🚨 Alerts ({alerts.length})
        </div>

        <button
          onClick={markAllRead}
          style={{
            padding: "4px 8px",
            fontSize: 11,
            background: "#111827",
            color: "#e5e7eb",
            border: "1px solid #374151",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Mark all read
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12, color: "#9ca3af" }}>
        <input
          type="checkbox"
          checked={showUnreadOnly}
          onChange={(e) => setShowUnreadOnly(e.target.checked)}
        />
        Show unread only
      </label>

      {alerts.length === 0 && (
        <div style={{ padding: 16, background: "#1e2a3a", borderRadius: 6, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>
          No alerts.
        </div>
      )}

      {alerts.map((a) => (
        <div
          key={a.id}
          style={{
            marginBottom: 8,
            padding: 12,
            background: a.isRead ? "#111827" : "#1f2937",
            border: "1px solid #374151",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e7eb" }}>
              {a.device?.name || a.deviceId}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              {new Date(a.createdAt).toLocaleString()}
            </div>
          </div>

          <div style={{ marginTop: 6, fontSize: 12, color: "#e5e7eb" }}>{a.message}</div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {a.lat != null && a.lon != null && (
              <button
                onClick={() => onAlertClick(a.lat!, a.lon!)}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  background: "#0b1220",
                  color: "#e5e7eb",
                  border: "1px solid #374151",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                View on map
              </button>
            )}

            {!a.isRead && (
              <button
                onClick={() => markRead(a.id)}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  background: "#064e3b",
                  color: "#d1fae5",
                  border: "1px solid #065f46",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Mark read
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
