import { useState, useEffect } from "react";
import { API_URL } from '../config';

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
    } catch (err) {
      console.error("Failed to load team:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInviteUrl("");

    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send invitation");
        return;
      }

      setInviteUrl(data.inviteUrl);
      setInviteEmail("");
      loadTeam();
    } catch (err) {
      setError("Network error");
    }
  };

  const handleCancelInvite = async (id: string) => {
    if (!confirm("Cancel this invitation?")) return;

    try {
      const res = await fetch(`/api/team/invitations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        loadTeam();
      }
    } catch (err) {
      console.error("Failed to cancel invitation:", err);
    }
  };

  const handleRemoveMember = async (id: string, email: string) => {
    if (!confirm(`Remove ${email} from the team?`)) return;

    try {
      const res = await fetch(`/api/team/members/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to remove member");
        return;
      }

      loadTeam();
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
        Loading team...
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#e5e7eb" }}>
          👥 Team ({members.length})
        </div>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          style={{
            padding: "4px 8px",
            fontSize: 11,
            background: showInviteForm ? "#374151" : "#22c55e",
            color: "#fff",
            border: "1px solid #4b5563",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {showInviteForm ? "Cancel" : "+ Invite"}
        </button>
      </div>

      {showInviteForm && (
        <form onSubmit={handleInvite} style={{ marginBottom: 16, padding: 12, background: "#1e2a3a", borderRadius: 6 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#9ca3af" }}>
              Email
            </label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: 13,
                background: "#0f1117",
                border: "1px solid #374151",
                borderRadius: 4,
                color: "#e5e7eb",
              }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#9ca3af" }}>
              Role
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: 13,
                background: "#0f1117",
                border: "1px solid #374151",
                borderRadius: 4,
                color: "#e5e7eb",
              }}
            >
              <option value="viewer">Viewer (read-only)</option>
              <option value="owner">Owner (full access)</option>
            </select>
          </div>
          {error && (
            <div style={{ padding: 8, marginBottom: 8, background: "#7f1d1d", border: "1px solid #991b1b", borderRadius: 4, fontSize: 12, color: "#fecaca" }}>
              {error}
            </div>
          )}
          {inviteUrl && (
            <div style={{ padding: 8, marginBottom: 8, background: "#1e3a1e", border: "1px solid #22c55e", borderRadius: 4 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Share this link:</div>
              <input
                type="text"
                value={inviteUrl}
                readOnly
                onClick={(e) => e.currentTarget.select()}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  fontSize: 11,
                  background: "#0f1117",
                  border: "1px solid #374151",
                  borderRadius: 4,
                  color: "#22c55e",
                }}
              />
            </div>
          )}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "6px",
              fontSize: 12,
              fontWeight: 600,
              background: "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Send Invitation
          </button>
        </form>
      )}

      {invitations.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", marginBottom: 8 }}>
            Pending Invitations ({invitations.length})
          </div>
          {invitations.map((inv) => (
            <div
              key={inv.id}
              style={{
                marginBottom: 6,
                padding: 10,
                background: "#1e2a3a",
                border: "1px solid #f59e0b",
                borderRadius: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#e5e7eb", marginBottom: 2 }}>
                    {inv.email}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af" }}>
                    {inv.role} • Expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleCancelInvite(inv.id)}
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    background: "#7f1d1d",
                    color: "#fecaca",
                    border: "1px solid #991b1b",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", marginBottom: 8 }}>
        Members
      </div>
      {members.map((member) => {
        const isCurrentUser = member.userId === currentUserId;
        const isOwner = member.role === "owner";

        return (
          <div
            key={member.id}
            style={{
              marginBottom: 6,
              padding: 10,
              background: "#1e2a3a",
              border: "1px solid #374151",
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#e5e7eb", marginBottom: 2 }}>
                  {member.name || member.email}
                  {isCurrentUser && <span style={{ marginLeft: 6, fontSize: 10, color: "#22c55e" }}>(You)</span>}
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>
                  {member.email}
                  <span
                    style={{
                      marginLeft: 8,
                      padding: "2px 6px",
                      background: isOwner ? "#22c55e" : "#3b82f6",
                      color: "#fff",
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    {member.role}
                  </span>
                </div>
              </div>
              {!isCurrentUser && !isOwner && (
                <button
                  onClick={() => handleRemoveMember(member.id, member.email)}
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
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
          </div>
        );
      })}
    </div>
  );
}
