import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useRoute } from "./lib/router";
import { api, ApiError } from "./lib/api";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Dashboard from "./pages/Dashboard";
import DemoStore from "./pages/DemoStore";
import "./styles/globals.css";
import "./styles/v2.css";

function App(): JSX.Element {
  const path = useRoute();
  if (path === "/pricing" || path.startsWith("/pricing")) return <Pricing />;
  if (path.startsWith("/dashboard")) return <DashboardGate />;
  if (path.startsWith("/demo")) return <DemoStore />;
  return <Landing />;
}

/**
 * Dashboard shell gates itself: it verifies the API key with a cheap request
 * and shows the unlock screen when the server rejects anonymous access. This
 * is a UX convenience only — the server is the real enforcement point.
 */
function DashboardGate(): JSX.Element {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [token, setTokenState] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const attempt = async () => {
      try {
        await api.projects();
        setUnlocked(true);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setUnlocked(false);
        else setUnlocked(true); // network hiccup: let the page render and report itself
      }
    };
    void attempt();
    const onFocus = () => void attempt();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    localStorage.setItem("gv_token", token.trim());
    window.location.reload();
  };

  if (unlocked === false) {
    return (
      <div className="dash-layout shell">
        <div className="card" style={{ maxWidth: 520, margin: "12vh auto 0" }}>
          <h1 className="dash-title" style={{ marginBottom: 8 }}>Dashboard is locked</h1>
          <p className="text-dim" style={{ fontSize: 14, marginBottom: 18 }}>
            Report data is private. Paste the dashboard token from your deployment's environment
            settings, or sign in with GitHub.
          </p>
          <form onSubmit={submit}>
            <input
              className="coupon-input-field"
              type="password"
              placeholder="Dashboard token"
              value={token}
              onChange={(e) => setTokenState(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            {error && <p className="mono-xs" style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-primary" type="submit">Unlock</button>
          </form>
          <button
            className="btn btn-ghost btn-sm mt-16"
            onClick={() => { window.location.href = "/api/auth/github"; }}
          >
            Sign in with GitHub instead
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
