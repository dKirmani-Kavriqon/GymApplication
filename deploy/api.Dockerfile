# GymVerse API — production image.
# Build from the repo root:  docker build -f deploy/api.Dockerfile -t gymverse-api .
FROM node:24-slim AS deps
WORKDIR /app
# All workspace manifests are needed so the lockfile resolves; only api + shared get installed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --omit=dev --workspace @gymverse/api --workspace @gymverse/shared --no-audit --no-fund

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/gymverse.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/src ./apps/api/src
RUN mkdir -p /data && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tsx runs the TypeScript sources directly (no separate build output to drift from the tests).
CMD ["node", "--import", "tsx", "src/server.ts"]
