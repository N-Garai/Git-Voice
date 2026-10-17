/** The full pricing page — animated tiers, feature comparison, pricing FAQ. */
import { useEffect, useState } from "react";
import { SiteHeader, SiteFooter } from "../components/Chrome";
import { useScrollReveal, SplitChars, prefersReducedMotion, usePageReveals } from "../hooks/animations";
import { useRevealWords } from "../hooks/motion";
import { navigate } from "../lib/router";
import { PLANS } from "../data/plans";

const COMPARISON: Array<{ feature: string; hobby: string; freelancer: string; agency: string }> = [
  { feature: "Project staging links", hobby: "1", freelancer: "1 / month slot", agency: "4 included" },
  { feature: "Issues per month", hobby: "10", freelancer: "Unlimited", agency: "Unlimited" },
  { feature: "Voice confirmation", hobby: "Browser voice", freelancer: "Premium voice", agency: "Premium voice" },
  { feature: "Issue drafting", hobby: "Offline engine", freelancer: "Model-drafted", agency: "Model-drafted" },
  { feature: "Architecture index", hobby: "✓", freelancer: "✓", agency: "✓ + pgvector" },
  { feature: "Auto re-index on push", hobby: "—", freelancer: "✓", agency: "✓" },
  { feature: "Draft review gate", hobby: "—", freelancer: "✓", agency: "✓" },
  { feature: "Per-client routing", hobby: "—", freelancer: "—", agency: "✓" },
  { feature: "Support", hobby: "Community", freelancer: "Email", agency: "Priority" }
];

const FAQ = [
  {
    q: "Is the free tier actually usable?",
    a: "Yes — the machine runs fully offline by design: browser speech capture, deterministic drafting, and dashboard drafts. Hobby is a real working tier, not a trial."
  },
  {
    q: "How does per-project billing work?",
    a: "A \"project\" is one staging link (one embeddable widget install). Freelancer covers one project per month slot; Agency bundles four."
  },
  {
    q: "Do I need API keys to start?",
    a: "No. Every key — model drafting, hosted embeddings, premium voice, GitHub publishing, pgvector — is optional and upgrades exactly one station of the pipeline."
  },
  {
    q: "What happens to unpublishable reports?",
    a: "If the GitHub publishing token is missing or a model call fails, the report degrades to a fully-formed dashboard draft — nothing is ever lost."
  },
  {
    q: "Can I self-host?",
    a: "Yes — Apache-2.0 licensed, single Docker image, sized for free-tier containers. Your client data never has to leave infrastructure you control."
  }
];

export default function Pricing(): JSX.Element {
  usePageReveals();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), prefersReducedMotion() ? 0 : 120);
    return () => clearTimeout(t);
  }, []);
  const title = useRevealWords("Priced like a tool,", 150);
  const title2 = useRevealWords("not a platform.", 150 + 17 * 90);
  const tiers = useScrollReveal<HTMLDivElement>();
  const table = useScrollReveal<HTMLDivElement>();
  const faq = useScrollReveal<HTMLDivElement>();

  return (
    <>
      <SiteHeader />
      <main className="pricing-page">
        <section className="section pricing-hero">
          <div className="shell">
            <div className={`section-head reveal is-visible${entered ? " entered" : ""}`}>
              <span className="kicker">Pricing</span>
              <h1 className="h2" aria-label="Priced like a tool, not a platform.">
                <span className="line accent">
                  {title.words.map((w, i) => (
                    <span key={`t${i}`} className="w3d" style={{ transitionDelay: `${title.delays[i]}ms` }}>{w}</span>
                  ))}
                </span>
                <span className="line">
                  {title2.words.map((w, i) => (
                    <span key={`u${i}`} className="w3d" style={{ transitionDelay: `${title2.delays[i]}ms` }}>{w}</span>
                  ))}
                </span>
              </h1>
              <p className="lede">
                One filed issue saves an unpaid hour. One saved hour pays for the month.
                The Hobby tier runs forever at $0 — the machine's offline mode is the product, not a demo.
              </p>
            </div>

            <div className="pricing-grid reveal-stagger" ref={tiers.ref}>
              {PLANS.map((p) => (
                <PriceCard key={p.id} plan={p} />
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="compare">
          <div className="shell">
            <div className="section-head reveal">
              <span className="kicker">Compare</span>
              <h2 className="h2"><SplitChars text="Every feature, side by side" /></h2>
            </div>
            <div className="card compare-card reveal" ref={table.ref}>
              <div className="cmp-table" role="table" aria-label="Plan comparison">
                <div className="cmp-row cmp-head" role="row">
                  <span className="cmp-f" role="columnheader">Feature</span>
                  <span role="columnheader">Hobby</span>
                  <span className="cmp-hi" role="columnheader">Freelancer</span>
                  <span role="columnheader">Agency</span>
                </div>
                {COMPARISON.map((row) => (
                  <div className="cmp-row" role="row" key={row.feature}>
                    <span className="cmp-f" role="cell">{row.feature}</span>
                    <span role="cell">{row.hobby}</span>
                    <span className={`cmp-hi${row.freelancer !== "—" ? " yes" : ""}`} role="cell">{row.freelancer}</span>
                    <span role="cell">{row.agency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="pricing-faq">
          <div className="shell">
            <div className="section-head reveal">
              <span className="kicker">FAQ</span>
              <h2 className="h2"><SplitChars text="Pricing questions" /></h2>
            </div>
            <div className="faq reveal-stagger" ref={faq.ref}>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <div className="faq-body">{f.a}</div>
                </details>
              ))}
            </div>
            <div className="mt-48 text-center">
              <button className="btn btn-primary" onClick={() => navigate("/demo")}>Try the machine — free, no keys needed</button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function PriceCard({ plan }: { plan: (typeof PLANS)[number] }): JSX.Element {
  return (
    <div className={`card price-card${plan.featured ? " featured" : ""}`}>
      {plan.featured && <span className="pc-flag">Most wired</span>}
      <span className="tier">{plan.tier}</span>
      <div className="price">{plan.price} <small>{plan.per}</small></div>
      <ul>
        {plan.features.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <button className={`btn ${plan.featured ? "btn-primary" : "btn-ghost"}`} onClick={() => navigate(plan.to)}>
        {plan.cta}
      </button>
    </div>
  );
}
