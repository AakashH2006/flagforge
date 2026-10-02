# Builds the organizer dashboard and serves it from nginx, with /api proxied to the API so the
# browser only ever talks to one origin.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY client-admin/package.json client-admin/
RUN npm ci --workspace=client-admin --include-workspace-root

COPY client-admin/ client-admin/
# Vite inlines VITE_* at build time, so where the player site lives has to be known here.
ARG VITE_PARTICIPANT_URL=http://localhost:8080
ENV VITE_PARTICIPANT_URL=$VITE_PARTICIPANT_URL
RUN npm run build -w client-admin


FROM nginx:1.29-alpine AS runtime
COPY client-admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client-admin/dist /usr/share/nginx/html
EXPOSE 80
