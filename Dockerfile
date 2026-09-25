FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages ./packages
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
