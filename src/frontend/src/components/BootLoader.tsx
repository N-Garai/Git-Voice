/**
 * The boot loader — a machine-themed, ~10 s power-up sequence that gates the
 * landing page. Boot log lines type in, seven station gauges fill, a progress
 * console counts to 100%, then the whole screen lifts away with a shutter wipe
 * and the hero enters.
 */
import { useEffect, useState } from "react";
import { useLoaderProgress } from "../hooks/motion";

const BOOT_LINES = [
  { t: "$ git-voice boot --power-on", cls: "cmd" },
  { t: "> power bus ............ ONLINE", cls: "ok" },
  { t: "> microphone array ..... CALIBRATED", cls: "ok" },
  { t: "> transcription unit ... READY", cls: "ok" },
  { t: "> architecture index ... LOADING SIGNATURES", cls: "warn" },
  { t: "  ├ routes ............. 14 mapped", cls: "dim" },
  { t: "  ├ components ......... 9 catalogued", cls: "dim" },
  { t: "  └ error codes ........ 17 armed", cls: "dim" },
  { t:"> hybrid retriever ..... VECTOR + BM25 FUSED", cls: "ok" },
  { t: "> triage engine ....... DRAFTING CALIBRATED", cls: "ok" },
  { t: "> voice synthesizer ... SPEAKERS WARM", cls: "ok" },
  { t: "> github conduit ....... LINK ESTABLISHED", cls: "ok" },
  { t: "BOOT SEQUENCE COMPLETE — MACHINE READY", cls: "final" }
];

const STATION_LABELS = ["listen", "transcribe", "locate", "correlate", "draft", "confirm", "publish"];

export default function BootLoader({ onDone }: { onDone: () => void }): JSX.Element {
  const [pct, setPct] = useState(0);
  const [lines, setLines] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);
  const BOOT_DURATION = 7000; // full machine boot (was 9500ms)
  const { finished } = useLoaderProgress(BOOT_DURATION, false);

  // Boot log lines reveal with progress.
  useEffect(() => {
    setLines(Math.min(BOOT_LINES.length, Math.floor((pct / 100) * BOOT_LINES.length)));
  }, [pct]);

  // Drive the master percentage externally (loader hook runs its own rAF loop).
  useEffect(() => {
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / BOOT_DURATION);
      setPct(Math.floor((1 - Math.pow(1 - t, 2.2)) * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ready = pct >= 100 || finished;

  // Auto-handoff shortly after 100%: kick the exit wipe, then unmount.
  useEffect(() => {
    if (!ready) return;
    const a = setTimeout(() => setExiting(true), 500);
    const b = setTimeout(() => setGone(true), 1600);
    const c = setTimeout(onDone, 1700);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, [ready, onDone]);

  if (gone) return <></>;

  const gearAngle = pct * 3.6 * 1.5;

  return (
    <div className={`boot-loader${exiting ? " exiting" : ""}`} role="status" aria-label="Loading Git-Voice">
      <div className="boot-grid" aria-hidden="true" />
      <div className="boot-cell">
        {/* Left: boot log */}
        <div className="boot-log">
          <div className="boot-bar">
            <span className="lamp r" /><span className="lamp y" /><span className="lamp g" />
            <span className="boot-title">git-voice // boot sequence</span>
          </div>
          <div className="boot-lines">
            {BOOT_LINES.slice(0, lines).map((l, i) => (
              <div key={i} className={`bl ${l.cls}`}>{l.t}</div>
            ))}
            <div className="bl caret-line"><span className="boot-caret" /></div>
          </div>
        </div>

        {/* Center: the machine */}
        <div className="boot-machine">
          <svg viewBox="0 0 200 200" className="boot-gear-box" aria-hidden="true">
            <g style={{ transform: `rotate(${gearAngle}deg)`, transformOrigin: "100px 100px" }}>
              <g fill="none" stroke="#22d3ee" strokeWidth="2.5">
                <circle cx="100" cy="100" r="34" />
                <g strokeLinecap="round" strokeWidth="6">
                  <path d="M100 38v14M100 148v14M38 100h14M148 100h14M56.5 56.5l10 10M133.5 133.5l10 10M143.5 56.5l-10 10M66.5 133.5l-10 10" />
                </g>
              </g>
              <circle cx="100" cy="100" r="10" fill="#22d3ee" opacity="0.85" />
            </g>
            <g style={{ transform: `rotate(-${gearAngle * 0.7}deg)`, transformOrigin: "160px 150px" }}>
              <g fill="none" stroke="#a78bfa" strokeWidth="2">
                <circle cx="160" cy="150" r="18" />
                <g strokeLinecap="round" strokeWidth="4">
                  <path d="M160 126v8M160 166v8M136 150h8M176 150h8M143 133l6 6M171 161l6 6M177 133l-6 6M149 161l-6 6" />
                </g>
              </g>
            </g>
          </svg>

          <div className="boot-pct">{pct}<span>%</span></div>
          <div className="boot-bar-track"><div className="boot-bar-fill" style={{ width: `${pct}%` }} /></div>

          <div className="boot-stations">
            {STATION_LABELS.map((s, i) => (
              <span key={s} className={`bs${pct > (i + 1) * (100 / STATION_LABELS.length) - 8 ? " lit" : ""}`}>
                <i />{s}
              </span>
            ))}
          </div>

          {ready && <div className="boot-ready">MACHINE READY — LIFTING SHUTTER…</div>}
        </div>
      </div>
    </div>
  );
}
