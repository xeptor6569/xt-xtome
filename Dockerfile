FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter xt-xtome-web build && pnpm --filter xt-xtome-api build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV WEB_DIST=/app/packages/xt-xtome-web/dist
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "packages/xt-xtome-api/dist/server.js"]
