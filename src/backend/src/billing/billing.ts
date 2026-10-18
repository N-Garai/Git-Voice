/**
 * Plans, entitlements, subscriptions and invoices.
 *
 * A signed-in GitHub account owns exactly one profile, and that profile carries
 * a tier. The tier decides which pipeline stages run in hosted mode and which
 * are held back — so the pricing page describes behaviour the server actually
 * enforces, not marketing copy.
 *
 * Payments are deliberately simulated: no processor, no money movement, no card
 * data stored. Checkout validates a mock instrument and immediately issues a
 * subscription plus an invoice.
 */
import crypto from "node:crypto";
import pg from "pg";
import { config } from "../config.js";

export type Tier = "hobby" | "freelancer" | "agency";

export type Entitlement =
  | "private-repos"
  | "hosted-drafting"
  | "premium-voice"
  | "auto-reindex"
  | "multi-project";

export interface PlanSpec {
  tier: Tier;
  label: string;
  /** Amount in whole cents; avoids float rounding on invoices. */
  amountCents: number;
  currency: "USD";
  /** How many staging links the tier allows. */
  projectLimit: number;
  entitlements: Entitlement[];
}

export const PLANS: Record<Tier, PlanSpec> = {
  hobby: {
    tier: "hobby",
    label: "Hobby",
    amountCents: 0,
    currency: "USD",
    projectLimit: 1,
    entitlements: []
  },
  freelancer: {
    tier: "freelancer",
    label: "Freelancer",
    amountCents: 1500,
    currency: "USD",
    projectLimit: 1,
    entitlements: ["private-repos", "hosted-drafting", "premium-voice", "auto-reindex"]
  },
  agency: {
    tier: "agency",
    label: "Agency",
    amountCents: 6000,
    currency: "USD",
    projectLimit: 10,
    entitlements: ["private-repos", "hosted-drafting", "premium-voice", "auto-reindex", "multi-project"]
  }
};

const ORDER: Tier[] = ["hobby", "freelancer", "agency"];

/** Higher number = more capable. Used for "at least this tier" checks. */
export function tierRank(tier: Tier): number {
  return ORDER.indexOf(tier);
}

export function hasEntitlement(tier: Tier, entitlement: Entitlement): boolean {
  return PLANS[tier]?.entitlements.includes(entitlement) ?? false;
}

/** Free-tier check used to decide whether a repo requires the paid path. */
export function isPaidTier(tier: Tier): boolean {
  return tierRank(tier) > 0;
}

export interface BillingProfile {
  login: string;
  tier: Tier;
  /** ISO timestamp of the current period's start; null on the free tier. */
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  /** Human-facing sequential reference, e.g. GV-2026-0007. */
  number: string;
  login: string;
  tier: Tier;
  planLabel: string;
  amountCents: number;
  currency: string;
  method: "card" | "upi";
  /** Last four digits for cards, or the masked handle for UPI. Never a full value. */
  instrument: string;
  issuedAt: string;
  periodStart: string;
  periodEnd: string;
  status: "paid";
}

export interface CheckoutInput {
  login: string;
  tier: Tier;
  method: "card" | "upi";
  /** Mock instrument reference, e.g. last4 digits. Never stored raw. */
  instrument: string;
}

export type CheckoutResult =
  | { ok: true; profile: BillingProfile; invoice: Invoice }
  | { ok: false; error: string; status?: number };

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Luhn check — the same validation a real gateway performs before it would
 * reject an instrument. Keeps the mock honest rather than accepting anything.
 */
export function luhnValid(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function maskInstrument(method: "card" | "upi", raw: string): string {
  if (method === "card") {
    const digits = raw.replace(/\D/g, "");
    return `•••• ${digits.slice(-4) || "4242"}`;
  }
  const handle = raw.trim();
  if (handle.includes("@")) {
    const [name, domain] = handle.split("@");
    return `${name.slice(0, 2)}•••@${domain ?? ""}`;
  }
  return `•••${handle.slice(-4)}`;
}

export class BillingStore {
  private profiles = new Map<string, BillingProfile>();
  private invoices: Invoice[] = [];
  private invoiceCounter = 0;
  private pool: pg.Pool | null = null;

  constructor() {
    if (config.databaseUrl) {
      try {
        this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
      } catch {
        this.pool = null;
      }
    }
  }

  private persistProfile(profile: BillingProfile): void {
    if (!this.pool) return;
    void this.pool
      .query(
        `INSERT INTO git_voice_profiles (login, tier, current_period_start, current_period_end, cancel_at_period_end, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (login) DO UPDATE SET
           tier = EXCLUDED.tier,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           updated_at = EXCLUDED.updated_at`,
        [
          profile.login,
          profile.tier,
          profile.currentPeriodStart ?? null,
          profile.currentPeriodEnd ?? null,
          profile.cancelAtPeriodEnd,
          new Date(profile.updatedAt)
        ]
      )
      .catch(() => {
        /* memory stays authoritative */
      });
  }

  private persistInvoice(invoice: Invoice): void {
    if (!this.pool) return;
    void this.pool
      .query(
        `INSERT INTO git_voice_invoices
           (id, number, login, tier, plan_label, amount_cents, currency, method, instrument, issued_at, period_start, period_end, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          invoice.id, invoice.number, invoice.login, invoice.tier, invoice.planLabel,
          invoice.amountCents, invoice.currency, invoice.method, invoice.instrument,
          new Date(invoice.issuedAt), new Date(invoice.periodStart), new Date(invoice.periodEnd),
          invoice.status
        ]
      )
      .catch(() => {
        /* invoice still visible in-memory */
      });
  }

  /** Restore profiles + invoices so a restart does not downgrade anyone. */
  async hydrate(): Promise<void> {
    if (!this.pool) return;
    try {
      const profiles = await this.pool.query(
        `SELECT login, tier, current_period_start, current_period_end, cancel_at_period_end, updated_at
         FROM git_voice_profiles`
      );
      for (const r of profiles.rows as Array<Record<string, unknown>>) {
        const login = r.login as string;
        this.profiles.set(login, {
          login,
          tier: (r.tier as Tier) ?? "hobby",
          currentPeriodStart: r.current_period_start
            ? (r.current_period_start as Date).toISOString()
            : undefined,
          currentPeriodEnd: r.current_period_end
            ? (r.current_period_end as Date).toISOString()
            : undefined,
          cancelAtPeriodEnd: r.cancel_at_period_end === true,
          updatedAt: (r.updated_at as Date).toISOString()
        });
      }

      const invoices = await this.pool.query(
        `SELECT id, number, login, tier, plan_label, amount_cents, currency, method, instrument,
                issued_at, period_start, period_end, status
         FROM git_voice_invoices ORDER BY issued_at DESC LIMIT 100`
      );
      for (const r of invoices.rows as Array<Record<string, unknown>>) {
        this.invoices.push({
          id: r.id as string,
          number: r.number as string,
          login: r.login as string,
          tier: r.tier as Tier,
          planLabel: r.plan_label as string,
          amountCents: r.amount_cents as number,
          currency: r.currency as string,
          method: r.method as "card" | "upi",
          instrument: r.instrument as string,
          issuedAt: (r.issued_at as Date).toISOString(),
          periodStart: (r.period_start as Date).toISOString(),
          periodEnd: (r.period_end as Date).toISOString(),
          status: "paid"
        });
        this.invoiceCounter += 1;
      }
    } catch (err) {
      console.warn("[billing] hydrate skipped:", err instanceof Error ? err.message : err);
    }
  }

  /** Every account starts on Hobby until it checks out. */
  profile(login: string): BillingProfile {
    const existing = this.profiles.get(login);
    if (existing) return this.expireIfLapsed(existing);
    return { login, tier: "hobby", cancelAtPeriodEnd: false, updatedAt: new Date().toISOString() };
  }

  /**
   * A paid tier lapses when its period ends and it was not renewed. Downgrading
   * on expiry is what stops an expired plan from silently keeping access.
   */
  private expireIfLapsed(profile: BillingProfile): BillingProfile {
    if (profile.tier === "hobby") return profile;
    if (!profile.currentPeriodEnd || Date.parse(profile.currentPeriodEnd) > Date.now()) {
      return profile;
    }
    const downgraded: BillingProfile = {
      ...profile,
      tier: "hobby",
      currentPeriodStart: undefined,
      currentPeriodEnd: undefined,
      cancelAtPeriodEnd: false,
      updatedAt: new Date().toISOString()
    };
    this.profiles.set(profile.login, downgraded);
    this.persistProfile(downgraded);
    return downgraded;
  }

  invoicesFor(login: string): Invoice[] {
    return this.invoices.filter((i) => i.login === login);
  }

  /** Simulated checkout. No processor is contacted and no money moves. */
  checkout(input: CheckoutInput): CheckoutResult {
    const plan = PLANS[input.tier];
    if (!plan) return { ok: false, error: "Unknown plan", status: 400 };
    if (!input.login) return { ok: false, error: "Sign in to purchase a plan", status: 401 };

    if (input.method === "card") {
      if (!luhnValid(input.instrument)) {
        return { ok: false, error: "That card number is not valid — check the digits and try again.", status: 400 };
      }
    } else if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(input.instrument.trim())) {
      return { ok: false, error: "Enter a valid UPI handle, for example name@bank", status: 400 };
    }

    const now = new Date().toISOString();
    const periodStart = now;
    const periodEnd = addDays(now, 30);

    this.invoiceCounter += 1;
    const invoice: Invoice = {
      id: `inv_${crypto.randomUUID().slice(0, 16)}`,
      number: `GV-${new Date().getUTCFullYear()}-${String(this.invoiceCounter).padStart(4, "0")}`,
      login: input.login,
      tier: input.tier,
      planLabel: plan.label,
      amountCents: plan.amountCents,
      currency: plan.currency,
      method: input.method,
      instrument: maskInstrument(input.method, input.instrument),
      issuedAt: now,
      periodStart,
      periodEnd,
      status: "paid"
    };
    this.invoices.push(invoice);
    this.persistInvoice(invoice);

    const profile: BillingProfile = {
      login: input.login,
      tier: input.tier,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      updatedAt: now
    };
    this.profiles.set(input.login, profile);
    this.persistProfile(profile);

    return { ok: true, profile, invoice };
  }

  /** Keeps the plan until the paid period ends, then falls back to Hobby. */
  cancel(login: string): BillingProfile {
    const current = this.profile(login);
    if (current.tier === "hobby") return current;
    const next: BillingProfile = { ...current, cancelAtPeriodEnd: true, updatedAt: new Date().toISOString() };
    this.profiles.set(login, next);
    this.persistProfile(next);
    return next;
  }

  /**
   * Immediately returns an account to Hobby and discards its receipts. Used by
   * the support/admin path and by tests that need a clean, unpurchased state.
   */
  reset(login: string): BillingProfile {
    const fresh: BillingProfile = {
      login,
      tier: "hobby",
      cancelAtPeriodEnd: false,
      updatedAt: new Date().toISOString()
    };
    this.profiles.set(login, fresh);
    this.persistProfile(fresh);
    this.invoices = this.invoices.filter((i) => i.login !== login);
    return fresh;
  }

  async close(): Promise<void> {
    await this.pool?.end().catch(() => {});
  }
}

export const billingStore = new BillingStore();

/** One-line summary of what the current tier can and cannot do. */
export function describeEntitlements(profile: BillingProfile): Array<{
  id: Entitlement;
  label: string;
  included: boolean;
}> {
  const labels: Record<Entitlement, string> = {
    "private-repos": "Private repositories",
    "hosted-drafting": "Model-drafted issues",
    "premium-voice": "Premium confirmation voice",
    "auto-reindex": "Automatic re-index on push",
    "multi-project": "Multiple client projects"
  };
  return (Object.keys(labels) as Entitlement[]).map((id) => ({
    id,
    label: labels[id],
    included: hasEntitlement(profile.tier, id)
  }));
}
