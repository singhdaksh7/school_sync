# SchoolSync — single image, two roles.
#
# The same image runs both the Next.js web/API service (`npm run start`) and
# the background job worker (`npm run worker`) — the worker is a lightweight
# poller (scripts/worker.ts) that only calls the web app's authenticated
# internal endpoint over HTTP, so it needs the same runtime deps (tsx,
# dotenv) but never touches Prisma/S3 directly. ECS task definitions select
# the role via the container `command` override; see infra/terraform/ecs.tf.
#
# Build target platform must match the ECS Fargate architecture (linux/amd64
# by default) so the Prisma engine binary fetched during `prisma generate`
# matches the runtime OS.

ARG NODE_IMAGE=node:22-slim

# ---- deps: full install (incl. devDependencies) for the build stage ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder: generate Prisma client + next build ----
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `prisma generate` only reads prisma/schema.prisma and emits the client — it
# never opens a database connection — but prisma.config.ts (see repo root)
# resolves DATABASE_URL eagerly on load, so a syntactically-valid placeholder
# is required here purely to satisfy that resolution. This ENV is scoped to
# the builder stage only; the `runner` stage below starts a fresh FROM and
# never inherits it — the real DATABASE_URL is injected at container start
# via ECS Secrets Manager (see infra/terraform/secrets.tf), never baked in.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build_placeholder"
RUN npx prisma generate
RUN npm run build

# ---- prod-deps: production-only node_modules for the runtime image ----
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runner: minimal runtime image, non-root, holds web + worker ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# Prisma's query engine (Debian target) needs libssl/openssl at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src/generated ./src/generated
COPY package.json next.config.ts prisma.config.ts tsconfig.worker.json ./
COPY public ./public
COPY prisma ./prisma
COPY scripts ./scripts

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default role: web/API server. ECS overrides `command` for the worker
# (["npm","run","worker"]) and the one-off migration task
# (["npx","prisma","migrate","deploy"]).
CMD ["npm", "run", "start"]
