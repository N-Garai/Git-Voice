import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useRoute, navigate } from "./lib/router";
import { api, ApiError } from "./lib/api";
import { GearLogo } from "./components/Chrome";
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
      <div className="split-gate">
        <aside className="auth-brand">
          <a
            href="/"
            className="brand"
            onClick={(e) => { e.preventDefault(); navigate("/"); }}
          >
            <GearLogo />
            <span>git<em>-</em>voice</span>
          </a>
          <div>
            <p className="auth-kicker">TWENTY SECONDS · ONE REPRODUCIBLE ISSUE</p>
            <h2>
              Client complaints,
              <br />
              <span className="auth-accent">engineering-grade issues.</span>
            </h2>
            <p className="auth-brand-sub">
              Point the widget at any site. Complaints arrive as issues with the suspected
              file, severity and console history attached — calm proof, not chaos.
            </p>
            <div className="auth-visual" aria-hidden="true">
              <span className="aic-ring"></span>
              <div className="aic-card">
                <p className="aic-kicker">SEVERITY · BLOCKER</p>
                <p className="aic-title">Coupon code rejected at checkout.</p>
                <span className="aic-bar w1"></span>
                <span className="aic-bar w2"></span>
                <span className="aic-bar w3"></span>
                <p className="aic-done">
                  <i></i>filed to src/lib/api/coupon.ts
                </p>
              </div>
              <div className="aic-chip">
                <span>&rarr;</span> 1 issue · 12 s
              </div>
            </div>
          </div>
          <p className="auth-brand-foot">the machine keeps the record straight.</p>
        </aside>
        <main className="auth-panel">
          <div className="auth-panel-top">
            <a href="/demo" className="auth-pill" onClick={(e) => { e.preventDefault(); navigate("/demo"); }}>
              Interactive demo
            </a>
            <a href="/" className="auth-toplink" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
              Back to the homepage ↗
            </a>
          </div>
          <a href="/" className="brand auth-mini-brand" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
            <GearLogo size={24} />
            <span>git<em>-</em>voice</span>
          </a>
          <div className="auth-body">
            <p className="auth-eyebrow">01 / SIGN IN</p>
            <h1>Welcome back.</h1>
            <p className="auth-sub">
              A private workspace for the sites you listen to — reports, drafts and
              invoices, all tied to your GitHub account.
            </p>
            <a className="btn btn-primary auth-github-btn" href="/api/auth/github">
              <span className="auth-github-label">
                <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                Sign in / Sign up with GitHub
              </span>
              <span className="auth-btn-arrow" aria-hidden="true">↗</span>
            </a>
            <p className="auth-newhere">
              New here? <strong>One tap creates the workspace</strong> — no form, no password.
            </p>
            <p className="auth-note">
              Issues are always filed under your own GitHub identity. We request only the
              access needed to index repositories and publish issues.
            </p>
          </div>
          <p className="auth-panel-foot">git-voice auth · apache-2.0 · your github account is the account</p>
        </main>
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
