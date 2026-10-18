FROM registry-1.docker.io/oven/bun:1.4.3-alpine AS source
WORKDIR /app
COPY . .

FROM source AS build
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --filter @cinegather/api build

# Install into a clean layer: a production install over an existing development
# tree can retain build tools and unrelated workspace dependencies.
FROM source AS production-dependencies
RUN bun install --frozen-lockfile --production --ignore-scripts --filter '@cinegather/api...'

FROM registry-1.docker.io/library/node:24.18.1-alpine AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=14310
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
USER node
EXPOSE 14310
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:14310/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
