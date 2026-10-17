/**
 * Typed environment configuration. Every integration is optional — the server
 * boots and runs the full pipeline with zero keys, degrading each external
 * call to a documented local fallback.
 */

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface IntegrationStatus {
  id: string;
  label: string;
  envKey: string;
  configured: boolean;
  activeMode: string;
  fallbackMode: string;
}

const EMBEDDING_DIM = num("EMBEDDING_DIM", 768);

export const config = {
  port: num("PORT", 10000),
  nodeEnv: str("NODE_ENV", "development"),
  baseUrl: str("APP_BASE_URL", `http://localhost:${num("PORT", 10000)}`),
  dashboardToken: str("DASHBOARD_TOKEN"),
  dataDir: str("DATA_DIR"),

  gemini: {
    apiKey: str("GOOGLE_API_KEY"),
    draftModelId: str("GEMMA_MODEL_ID", "gemma-3-27b-it"),
    transcribeModelId: str("TRANSCRIBE_MODEL_ID", "gemini-2.5-flash"),
    embeddingModelId: str("EMBEDDING_MODEL_ID", "gemini-embedding-001"),
    embeddingDim: EMBEDDING_DIM
  },

  databaseUrl: str("DATABASE_URL"),

  elevenlabs: {
    apiKey: str("ELEVENLABS_API_KEY"),
    voiceId: str("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
    modelId: str("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")
  },

  github: {
    token: str("GITHUB_TOKEN"),
    defaultRepo: str("GITHUB_DEFAULT_REPO"),
    webhookSecret: str("GITHUB_WEBHOOK_SECRET"),
    oauthClientId: str("GITHUB_OAUTH_CLIENT_ID"),
    oauthClientSecret: str("GITHUB_OAUTH_CLIENT_SECRET")
  },

  auth: {
    // Opaque 256-bit session ids — no signing secret needed. Sessions live in
    // memory and mirror to Postgres when DATABASE_URL is set, so they survive
    // free-tier sleeps/restarts instead of forcing a re-login.
    sessionCookieName: "gv_session",
    sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000
  },

  limits: {
    maxBodyBytes: 12 * 1024 * 1024,
    maxAudioBytes: 10 * 1024 * 1024,
    issuesPerWindowPerIp: 8,
    issueWindowMs: 5 * 60 * 1000,
    maxIssuesKept: 200,
    maxAudioIssuesKept: 50,
    workflowTimeoutMs: 90 * 1000
  }
} as const;

/** Machine-readable health for the settings page + /health. */
/** GitHub login is usable only when both OAuth env keys are present. */
function oauthConfigured(): boolean {
  return Boolean(config.github.oauthClientId && config.github.oauthClientSecret);
}

export function integrationStatuses(): IntegrationStatus[] {
  return [
    {
      id: "llm",
      label: "Issue drafting",
      envKey: "GOOGLE_API_KEY",
      configured: Boolean(config.gemini.apiKey),
      activeMode: `Hosted instruct model (${config.gemini.draftModelId})`,
      fallbackMode: "Built-in deterministic triage synthesizer (offline)"
    },
    {
      id: "stt",
      label: "Server-side transcription",
      envKey: "GOOGLE_API_KEY",
      configured: Boolean(config.gemini.apiKey),
      activeMode: `Audio transcribed by ${config.gemini.transcribeModelId}`,
      fallbackMode: "Browser-native speech capture + typed report fallback"
    },
    {
      id: "embeddings",
      label: "Embeddings",
      envKey: "GOOGLE_API_KEY",
      configured: Boolean(config.gemini.apiKey),
      activeMode: `${config.gemini.embeddingModelId} (${config.gemini.embeddingDim}-d)`,
      fallbackMode: "Deterministic hashed feature vectors (offline)"
    },
    {
      id: "vector-store",
      label: "Vector store",
      envKey: "DATABASE_URL",
      configured: Boolean(config.databaseUrl),
      activeMode: "PostgreSQL + pgvector (HNSW + tsvector hybrid)",
      fallbackMode: "In-process index with the same hybrid ranking"
    },
    {
      id: "tts",
      label: "Voice confirmation",
      envKey: "ELEVENLABS_API_KEY",
      configured: Boolean(config.elevenlabs.apiKey),
      activeMode: "Server-rendered speech audio (mp3)",
      fallbackMode: "Browser-native speech synthesis in the widget"
    },
    {
      id: "github",
      label: "GitHub publishing",
      envKey: "GITHUB_OAUTH_CLIENT_ID",
      configured: oauthConfigured(),
      activeMode: "Issues filed with each project owner's own GitHub identity",
      fallbackMode: "Projects without a signed-in owner stay as dashboard drafts"
    },
    {
      id: "github-login",
      label: "GitHub login",
      envKey: "GITHUB_OAUTH_CLIENT_ID",
      configured: Boolean(config.github.oauthClientId && config.github.oauthClientSecret),
      activeMode: "Developers log in with GitHub; private repos work per-user",
      fallbackMode: "Logged-out mode — any public owner/repo link works"
    },
{
      id: "auth",
      label: "Dashboard access",
      envKey: "DASHBOARD_TOKEN",
      configured: Boolean(config.dashboardToken),
      activeMode: "Operator key + per-owner tenant isolation",
      fallbackMode: "Owner-scoped access only (GitHub login required)"
    }
  ];
}
