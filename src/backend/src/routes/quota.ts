/**
 * Abuse guards for the public report endpoint.
 *
 * The widget endpoint is intentionally open (it is the product's front door),
 * but the hosted model key behind it is the operator's own free-tier quota.
 * Two layers protect it:
 *
 *  1. `checkRateLimit`  — per-IP fixed window (existing).
 *  2. `claimHostedQuota` — a process-wide budget for hosted (LLM/STT/embed)
 *     work. Anonymous reports draw from a small reserved slice so a burst of
 *     traffic degrades to the offline engine instead of exhausting the
 *     operator's quota; authenticated users draw from their own larger share.
 *
 * The budget resets hourly and lives in memory on purpose — it is a fairness
 * valve, not an accounting ledger, so it must not become a persistence or
 * availability dependency.
 */

export type QuotaClass = "anonymous" | "authenticated";

export interface QuotaDecision {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

interface Window {
  anonymous: number;
  authenticated: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 60 * 1000;

// Hosted work allowed per hour in total, and the maximum share that anonymous
// (unauthenticated) traffic may consume of it. Sized so a real demo/judge run
// never hits the ceiling, while a runaway loop exhausts the anonymous slice
// quickly and only then starts degrading authenticated traffic.
const TOTAL_HOSTED_PER_HOUR = 120;
const ANON_SHARE = 0.25;

let window: Window = { anonymous: 0, authenticated: 0, resetAt: Date.now() + WINDOW_MS };

function current(): Window {
  if (Date.now() >= window.resetAt) {
    window = { anonymous: 0, authenticated: 0, resetAt: Date.now() + WINDOW_MS };
  }
  return window;
}

export function claimHostedQuota(cls: QuotaClass): QuotaDecision {
  if (!process.env.GOOGLE_API_KEY) {
    // No hosted key configured: the offline engine costs nothing, so there is
    // nothing to protect and nothing to ration.
    return { allowed: true };
  }

  const w = current();
  const total = w.anonymous + w.authenticated;
  const anonCeiling = Math.floor(TOTAL_HOSTED_PER_HOUR * ANON_SHARE);

  if (cls === "anonymous") {
    if (total >= TOTAL_HOSTED_PER_HOUR || w.anonymous >= anonCeiling) {
      return {
        allowed: false,
        reason: "Hosted model capacity is fully reserved right now — using the offline engine instead.",
        retryAfterMs: Math.max(1_000, w.resetAt - Date.now())
      };
    }
    w.anonymous += 1;
    return { allowed: true };
  }

  if (total >= TOTAL_HOSTED_PER_HOUR) {
    return {
      allowed: false,
      reason: "Hosted model capacity is fully reserved right now — using the offline engine instead.",
      retryAfterMs: Math.max(1_000, w.resetAt - Date.now())
    };
  }
  w.authenticated += 1;
  return { allowed: true };
}

/** Test seam: read the current window without mutating it. */
export function hostedQuotaSnapshot(): { anonymous: number; authenticated: number; resetAt: number } {
  return { ...current() };
}

/** Test seam: force the next read to start a fresh window. */
export function resetHostedQuota(): void {
  window = { anonymous: 0, authenticated: 0, resetAt: Date.now() + WINDOW_MS };
}