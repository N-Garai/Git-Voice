/**
 * The landing hero — enters with a cinematic 3D word-stagger reveal right after
 * the boot loader lifts, then vents its signature panel via a scroll-scrubbed
 * clip-path portal morph (Zentry-inspired).
 */
import { useEffect, useState } from "react";
import { navigate } from "../lib/router";
import { useRevealWords } from "../hooks/zentry";
import { prefersReducedMotion } from "../hooks/animations";

const H1 = "Client rants in.";
const H2 = "Engineering out.";
const SUB =
  "Your client speaks for twenty seconds. The machine transcribes, locates the suspect file, drafts the report, and files it — reproducible GitHub issues, filed in about eight seconds.";

export default function Hero({ entered }: { entered: boolean }): JSX.Element {
  const [stage, setStage] = useState(0); // 0 hidden → 1 words in → 2 sub+cta → 3 terminal
  const h1 = useRevealWords(H1, 150);
  const h2 = useRevealWords(H2, 150 + H1.length * 60);
  const subWords = useRevealWords(SUB, 0);

  useEffect(() => {
    if (!entered) return;
    if (prefersReducedMotion()) return setStage(3);
    const t1 = setTimeout(() => setStage(1), 80);
    const t2 = setTimeout(() => setStage(2), 1500);
    const t3 = setTimeout(() => setStage(3), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [entered]);

  return (
    <section className={`hero hero-new${entered ? " entered" : ""}`}>
      <div className="gears-deco" aria-hidden="true">
        <svg className="g1" viewBox="0 0 100 100"><g fill="none" stroke="#22d3ee" strokeWidth="2"><circle cx="50" cy="50" r="26" /><circle cx="50" cy="50" r="40" strokeDasharray="6 7" /></g></svg>
        <svg className="g2" viewBox="0 0 100 100"><g fill="none" stroke="#a78bfa" strokeWidth="2"><circle cx="50" cy="50" r="26" /><circle cx="50" cy="50" r="40" strokeDasharray="6 7" /></g></svg>
      </div>

      <div className="shell inner">
        <div className="hero-copy">
          <span className={`hero-badge${stage >= 1 ? " show" : ""}`}>
            <span className="dot" />The machine is warm — try the live demo
          </span>

          <h1 className="hero-3d" aria-label={`${H1} ${H2}`}>
            <span className="line accent">
              {h1.words.map((w, i) => (
                <span key={`a${i}`} className="w3d" style={{ transitionDelay: `${h1.delays[i]}ms` }}>{w}</span>
              ))}
            </span>
            <span className="line">
              {h2.words.map((w, i) => (
                <span key={`b${i}`} className="w3d" style={{ transitionDelay: `${h2.delays[i]}ms` }}>{w}</span>
              ))}
            </span>
          </h1>

          <p className={`hero-sub3d${stage >= 2 ? " show" : ""}`}>
            {subWords.words.map((w, i) => (
              <span key={i} className="w" style={{ transitionDelay: `${i * 24}ms` }}>{w}</span>
            ))}
          </p>

          <div className={`hero-ctas${stage >= 2 ? " show" : ""}`}>
            <button className="btn btn-primary" onClick={() => navigate("/demo")}>▶ Try the live demo</button>
            <a className="btn btn-ghost" href="#showcase">See the machine</a>
            <a className="btn btn-ghost" href="/pricing" onClick={(e) => { e.preventDefault(); navigate("/pricing"); }}>Pricing</a>
          </div>

          <div className={`hero-meta${stage >= 2 ? " show" : ""}`}>
            <span><b>~8s</b> rant → filed issue</span>
            <span><b>0</b> forms for the client</span>
            <span><b>100%</b> free-tier runtime</span>
          </div>
        </div>

        <div className={`hero-terminal-slot${stage >= 3 ? " show" : ""}`}>
          <BootTerminal />
        </div>
      </div>
    </section>
  );
}

const TERMINAL_SCRIPT = [
  { cls: "cmt", text: "// what the client says:" },
  { cls: "say", text: '"the checkout is broken, fix it asap — the coupon box turned red"' },
  { cls: "cmt", text: "" },
  { cls: "cmt", text: "// what lands in the repository:" },
  { cls: "step", text: "→ Bug: coupon validation fails at checkout (severity: high)" },
  { cls: "file", text: "→ src/components/checkout/CouponInput.tsx" },
  { cls: "step", text: "→ 1. open /checkout  2. type \"SUMMER20\"  3. apply code" },
  { cls: "step", text: "→ console: ERR_COUPON_STATE_DESYNC captured" },
  { cls: "ok", text: "✓ issue #412 filed · client hears voice confirmation" }
];

/** Typewriter terminal, restarted by key whenever it mounts. */
function BootTerminal(): JSX.Element {
  const [shown, setShown] = useState("");
  const full = TERMINAL_SCRIPT.map(l => l.text).join("\n");

  useEffect(() => {
    if (prefersReducedMotion()) return setShown(full);
    let i = 0;
    const iv = window.setInterval(() => {
      i += 2;
      setShown(full.slice(0, i));
      if (i >= full.length) clearInterval(iv);
    }, 16);
    return () => clearInterval(iv);
  }, [full]);

  const lines = shown.split("\n");
  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className="lamp r" /><span className="lamp y" /><span className="lamp g" />
        <span className="title">triage-machine — live</span>
      </div>
      <div className="terminal-body">
        {TERMINAL_SCRIPT.map((line, i) => {
          const text = lines[i] ?? "";
          if (!text) return null;
          return (
            <div key={i} className={line.cls}>
              {text || "\u00A0"}
              {i === lines.length - 1 && <span className="terminal-caret" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
