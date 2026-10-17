/**
 * Demo staging storefront — a deliberately broken checkout that reproduces
 * the bug seeded in the demo project's architecture index. The real widget
 * script (served by this same origin at /api/widget.js) is loaded onto the
 * page exactly the way a client's staging site would load it.
 */
import { useEffect, useState } from "react";
import { SiteHeader, SiteFooter } from "../components/Chrome";
import { useScrollReveal } from "../hooks/animations";
import { navigate } from "../lib/router";
import { api } from "../lib/api";

export default function DemoStore(): JSX.Element {
  // Reports require a signed-in owner, so surface that state up front instead
  // of letting the widget fail after the client has already spoken.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    void api
      .me()
      .then((m) => setSignedIn(Boolean(m.user)))
      .catch(() => setSignedIn(false));
  }, []);

  const [code, setCode] = useState("");
  const [couponState, setCouponState] = useState<"idle" | "pending" | "applied" | "invalid">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [orderState, setOrderState] = useState<"none" | "blocked" | "done">("none");
  const [widgetLoaded, setWidgetLoaded] = useState(false);
  const reveal = useScrollReveal<HTMLDivElement>();

  // Load the production widget bundle onto this page, like a real staging site.
  useEffect(() => {
    if (document.querySelector("script[data-gv-demo]")) {
      setWidgetLoaded(true);
      return;
    }
    const s = document.createElement("script");
    s.src = "/api/widget.js";
    s.dataset.projectId = "prj_demo_storefront";
    s.dataset.gvDemo = "true";
    s.onload = () => setWidgetLoaded(true);
    s.onerror = () => setWidgetLoaded(false);
    document.body.appendChild(s);

    // Seed the console with the exact error the fixture's bug produces, so
    // telemetry correlation has something real to bite on.
    const t = setTimeout(() => {
      console.error("ERR_COUPON_STATE_DESYNC: coupon response shape mismatch", {
        expected: "discountPct",
        received: "discount_percent",
        file: "src/components/checkout/CouponInput.tsx"
      });
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  // The deliberate bug: the "API" returns snake_case; this component reads
  // camelCase — the apply never commits success and the flow locks up.
  const applyCoupon = () => {
    if (!code.trim()) return;
    setCouponState("pending");
    setTimeout(() => {
      // Staging promo API (mocked): responds with discount_percent.
      const promo = { code: code.trim().toUpperCase(), discount_percent: 20, expiresAt: "2026-12-31" };
      // Component bug: reads discountPct — undefined.
      const discount = (promo as unknown as { discountPct?: number }).discountPct;
      if (discount === undefined) {
        console.error("TypeError: Cannot read properties of undefined (reading 'discountPct')", {
          component: "CouponInput",
          route: "/demo"
        });
        setCouponState("invalid");
        return;
      }
      setCouponState("applied");
    }, 500);
  };

  const completeOrder = () => {
    if (couponState === "pending") return; // the lock the bug causes
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setOrderState(couponState === "invalid" ? "blocked" : "done");
    }, 600);
  };

  return (
    <>
      <SiteHeader />
      <main className="demo-store">
        <div className="shell">
          <div style={{ maxWidth: 720, marginBottom: 36 }}>
            <span className="kicker">Staging environment</span>
            <h1 className="h2">Acme Outfitters — staging build 4f19c</h1>
            <p className="lede">
              This page pretends to be a client's staging site. Something here is broken — the
              coupon field rejects valid codes and locks checkout. Sign in, then click the glowing
              microphone button in the corner and{" "}
              <strong style={{ color: "var(--pink)" }}>report it like a client would</strong>:
              casually, emotionally, non-technically. Then open the{" "}
              <a href="/dashboard" onClick={(e) => { e.preventDefault(); navigate("/dashboard"); }}>dashboard</a> and watch the machine work.
            </p>
            <p className="mono-xs text-faint mt-8">
              widget status: {widgetLoaded ? <span className="text-cyan">loaded ✓</span> : <span className="loading-dots"><i /><i /><i /></span>}
            </p>
            {signedIn === false && (
              <div className="card mt-16" style={{ borderColor: "rgba(251, 191, 36, 0.35)" }}>
                <p className="mono-xs" style={{ color: "var(--amber)", marginBottom: 10 }}>
                  SIGN IN REQUIRED TO FILE
                </p>
                <p className="text-dim" style={{ fontSize: 13.5, marginBottom: 14 }}>
                  Reports are private and each issue is filed under the project owner's own GitHub
                  identity, so the machine needs to know who is asking. Sign in, then talk to the
                  microphone exactly like a client would.
                </p>
                <a className="btn btn-primary" href="/api/auth/github">Sign in with GitHub</a>
              </div>
            )}
          </div>

          <div className="store-grid" ref={reveal.ref}>
            <div className="reveal reveal-left">
              <div className="product">
                <div className="p-img" aria-hidden="true">🏕</div>
                <div className="p-body">
                  <h3>Trailhead 2P Tent</h3>
                  <div className="p-price">$249.00</div>
                  <p className="text-dim" style={{ fontSize: 14 }}>
                    Lightweight three-season shelter with dual vestibules. Ships in 2 days.
                  </p>
                  <button
                    className="btn btn-primary mt-16"
                    onClick={() => {
                      // Click breadcrumbs for the telemetry collector.
                      setCode(code || "SUMMER20");
                      console.log("added Trailhead 2P Tent to cart");
                    }}
                  >
                    Add to cart
                  </button>
                </div>
              </div>
            </div>

            <div className="reveal reveal-right">
              <div className="store-cart">
                <h3 style={{ fontFamily: "var(--font-display)", marginBottom: 10 }}>Your cart</h3>
                <div className="cart-line">
                  <span>Trailhead 2P Tent × 1</span>
                  <span className="mono">$249.00</span>
                </div>

                <div className="coupon-row">
                  <input
                    className={`coupon-input-field${couponState === "invalid" ? " err" : ""}`}
                    placeholder="Promo code — try SUMMER20"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCouponState("idle");
                    }}
                    aria-label="Promotional code"
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={applyCoupon}
                    disabled={couponState === "pending"}
                  >
                    Apply
                  </button>
                </div>
                <div className={`coupon-msg ${couponState === "invalid" ? "err" : "ok"}`}>
                  {couponState === "invalid" && "That code didn't work. (this is the bug — SUMMER20 is valid)"}
                  {couponState === "applied" && "Code applied!"}
                  {couponState === "pending" && "Checking…"}
                </div>

                <button
                  className="complete-order-btn"
                  onClick={completeOrder}
                  disabled={submitting || couponState === "pending"}
                >
                  {submitting ? "Placing order…" : "Complete order"}
                </button>

                {orderState === "blocked" && (
                  <p className="coupon-msg err mt-8">Order blocked: coupon state invalid.</p>
                )}
                {orderState === "done" && (
                  <p className="coupon-msg ok mt-8">Order placed. (try the coupon first — that's the broken path)</p>
                )}
              </div>
            </div>
          </div>

          <div className="card mt-48" style={{ maxWidth: 720 }}>
            <h3 style={{ fontFamily: "var(--font-display)" }}>What to say (or type)</h3>
            <p className="text-dim mt-8" style={{ fontStyle: "italic", color: "var(--pink)" }}>
              “I typed my coupon code SUMMER20 and the box turned red even though the code is
              definitely right, and then when I click complete order nothing happens at all.
              I need this fixed today, my customers can't check out!”
            </p>
            <p className="mono-xs text-faint mt-16">
              The machine will: capture your voice → bundle this page's console errors
              (ERR_COUPON_STATE_DESYNC is live in the console right now) → match the demo
              index → draft the issue → speak the confirmation → show it in the dashboard.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
