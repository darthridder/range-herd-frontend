import { useState, useEffect } from "react";

type Geofence = {
  id: string;
  name: string;
  type: string;
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  polygon: any;
  createdAt: string;
};

type GeofencePanelProps = {
  token: string;
  onGeofenceCreated: () => void;
  onGeofenceDeleted: () => void;
};

export default function GeofencePanel({
  token,
  onGeofenceCreated,
  onGeofenceDeleted,
}: GeofencePanelProps) {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGeofences();
  }, [token]);

  const loadGeofences = async () => {
    try {
      const res = await fetch("/api/geofences", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGeofences(data);
        onGeofenceCreated(); // notify parent that geofences are up-to-date
      }
    } catch (err) {
      console.error("Failed to load geofences:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this geofence? This will also delete associated alerts.")) return;

    try {
      const res = await fetch(`/api/geofences/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setGeofences((prev) => prev.filter((g) => g.id !== id));
        onGeofenceDeleted();
      }
    } catch (err) {
      console.error("Failed to delete geofence:", err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
        Loading geofences...
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#e5e7eb" }}>
        🗺️ Geofences ({geofences.length})
      </div>

      {geofences.length === 0 && (
        <div style={{ padding: 16, background: "#1e2a3a", borderRadius: 6, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>
          No geofences yet. Draw one on the map to get started.
        </div>
      )}

      {geofences.map((fence) => (
        <div
          key={fence.id}
          style={{
            marginBottom: 8,
            padding: 12,
            background: "#1e2a3a",
            border: "1px solid #374151",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ fontSize: 13, color: "#e5e7eb" }}>{fence.name}</strong>
            <button
              onClick={() => handleDelete(fence.id)}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                background: "#7f1d1d",
                color: "#fecaca",
                border: "1px solid #991b1b",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            Type: {fence.type === "circle" ? "Circle" : "Polygon"}
            {fence.type === "circle" && fence.radiusM && (
              <span> • {(fence.radiusM / 1000).toFixed(2)} km radius</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Created: {new Date(fence.createdAt).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  );
}