# Bun runs the Hono API and serves the built SPA from one origin.
FROM oven/bun:1

WORKDIR /app

# Manifests first so dependency installs cache independently of source changes.
COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

# Build the static SPA into apps/web/dist.
RUN cd apps/web && bun run build

# The API applies pending migrations then serves /api, /public, /health and the SPA.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "bun apps/api/src/migrate.ts && bun apps/api/src/server.ts"]
