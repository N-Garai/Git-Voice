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
  userToken?: string;
  title: string;
  body: string;
  labels: string[];
}): Promise<GithubPublishResult> {
  // Per-user OAuth token first (unlocks that user's private repos), then the
  // server-wide publishing token, then gracefully degrade to a draft.
  const token = params.userToken ?? config.github.token;
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

// ---------------------------------------------------------------------------
// GitHub OAuth login (free OAuth App; `repo` scope so private repos work).
// The client secret never leaves the server: code→token exchange + user fetch
// both happen here. Only the GitHub login name is ever exposed to the client.
// ---------------------------------------------------------------------------

export function oauthCallbackUrl(): string {
  return `${config.baseUrl.replace(/\/+$/, "")}/api/auth/github/callback`;
}

export function oauthAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.github.oauthClientId,
    redirect_uri: oauthCallbackUrl(),
    scope: "repo",
    state
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface OAuthAccount {
  accessToken: string;
  githubUserId: number;
  githubLogin: string;
}

/** Exchange the one-time `code` for a user token, then fetch who it belongs to. */
export async function exchangeOAuthCode(code: string): Promise<OAuthAccount> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "git-voice" },
    body: JSON.stringify({
      client_id: config.github.oauthClientId,
      client_secret: config.github.oauthClientSecret,
      code
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (HTTP ${tokenRes.status})`);
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description ?? tokenData.error ?? "No access token returned");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "git-voice"
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!userRes.ok) throw new Error(`Could not read the GitHub profile (HTTP ${userRes.status})`);
  const user = (await userRes.json()) as { id?: number; login?: string };
  if (typeof user.id !== "number" || !user.login) throw new Error("Incomplete GitHub profile");
  return { accessToken: tokenData.access_token, githubUserId: user.id, githubLogin: user.login };
}

export interface RepoListing {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

/** List the logged-in user's repos (private included) for the project picker. */
export async function listUserRepos(userToken: string): Promise<RepoListing[]> {
  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "git-voice"
      },
      signal: AbortSignal.timeout(20_000)
    }
  );
  if (!res.ok) throw new Error(`GitHub repo list failed (HTTP ${res.status})`);
  const data = (await res.json()) as Array<{
    full_name?: string;
    private?: boolean;
    default_branch?: string;
  }>;
  return data
    .filter((r) => typeof r.full_name === "string")
    .map((r) => ({
      fullName: r.full_name as string,
      isPrivate: r.private === true,
      defaultBranch: r.default_branch ?? "main"
    }));
}
