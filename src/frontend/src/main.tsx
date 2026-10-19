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
 * Dashboard shell gates itself: it verifies access with a cheap request and
 * shows a sign-in screen when the server asks for an account. This is a UX
 * convenience only — the server is the real enforcement point.
 */
function DashboardGate(): JSX.Element {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

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

  if (unlocked === false) {
    return (
      <div className="dash-layout shell">
        <div className="card auth-gate">
          <div className="big" aria-hidden="true">🔒</div>
          <h1>Sign in to Git-Voice</h1>
          <p className="text-dim">
            Your reports, projects and invoices stay private to your GitHub account —
            the dashboard has no public view.
          </p>
          <a className="btn btn-primary auth-gate-btn" href="/api/auth/github">
            Sign in with GitHub
          </a>
          <p className="mono-xs text-faint">
            Issues are always filed under your own GitHub identity.
          </p>
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
