/** Shared page chrome: header, footer, marquee, and the brand gear mark. */
import { useEffect, useState } from "react";
import { useScrolled } from "../hooks/animations";
import { navigate } from "../lib/router";

export function GearLogo({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <span className="gear-logo" style={{ width: size, height: size, display: "inline-flex" }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="gearGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <path
          d="M54.00 32.00 A22 22 0 0 1 53.38 37.17 L47.97 37.81 A17 17 0 0 1 46.16 41.41 L48.85 46.14 A22 22 0 0 1 45.06 49.71 L40.50 46.72 A17 17 0 0 1 36.80 48.31 L35.82 53.67 A22 22 0 0 1 30.62 53.96 L29.05 48.74 A17 17 0 0 1 25.19 47.58 L21.00 51.05 A22 22 0 0 1 16.83 47.93 L18.98 42.93 A17 17 0 0 1 16.77 39.56 L11.33 39.52 A22 22 0 0 1 10.14 34.45 L15.00 32.00 A17 17 0 0 1 15.48 28.00 L11.33 24.48 A22 22 0 0 1 13.68 19.83 L18.98 21.07 A17 17 0 0 1 21.91 18.32 L21.00 12.95 A22 22 0 0 1 25.79 10.90 L29.05 15.26 A17 17 0 0 1 33.07 15.03 L35.82 10.33 A22 22 0 0 1 40.81 11.84 L40.50 17.28 A17 17 0 0 1 43.72 19.69 L48.85 17.86 A22 22 0 0 1 51.71 22.22 L47.97 26.19 A17 17 0 0 1 48.89 30.11 L54.00 32.00 Z"
          fill="url(#gearGrad)"
        />
        <circle cx="32" cy="32" r="10" fill="none" stroke="#0e1219" strokeWidth="3" opacity="0.55" />
        <path d="M32 24v16M25 28l14 8M25 36l14-8" stroke="#0e1219" strokeWidth="2.6" opacity="0.55" strokeLinecap="round" />
        <circle cx="32" cy="32" r="4.4" fill="#0e1219" />
        <circle cx="32" cy="32" r="2.4" fill="#e8faff" />
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
