# ---------- Build stage ----------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --@verdent:registry=https://npm.verdent.app

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY server ./server

EXPOSE 8080
CMD ["node", "server/index.mjs"]
