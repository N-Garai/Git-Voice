/** The full pricing page — animated tiers, feature comparison, and FAQ. */
import { useEffect, useState } from "react";
import { SiteHeader, SiteFooter } from "../components/Chrome";
import { useScrollReveal, SplitChars, prefersReducedMotion, usePageReveals } from "../hooks/animations";
import { useRevealWords } from "../hooks/motion";
import { navigate } from "../lib/router";
import { PLANS, COMPARISON, FAQ } from "../data/plans";

/** "—" for capabilities a tier does not include, "✓" for included ones. */
function Cell({ value }: { value: string | null }): JSX.Element {
  if (value === null) {
    return (
      <span className="cmp-no" role="cell" aria-label="Not included">
        —
      </span>
    );
  }
  if (value === "Included") {
    return (
      <span className="cmp-yes" role="cell" aria-label="Included">
        ✓
      </span>
    );
  }
  return <span role="cell">{value}</span>;
}

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
                    <Cell value={row.hobby} />
                    <span className="cmp-hi" role="presentation">
                      <Cell value={row.freelancer} />
                    </span>
                    <Cell value={row.agency} />
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
              <h2 className="h2"><SplitChars text="Frequently asked questions" /></h2>
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
      <p className="text-dim" style={{ fontSize: 13.5, margin: "10px 0 4px" }}>{plan.tagline}</p>
      <ul>
        {plan.features.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <button className={`btn ${plan.featured ? "btn-primary" : "btn-ghost"}`} onClick={() => navigate(plan.to)}>
        {plan.cta}
      </button>
    </div>
  );
}
