/** Shared page chrome: header, footer, marquee, and the brand gear mark. */
import { useEffect, useState } from "react";
import { useScrolled } from "../hooks/animations";
import { navigate } from "../lib/router";

export function GearLogo({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <span className="gear-logo" style={{ width: size, height: size, display: "inline-flex" }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <g fill="none" stroke="#22d3ee" strokeWidth="4">
          <circle cx="32" cy="32" r="13" />
          <g strokeLinecap="round" strokeWidth="5">
            <path d="M32 7v8M32 49v8M7 32h8M49 32h8M14.3 14.3l5.7 5.7M43.9 43.9l5.7 5.7M49.7 14.3l-5.7 5.7M20.1 43.9l-5.7 5.7" />
          </g>
        </g>
        <circle cx="32" cy="32" r="4.5" fill="#22d3ee" />
      </svg>
    </span>
  );
}

export function SiteHeader(): JSX.Element {
  const scrolled = useScrolled();
  return (
    <header className={`site-header${scrolled ? " scrolled" : ""}`}>
      <div className="inner">
        <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          <GearLogo />
          <span>
            git<em>-</em>voice
          </span>
        </a>
        <nav className="nav-links">
          <a href="#how" className="hide-sm">How it works</a>
          <a
            href="/pricing"
            onClick={(e) => { e.preventDefault(); navigate("/pricing"); }}
          >
            Pricing
          </a>
          <a
            href="/demo"
            onClick={(e) => { e.preventDefault(); navigate("/demo"); }}
          >
            Live demo
          </a>
          <a
            href="/dashboard"
            className="btn btn-primary btn-sm"
            onClick={(e) => { e.preventDefault(); navigate("/dashboard"); }}
          >
            Open dashboard
          </a>
        </nav>
      </div>
    </header>
  );
}

const MARQUEE_ITEMS = [
  "Voice capture",
  "Browser telemetry",
  "Architecture index",
  "Hybrid retrieval",
  "Issue drafting",
  "Voice confirmation",
  "GitHub publishing",
  "Zero-config boot",
  "Deterministic fallbacks"
];

export function Marquee(): JSX.Element {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="marquee-wrap" aria-hidden="true">
      <div className="marquee">
        {items.map((item, i) => (
          <span key={i}>{item}</span>
        ))}
      </div>
    </div>
  );
}

export function SiteFooter(): JSX.Element {
  return (
    <>
      <Marquee />
      <footer className="site-footer">
        <div className="shell">
          <div className="cols">
            <div>
              <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
                <GearLogo />
                <span>git<em>-</em>voice</span>
              </a>
              <p className="about mt-16">
                The feedback machine for freelance developers: client speaks for twenty
                seconds, an engineering-grade issue lands in the repository.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li><a href="/demo" onClick={(e) => { e.preventDefault(); navigate("/demo"); }}>Live demo</a></li>
                <li><a href="/dashboard" onClick={(e) => { e.preventDefault(); navigate("/dashboard"); }}>Dashboard</a></li>
                <li><a href="/pricing" onClick={(e) => { e.preventDefault(); navigate("/pricing"); }}>Pricing</a></li>
                <li><a href="#how" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>How it works</a></li>
              </ul>
            </div>
            <div>
              <h4>Project</h4>
              <ul>
                <li><a href="#faq" onClick={(e) => { e.preventDefault(); document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" }); }}>FAQ</a></li>
                <li><a href="/api/widget.js">Widget bundle</a></li>
                <li><a href="/health">Service health</a></li>
              </ul>
            </div>
          </div>
          <div className="bottom">
            <span>Apache-2.0 · runs entirely on free tiers</span>
            <span>filed with ♥ by the machine</span>
          </div>
        </div>
      </footer>
    </>
  );
}

/** Fires a toast message into the corner region. */
export function useToast(): (message: string) => void {
  const [region] = useState(() => {
    if (typeof document === "undefined") return null;
    let el = document.querySelector(".toast-region");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast-region";
      document.body.appendChild(el);
    }
    return el as HTMLElement;
  });

  useEffect(() => {
    return () => {
      region?.remove();
    };
  }, [region]);

  return (message: string) => {
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  };
}
