# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Prisma engine generation during npm postinstall needs OpenSSL available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*


FROM base AS deps

# Copy only what we need for a deterministic install. We include `scripts/` because
# `npm ci` runs our `postinstall` hook (Prisma generate) which lives there.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts

RUN PRISMA_SKIP_POSTINSTALL_GENERATE=1 npm ci


FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run prisma:generate
RUN npm run build

# Produce a production-only node_modules for runtime.
RUN npm prune --omit=dev


FROM base AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.js ./prisma.config.js
COPY --chown=node:node --from=build /app/scripts ./scripts

USER node

CMD ["node", "dist/src/index.js"]
