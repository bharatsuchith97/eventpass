# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build
# ---- run ----
FROM node:22-alpine
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations \
    WEB_DIST=/app/web
WORKDIR /app
COPY server/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/src/db/migrations ./migrations
COPY --from=build /app/web/dist ./web
RUN chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "dist/index.js"]
