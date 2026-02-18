import { useState, useEffect } from "react";
import { API_URL } from "../config";

type TeamMember = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
};

type TeamPanelProps = {
  token: string;
  currentUserId: string;
};

export default function TeamPanel({ token, currentUserId }: TeamPanelProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadTeam = async () => {
    try {
      setLoading(true);
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`${API_URL}/api/team/members`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/team/invitations`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (membersRes.ok) setMembers(await membersRes.json());
      if (invitesRes.ok) setInvitations(await invitesRes.json());
    } catch (e) {
      console.error("Failed to load team:", e);
    } finally {
      setLoading(false);
    }
  };

  const sendInvite = async () => {
    setError("");
    setInviteUrl("");

    try {
      const res = await fetch(`${API_URL}/api/team/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Invite failed");
        return;
      }

      setInviteUrl(data?.inviteUrl || "");
      setInviteEmail("");
      setShowInviteForm(false);
      loadTeam();
    } catch (e) {
      setError("Invite failed");
    }
  };

  const deleteInvitation = async (id: string) => {
    if (!confirm("Delete this invitation?")) return;

    try {
      const res = await fetch(`${API_URL}/api/team/invitations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) loadTeam();
    } catch (e) {
      console.error("Failed to delete invite:", e);
    }
  };

  const removeMember = async (id: string) => {
    if (!confirm("Remove this team member?")) return;

    try {
      const res = await fetch(`${API_URL}/api/team/members/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) loadTeam();
    } catch (e) {
      console.error("Failed to remove member:", e);
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>Loading team…</div>;
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#e5e7eb" }}>
        👥 Team
      </div>

      <div style={{ marginBottom: 10 }}>
        <button
          onClick={() => setShowInviteForm((s) => !s)}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            background: "#111827",
            color: "#e5e7eb",
            border: "1px solid #374151",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {showInviteForm ? "Cancel" : "Invite member"}
        </button>
      </div>

      {showInviteForm && (
        <div style={{ marginBottom: 12, padding: 12, background: "#1e2a3a", borderRadius: 6, border: "1px solid #374151" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@domain.com"
              style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }}
            >
              <option value="viewer">viewer</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <button
            onClick={sendInvite}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Send invite
          </button>

          {error && <div style={{ marginTop: 8, color: "#fca5a5", fontSize: 12 }}>{error}</div>}

          {inviteUrl && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>
              Invite URL:{" "}
              <span style={{ color: "#e5e7eb", wordBreak: "break-all" }}>{inviteUrl}</span>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 10, fontSize: 12, color: "#9ca3af" }}>
        Members ({members.length})
      </div>

      {members.map((m) => (
        <div
          key={m.id}
          style={{
            marginBottom: 8,
            padding: 10,
            background: "#1e2a3a",
            border: "1px solid #374151",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 700 }}>
              {m.name || m.email}
            </div>
            <div style={{ color: "#9ca3af", fontSize: 12 }}>{m.role}</div>
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>{m.email}</div>

          {m.userId !== currentUserId && !m.id.startsWith("owner:") && (
            <button
              onClick={() => removeMember(m.id)}
              style={{
                marginTop: 8,
                padding: "4px 8px",
                fontSize: 11,
                background: "#7f1d1d",
                color: "#fecaca",
                border: "1px solid #991b1b",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}

      <div style={{ marginTop: 14, marginBottom: 10, fontSize: 12, color: "#9ca3af" }}>
        Invitations ({invitations.length})
      </div>

      {invitations.map((i) => (
        <div
          key={i.id}
          style={{
            marginBottom: 8,
            padding: 10,
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 700 }}>{i.email}</div>
            <div style={{ color: "#9ca3af", fontSize: 12 }}>{i.status}</div>
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
            role: {i.role} • expires: {new Date(i.expiresAt).toLocaleString()}
          </div>

          <button
            onClick={() => deleteInvitation(i.id)}
            style={{
              marginTop: 8,
              padding: "4px 8px",
              fontSize: 11,
              background: "#7f1d1d",
              color: "#fecaca",
              border: "1px solid #991b1b",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Delete invite
          </button>
        </div>
      ))}
    </div>
  );
}
