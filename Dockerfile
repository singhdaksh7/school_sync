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
#
# Base: Alpine (musl), not Debian slim — the Debian `bookworm` base shipped
# `perl-base` as an Essential OS package (present even though nothing in
# this app calls perl; confirmed by dependency inspection — no npm script,
# node_modules/.bin shebang, or Prisma/Next.js/tsx code path ever invokes
# it) with unpatched critical/high CVEs (`apt-cache policy perl-base` showed
# the installed version already matched the latest available candidate in
# both the main and security repos — an `apt upgrade` would not have fixed
# them). Debian marks `perl-base` Essential, so it can't be removed without
# a forced, unsupported removal. Alpine's base rootfs never includes perl at
# all, so this isn't a suppressed finding — the vulnerable package is
# structurally absent. Prisma's schema has no `binaryTargets` override, so
# `prisma generate` auto-detects musl and fetches the correct engine; the
# only other runtime dependency here (`bcryptjs`) is pure JavaScript with no
# native bindings, so it's unaffected by the libc change.
ARG NODE_IMAGE=node:22-alpine

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

# Prisma's query engine (musl target on Alpine) needs libssl/openssl at
# runtime, same reason as the previous Debian base — just apk instead of apt.
RUN apk add --no-cache openssl ca-certificates

# BusyBox's addgroup/adduser (Alpine) only take short flags, unlike GNU
# groupadd/useradd's long-option form used on the previous Debian base.
RUN addgroup -S -g 1001 nodejs \
    && adduser -S -D -H -u 1001 -G nodejs nextjs

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

# Vendored AWS RDS root CA bundle (see certs/README.md for source/checksum)
# — trusted via NODE_EXTRA_CA_CERTS so Node can verify the RDS TLS
# certificate chain instead of disabling verification. Never fetched at
# build time: exact bytes committed to the repo.
COPY certs/aws-rds-global-bundle.pem ./certs/aws-rds-global-bundle.pem

RUN chown -R nextjs:nodejs /app \
    && chmod 0444 /app/certs/aws-rds-global-bundle.pem
USER nextjs

# Baked into the image itself (not left to ECS-only injection): the bundle
# path is image-internal and fixed by the COPY above, and it is not a
# secret (the AWS RDS root CA is public — see certs/README.md), so there is
# no reason it should ever require an operator-supplied `-e` flag or depend
# on which deployment path re-registers a task definition's `environment`
# block. infra/terraform/ecs.tf also sets this same variable on each ECS
# task definition's `environment` — that's for first-time `terraform apply`
# clarity/parity, not the source of truth; ECS `environment` entries simply
# override an image ENV of the same name when both are present, so setting
# it in both places is safe and never conflicts.
ENV NODE_EXTRA_CA_CERTS=/app/certs/aws-rds-global-bundle.pem

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default role: web/API server. ECS overrides `command` for the worker
# (["npm","run","worker"]) and the one-off migration task
# (["npx","prisma","migrate","deploy"]).
CMD ["npm", "run", "start"]
