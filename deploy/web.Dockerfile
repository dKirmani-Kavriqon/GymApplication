# Owner dashboard (static) + reverse proxy with automatic HTTPS (Caddy).
# Build from the repo root:
#   docker build -f deploy/web.Dockerfile --build-arg VITE_API_URL=https://api.example.com -t gymverse-web .
FROM node:24-slim AS build
ARG VITE_API_URL
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace @gymverse/dashboard --workspace @gymverse/shared --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/dashboard ./apps/dashboard
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL build arg is required" && exit 1)
RUN VITE_API_URL=$VITE_API_URL npm run build -w @gymverse/dashboard

FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/dashboard/dist /srv/dashboard
