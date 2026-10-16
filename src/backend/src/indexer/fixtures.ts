/**
 * Bundled demo project — a small storefront codebase used to seed the
 * architecture index so the machine is immediately explorable with zero
 * configuration. It contains one deliberate bug on the checkout route
 * (a coupon state desync) that the live demo storefront reproduces, so
 * every filed report maps to real, indexed code.
 */

export interface FixtureFile {
  path: string;
  source: string;
}

export const DEMO_PROJECT_ID = "prj_demo_storefront";

export const DEMO_PROJECT_NAME = "Demo Storefront";

export const DEMO_FIXTURE: FixtureFile[] = [
  {
    path: "src/components/checkout/CouponInput.tsx",
    source: `/**
 * Coupon entry field for the checkout route.
 * Applies promotional codes and reflects validation state.
 */
import { useState } from "react";
import { validatePromoCode } from "../../lib/api/coupon";
import "./checkout.css";

export const ERR_COUPON_STATE_DESYNC = "ERR_COUPON_STATE_DESYNC";

async function applyCoupon(code: string): Promise<number> {
  const promo = await validatePromoCode(code.trim().toUpperCase());
  return promo.discountPct;
}

export function CouponInput({ onApplied }: { onApplied: (discount: number) => void }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ status: "idle" | "pending" | "applied" | "invalid"; discount?: number }>({ status: "idle" });

  async function onApply() {
    setState({ status: "pending" });
    try {
      const promo = await validatePromoCode(code.trim().toUpperCase());
      // BUG: the staging API returns discount_percent (snake_case) while this
      // component reads discountPct. The undefined read throws inside the
      // try block *before* the success state is committed, leaving the
      // pending flag set and the Complete Order button disabled forever.
      const discount = await applyCoupon(code);
      setState({ status: "applied", discount });
      onApplied(discount);
    } catch (err) {
      console.error("ERR_COUPON_STATE_DESYNC: coupon response shape mismatch", err);
      setState({ status: "invalid" });
    }
  }

  return (
    <div className="coupon-input">
      <input
        className="coupon-field"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Promotional code"
        aria-label="Promotional code"
      />
      <button className="coupon-apply" onClick={applyCoupon} disabled={state.status === "pending"}>
        Apply code
      </button>
      {state.status === "invalid" && <p className="coupon-error">That code didn't work.</p>}
    </div>
  );
}
`
  },
  {
    path: "src/components/checkout/CheckoutForm.tsx",
    source: `/**
 * Primary checkout completion form. Locks the Complete Order button while a
 * coupon or payment request is pending.
 */
import { useState } from "react";
import { CouponInput } from "./CouponInput";

export const ERR_ORDER_PAYLOAD_INVALID = "ERR_ORDER_PAYLOAD_INVALID";
export const WARN_SUBMIT_LOCKED = "WARN_SUBMIT_LOCKED";

export function CheckoutForm({ cartTotal }: { cartTotal: number }) {
  const [discount, setDiscount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function submitOrder() {
    if (submitting) {
      console.warn(WARN_SUBMIT_LOCKED);
      return;
    }
    setSubmitting(true);
    const payload = { total: cartTotal, discount };
    if (!payload.total) throw new Error(ERR_ORDER_PAYLOAD_INVALID);
    await fetch("/api/checkout", { method: "POST", body: JSON.stringify(payload) });
    setSubmitting(false);
  }

  return (
    <form className="checkout-form" onSubmit={(e) => e.preventDefault()}>
      <h2>Checkout</h2>
      <CouponInput onApplied={setDiscount} />
      <div className="checkout-summary">Total due: {(cartTotal - discount).toFixed(2)}</div>
      <button
        className="complete-order-button"
        type="button"
        onClick={submitOrder}
        disabled={submitting}
      >
        Complete order
      </button>
    </form>
  );
}
`
  },
  {
    path: "src/lib/api/coupon.ts",
    source: `/** Promotional code API client. */
export const ERR_INVALID_CODE = "ERR_INVALID_CODE";
export const PROMO_EXPIRED_422 = "PROMO_EXPIRED_422";

export interface PromoResponse {
  code: string;
  discount_percent: number;
  expiresAt: string;
}

export async function validatePromoCode(code: string): Promise<PromoResponse> {
  if (!code) throw new Error(ERR_INVALID_CODE);
  const res = await fetch(\`/api/promo/\${encodeURIComponent(code)}\`);
  if (res.status === 422) throw new Error(PROMO_EXPIRED_422);
  if (!res.ok) throw new Error(ERR_INVALID_CODE);
  return (await res.json()) as PromoResponse;
}
`
  },
  {
    path: "src/components/cart/CartDrawer.tsx",
    source: `/** Slide-over cart drawer with quantity steppers and subtotal recalculation. */
import { useState } from "react";

export const ERR_NAN_SUBTOTAL = "ERR_NAN_SUBTOTAL";
export const CART_SYNC_FAILED = "CART_SYNC_FAILED";

export interface CartItem { sku: string; unitPrice: number; qty: number; bundleDiscount?: number }

export function CartDrawer({ items }: { items: CartItem[] }) {
  const [local, setLocal] = useState(items);

  function updateQuantity(sku: string, delta: number) {
    setLocal((prev) => prev.map((i) => (i.sku === sku ? { ...i, qty: Math.max(1, i.qty + delta) } : i)));
  }

  function recalculateSubtotal(list: CartItem[]): number {
    const total = list.reduce((sum, i) => sum + (i.unitPrice - (i.bundleDiscount ?? 0)) * i.qty, 0);
    if (Number.isNaN(total)) {
      console.error(ERR_NAN_SUBTOTAL);
      return 0;
    }
    return total;
  }

  return (
    <aside className="cart-drawer">
      {local.map((i) => (
        <div className="cart-line" key={i.sku}>
          <span>{i.sku}</span>
          <button className="cart-stepper" onClick={() => updateQuantity(i.sku, 1)}>+</button>
          <button className="cart-stepper" onClick={() => updateQuantity(i.sku, -1)}>-</button>
        </div>
      ))}
      <div className="cart-subtotal">Subtotal: {recalculateSubtotal(local).toFixed(2)}</div>
    </aside>
  );
}
`
  },
  {
    path: "src/components/billing/PaymentModal.tsx",
    source: `/** Subscription upgrade modal with focus trapping. */
import { useEffect, useRef } from "react";

export const ERR_PAYMENT_INTENT_NULL = "ERR_PAYMENT_INTENT_NULL";
export const PAYMENT_ELEMENT_MOUNT_FAIL = "PAYMENT_ELEMENT_MOUNT_FAIL";

export function PaymentModal({ planId, onClose }: { planId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function createUpgradeIntent(id: string) {
      const res = await fetch("/api/billing/intent", { method: "POST", body: JSON.stringify({ planId: id }) });
      const data = await res.json();
      if (!data.clientSecret) {
        console.error(ERR_PAYMENT_INTENT_NULL);
      }
      return data.clientSecret as string | null;
    }
    createUpgradeIntent(planId).catch((err) => console.error(PAYMENT_ELEMENT_MOUNT_FAIL, err));
  }, [planId]);

  return (
    <div className="payment-modal" ref={ref}>
      <button className="payment-modal-close" onClick={onClose}>Close</button>
    </div>
  );
}
`
  },
  {
    path: "src/components/auth/SessionGuard.tsx",
    source: `/** Client-side session boundary: verifies the token before rendering children. */
import { useEffect } from "react";

export const ERR_TOKEN_STALE = "ERR_TOKEN_STALE";

export function SessionGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    async function verifySessionToken() {
      const res = await fetch("/api/session/verify");
      if (res.status === 401) {
        console.error(ERR_TOKEN_STALE);
        window.location.assign("/auth/login");
      }
    }
    verifySessionToken();
  }, []);
  return <>{children}</>;
}
`
  },
  {
    path: "src/lib/api/client.ts",
    source: `/** Shared fetch wrapper with timeout + retry budget. */
export const NETWORK_TIMEOUT = "NETWORK_TIMEOUT";
export const RETRY_BUDGET_EXCEEDED = "RETRY_BUDGET_EXCEEDED";

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return (await res.json()) as T;
  } catch (err) {
    console.error(NETWORK_TIMEOUT, url);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
`
  },
  {
    path: "src/components/onboarding/AssetUploader.tsx",
    source: `/** Drag-and-drop brand asset uploader for client onboarding. */
export const ERR_HEIC_UNSUPPORTED = "ERR_HEIC_UNSUPPORTED";
export const UPLOAD_CHUNK_TIMEOUT = "UPLOAD_CHUNK_TIMEOUT";

export function AssetUploader() {
  function handleFileDrop(files: FileList) {
    for (const file of Array.from(files)) {
      if (file.name.toLowerCase().endsWith(".heic")) {
        console.error(ERR_HEIC_UNSUPPORTED, file.name);
        continue;
      }
      void upload(file);
    }
  }

  async function upload(file: File) {
    try {
      await fetch("/api/onboarding/assets", { method: "POST", body: file });
    } catch {
      console.error(UPLOAD_CHUNK_TIMEOUT);
    }
  }

  return <div className="asset-uploader" onDrop={(e) => handleFileDrop(e.dataTransfer.files)}>Drop brand assets here</div>;
}
`
  },
  {
    path: "src/routes/AppRoutes.tsx",
    source: `/** Top-level route table for the storefront. */
import { CheckoutForm } from "../components/checkout/CheckoutForm";
import { CartDrawer } from "../components/cart/CartDrawer";
import { SessionGuard } from "../components/auth/SessionGuard";

export function AppRoutes() {
  return (
    <SessionGuard>
      {/* route table rendered by the router */}
      <a href="/cart">/cart</a>
      <a href="/checkout">/checkout</a>
      <a href="/settings/billing">/settings/billing</a>
      <a href="/onboarding/assets">/onboarding/assets</a>
      <CheckoutForm cartTotal={0} />
      <CartDrawer items={[]} />
    </SessionGuard>
  );
}
`
  },
  {
    path: "src/styles/checkout.css",
    source: `/* Checkout route styling. */
.checkout-form {
  display: grid;
  gap: 12px;
  max-width: 420px;
}

.coupon-input {
  display: flex;
  gap: 8px;
}

.coupon-field {
  border: 1px solid var(--line);
  padding: 8px;
}

.coupon-error {
  color: var(--danger);
}

.complete-order-button {
  background: var(--accent);
  padding: 12px;
}

.checkout-summary {
  font-variant-numeric: tabular-nums;
}
`
  }
];
