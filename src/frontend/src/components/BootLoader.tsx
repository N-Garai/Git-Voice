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
            {/* Main drive gear — solid industrial gear with teeth, spokes, hub. */}
            <g style={{ transform: `rotate(${gearAngle}deg)`, transformOrigin: "100px 100px" }}>
              <path
                d="M158.00 100.00 A58 58 0 0 1 156.37 113.64 L143.23 115.73 A46 46 0 0 1 138.31 125.46 L144.43 137.28 A58 58 0 0 1 134.42 146.68 L123.00 139.84 A46 46 0 0 1 112.99 144.13 L110.07 157.12 A58 58 0 0 1 96.36 157.89 L92.01 145.30 A46 46 0 0 1 81.58 142.15 L71.00 150.23 A58 58 0 0 1 60.00 142.00 L64.76 129.57 A46 46 0 0 1 58.80 120.45 L45.50 119.84 A58 58 0 0 1 42.36 106.47 L54.00 100.00 A46 46 0 0 1 55.29 89.18 L45.50 80.16 A58 58 0 0 1 51.69 67.90 L64.76 70.43 A46 46 0 0 1 72.70 62.97 L71.00 49.77 A58 58 0 0 1 83.62 44.36 L92.01 54.70 A46 46 0 0 1 102.89 54.09 L110.07 42.88 A58 58 0 0 1 123.22 46.85 L123.00 60.16 A46 46 0 0 1 131.72 66.69 L144.43 62.72 A58 58 0 0 1 151.95 74.21 L143.23 84.27 A46 46 0 0 1 145.71 94.87 L158.00 100.00 Z"
                fill="#0e2a33"
                stroke="#22d3ee"
                strokeWidth="2.5"
              />
              {/* web: spoke bars between hub and rim */}
              <g stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" opacity="0.9">
                <path d="M100 76v48M77.5 88l45 24M77.5 112l45-24" />
              </g>
              <circle cx="100" cy="100" r="21" fill="#0e2a33" stroke="#22d3ee" strokeWidth="2.5" />
              <circle cx="100" cy="100" r="8" fill="#22d3ee" />
            </g>
            {/* Pinion gear, counter-rotating and meshing into the drive gear. */}
            <g style={{ transform: `rotate(-${gearAngle * 0.7}deg)`, transformOrigin: "152px 152px" }}>
              <path
                d="M171.00 152.00 A19 19 0 0 1 170.33 157.01 L164.93 157.36 A14 14 0 0 1 163.06 160.58 L165.44 165.44 A19 19 0 0 1 161.41 168.50 L157.36 164.93 A14 14 0 0 1 153.75 165.89 L152.00 171.00 A19 19 0 0 1 146.99 170.33 L146.64 164.93 A14 14 0 0 1 143.42 163.06 L138.56 165.44 A19 19 0 0 1 135.50 161.41 L139.07 157.36 A14 14 0 0 1 138.11 153.75 L133.00 152.00 A19 19 0 0 1 133.67 146.99 L139.07 146.64 A14 14 0 0 1 140.94 143.42 L138.56 138.56 A19 19 0 0 1 142.59 135.50 L146.64 139.07 A14 14 0 0 1 150.25 138.11 L152.00 133.00 A19 19 0 0 1 157.01 133.67 L157.36 139.07 A14 14 0 0 1 160.58 140.94 L165.44 138.56 A19 19 0 0 1 168.50 142.59 L164.93 146.64 A14 14 0 0 1 165.89 150.25 L171.00 152.00 Z"
                fill="#221a35"
                stroke="#a78bfa"
                strokeWidth="2.5"
              />
              <circle cx="152" cy="152" r="9.5" fill="#221a35" stroke="#a78bfa" strokeWidth="2.5" />
              <circle cx="152" cy="152" r="3.5" fill="#a78bfa" />
            </g>
            {/* Rotating tick ring around the drive gear — reads as a gauge. */}
            <g style={{ transform: `rotate(${gearAngle * 0.25}deg)`, transformOrigin: "100px 100px" }}>
              {Array.from({ length: 24 }).map((_, i) => {
                const a = (i / 24) * Math.PI * 2;
                const rOut = 72;
                const rIn = i % 6 === 0 ? 64 : 68;
                const x1 = 100 + rIn * Math.cos(a);
                const y1 = 100 + rIn * Math.sin(a);
                const x2 = 100 + rOut * Math.cos(a);
                const y2 = 100 + rOut * Math.sin(a);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 6 === 0 ? "#22d3ee" : "#1f4450"} strokeWidth={i % 6 === 0 ? 2 : 1.4} />;
              })}
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
