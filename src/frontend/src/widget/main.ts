/**
 * Git-Voice embeddable widget — one <script> tag on any staging site.
 *
 *   <script src="https://your-deployment/api/widget.js" data-project-id="prj_..."></script>
 *
 * Everything renders inside a shadow root so host page styles never collide.
 * Flow: floating button → recorder card (live waveform, 30 s cap) →
 * analyzing shimmer → spoken + visual confirmation. If the browser has no
 * microphone or no speech recognition, the card degrades to a typed report
 * box so a report can always be filed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ConsoleEntry { level: string; text: string; ts: number }
interface PageError { message: string; source?: string; line?: number; col?: number; ts: number }
interface ClickEvent { selector: string; label?: string; ts: number }

const WIDGET_FLAG = "__GIT_VOICE_WIDGET__";
const scriptEl = document.currentScript as HTMLScriptElement | null;
const projectId =
  scriptEl?.dataset.projectId || scriptEl?.getAttribute("data-project-id") || "prj_demo_storefront";
const apiBase = new URL(scriptEl?.src ?? location.href).origin;

function bootOnce(): void {
  if ((window as any)[WIDGET_FLAG]) return;
  (window as any)[WIDGET_FLAG] = true;
  bootWidget();
}

function bootWidget(): void {
  // ---------------------------------------------------------------- telemetry
  const consoleBuffer: ConsoleEntry[] = [];
  const errorBuffer: PageError[] = [];
  const clickBuffer: ClickEvent[] = [];
  const loadedAt = Date.now();

  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    pushConsole("error", args);
    originalError.apply(console, args as []);
  };
  console.warn = (...args: unknown[]) => {
    pushConsole("warn", args);
    originalWarn.apply(console, args as []);
  };
  function pushConsole(level: string, args: unknown[]): void {
    consoleBuffer.push({ level, text: safeText(args), ts: Date.now() });
    if (consoleBuffer.length > 60) consoleBuffer.shift();
  }
  function safeText(args: unknown[]): string {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ")
      .slice(0, 1500);
  }

  window.addEventListener("error", (e) => {
    errorBuffer.push({ message: String(e.message).slice(0, 900), source: e.filename, line: e.lineno, col: e.colno, ts: Date.now() });
    if (errorBuffer.length > 20) errorBuffer.shift();
  });
  window.addEventListener("unhandledrejection", (e) => {
    errorBuffer.push({ message: `Unhandled rejection: ${safeText([e.reason])}`.slice(0, 900), ts: Date.now() });
    if (errorBuffer.length > 20) errorBuffer.shift();
  });
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== "function") return;
      if (host?.contains(t)) return; // widget interactions are not breadcrumbs
      const testId = t.closest("[data-testid]");
      const sel = testId
        ? `[data-testid="${testId.getAttribute("data-testid")}"]`
        : t.id
          ? `#${t.id}`
          : t.tagName.toLowerCase() + (t.className && typeof t.className === "string" ? `.${t.className.trim().split(/\s+/)[0]}` : "");
      const label = (t.getAttribute("aria-label") || t.textContent || "").trim().slice(0, 60);
      clickBuffer.push({ selector: sel, label, ts: Date.now() });
      if (clickBuffer.length > 15) clickBuffer.shift();
    },
    true
  );

  function collectTelemetry() {
    return {
      url: location.href.slice(0, 500),
      route: location.pathname.slice(0, 300),
      title: document.title.slice(0, 300),
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      userAgent: navigator.userAgent.slice(0, 500),
      language: navigator.language,
      referrer: document.referrer.slice(0, 500),
      sessionMs: Date.now() - loadedAt,
      consoleLogs: [...consoleBuffer],
      errors: [...errorBuffer],
      clicks: [...clickBuffer]
    };
  }

  // ---------------------------------------------------------------- shadow DOM
  const host = document.createElement("div");
  host.setAttribute("data-git-voice-widget", "");
  host.style.cssText = "position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483000;";
  const root = host.attachShadow({ mode: "open" });

const style = document.createElement("style");
style.textContent = WIDGET_CSS;
root.appendChild(style);

  const mount = document.createElement("div");
  mount.className = "gv-mount";
  root.appendChild(mount);

  function ready(): void {
    (document.body || document.documentElement).appendChild(host);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }

  // ---------------------------------------------------------------- states
  type Phase = "idle" | "recording" | "analyzing" | "done" | "error";
  let phase: Phase = "idle";

  renderButton();

  function renderButton(): void {
    mount.innerHTML = `
      <button class="gv-fab" aria-label="Report an issue by voice" title="Report an issue by voice">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="2.5" width="6" height="11.5" rx="3"/>
          <path d="M5 11a7 7 0 0 0 14 0"/>
          <path d="M12 18.5V21.5"/>
        </svg>
        <span class="gv-fab-ring"></span>
      </button>`;
    const fab = mount.querySelector<HTMLButtonElement>(".gv-fab")!;
    fab.addEventListener("click", openCard);
  }

  function openCard(): void {
    phase = "idle";
    renderCard();
  }

  function renderCard(): void {
    mount.innerHTML = `
      <div class="gv-backdrop" data-close></div>
      <div class="gv-card" role="dialog" aria-label="Report an issue">
        <header class="gv-head">
          <span class="gv-badge"><span class="gv-dot"></span>Report an issue</span>
          <button class="gv-x" data-close aria-label="Close">×</button>
        </header>
        <div class="gv-body" id="gv-body"></div>
      </div>`;

    mount.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", () => {
        stopEverything();
        renderButton();
      })
    );

    const body = mount.querySelector("#gv-body") as HTMLElement;
    if (phase === "idle") renderRecordUI(body);
  }

  // ---------------------------------------------------------------- recording
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let audioBlob: Blob | null = null;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId = 0;
  let countdownId = 0;
  let recognition: any = null;
  let liveTranscript = "";
  let finalTranscript = "";

  function renderRecordUI(body: HTMLElement): void {
    body.innerHTML = `
      <p class="gv-hint">Tap the microphone and describe what's wrong — like you're telling a colleague.</p>
      <div class="gv-stage">
        <div class="gv-wave" id="gv-wave" aria-hidden="true">${Array.from({ length: 28 }, () => `<span></span>`).join("")}</div>
        <button class="gv-rec" id="gv-rec" aria-label="Start recording">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <rect x="9" y="2.5" width="6" height="11.5" rx="3"/>
            <path d="M5 11a7 7 0 0 0 14 0"/>
            <path d="M12 18.5V21.5"/>
          </svg>
        </button>
        <svg class="gv-progress" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="gv-progress-bg" cx="60" cy="60" r="54"/>
          <circle class="gv-progress-fg" id="gv-prog" cx="60" cy="60" r="54"/>
        </svg>
        <span class="gv-timer" id="gv-timer">0:00</span>
      </div>
      <p class="gv-live" id="gv-live"></p>
      <div class="gv-fallback">
        <button class="gv-linkbtn" id="gv-type">Prefer typing? Write the report instead</button>
      </div>`;

    mount.querySelector("#gv-rec")!.addEventListener("click", toggleRecording);
    mount.querySelector("#gv-type")!.addEventListener("click", renderTypedUI);

    // Preflight: if no microphone permission is grantable, jump to typed mode.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      renderTypedUI();
      return;
    }
  }

  async function toggleRecording(): Promise<void> {
    if (phase === "recording") {
      stopRecording(false);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showCardError("Microphone unavailable — you can type the report instead.");
      renderTypedUI();
      return;
    }

    phase = "recording";
    audioChunks = [];
    liveTranscript = "";
    finalTranscript = "";

    const recBtn = mount.querySelector<HTMLButtonElement>("#gv-rec")!;
    recBtn.classList.add("gv-recording");
    recBtn.setAttribute("aria-label", "Stop recording");
    recBtn.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`;

    // Waveform analyser
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      animateWave();
    } catch {
      analyser = null;
    }

    // Recorder (codec feature-detection, Safari falls back to mp4)
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      audioBlob = mimeType?.includes("mp4")
        ? new Blob(audioChunks, { type: "audio/mp4" })
        : mimeType?.includes("ogg")
          ? new Blob(audioChunks, { type: "audio/ogg" })
          : new Blob(audioChunks, { type: "audio/webm" });
      finishRecording();
    };
    mediaRecorder.start(250);

    // Live browser STT (free, no server round-trip)
    startSpeechRecognition();

    // 30 s cap + countdown ring
    const started = Date.now();
    const CAP = 30_000;
    const prog = mount.querySelector<SVGCircleElement>("#gv-prog");
    const timer = mount.querySelector<HTMLElement>("#gv-timer");
    const CIRC = 2 * Math.PI * 54;
    if (prog) {
      prog.style.strokeDasharray = `${CIRC}`;
      prog.style.strokeDashoffset = `${CIRC}`;
    }
    clearInterval(countdownId);
    countdownId = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const sec = Math.floor(elapsed / 1000);
      if (timer) timer.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      if (prog) prog.style.strokeDashoffset = `${CIRC * (1 - Math.min(1, elapsed / CAP))}`;
      if (elapsed >= CAP) stopRecording(true);
    }, 100);
  }

  function animateWave(): void {
    const bars = mount.querySelectorAll<HTMLElement>(".gv-wave span");
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const tick = () => {
      if (!analyser || phase !== "recording") return;
      analyser.getByteFrequencyData(data!);
      bars.forEach((bar, i) => {
        const v = (data![Math.floor((i / bars.length) * (data!.length * 0.7))] ?? 0) / 255;
        bar.style.height = `${Math.max(4, v * 44)}px`;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function startSpeechRecognition(): void {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalTranscript += res[0].transcript + " ";
          else interim += res[0].transcript;
        }
        liveTranscript = interim;
        const liveEl = mount.querySelector("#gv-live");
        if (liveEl) liveEl.textContent = (finalTranscript + liveTranscript).slice(0, 220);
      };
      recognition.onerror = () => {
        recognition = null;
      };
      recognition.start();
    } catch {
      recognition = null;
    }
  }

  function stopRecording(auto: boolean): void {
    if (phase !== "recording") return;
    phase = "analyzing";
    clearInterval(countdownId);
    cancelAnimationFrame(rafId);
    try {
      recognition?.stop();
    } catch {
      /* already stopped */
    }
    try {
      mediaRecorder?.state !== "inactive" && mediaRecorder?.stop();
    } catch {
      /* recorder already closed */
    }
    stream?.getTracks().forEach((t) => t.stop());
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;

    if (!mediaRecorder) {
      audioBlob = null;
      finishRecording();
    }
    void auto;
  }

  function finishRecording(): void {
    const transcript = (finalTranscript + liveTranscript).trim();
    void submitReport(transcript, transcript ? "browser-speech" : "telemetry-only", audioBlob);
  }

  // ---------------------------------------------------------------- typed UI
  function renderTypedUI(): void {
    stopEverything();
    const body = mount.querySelector("#gv-body") as HTMLElement | null;
    if (!body) return;
    body.innerHTML = `
      <p class="gv-hint">Describe what's wrong — where you were, what you clicked, what happened.</p>
      <textarea class="gv-textarea" id="gv-text" rows="5" placeholder="e.g. I was on the checkout page, typed my coupon code, clicked complete order and nothing happened…"></textarea>
      <button class="gv-primary" id="gv-send">Send report</button>`;
    const send = mount.querySelector<HTMLButtonElement>("#gv-send")!;
    send.addEventListener("click", () => {
      const text = (mount.querySelector("#gv-text") as HTMLTextAreaElement).value.trim();
      if (!text) {
        showCardError("Write a sentence or two first.");
        return;
      }
      void submitReport(text, "typed-report", null);
    });
  }

  async function submitReport(
    transcript: string,
    transcriptSource: "browser-speech" | "typed-report" | "telemetry-only",
    audio: Blob | null
  ): Promise<void> {
    phase = "analyzing";
    renderAnalyzing();

    const form = new FormData();
    form.set("projectId", projectId);
    form.set("telemetry", JSON.stringify(collectTelemetry()));
    form.set("transcript", transcript);
    form.set("transcriptSource", transcriptSource);
    if (audio && audio.size > 0) form.set("audio", audio, "report.webm");

    try {
      // Generous timeout: free-tier hosting can take ~1 min to wake from sleep.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 75_000);
      const res = await fetch(`${apiBase}/api/issue`, {
        method: "POST",
        body: form,
        // Same-origin embeds carry the session cookie; cross-origin staging
        // sites do not (SameSite=Lax), so those need the owner signed in.
        credentials: "include",
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: `Server responded ${res.status}` }))) as { error?: string };
        if (res.status === 401) {
          throw new Error("Sign in with GitHub on this page first, then send the report.");
        }
        throw new Error(err.error ?? `Server responded ${res.status}`);
      }
      const data = (await res.json()) as { issue: any };
      renderDone(data.issue);
    } catch (err) {
      phase = "error";
      const msg = err instanceof Error ? err.message : String(err);
      renderError(msg.includes("abort") ? "The server took too long to answer (it may be waking up). Please try again." : msg);
    }
  }

  function renderAnalyzing(): void {
    const body = mount.querySelector("#gv-body") as HTMLElement | null;
    if (!body) return;
    body.innerHTML = `
      <p class="gv-hint">Analyzing your report…</p>
      <div class="gv-steps">
        ${["Transcribing voice", "Locating suspect files", "Correlating console errors", "Drafting the issue", "Filing the report"]
          .map((s, i) => `<div class="gv-step" style="--i:${i}"><span class="gv-shimmer"></span>${s}</div>`)
          .join("")}
      </div>`;
  }

  function renderDone(issue: any): void {
    phase = "done";
    const r = issue?.result;
    const body = mount.querySelector("#gv-body") as HTMLElement | null;
    if (!body) return;
    const file = r?.draft?.suspectedFile ? r.draft.suspectedFile.split("/").pop() : null;
    const gh = r?.github?.issueUrl;

    body.innerHTML = `
      <div class="gv-done">
        <div class="gv-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>
        </div>
        <p class="gv-done-title"></p>
        ${file ? `<p class="gv-done-file">Suspected file: <code>${escapeHtml(file)}</code></p>` : ""}
        <p class="gv-done-sev">Priority: <strong>${escapeHtml(r?.draft?.severity ?? "medium")}</strong></p>
        ${gh ? `<a class="gv-done-link" href="${escapeHtml(gh)}" target="_blank" rel="noopener">View it on GitHub ↗</a>` : `<p class="gv-done-note">Saved to the project dashboard as a draft.</p>`}
        <div class="gv-eq" id="gv-eq" aria-hidden="true">${Array.from({ length: 18 }, () => "<span></span>").join("")}</div>
        <button class="gv-primary" id="gv-close2">Close</button>
      </div>`;

    const titleEl = body.querySelector(".gv-done-title") as HTMLElement;
    typeSentence(titleEl, r?.draft?.title ?? "Your report was filed.", 18);

    body.querySelector("#gv-close2")!.addEventListener("click", () => {
      stopEverything();
      renderButton();
    });

    // Spoken confirmation: server audio if present, else browser speech.
    const spoken = r?.confirmation?.spokenText;
    if (r?.confirmation?.audioBase64) {
      try {
        const audio = new Audio(`data:${r.confirmation.audioMime ?? "audio/mpeg"};base64,${r.confirmation.audioBase64}`);
        animateEqualizer(() => !audio.paused);
        void audio.play().catch(() => speakLocal(spoken));
      } catch {
        speakLocal(spoken);
      }
    } else {
      speakLocal(spoken);
    }
  }

  function speakLocal(text?: string): void {
    if (!text || !("speechSynthesis" in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang === (navigator.language || "en").slice(0, 2));
      if (match) u.voice = match;
      u.rate = 1.02;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* speech is best-effort */
    }
  }

  function animateEqualizer(isPlaying: () => boolean): void {
    const eq = mount.querySelector("#gv-eq");
    if (!eq) return;
    eq.classList.add("gv-eq-live");
    const check = () => {
      if (!isPlaying() || !mount.querySelector("#gv-eq")) return;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  function renderError(message: string): void {
    const body = mount.querySelector("#gv-body") as HTMLElement | null;
    if (!body) return;
    body.innerHTML = `
      <div class="gv-errorbox">
        <p class="gv-errortitle">We couldn't file that report</p>
        <p class="gv-errormsg">${escapeHtml(message)}</p>
        <button class="gv-primary" id="gv-retry">Try again</button>
      </div>`;
    body.querySelector("#gv-retry")!.addEventListener("click", openCard);
  }

  function showCardError(message: string): void {
    const body = mount.querySelector("#gv-body") as HTMLElement | null;
    if (!body) return;
    const existing = body.querySelector(".gv-flash");
    if (existing) existing.remove();
    const p = document.createElement("p");
    p.className = "gv-flash";
    p.textContent = message;
    body.prepend(p);
  }

  function typeSentence(el: HTMLElement, text: string, msPerChar: number): void {
    el.textContent = "";
    let i = 0;
    const tick = () => {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i += 1;
        setTimeout(tick, msPerChar);
      }
    };
    tick();
  }

  function stopEverything(): void {
    clearInterval(countdownId);
    cancelAnimationFrame(rafId);
    try {
      recognition?.stop();
    } catch {
      /* noop */
    }
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    } catch {
      /* noop */
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    phase = "idle";
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
    );
  }
}

// ---------------------------------------------------------------------------
// Scoped styles — brand trio: cyan (machine), violet (agent), pink (voice)
// ---------------------------------------------------------------------------
const WIDGET_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }

.gv-fab {
  position: fixed; right: 22px; bottom: 22px;
  width: 58px; height: 58px; border-radius: 50%;
  border: none; cursor: pointer;
  background: linear-gradient(135deg, #0ea5b7, #06b6d4);
  color: #f0fdff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 30px rgba(6, 182, 212, .35), 0 2px 8px rgba(0,0,0,.3);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease;
  animation: gv-pulse 4s ease-in-out infinite;
  z-index: 2147483001;
}
.gv-fab:hover { transform: scale(1.08); box-shadow: 0 14px 38px rgba(6,182,212,.5); }
.gv-fab:active { transform: scale(.96); }
.gv-fab-ring {
  position: absolute; inset: -4px; border-radius: 50%;
  border: 2px solid rgba(6,182,212,.55);
  animation: gv-ring 4s ease-in-out infinite;
}
@keyframes gv-pulse { 0%,100% { transform: scale(1);} 50% { transform: scale(1.05);} }
@keyframes gv-ring { 0%,100% { transform: scale(1); opacity: .8;} 50% { transform: scale(1.18); opacity: 0;} }

.gv-backdrop {
  position: fixed; inset: 0;
  background: rgba(6, 10, 16, .55);
  backdrop-filter: blur(3px);
  z-index: 2147483002;
}
.gv-card {
  position: fixed; right: 20px; bottom: 96px;
  width: min(400px, calc(100vw - 32px));
  background: #0d1117;
  border: 1px solid #1f2a37;
  border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0,0,0,.55);
  z-index: 2147483003;
  overflow: hidden;
  animation: gv-rise .32s cubic-bezier(.22,1,.36,1);
}
@keyframes gv-rise { from { opacity: 0; transform: translateY(18px) scale(.97);} to { opacity: 1; transform: none;} }

.gv-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #1f2a37;
  background: linear-gradient(180deg, #101722, #0d1117);
}
.gv-badge {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; letter-spacing: .04em;
  color: #7dd3fc; text-transform: uppercase;
}
.gv-dot { width: 8px; height: 8px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 10px #22d3ee; animation: gv-blink 2.4s infinite; }
@keyframes gv-blink { 0%,100%{opacity:1;} 50%{opacity:.35;} }
.gv-x {
  border: none; background: transparent; color: #8b98a9;
  font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px;
}
.gv-x:hover { color: #e6edf3; background: #1b2430; }

.gv-body { padding: 18px 16px 20px; color: #c9d4e0; font-size: 14px; }
.gv-hint { margin: 0 0 14px; color: #8fa0b3; line-height: 1.5; }

.gv-stage {
  position: relative; height: 150px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  border: 1px dashed #223041; border-radius: 14px;
  background: repeating-linear-gradient(45deg, #0e1420 0 12px, #0d1117 12px 24px);
  overflow: hidden;
}
.gv-rec {
  position: relative; z-index: 2;
  width: 64px; height: 64px; border-radius: 50%;
  border: none; cursor: pointer;
  background: linear-gradient(135deg, #db2777, #f472b6);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 26px rgba(244, 114, 182, .4);
  transition: transform .15s cubic-bezier(.34,1.56,.64,1);
}
.gv-rec:hover { transform: scale(1.07); }
.gv-rec.gv-recording { background: linear-gradient(135deg, #dc2626, #ef4444); animation: gv-recpulse 1.2s infinite; }
@keyframes gv-recpulse { 0%,100%{ box-shadow: 0 0 0 0 rgba(239,68,68,.5);} 50%{ box-shadow: 0 0 0 14px rgba(239,68,68,0);} }

.gv-wave {
  position: absolute; inset: auto 0 6px; z-index: 1;
  display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 48px; opacity: .9;
}
.gv-wave span {
  width: 4px; height: 4px; border-radius: 2px;
  background: linear-gradient(180deg, #22d3ee, #0e7490);
  transition: height .08s ease;
}

.gv-progress { position: absolute; top: -66px; left: 50%; transform: translateX(-50%); width: 132px; height: 132px; pointer-events: none; }
.gv-progress circle { fill: none; stroke-width: 3; }
.gv-progress-bg { stroke: #1b2430; }
.gv-progress-fg { stroke: #f472b6; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 60px 60px; transition: stroke-dashoffset .12s linear; }
.gv-timer { position: absolute; top: 8px; right: 12px; font-size: 12px; color: #64748b; font-variant-numeric: tabular-nums; }

.gv-live {
  min-height: 20px; margin: 12px 2px 0; font-size: 13px; color: #67e8f9;
  font-style: italic; opacity: .9;
}

.gv-fallback { margin-top: 14px; text-align: center; }
.gv-linkbtn {
  border: none; background: none; cursor: pointer;
  color: #a78bfa; font-size: 13px; text-decoration: underline dotted;
}
.gv-linkbtn:hover { color: #c4b5fd; }

.gv-textarea {
  width: 100%; resize: vertical; min-height: 110px;
  background: #0a0f16; color: #dbe6f0;
  border: 1px solid #223041; border-radius: 10px; padding: 12px;
  font-size: 14px; line-height: 1.5;
}
.gv-textarea:focus { outline: 2px solid rgba(34, 211, 238, .4); border-color: #22d3ee; }

.gv-primary {
  margin-top: 14px; width: 100%;
  padding: 12px 18px; border: none; border-radius: 10px; cursor: pointer;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  color: #05242b; font-weight: 700; font-size: 14px;
  transition: transform .15s ease, filter .15s ease;
}
.gv-primary:hover { transform: translateY(-1px); filter: brightness(1.08); }

.gv-steps { display: flex; flex-direction: column; gap: 8px; }
.gv-step {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 8px;
  background: #101722; border: 1px solid #1c2836;
  font-size: 13px; color: #9fb0c3;
  animation: gv-stepin .4s ease both; animation-delay: calc(var(--i) * .35s);
}
@keyframes gv-stepin { from { opacity: 0; transform: translateX(-10px);} to { opacity: 1; transform: none;} }
.gv-shimmer {
  width: 16px; height: 16px; border-radius: 50%; flex: none;
  background: conic-gradient(from 0deg, #22d3ee, #a78bfa, #f472b6, #22d3ee);
  animation: gv-spin 1.1s linear infinite;
  mask: radial-gradient(circle, transparent 42%, #000 44%);
  -webkit-mask: radial-gradient(circle, transparent 42%, #000 44%);
}
@keyframes gv-spin { to { transform: rotate(360deg);} }

.gv-done { text-align: center; }
.gv-check {
  width: 56px; height: 56px; margin: 2px auto 12px; border-radius: 50%;
  background: rgba(34, 197, 94, .12); border: 1px solid rgba(34, 197, 94, .4);
  color: #4ade80; display: flex; align-items: center; justify-content: center;
  animation: gv-pop .4s cubic-bezier(.34,1.56,.64,1);
}
@keyframes gv-pop { from { transform: scale(.4); opacity: 0;} to { transform: scale(1); opacity: 1;} }
.gv-done-title { margin: 0 0 6px; color: #67e8f9; font-weight: 600; font-size: 15px; line-height: 1.4; min-height: 22px; }
.gv-done-file { margin: 2px 0; font-size: 13px; color: #a78bfa; }
.gv-done-file code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #171d29; padding: 2px 6px; border-radius: 5px; }
.gv-done-sev { margin: 6px 0 4px; font-size: 13px; color: #8fa0b3; }
.gv-done-link { display: inline-block; margin: 4px 0 2px; color: #22d3ee; font-size: 13px; }
.gv-done-note { margin: 4px 0 2px; font-size: 12px; color: #64748b; }
.gv-eq { display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 26px; margin: 12px 0 2px; }
.gv-eq span { width: 4px; height: 5px; border-radius: 2px; background: #f472b6; opacity: .35; }
.gv-eq.gv-eq-live span { animation: gv-eqb 0.9s ease-in-out infinite; opacity: 1; }
.gv-eq.gv-eq-live span:nth-child(3n) { animation-delay: .15s; background: #22d3ee; }
.gv-eq.gv-eq-live span:nth-child(3n+1) { animation-delay: .3s; background: #a78bfa; }
.gv-eq.gv-eq-live span:nth-child(2n) { animation-delay: .45s; }
@keyframes gv-eqb { 0%,100% { height: 5px;} 50% { height: 22px;} }

.gv-errorbox { text-align: left; }
.gv-errortitle { margin: 0 0 4px; color: #f87171; font-weight: 600; }
.gv-errormsg { margin: 0 0 6px; color: #9fb0c3; font-size: 13px; line-height: 1.45; word-break: break-word; }
.gv-flash { margin: 0 0 10px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; color: #fbbf24; background: rgba(251, 191, 36, .08); border: 1px solid rgba(251, 191, 36, .25); }

@media (prefers-reduced-motion: reduce) {
  .gv-fab, .gv-fab-ring, .gv-rec.gv-recording, .gv-shimmer, .gv-eq span { animation: none !important; }
  .gv-card { animation: none; }
}
`;

// Bootstrap last, so every declaration above is initialized when it runs.
bootOnce();
