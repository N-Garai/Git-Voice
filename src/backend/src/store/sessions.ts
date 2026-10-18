/**
 * GitHub-login sessions.
 *
 * The browser only ever holds an opaque 256-bit session id (HttpOnly cookie).
 * The GitHub OAuth token lives server-side: in memory for speed, mirrored to
 * Postgres when DATABASE_URL is set so logins survive free-tier sleeps and
 * restarts. Tokens are never sent to the client and never appear in logs.
 */
import crypto from "node:crypto";
import pg from "pg";
import { config } from "../config.js";

export interface Session {
  id: string;
  githubUserId: number;
  githubLogin: string;
  /** Public profile image URL; empty when unavailable. */
  avatarUrl: string;
  /** OAuth access token — server-side only, never serialized to the client. */
  token: string;
  createdAt: string;
  expiresAt: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function randomId(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function oauthConfigured(): boolean {
  return Boolean(config.github.oauthClientId && config.github.oauthClientSecret);
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private states = new Map<string, number>();
  private pool: pg.Pool | null = null;

  constructor() {
    if (config.databaseUrl) {
      try {
        this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
      } catch {
        this.pool = null;
      }
    }
  }

  /** Short-lived CSRF states for the OAuth handshake (memory-only is fine). */
  createState(): string {
    const state = randomId(16);
    this.states.set(state, Date.now() + STATE_TTL_MS);
    return state;
  }

  /** Single-use: valid states are consumed on first check. */
  consumeState(state: string | undefined | null): boolean {
    if (!state) return false;
    const expiry = this.states.get(state);
    this.states.delete(state);
    if (!expiry) return false;
    if (Date.now() > expiry) return false;
    if (this.states.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.states) if (v < now) this.states.delete(k);
    }
    return true;
  }

  async create(githubUserId: number, githubLogin: string, token: string, avatarUrl = ""): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: randomId(),
      githubUserId,
      githubLogin,
      avatarUrl,
      token,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + config.auth.sessionMaxAgeMs).toISOString()
    };
    this.sessions.set(session.id, session);
    if (this.pool) {
      try {
        await this.pool.query(
`INSERT INTO git_voice_sessions (id, github_user_id, github_login, avatar_url, token, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at,
           avatar_url = EXCLUDED.avatar_url`,
        [session.id, session.githubUserId, session.githubLogin, session.avatarUrl || null, session.token,
         new Date(session.createdAt), new Date(session.expiresAt)]
        );
      } catch {
        // Memory remains the source of truth when the mirror fails.
      }
    }
    return session;
  }

  async get(id: string | undefined | null): Promise<Session | undefined> {
    if (!id) return undefined;
    const live = this.sessions.get(id);
    if (live) {
      if (Date.now() > Date.parse(live.expiresAt)) {
        await this.destroy(id);
        return undefined;
      }
      return live;
    }
    if (!this.pool) return undefined;
    try {
      const res = await this.pool.query(
        `SELECT id, github_user_id, github_login, avatar_url, token, created_at, expires_at
         FROM git_voice_sessions WHERE id = $1`,
        [id]
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const session: Session = {
        id: row.id as string,
        githubUserId: row.github_user_id as number,
        githubLogin: row.github_login as string,
        avatarUrl: (row.avatar_url as string) ?? "",
        token: row.token as string,
        createdAt: (row.created_at as Date).toISOString(),
        expiresAt: (row.expires_at as Date).toISOString()
      };
      if (Date.now() > Date.parse(session.expiresAt)) {
        await this.destroy(id);
        return undefined;
      }
      this.sessions.set(session.id, session);
      return session;
    } catch {
      return undefined;
    }
  }

  /** Active OAuth token for a GitHub login (used for that user's projects). */
  async tokenForLogin(login: string): Promise<string | undefined> {
    const needle = login.toLowerCase();
    for (const s of this.sessions.values()) {
      if (s.githubLogin.toLowerCase() === needle && Date.now() <= Date.parse(s.expiresAt)) {
        return s.token;
      }
    }
    if (!this.pool) return undefined;
    try {
      const res = await this.pool.query(
        `SELECT token FROM git_voice_sessions
         WHERE lower(github_login) = lower($1) AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
        [login]
      );
      return (res.rows[0] as { token?: string } | undefined)?.token;
    } catch {
      return undefined;
    }
  }

  async destroy(id: string): Promise<void> {
    this.sessions.delete(id);
    if (!this.pool) return;
    try {
      await this.pool.query(`DELETE FROM git_voice_sessions WHERE id = $1`, [id]);
    } catch {
      // Session already gone from memory; nothing left to do.
    }
  }

  async close(): Promise<void> {
    await this.pool?.end().catch(() => {});
  }
}

export const sessionStore = new SessionStore();

/** Parse the session id out of a Cookie header (no dependency). */
export function sessionIdFromCookie(header: string | undefined | null): string | undefined {
  if (!header) return undefined;
  const name = `${config.auth.sessionCookieName}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name)) {
      const value = trimmed.slice(name.length).trim().replace(/^"|"$/g, "");
      if (/^[0-9a-f]{32,128}$/.test(value)) return value;
      return undefined;
    }
  }
  return undefined;
}

/** Build the Set-Cookie header for a fresh login. */
export function sessionCookie(sessionId: string): string {
  const secure = config.baseUrl.startsWith("https://") ? "; Secure" : "";
  const maxAge = Math.floor(config.auth.sessionMaxAgeMs / 1000);
  return `${config.auth.sessionCookieName}=${sessionId}; HttpOnly; Path=/${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Expire the session cookie on logout. */
export function clearSessionCookie(): string {
  const secure = config.baseUrl.startsWith("https://") ? "; Secure" : "";
  return `${config.auth.sessionCookieName}=; HttpOnly; Path=/${secure}; SameSite=Lax; Max-Age=0`;
}
