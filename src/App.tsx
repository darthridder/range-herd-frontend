import { useState, useEffect } from "react";
import Login from "./components/Login";
import Register from "./components/Register";
import Dashboard from "./components/Dashboard";

type AuthView = "login" | "register" | "dashboard";

export default function App() {
  const [view, setView] = useState<AuthView>("login");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    const token = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");

    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setView("dashboard");
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      }
    }

    setLoading(false);
  }, []);

  const handleLogin = (token: string, userData: any) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
    setView("dashboard");
  };

  const handleRegister = (token: string, userData: any) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
    setView("dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
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

  return <Dashboard user={user} onLogout={handleLogout} />;
}