import { useState, useEffect } from "react";

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
    const interval = setInterval(loadAlerts, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [token, showUnreadOnly]);

  const loadAlerts = async () => {
    try {
      const params = showUnreadOnly ? "?unreadOnly=true" : "";
      const res = await fetch(`/api/alerts${params}`, {
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

  const markAsRead = async (id: string) => {
    try {
      const res = await fetch(`/api/alerts/${id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, isRead: true } : a))
        );
      }
    } catch (err) {
      console.error("Failed to mark alert as read:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const res = await fetch("/api/alerts/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        loadAlerts();
      }
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const severityColor = (severity: string) => {
    if (severity === "high") return "#ef4444";
    if (severity === "medium") return "#f59e0b";
    return "#9ca3af";
  };

  const unreadCount = alerts.filter((a) => !a.isRead).length;

  if (loading) {
    return (
      <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
        Loading alerts...
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#e5e7eb" }}>
          🚨 Alerts
          {unreadCount > 0 && (
            <span
              style={{
                marginLeft: 8,
                padding: "2px 8px",
                fontSize: 11,
                background: "#ef4444",
                color: "#fff",
                borderRadius: 12,
                fontWeight: 700,
              }}
            >
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              background: "#374151",
              color: "#e5e7eb",
              border: "1px solid #4b5563",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", fontSize: 12, color: "#9ca3af", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showUnreadOnly}
            onChange={(e) => setShowUnreadOnly(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Show unread only
        </label>
      </div>

      {alerts.length === 0 && (
        <div style={{ padding: 16, background: "#1e2a3a", borderRadius: 6, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>
          {showUnreadOnly ? "No unread alerts" : "No alerts"}
        </div>
      )}

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {alerts.map((alert) => (
          <div
            key={alert.id}
            onClick={() => {
              if (alert.lat && alert.lon) onAlertClick(alert.lat, alert.lon);
              if (!alert.isRead) markAsRead(alert.id);
            }}
            style={{
              marginBottom: 8,
              padding: 12,
              background: alert.isRead ? "#1e2a3a" : "#2d1f1f",
              border: `1px solid ${alert.isRead ? "#374151" : severityColor(alert.severity)}`,
              borderRadius: 6,
              cursor: alert.lat && alert.lon ? "pointer" : "default",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: severityColor(alert.severity),
                  marginTop: 4,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#e5e7eb", marginBottom: 4 }}>
                  {alert.message}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  {new Date(alert.createdAt).toLocaleString()}
                </div>
                {!alert.isRead && (
                  <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>
                    • UNREAD
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
