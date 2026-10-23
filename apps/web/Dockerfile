FROM registry-1.docker.io/oven/bun:1.4.3-alpine AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run build:web

FROM registry-1.docker.io/library/caddy:2.10.2-alpine
COPY --from=build /app/apps/web/dist /srv/cinegather
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
