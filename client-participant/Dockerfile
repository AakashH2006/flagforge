# Builds the player client and serves it from nginx, with /api and the Socket.io upgrade
# proxied to the API so the browser only ever talks to one origin.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY client-participant/package.json client-participant/
RUN npm ci --workspace=client-participant --include-workspace-root

COPY client-participant/ client-participant/
RUN npm run build -w client-participant


FROM nginx:1.29-alpine AS runtime
COPY client-participant/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client-participant/dist /usr/share/nginx/html
EXPOSE 80
