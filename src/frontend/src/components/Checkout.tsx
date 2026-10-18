/**
 * Simulated checkout.
 *
 * No payment processor is contacted and no money moves: the server validates a
 * mock instrument (Luhn for cards, handle shape for UPI), then immediately
 * issues a subscription and an invoice. The UI says so plainly so nobody
 * mistakes it for a live transaction.
 */
import { useState } from "react";
import { api, type Invoice, type Tier } from "../lib/api";

export interface PlanOption {
  tier: Tier;
  label: string;
  amountCents: number;
}

const METHOD_LABEL: Record<"card" | "upi", string> = { card: "Card", upi: "UPI" };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Deterministic decorative pattern standing in for a scan code. It encodes no
 * payment data and cannot be scanned into anything — it exists so the flow
 * reads as a real checkout.
 */
function MockQr({ seed }: { seed: string }): JSX.Element {
  const cells: boolean[] = [];
  let h = 2166136261;
  for (let i = 0; i < 169; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    cells.push((h >>> 8) % 2 === 0);
  }
  const finder = (r: number, c: number) => (r < 3 && c < 3) || (r < 3 && c > 11) || (r > 11 && c < 3);
  return (
    <svg
      viewBox="0 0 13 13"
      width="150"
      height="150"
      role="img"
      aria-label="Simulated scan code"
      style={{ background: "#fff", padding: 8, borderRadius: 10 }}
    >
      {cells.map((on, i) => {
        const r = Math.floor(i / 13);
        const c = i % 13;
        const finderBlock = (r % 4 === 0 && c % 4 === 0) || finder(r, c);
        return <rect key={i} x={c} y={r} width="1" height="1" fill={finderBlock || on ? "#0a0a0b" : "#fff"} />;
      })}
    </svg>
  );
}

export default function Checkout({
  plans,
  currentTier,
  onDone,
  onCancel
}: {
  plans: PlanOption[];
  currentTier: Tier;
  onDone: (invoice: Invoice) => void;
  onCancel: () => void;
}): JSX.Element {
  const [tier, setTier] = useState<Tier>(
    plans.some((p) => p.tier === "freelancer") ? "freelancer" : (plans[0]?.tier ?? "hobby")
  );
  const [method, setMethod] = useState<"card" | "upi">("card");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const plan = plans.find((p) => p.tier === tier);
  const free = !plan || plan.amountCents === 0;

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!free) {
      if (method === "card") {
        if (!/^\d{13,19}$/.test(number.replace(/\D/g, ""))) {
          setError("Enter the 16 digits on your card.");
          return;
        }
        if (!/^\d{2}\/\d{2}$/.test(expiry)) {
          setError("Expiry must be MM/YY.");
          return;
        }
        if (!/^\d{3,4}$/.test(cvc)) {
          setError("Security code must be 3 or 4 digits.");
          return;
        }
      } else if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(handle.trim())) {
        setError("Enter a valid UPI handle, for example name@bank");
        return;
      }
    }

    setBusy(true);
    try {
      const instrument = free
        ? "0000000000000000"
        : method === "card"
          ? number.replace(/\D/g, "")
          : handle.trim();
      const res = await api.checkout(tier, method, instrument);
      onDone(res.invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,7,11,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
      onClick={onCancel}
    >
      <form
        className="card"
        style={{ maxWidth: 460, width: "100%" }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void pay(e)}
      >
        <h3 style={{ fontFamily: "var(--font-display)", marginBottom: 4 }}>Choose your plan</h3>
        <p className="mono-xs text-faint" style={{ marginBottom: 16 }}>
          Simulated checkout — no payment processor is contacted and no money moves.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {plans.map((p) => (
            <button
              key={p.tier}
              type="button"
              className={`btn btn-sm ${tier === p.tier ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setTier(p.tier)}
              aria-pressed={tier === p.tier}
            >
              {p.label} · {money(p.amountCents)}
            </button>
          ))}
        </div>

        {currentTier !== "hobby" && (
          <p className="mono-xs text-cyan" style={{ marginBottom: 12 }}>
            You are on {currentTier} — upgrades take effect immediately.
          </p>
        )}

        {free ? (
          <p className="text-dim" style={{ fontSize: 14 }}>
            Hobby stays free forever. No card required.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {(["card", "upi"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn-sm ${method === m ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setMethod(m)}
                  aria-pressed={method === m}
                >
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>

            {method === "card" ? (
              <>
                <input
                  className="coupon-input-field"
                  style={{ marginBottom: 10 }}
                  placeholder="4242 4242 4242 4242"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
                <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <input
                    className="coupon-input-field"
                    style={{ margin: 0 }}
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    autoComplete="off"
                  />
                  <input
                    className="coupon-input-field"
                    style={{ margin: 0 }}
                    placeholder="CVC"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <p className="mono-xs text-faint" style={{ marginBottom: 12 }}>
                  Any test digits work — the card number is checked before the invoice is issued.
                </p>
              </>
            ) : (
              <>
                <input
                  className="coupon-input-field"
                  style={{ marginBottom: 12 }}
                  placeholder="name@bank"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoComplete="off"
                />
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <MockQr seed={`${tier}:${handle || "pending"}`} />
                  <span className="mono-xs text-faint">Decorative only — encodes no payment data</span>
                </div>
              </>
            )}
          </>
        )}

        {error && (
          <p className="mono-xs" style={{ color: "var(--red)", marginBottom: 12 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? "Processing…" : free ? "Switch to Hobby" : `Pay ${money(plan?.amountCents ?? 0)}`}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Receipt shown immediately after a successful purchase. */
export function Receipt({ invoice, onClose }: { invoice: Invoice; onClose: () => void }): JSX.Element {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,7,11,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
      onClick={onClose}
    >
      <div className="card" style={{ maxWidth: 440, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontFamily: "var(--font-display)", marginBottom: 4 }}>Payment complete</h3>
        <p className="mono-xs text-faint" style={{ marginBottom: 18 }}>
          Invoice {invoice.number} · {new Date(invoice.issuedAt).toLocaleString()}
        </p>

        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: "0 0 18px", fontSize: 14 }}>
          <dt className="text-faint">Plan</dt>
          <dd style={{ margin: 0 }}>{invoice.planLabel}</dd>
          <dt className="text-faint">Amount</dt>
          <dd style={{ margin: 0 }}>
            {money(invoice.amountCents)} {invoice.currency}
          </dd>
          <dt className="text-faint">Method</dt>
          <dd style={{ margin: 0 }}>
            {METHOD_LABEL[invoice.method]} {invoice.instrument}
          </dd>
          <dt className="text-faint">Status</dt>
          <dd style={{ margin: 0, color: "var(--green)" }}>{invoice.status}</dd>
          <dt className="text-faint">Renews</dt>
          <dd style={{ margin: 0 }}>{new Date(invoice.periodEnd).toLocaleDateString()}</dd>
        </dl>

        <button className="btn btn-primary" style={{ width: "100%" }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}