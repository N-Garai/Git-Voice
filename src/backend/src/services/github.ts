/** GitHub Issues REST client + push-webhook signature verification. */

import { config } from "../config.js";
import type { GithubPublishResult } from "../types.js";
import crypto from "node:crypto";

export function parseRepoFullName(input: string | undefined | null): { owner: string; repo: string } | null {
  if (!input) return null;
  const m = input.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export async function createGitHubIssue(params: {
  repoFullName?: string;
  title: string;
  body: string;
  labels: string[];
}): Promise<GithubPublishResult> {
  const token = config.github.token;
  const target = parseRepoFullName(params.repoFullName ?? config.github.defaultRepo);

  if (!token) {
    return { pushed: false, reason: "No publishing token configured — kept as a dashboard draft." };
  }
  if (!target) {
    return { pushed: false, reason: "No target repository configured — kept as a dashboard draft." };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "git-voice"
      },
      body: JSON.stringify({
        title: params.title.slice(0, 120),
        body: params.body.slice(0, 60_000),
        labels: params.labels.slice(0, 10)
      }),
      signal: AbortSignal.timeout(20_000)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        pushed: false,
        repository: `${target.owner}/${target.repo}`,
        reason: `GitHub API responded ${res.status}: ${body.slice(0, 180)}`
      };
    }

    const data = (await res.json()) as { number: number; html_url: string };
    return {
      pushed: true,
      issueNumber: data.number,
      issueUrl: data.html_url,
      repository: `${target.owner}/${target.repo}`
    };
  } catch (err) {
    return {
      pushed: false,
      repository: `${target.owner}/${target.repo}`,
      reason: `GitHub API unreachable: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/** Constant-time HMAC-SHA256 verification for the push webhook. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = config.github.webhookSecret;
  if (!secret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
