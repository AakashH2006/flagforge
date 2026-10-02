# Build and run the API. Debian rather than Alpine because @node-rs/argon2 is a native module
# and its glibc prebuilds are the well-trodden path.
FROM node:22-bookworm-slim AS build

WORKDIR /app
# The lockfile covers every workspace, so both installs below resolve the same versions.
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace=server --include-workspace-root

COPY server/ server/
RUN npm run build -w server


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server --include-workspace-root && npm cache clean --force

COPY --from=build /app/server/dist server/dist
# Migrations are read at runtime by `npm run db:migrate -w server`.
COPY server/drizzle server/drizzle

# Attachments live here. Mount a volume: a container's own filesystem does not survive a redeploy.
ENV UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R node:node /data

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 4000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server/dist/index.js"]
