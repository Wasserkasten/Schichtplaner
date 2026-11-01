# --- Build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# better-sqlite3 bringt fertige Binärdateien für Linux x64/ARM64 mit – kein Compiler nötig
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

# --- Laufzeit ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/schichtplaner.db STATIC_DIR=/app/web/dist
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/src/schema.sql ./server/src/schema.sql
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/dist/index.js"]
