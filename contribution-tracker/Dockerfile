# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN useradd --uid 1001 --create-home app && mkdir -p /data && chown app /data
COPY --from=build --chown=app /app/.next/standalone ./
COPY --from=build --chown=app /app/.next/static ./.next/static
# Migrations and the seed library are read from the working directory at runtime.
COPY --from=build --chown=app /app/drizzle ./drizzle
COPY --from=build --chown=app /app/seed ./seed
USER app
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
