import { useCallback, useEffect, useMemo, useState } from "react";

import { API_URL } from "../config";

export type AlertRow = {
  id: string;
  ranchId: string;
  deviceId: string;
  geofenceId: string;
  type: string;
  severity: string;
  message: string;
  lat: number | null;
  lon: number | null;
  isRead: boolean;
  createdAt: string;
  device?: { deviceId: string; name: string | null };
  geofence?: { name: string };
  // Optional fields we may attach when broadcasting
  deviceName?: string | null;
  geofenceName?: string | null;
};

export default function AlertsPanel({
  token,
  incomingAlert,
}: {
  token: string;
  incomingAlert: AlertRow | null;
}) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);

  const unread = useMemo(() => alerts.filter((a) => !a.isRead).length, [alerts]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`alerts load failed: ${res.status}`);
      const data = (await res.json()) as AlertRow[];
      setAlerts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (!incomingAlert) return;

    // Ensure required fields
    const normalized: AlertRow = {
      ...incomingAlert,
      isRead: incomingAlert.isRead ?? false,
      createdAt: incomingAlert.createdAt ?? new Date().toISOString(),
    } as any;

    setAlerts((prev) => {
      if (prev.some((a) => a.id === normalized.id)) return prev;
      return [normalized, ...prev].slice(0, 200);
    });
  }, [incomingAlert]);

  const markRead = useCallback(
    async (id: string) => {
      // optimistic
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)));
      try {
        const res = await fetch(`${API_URL}/api/alerts/${id}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`mark read failed: ${res.status}`);
      } catch (e) {
        console.error(e);
        // revert
        setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: false } : a)));
      }
    },
    [token]
  );

  const markAllRead = useCallback(async () => {
    // optimistic
    setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
    try {
      const res = await fetch(`${API_URL}/api/alerts/read-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`read-all failed: ${res.status}`);
    } catch (e) {
      console.error(e);
      loadAlerts();
    }
  }, [token, loadAlerts]);

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 13 }}>Alerts</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            Unread: <b style={{ color: "#e5e7eb" }}>{unread}</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={loadAlerts}
            disabled={loading}
            style={{
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.06)",
              color: "#e5e7eb",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "…" : "Refresh"}
          </button>

          <button
            onClick={markAllRead}
            style={{
              borderRadius: 10,
              border: "1px solid rgba(59,130,246,0.55)",
              background: "rgba(59,130,246,0.12)",
              color: "#e5e7eb",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            Read all
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
        {alerts.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 12 }}>No alerts yet.</div>
        ) : (
          alerts.slice(0, 50).map((a) => {
            const gfName = a.geofenceName ?? a.geofence?.name ?? a.geofenceId;
            const devName = a.deviceName ?? a.device?.name ?? a.deviceId;

            const badge = a.type === "geofence_exit" ? "EXIT" : a.type === "geofence_enter" ? "ENTER" : a.type;

            return (
              <div
                key={a.id}
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  paddingTop: 10,
                  marginTop: 10,
                  background: a.isRead ? "transparent" : "rgba(255,230,0,0.08)",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 12 }}>
                    {badge} — {gfName}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: "#e5e7eb" }}>
                  <b>{devName}</b> — {a.message}
                </div>

                {!a.isRead ? (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => markRead(a.id)}
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.06)",
                        color: "#e5e7eb",
                        padding: "7px 10px",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      Mark read
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
