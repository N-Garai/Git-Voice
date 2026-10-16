/** Tiny fixed-window rate limiter (per IP) — enough for a free-tier demo. */
import { config } from "../config.js";

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number; remaining: number } {
  const now = Date.now();
  const state = windows.get(ip);

  if (!state || state.resetAt <= now) {
    windows.set(ip, { count: 1, resetAt: now + config.limits.issueWindowMs });
    return { allowed: true, remaining: config.limits.issuesPerWindowPerIp - 1 };
  }

  if (state.count >= config.limits.issuesPerWindowPerIp) {
    return { allowed: false, retryAfterMs: state.resetAt - now, remaining: 0 };
  }

  state.count += 1;

  // Opportunistic cleanup so the map cannot grow unbounded.
  if (windows.size > 1000) {
    for (const [key, s] of windows) if (s.resetAt <= now) windows.delete(key);
  }

  return { allowed: true, remaining: config.limits.issuesPerWindowPerIp - state.count };
}

export function clientIp(headers: Record<string, string>): string {
  return (
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    headers["x-real-ip"] ||
    "local"
  );
}
