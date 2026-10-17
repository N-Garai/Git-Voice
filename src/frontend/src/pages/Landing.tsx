/**
 * Landing page — boot loader gate, cinematic hero, then Zentry-style scroll
 * storytelling: a portal-morph showcase, an expanding full-bleed panel, the
 * pipeline machine, features, and the pricing teaser.
 */
import { useEffect, useState } from "react";
import BootLoader from "../components/BootLoader";
import Hero from "../components/Hero";
import { SiteHeader, SiteFooter } from "../components/Chrome";
import { useScrollReveal, SplitChars } from "../hooks/animations";
import { useClipPortal, useExpandPanel, useRevealWords, useScrollTheme } from "../hooks/zentry";
import { usePageReveals } from "../hooks/animations";
import { navigate } from "../lib/router";
import { PLANS } from "../data/plans";

// Module-scope flag: resets on every full document load (new JS context) but
// survives in-app SPA navigations. That is exactly the replay contract — the
// boot loader plays fully on every hard refresh, and is skipped when the user
// navigates away and back without reloading. (sessionStorage was wrong here:
// it survives hard refresh in the same tab, so the loader played only once.)
let loaderPlayedSinceLoad = false;

export default function Landing(): JSX.Element {
  useScrollTheme();
  const [booting, setBooting] = useState(() => !loaderPlayedSinceLoad);
  const [entered, setEntered] = useState(false);
  usePageReveals([booting]);

  useEffect(() => {
    if (booting) return;
    loaderPlayedSinceLoad = true;
    // Let the shutter lift, then stage the hero entrance.
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, [booting]);

  if (booting) return <BootLoader onDone={() => setBooting(false)} />;

  return (
    <>
      <SiteHeader />
      <main>
        <Hero entered={entered} />
        <PortalShowcase />
        <ExpandShowcase />
        <MachineSection />
        <Features />
        <PricingTeaser />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------ portal showcase */

function PortalShowcase(): JSX.Element {
  const portal = useClipPortal<HTMLDivElement>();
  const words = useRevealWords("One email costs you two hours.", 0);

  return (
    <section className="section" id="problem" data-theme="blue">
      <div className="shell">
        <div className="section-head reveal">
          <span className="kicker">The problem</span>
          <h2 className="h2" aria-label="One email costs you two hours.">
            {words.words.map((w, i) => (
              <span key={i} className="w3d" style={{ transitionDelay: `${words.delays[i]}ms` }}>{w}{" "}</span>
            ))}
          </h2>
        </div>

        <div
          ref={portal.ref}
          className="portal-panel reveal"
          style={{
            clipPath: portal.clip,
            borderRadius: portal.borderRadius,
            opacity: portal.progress < 0.02 ? 0 : 1
          }}
        >
          <div className="portal-inner">
            <div className="compare">
              <div className="email-mock">
                <div className="em-head"><span>inbox — 09:42</span><span>no subject</span></div>
                <div className="em-body">
                  <div className="em-from">from: client@theircompany.com</div>
                  <p className="em-text">
                    "Hi! The site is broken again… I clicked the thing on my iPad and nothing
                    happened?? Also the coupon box went red even though I typed my code
                    correctly. Can you fix it today? It's urgent!!"
                  </p>
                  <p className="mt-16 text-faint mono-xs">→ 2 hours of detective work. Unbilled.</p>
                </div>
              </div>
              <div className="vs">the machine converts</div>
              <div className="issue-mock">
                <div className="is-head">
                  <span className="is-open">OPEN</span>
                  <span className="is-title">Coupon validation fails at checkout (blocked)</span>
                </div>
                <div className="is-body">
                  <div className="is-row"><span className="k">file</span><span className="v mono">src/components/checkout/CouponInput.tsx</span></div>
                  <div className="is-row"><span className="k">repro</span><span className="v mono">3 steps · starts at /checkout</span></div>
                  <div className="is-row"><span className="k">console</span><span className="v mono">ERR_COUPON_STATE_DESYNC</span></div>
                  <div className="is-row"><span className="k">viewport</span><span className="v mono">820×1180 · iPad Safari</span></div>
                  <div className="labels">
                    <span className="label red">bug</span>
                    <span className="label blue">staging</span>
                    <span className="label red">severity:high</span>
                    <span className="label violet">git-voice</span>
                  </div>
                  <p className="mt-16 text-faint mono-xs">→ 0 hours of detective work. Filed in 8 seconds.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- expanding panel */

function ExpandShowcase(): JSX.Element {
  const panel = useExpandPanel<HTMLDivElement>();

  return (
    <section className="section expand-section" id="showcase" data-theme="violet">
      <div className="shell">
        <div className="section-head reveal">
          <span className="kicker">The machine room</span>
          <h2 className="h2"><SplitChars text="Watch it widen" /></h2>
          <p className="lede">Keep scrolling — the intake bay opens to full width as the report arrives.</p>
        </div>
      </div>
      <div className="expand-slot">
        <div
          ref={panel.ref}
          className="expand-panel"
          style={{
            width: `${panel.width}%`,
            height: `${panel.heightPx}px`,
            borderRadius: `${panel.radius}px`
          }}
        >
          <div className="expand-content">
            <div className="conveyor-mini" aria-hidden="true">
              {["voice in", "transcribe", "locate", "correlate", "draft", "confirm", "publish"].map((s, i) => (
                <span key={s} className="cm-node" style={{ animationDelay: `${i * 0.22}s` }}>{s}</span>
              ))}
            </div>
            <div className="expand-stats">
              <div><b>7</b><span>stations per report</span></div>
              <div><b>~8s</b><span>voice → filed issue</span></div>
              <div><b>5</b><span>index matches per draft</span></div>
              <div><b>100%</b><span>traceable evidence</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- machine */

const STATIONS = [
  { icon: "🎙", name: "Voice in", desc: "20 s of natural speech" },
  { icon: "📝", name: "Transcribe", desc: "browser or server STT" },
  { icon: "🧭", name: "Locate", desc: "hybrid index search" },
  { icon: "🔗", name: "Correlate", desc: "console ↔ error codes" },
  { icon: "✍️", name: "Draft", desc: "structured report" },
  { icon: "🔊", name: "Confirm", desc: "spoken back to client" },
  { icon: "📦", name: "Publish", desc: "GitHub issue + labels" }
];

function MachineSection(): JSX.Element {
  const { ref } = useScrollReveal<HTMLDivElement>();
  return (
    <section className="section" id="how" data-theme="blue">
      <div className="shell">
        <div className="section-head reveal">
          <span className="kicker">The machine</span>
          <h2 className="h2"><SplitChars text="Seven stations, eight seconds" /></h2>
          <p className="lede">
            The report rides a conveyor from voice to filed issue. Each station does one
            job and degrades gracefully — the line never stops.
          </p>
        </div>
        <div className="machine" ref={ref}>
          <div className="conveyor">
            {STATIONS.map((s) => (
              <div className="station" key={s.name}>
                <div className="wheel">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    {Array.from({ length: 8 }).map((_, i) => {
                      const a = (i / 8) * Math.PI * 2;
                      return (
                        <line key={i} x1={12 + Math.cos(a) * 6.5} y1={12 + Math.sin(a) * 6.5} x2={12 + Math.cos(a) * 10} y2={12 + Math.sin(a) * 10} strokeLinecap="round" strokeWidth="2" />
                      );
                    })}
                  </svg>
                </div>
                <div className="s-name">{s.name}</div>
                <div className="s-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-24 text-center text-faint mono-xs">
          every step runs server-side and is traced in the dashboard
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ features */

const FEATURES = [
  { tile: "🎙", cls: "", title: "Voice-first capture", body: "Clients tap one button and speak naturally for up to 30 seconds. No forms, no severity pickers, no \"what browser are you using?\"." },
  { tile: "⚙", cls: "", title: "Smart Architecture Index", body: "Routes, components, exported symbols, and error codes from your repo — indexed once, searched with hybrid vector + keyword ranking." },
  { tile: "🧠", cls: "violet", title: "Telemetry correlation", body: "Console logs, page errors, click breadcrumbs, viewport, and user-agent ride along with every report and get correlated to indexed code." },
  { tile: "📄", cls: "violet", title: "Engineering-grade drafts", body: "Every issue ships expected vs. actual, numbered reproduction steps, the suspected file, severity, and labels." },
  { tile: "🔊", cls: "pink", title: "Spoken confirmation", body: "The client hears the issue was logged, its title, and where it will be fixed — before the widget closes." },
  { tile: "🔓", cls: "pink", title: "Zero lock-in", body: "Every external layer has a documented local fallback: the machine runs end-to-end with no API keys, and upgrades piece by piece." }
];

function Features(): JSX.Element {
  const { ref } = useScrollReveal<HTMLDivElement>();
  return (
    <section className="section" id="features" data-theme="base">
      <div className="shell">
        <div className="section-head reveal">
          <span className="kicker">Capabilities</span>
          <h2 className="h2"><SplitChars text="Built like industrial equipment" /></h2>
        </div>
        <div className="grid-3 reveal-stagger" ref={ref}>
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <h3><span className={`icon-tile ${f.cls}`}>{f.tile}</span>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ pricing teaser */

function PricingTeaser(): JSX.Element {
  const { ref } = useScrollReveal<HTMLDivElement>();
  return (
    <section className="section" id="pricing" data-theme="violet">
      <div className="shell">
        <div className="section-head reveal">
          <span className="kicker">Pricing</span>
          <h2 className="h2"><SplitChars text="Start at $0, grow when it pays" /></h2>
          <p className="lede">One filed issue saves an unpaid hour. Everything else is margin.</p>
        </div>
        <div className="pricing-grid reveal-stagger" ref={ref}>
          {PLANS.map((p) => (
            <div className={`card price-card${p.featured ? " featured" : ""}`} key={p.id}>
              <span className="tier">{p.tier}</span>
              <div className="price">{p.price} <small>{p.per}</small></div>
              <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={`btn ${p.featured ? "btn-primary" : "btn-ghost"}`} onClick={() => navigate("/pricing")}>
                See full pricing
              </button>
            </div>
          ))}
        </div>
        <div className="mt-24 text-center">
          <button className="btn btn-ghost" onClick={() => navigate("/pricing")}>Compare every feature →</button>
        </div>
      </div>
    </section>
  );
}

function FinalCta(): JSX.Element {
  return (
    <section className="section final-cta" data-theme="embers">
      <div className="shell text-center">
        <h2 className="h2"><SplitChars text="Point your clients at the microphone." /></h2>
        <p className="lede" style={{ margin: "18px auto 28px" }}>
          The live demo storefront has the real widget installed — report the planted bug like a client would.
        </p>
        <button className="btn btn-primary" onClick={() => navigate("/demo")}>▶ Enter the demo</button>
      </div>
    </section>
  );
}
