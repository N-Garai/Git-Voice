/** Developer dashboard: issue log, projects + indexing, integration settings. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  fetchBlob,
  ApiError,
  getToken,
  setToken as setTokenValue,
  type IssueRecordDto,
  type ProjectDto,
  type IntegrationDto,
  type GitHubUser,
  type RepoListing
} from "../lib/api";
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
      // A 401 here means the token/key went stale — surface the unlock screen
      // rather than an empty issue log.
      if (err instanceof ApiError && err.status === 401) {
        setError("locked");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  if (error === "locked") {
    return (
      <div className="empty">
        <div className="big">🔒</div>
        <p>This dashboard needs the operator token or a GitHub sign-in.</p>
        <button className="btn btn-primary mt-16" onClick={() => window.location.reload()}>Unlock</button>
      </div>
    );
  }
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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const reveal = useScrollReveal<HTMLDivElement>();

  const hasAudio = issue.audioMime !== undefined;

  // Audio is a protected endpoint (Bearer token required), so it is fetched
  // with the token and played from an object URL rather than a plain <audio src>.
  useEffect(() => {
    if (!hasAudio) return;
    let revoked: string | null = null;
    let cancelled = false;
    void fetchBlob(api.issueAudioUrl(issue.id))
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setAudioUrl(revoked);
      })
      .catch(() => setAudioUrl(null));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [hasAudio, issue.id]);

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
            {audioUrl && <audio ref={audioRef} src={audioUrl} preload="none" />}
            <button
              className={`audio-btn${playing ? " playing" : ""}`}
              onClick={playAudio}
              disabled={!audioUrl}
            >
              {playing ? (
                <span className="eq"><i /><i /><i /><i /></span>
              ) : (
                "▶"
              )}
              {audioUrl
                ? playing ? "Playing client's voice" : "Listen to the client"
                : "Loading audio…"}
            </button>
          </>
        )}
        {r?.github.issueUrl ? (
          <a className="gh-link" href={r.github.issueUrl} target="_blank" rel="noopener">
            View on GitHub ↗
          </a>
        ) : r?.github.reason ? (
          <span className="mono-xs text-faint" title={r.github.reason}>draft — {r.github.reason}</span>
        ) : null}
        {r && (
          <button
            className="gh-link"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
            onClick={() => {
              void fetchBlob(`/api/issues/${issue.id}/body.md`)
                .then((blob) => blob.text())
                .then((text) => window.open(URL.createObjectURL(new Blob([text], { type: "text/markdown" })), "_blank"))
                .catch(() => undefined);
            }}
          >
            Raw markdown
          </button>
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

/* --------------------------------------------------------- report composer */

/**
 * Speak the confirmation. Prefers the server-rendered audio so the app has one
 * consistent voice; falls back to the browser's speech synthesis when no hosted
 * key is configured or the audio is unavailable.
 */
function speak(
  text: string,
  audio?: { audioBase64?: string; audioMime?: string }
): void {
  if (audio?.audioBase64) {
    try {
      const el = new Audio(`data:${audio.audioMime ?? "audio/mpeg"};base64,${audio.audioBase64}`);
      void el.play().catch(() => speakLocally(text));
      return;
    } catch {
      // fall through to the browser voice
    }
  }
  speakLocally(text);
}

function speakLocally(text: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang === (navigator.language || "en").slice(0, 2));
    if (match) u.voice = match;
    u.rate = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    // Speech is a bonus; the visual confirmation still shows everything.
  }
}

/**
 * Voice-or-type report composer. Voice captures browser speech *and* a
 * recording (multipart), so the server-side transcription station has real
 * audio to work with — the same path the embeddable widget uses.
 */
function ReportComposer({
  projectName,
  busy,
  onCancel,
  onSubmit
}: {
  projectName: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string, audio?: Blob) => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<Blob | undefined>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const baseRef = useRef("");

  const toggleRecord = async () => {
    if (recording) {
      recorderRef.current?.stop();
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported?.(t)
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        setAudio(new Blob(chunksRef.current, { type }));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start(250);
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setText((t) => t || "Microphone unavailable — type the report instead.");
      return;
    }

    // Live browser speech-to-text fills the same box as typing.
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SR) return;
    try {
      const r = new SR();
      r.lang = navigator.language || "en-US";
      baseRef.current = text;
      r.onresult = (e: SpeechRecognitionEventLike) => {
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript + " ";
          else interim += res[0].transcript;
        }
        if (final) {
          setText(`${baseRef.current} ${final}`.trim());
          baseRef.current = `${baseRef.current} ${final}`.trim();
        }
      };
      r.onend = () => setRecording((v) => (recorderRef.current ? v : false));
      r.start();
      recognitionRef.current = r as unknown as { stop: () => void };
    } catch {
      // Recording still works without live transcription.
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,7,11,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{ maxWidth: 560, width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontFamily: "var(--font-display)", marginBottom: 4 }}>New voice report</h3>
        <p className="mono-xs text-faint" style={{ marginBottom: 16 }}>
          {projectName} — talk or type, whichever is easier.
        </p>

        <textarea
          className="coupon-input-field"
          style={{ minHeight: 110, width: "100%", padding: 12, resize: "vertical" }}
          placeholder="What's wrong? e.g. “the bird makes no sound when it hits a pipe”"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
          <button
            className={`btn ${recording ? "btn-primary" : "btn-ghost"} btn-sm`}
            onClick={() => void toggleRecord()}
            disabled={busy}
          >
            {recording ? "● Stop recording" : "🎙 Speak it instead"}
          </button>
          {audio && <span className="mono-xs text-cyan">audio captured ✓</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !text.trim()}
              onClick={() => onSubmit(text.trim(), audio)}
            >
              {busy ? "Filing…" : "Send report"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/* ------------------------------------------------------------------- projects */

function ProjectsView(): JSX.Element {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  // Operator key: optional. The api client attaches it to every dashboard
  // call automatically, so this input only needs to write it once.
  const [token, setToken] = useState(getToken());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghRepos, setGhRepos] = useState<RepoListing[]>([]);
  const [ghState, setGhState] = useState<"unknown" | "connected" | "logged-out" | "unconfigured">("unknown");
  const [composer, setComposer] = useState<{ open: boolean; projectId: string; projectName: string } | null>(null);

  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    const data = await api.projects();
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    void load().catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        setLoadError("This dashboard needs the operator token or a GitHub sign-in.");
        return;
      }
      setProjects([]);
    });
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
    setTokenValue(token);
  }, [token]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy("create");
    setMessage("");
    try {
      await api.createProject(name.trim(), repo.trim() || undefined);
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
      const res = await api.reindexProject(id, repoFullName) as unknown as { filesIndexed: number };
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

  const removeProject = async (id: string, name: string) => {
    const ok = window.confirm(
      `Delete "${name}"?\n\nThis permanently removes the project, its stored reports and audio, and its architecture index — including everything in the database. Issues already filed on GitHub are not affected.`
    );
    if (!ok) return;
    setBusy(id);
    setMessage("");
    try {
      const res = await api.deleteProject(id);
      setMessage(`Deleted "${name}" — ${res.deleted.reports} report(s) and its index removed.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const submitReport = async (projectId: string, repoOverride: string, text: string, audio?: Blob) => {
    setBusy(projectId);
    setMessage("Analyzing the report…");
    try {
      const telemetry = {
        url: window.location.href,
        route: window.location.pathname,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        userAgent: navigator.userAgent,
        language: navigator.language,
        consoleLogs: [] as Array<{ level: string; text: string }>,
        errors: [] as Array<{ message: string }>,
        clicks: [] as Array<{ selector: string }>
      };

      // With audio we must use multipart so the recording reaches the server;
      // otherwise the JSON path is simpler and always available.
      let created: { issue: IssueRecordDto };
      if (audio && audio.size > 0) {
        const form = new FormData();
        form.set("projectId", projectId);
        form.set("transcript", text);
        form.set("transcriptSource", text.trim() ? "browser-speech" : "typed-report");
        form.set("telemetry", JSON.stringify(telemetry));
        if (repoOverride.trim()) form.set("repoFullName", repoOverride.trim());
        form.set("audio", audio, "report.webm");
        const res = await fetch("/api/issue", { method: "POST", body: form, credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as { issue?: IssueRecordDto; error?: string };
        if (!res.ok || !data.issue) throw new Error(data.error ?? `Request failed (${res.status})`);
        created = data as { issue: IssueRecordDto };
      } else {
        created = await api.submitReport({
          projectId,
          transcript: text,
          repoFullName: repoOverride.trim() || undefined,
          telemetry
        });
      }

      const spoken = created.issue.result?.confirmation;
      if (spoken?.spokenText) speak(spoken.spokenText, spoken);
      setMessage(
        created.issue.result?.github.issueUrl
          ? `Report filed — ${created.issue.result.github.issueUrl}`
          : "Report filed as a draft — open the Issues tab to review it."
      );
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const fileHere = (projectId: string) => {
    setComposer({ open: true, projectId, projectName: projectNameById[projectId] ?? projectId });
  };

  const confirmCompose = async (text: string, audio?: Blob) => {
    if (!composer) return;
    const projectId = composer.projectId;
    const repoEl = document.getElementById(`repo-override-${projectId}`) as HTMLInputElement | null;
    const repoOverride = repoEl?.value ?? "";
    // Close immediately: the pipeline takes several seconds and the composer
    // should not sit there frozen while it runs.
    setComposer(null);
    await submitReport(projectId, repoOverride, text, audio);
  };

  if (!projects) return <div className="empty"><span className="loading-dots"><i /><i /><i /></span></div>;

  if (loadError) {
    return (
      <div className="empty">
        <div className="big">🔒</div>
        <p>{loadError}</p>
        <button className="btn btn-primary mt-16" onClick={() => window.location.reload()}>Unlock</button>
      </div>
    );
  }

  const baseUrl = window.location.origin;
  const projectNameById: Record<string, string> = {};
  for (const p of projects) projectNameById[p.id] = p.name;

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
                disabled={busy === p.id}
                onClick={() => void reindex(p.id, p.repoFullName)}
              >
                {busy === p.id ? "Indexing…" : "Re-index"}
              </button>
              {p.id !== "prj_demo_storefront" && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy === p.id}
                  onClick={() => void removeProject(p.id, p.name)}
                  title="Delete this project, its reports, and its index"
                >
                  Delete
                </button>
              )}
            </div>
            {p.indexError && <p className="mono-xs" style={{ color: "var(--red)", marginTop: 8 }}>{p.indexError}</p>}
            {p.indexedAt && (
              <p className="mono-xs text-faint mt-8">indexed {new Date(p.indexedAt).toLocaleString()} · embedder: {p.embedderId}</p>
            )}
            <div className="snippet">
              &lt;script src="<b>{baseUrl}/api/widget.js</b>" data-project-id="<b>{p.id}</b>"&gt;&lt;/script&gt;
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <input
                className="coupon-input-field"
                style={{ flex: "1 1 240px", margin: 0 }}
                placeholder={"File to repo (owner/repo) — blank uses " + (p.repoFullName ?? "none")}
                defaultValue=""
                id={`repo-override-${p.id}`}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === p.id}
                onClick={() => fileHere(p.id)}
              >
                File a report here
              </button>
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
            placeholder={getToken() ? "Dashboard token — saved ✓" : "Operator dashboard token (optional)"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <button className="btn btn-primary mt-16" disabled={busy === "create" || !name.trim()} onClick={() => void create()}>
          {busy === "create" ? "Creating…" : "Create project"}
        </button>
        <p className="mono-xs text-faint mt-8">
          Any public repo (owner/repo) indexes without logging in. Sign in with GitHub and your
          private repos work too — issues are always filed under your own GitHub identity.
        </p>
      </div>

      {composer && (
        <ReportComposer
          projectName={composer.projectName}
          busy={busy === composer.projectId}
          onCancel={() => setComposer(null)}
          onSubmit={(text, audio) => void confirmCompose(text, audio)}
        />
      )}
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
