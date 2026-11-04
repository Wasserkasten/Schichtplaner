# --- Build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts/check-native.mjs scripts/
COPY server/package.json server/
COPY web/package.json web/
# Abhängigkeiten installieren. Kein Compiler nötig: better-sqlite3, Vite und TypeScript bringen
# fertige Binärdateien mit (als optionale Pakete). npm überspringt optionale Pakete aber stillschweigend,
# wenn z. B. ihr Download fehlschlägt – deshalb wird geprüft und notfalls einmal neu installiert.
# So landet nie ein unvollständiger Stand im Docker-Cache.
RUN npm ci --ignore-scripts --include=optional --no-audit --no-fund \
 && { node scripts/check-native.mjs \
      || { echo "Installation unvollständig – zweiter Versuch …" \
           && rm -rf node_modules \
           && npm ci --ignore-scripts --include=optional --no-audit --no-fund \
           && node scripts/check-native.mjs; }; }
COPY server/ server/
COPY web/ web/
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
