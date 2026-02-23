import { useState, useEffect } from "react";
import Login from "./components/Login";
import Register from "./components/Register";
import Dashboard from "./components/Dashboard";

type AuthView = "login" | "register" | "dashboard";

export default function App() {
  const [view, setView] = useState<AuthView>("login");
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    const t = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");

    if (t && storedUser) {
      try {
        setToken(t);
        setUser(JSON.parse(storedUser));
        setView("dashboard");
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setToken(null);
        setUser(null);
        setView("login");
      }
    }

    setLoading(false);
  }, []);

  const handleLogin = (newToken: string, userData: any) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
    setView("dashboard");
  };

  const handleRegister = (newToken: string, userData: any) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
    setView("dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    setView("login");
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1117",
          color: "#e5e7eb",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🐄</div>
          <div style={{ fontSize: 14, color: "#9ca3af" }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (view === "login") {
    return <Login onLogin={handleLogin} onSwitchToRegister={() => setView("register")} />;
  }

  if (view === "register") {
    return <Register onRegister={handleRegister} onSwitchToLogin={() => setView("login")} />;
  }

  // Safety: if token missing, force login
  if (!token) {
    setView("login");
    return null;
  }

  return <Dashboard token={token} user={user} onLogout={handleLogout} />;
}