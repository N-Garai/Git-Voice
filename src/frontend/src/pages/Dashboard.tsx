/** Developer dashboard: issue log, projects + indexing, integration settings. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type IssueRecordDto, type ProjectDto, type IntegrationDto, type GitHubUser, type RepoListing } from "../lib/api";
import { useRoute, navigate } from "../lib/router";
import { GearLogo } from "../components/Chrome";
import { useScrollReveal } from "../hooks/animations";

type View = "issues" | "projects" | "settings";

const VIEW_BY_PATH: Record<string, View> = {
  "/dashboard": "issues",
  "/dashboard/issues": "issues",
  "/dashboard/projects": "projects",
  "/dashboard/settings": "settings"
};

export default function Dashboard(): JSX.Element {
  const path = useRoute();
  const view = VIEW_BY_PATH[path] ?? "issues";
  return (
    <div className="dash-layout shell">
      <DashNav view={view} />
      <div>
        {view === "issues" && <IssuesView />}
        {view === "projects" && <ProjectsView />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}

function DashNav({ view }: { view: View }): JSX.Element {
  const items: Array<{ id: View; label: string; icon: string }> = [
    { id: "issues", label: "Issues", icon: "📄" },
    { id: "projects", label: "Projects", icon: "🗂" },
    { id: "settings", label: "Settings", icon: "⚙" }
  ];
  return (
    <aside className="dash-nav">
      <a href="/" className="brand" style={{ marginBottom: 18 }} onClick={(e) => { e.preventDefault(); navigate("/"); }}>
        <GearLogo size={26} />
        <span style={{ fontSize: 16 }}>git<em style={{ fontStyle: "normal", color: "var(--cyan)" }}>-</em>voice</span>
      </a>
      {items.map((item) => (
        <a
          key={item.id}
          href={`/dashboard/${item.id}`}
          className={view === item.id ? "active" : ""}
          onClick={(e) => { e.preventDefault(); navigate(`/dashboard/${item.id}`); }}
        >
          <span>{item.icon}</span> {item.label}
        </a>
      ))}
    </aside>
  );
}

/* ------------------------------------------------------------------- issues */

function IssuesView(): JSX.Element {
  const [issues, setIssues] = useState<IssueRecordDto[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.issues();
      setIssues(data.issues);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div className="empty"><div className="big">⚠</div>{error}</div>;
  if (!issues) return <div className="empty"><span className="loading-dots"><i /><i /><i /></span></div>;

  return (
    <div>
      <div className="dash-head">
        <h1 className="dash-title">Issue log</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>↻ Refresh</button>
      </div>
      {issues.length === 0 ? (
        <div className="empty">
          <div className="big">🎙</div>
          <p>No reports yet. File one from the <a href="/demo" onClick={(e) => { e.preventDefault(); navigate("/demo"); }}>live demo storefront</a>.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {issues.map((issue, i) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              index={i}
              expanded={expanded === issue.id}
              onToggle={() => setExpanded(expanded === issue.id ? null : issue.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueCard({
  issue,
  index,
  expanded,
  onToggle
}: {
  issue: IssueRecordDto;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const r = issue.result;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const reveal = useScrollReveal<HTMLDivElement>();

  const hasAudio = issue.audioMime !== undefined;

  const playAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
      el.onended = () => setPlaying(false);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="issue-card" style={{ animationDelay: `${Math.min(index, 10) * 60}ms` }} ref={reveal.ref}>
      <div className="row1" style={{ cursor: "pointer" }} onClick={onToggle}>
        <span className={`status-pill ${issue.status}`}>{issue.status}</span>
        <span className="title">{r?.draft.title ?? "(drafting…)"}</span>
        {r && <span className={`sev-pill ${r.draft.severity}`}>{r.draft.severity}</span>}
        <span className="mono-xs text-faint">{new Date(issue.createdAt).toLocaleTimeString()}</span>
        <span className="mono-xs text-faint">{expanded ? "▲" : "▼"}</span>
      </div>

      <div className="row2">
        {r?.draft.suspectedFile && <span className="f">{r.draft.suspectedFile.split("/").pop()}</span>}
        {r && <span>{r.matches.length} file matches</span>}
        {r?.consoleCorrelations.length ? <span>{r.consoleCorrelations.length} correlations</span> : null}
        <span>{issue.telemetry.route}</span>
        <span>{issue.telemetry.viewport.w}×{issue.telemetry.viewport.h}</span>
      </div>

      <div className="trace">
        {issue.trace.map((t) => (
          <span key={t.stepId} className={`t ${t.status === "completed" ? "done" : t.status === "running" ? "run" : t.status === "failed" ? "fail" : "skip"}`}>
            {t.name}
            {t.durationMs !== undefined ? ` ${t.durationMs}ms` : ""}
          </span>
        ))}
      </div>

      <div className="actions">
        {hasAudio && (
          <>
            <audio ref={audioRef} src={`/api/issues/${issue.id}/audio`} preload="none" />
            <button className={`audio-btn${playing ? " playing" : ""}`} onClick={playAudio}>
              {playing ? (
                <span className="eq"><i /><i /><i /><i /></span>
              ) : (
                "▶"
              )}
              {playing ? "Playing client's voice" : "Listen to the client"}
            </button>
          </>
        )}
        {r?.github.issueUrl ? (
          <a className="gh-link" href={r.github.issueUrl} target="_blank" rel="noopener">
            View on GitHub ↗
          </a>
        ) : r?.github.reason ? (
          <span className="mono-xs text-faint" title={r.github.reason}>draft (publishing off)</span>
        ) : null}
        {r && (
          <a className="gh-link" href={`/api/issues/${issue.id}/body.md`} target="_blank" rel="noopener">
            Raw markdown
          </a>
        )}
      </div>

      {expanded && r && (
        <div className="mt-16" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <p className="text-dim" style={{ marginBottom: 12 }}>{r.draft.summary}</p>

          <div className="mono-xs text-faint" style={{ marginBottom: 6 }}>REPRODUCTION STEPS</div>
          <ol style={{ color: "var(--ink-dim)", fontSize: 14, paddingLeft: 22, marginBottom: 16 }}>
            {r.draft.reproSteps.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{s}</li>
            ))}
          </ol>

          <div className="grid-2" style={{ gap: 12, marginBottom: 14 }}>
            <div>
              <div className="mono-xs text-faint" style={{ marginBottom: 4 }}>EXPECTED</div>
              <p className="text-dim" style={{ fontSize: 13.5 }}>{r.draft.expected}</p>
            </div>
            <div>
              <div className="mono-xs text-faint" style={{ marginBottom: 4 }}>ACTUAL</div>
              <p className="text-dim" style={{ fontSize: 13.5 }}>{r.draft.actual}</p>
            </div>
          </div>

          {issue.transcript && (
            <>
              <div className="mono-xs text-faint" style={{ marginBottom: 4 }}>CLIENT TRANSCRIPT</div>
              <p className="text-pink" style={{ fontSize: 13.5, fontStyle: "italic", marginBottom: 14 }}>
                “{issue.transcript}”
              </p>
            </>
          )}

          <div className="mono-xs text-faint" style={{ marginBottom: 6 }}>INDEX MATCHES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {r.matches.map((m) => (
              <div key={m.filePath} className="mono-xs" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span className="text-violet">{m.filePath}</span>
                <span className="text-faint">{m.score.toFixed(3)}</span>
              </div>
            ))}
          </div>

          <div className="mono-xs text-faint">
            drafter: <span className="text-cyan">{r.models.drafter}</span> · transcriber: <span className="text-cyan">{r.models.transcriber}</span> · voice: <span className="text-pink">{r.confirmation.voiceBackend}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ projects */

function ProjectsView(): JSX.Element {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState(localStorage.getItem("gv_token") ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghRepos, setGhRepos] = useState<RepoListing[]>([]);
  const [ghState, setGhState] = useState<"unknown" | "connected" | "logged-out" | "unconfigured">("unknown");

  const load = useCallback(async () => {
    const data = await api.projects();
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    void load().catch(() => setProjects([]));
    // Post-OAuth landing flags (?github=connected / ?github=error).
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("github");
    if (flag === "connected" || flag === "error") {
      setMessage(flag === "connected" ? "GitHub connected — pick one of your repos below." : "GitHub login failed — please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    void api.me().then((m) => {
      setGhUser(m.user);
      setGhState(m.user ? "connected" : "logged-out");
      if (m.user) {
        void api.repos().then((r) => setGhRepos(r.repos)).catch(() => setGhRepos([]));
      }
    }).catch(() => setGhState("logged-out"));
  }, [load]);

  useEffect(() => {
    localStorage.setItem("gv_token", token);
  }, [token]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy("create");
    setMessage("");
    try {
      await api.createProject(name.trim(), repo.trim() || undefined, token || undefined);
      setName("");
      setRepo("");
      await load();
      setMessage("Project created.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const reindex = async (id: string, repoFullName?: string) => {
    setBusy(id);
    setMessage("");
    try {
      const res = await api.reindexProject(id, repoFullName, token || undefined) as unknown as { filesIndexed: number };
      setMessage(`Indexed ${res.filesIndexed} files.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const loginGh = async () => {
    // Probe first so an unconfigured server shows a hint instead of a raw error page.
    try {
      const res = await fetch("/api/auth/github", { redirect: "manual" });
      if (res.status === 404) {
        setGhState("unconfigured");
        setMessage("GitHub login is not configured on this server yet (needs the OAuth env keys). Public repo links still work below.");
        return;
      }
    } catch {
      // Offline or blocked probe — try the navigation anyway.
    }
    window.location.href = "/api/auth/github";
  };

  const logoutGh = async () => {
    try {
      await api.logout();
    } catch {
      // The server clears the cookie regardless.
    }
    setGhUser(null);
    setGhRepos([]);
    setGhState("logged-out");
    setMessage("Logged out of GitHub — public repo links still work.");
  };

  if (!projects) return <div className="empty"><span className="loading-dots"><i /><i /><i /></span></div>;

  const baseUrl = window.location.origin;

  return (
    <div>
      <div className="dash-head">
        <h1 className="dash-title">Projects</h1>
      </div>

      {message && <p className="mono-xs text-cyan" style={{ marginBottom: 14 }}>{message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {projects.map((p) => (
          <div className="card project-card" key={p.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontFamily: "var(--font-display)", fontSize: 17 }}>{p.name}</strong>
              {p.repoFullName && <span className="mono-xs text-faint">{p.repoFullName}</span>}
              <span className={`status-pill ${p.indexStatus === "ready" ? "completed" : p.indexStatus === "failed" ? "failed" : p.indexStatus === "indexing" ? "running" : "queued"}`}>
                {p.indexStatus}
              </span>
              <span className="mono-xs text-faint">{p.indexCount} files indexed</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: "auto" }}
                disabled={busy === p.id}
                onClick={() => void reindex(p.id, p.repoFullName)}
              >
                {busy === p.id ? "Indexing…" : "Re-index"}
              </button>
            </div>
            {p.indexError && <p className="mono-xs" style={{ color: "var(--red)", marginTop: 8 }}>{p.indexError}</p>}
            {p.indexedAt && (
              <p className="mono-xs text-faint mt-8">indexed {new Date(p.indexedAt).toLocaleString()} · embedder: {p.embedderId}</p>
            )}
            <div className="snippet">
              &lt;script src="<b>{baseUrl}/api/widget.js</b>" data-project-id="<b>{p.id}</b>"&gt;&lt;/script&gt;
            </div>
          </div>
        ))}
      </div>

      <div className="card mt-24">
        <h3 style={{ fontFamily: "var(--font-display)", marginBottom: 14 }}>GitHub</h3>
        {ghState === "connected" && ghUser ? (
          <div>
            <p className="text-dim" style={{ fontSize: 14, marginBottom: 12 }}>
              Connected as <strong className="mono">@{ghUser.login}</strong> — your repos (private included) are selectable when adding a project.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => void logoutGh()}>Log out</button>
          </div>
        ) : (
          <div>
            <button className="btn btn-primary" onClick={() => void loginGh()}>Login with GitHub</button>
            <p className="mono-xs text-faint mt-8">
              Optional. Without login you can still use any <strong>public</strong> repo link below. Login unlocks your private repos too.
            </p>
          </div>
        )}
      </div>

      <div className="card mt-24">
        <h3 style={{ fontFamily: "var(--font-display)", marginBottom: 14 }}>Add a project</h3>
        {ghRepos.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <select
              className="coupon-input-field"
              value=""
              onChange={(e) => { if (e.target.value) setRepo(e.target.value); }}
              aria-label="Pick one of your GitHub repositories"
            >
              <option value="">Pick one of your GitHub repos…</option>
              {ghRepos.map((r) => (
                <option key={r.fullName} value={r.fullName}>
                  {r.fullName}{r.isPrivate ? " (private)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid-2" style={{ gap: 12 }}>
          <input
            className="coupon-input-field"
            placeholder="Project name (e.g. Acme staging)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="coupon-input-field"
            placeholder="GitHub repo (owner/repo, optional)"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </div>
        <div className="mt-16">
          <input
            className="coupon-input-field"
            type="password"
            placeholder="Dashboard token (only if the server requires one)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <button className="btn btn-primary mt-16" disabled={busy === "create" || !name.trim()} onClick={() => void create()}>
          {busy === "create" ? "Creating…" : "Create project"}
        </button>
        <p className="mono-xs text-faint mt-8">
          Paste any public repo (owner/repo) — no login needed. Projects created while logged in file issues
          and reindex with your GitHub access, so your private repos work too.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<{ baseUrl: string; integrations: IntegrationDto[] } | null>(null);

  useEffect(() => {
    void api.settings().then(setSettings).catch(() =>
      setSettings({ baseUrl: window.location.origin, integrations: [] })
    );
  }, []);

  if (!settings) return <div className="empty"><span className="loading-dots"><i /><i /><i /></span></div>;

  return (
    <div>
      <div className="dash-head">
        <h1 className="dash-title">Settings</h1>
      </div>
      <div className="card">
        <p className="mono-xs text-faint" style={{ marginBottom: 4 }}>DEPLOYMENT</p>
        <p className="mono" style={{ color: "var(--cyan)", marginBottom: 20 }}>{settings.baseUrl}</p>
        <p className="mono-xs text-faint" style={{ marginBottom: 20 }}>
          Each integration shows the mode it is running in right now. Adding the environment
          variable upgrades that station of the pipeline — nothing else changes.
        </p>
        {settings.integrations.map((it) => (
          <div className="settings-row" key={`${it.id}-${it.envKey}`}>
            <div>
              <div className="s-name">
                <span className={`dot ${it.configured ? "on" : "off"}`} />
                {it.label}
              </div>
              <div className="s-mode mt-8">{it.configured ? it.activeMode : it.fallbackMode}</div>
            </div>
            <div className="s-env">{it.envKey}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
