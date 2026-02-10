# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base

WORKDIR /app


FROM base AS deps

# Copy only what we need for a deterministic install. We include `scripts/` because
# `npm ci` runs our `postinstall` hook (Prisma generate) which lives there.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts

RUN npm ci


FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Produce a production-only node_modules for runtime.
RUN npm prune --omit=dev


FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

CMD ["node", "dist/index.js"]
