# ============================================================================
# Git-Voice — single-container production image
# One Node process serves the dashboard SPA, the embeddable widget bundle,
# and the triage REST API. Built for platforms that run a Dockerfile
# (sized for a 512 MB free-tier container — no native modules).
# ============================================================================

# ---------- Stage 1: dashboard + widget bundle ----------
FROM node:22-alpine AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY src/frontend/package.json ./src/frontend/
RUN npm ci

COPY src/frontend ./src/frontend
RUN npm run build -w @git-voice/frontend

# ---------- Stage 2: backend (TypeScript -> dist) ----------
FROM node:22-alpine AS backend-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY src/backend/package.json ./src/backend/
RUN npm ci

COPY src/backend ./src/backend
RUN npm run build -w @git-voice/backend

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000

# Production dependencies only (frontend deps are all build-time).
COPY package.json package-lock.json ./
COPY src/frontend/package.json ./src/frontend/
COPY src/backend/package.json ./src/backend/
RUN npm ci --omit=dev

COPY --from=backend-build  /app/src/backend/dist  ./src/backend/dist
COPY --from=frontend-build /app/src/frontend/dist ./src/frontend/dist
COPY --from=frontend-build /app/src/frontend/dist-widget ./src/frontend/dist-widget

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1

CMD ["node", "src/backend/dist/index.js"]
