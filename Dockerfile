# syntax=docker/dockerfile:1
#
# Imagen de producción de Wanderbibliothek.
#
#   docker build -t wanderbibliothek .
#   docker compose up -d          (ver docker-compose.yml)
#
# Tres etapas para que la imagen final no lleve ni TypeScript ni las
# herramientas de compilación de better-sqlite3.

# --- 1. Dependencias completas (incluye devDependencies para el build) ------
#
# La imagen base va fijada por **digest**, no solo por etiqueta: `24-bookworm-slim`
# es un puntero que se mueve, y con él cambiarían Node y las librerías del
# sistema sin que cambie nada en este repositorio. Dependabot (ecosistema
# `docker`) propone el digest nuevo; actualizarlo es un cambio visible en el
# diff y en la imagen firmada de la release.
#
# Node 24 (LTS «Krypton») en lugar de 22: el 22 entra en fin de soporte en
# abril de 2027 y este es el mismo salto que ya hacen `ci.yml` y `.nvmrc`.
# Las tres etapas comparten digest para que compilar y ejecutar usen el mismo
# runtime; cambiarlas por separado es cómo aparecen los fallos que solo se ven
# en producción.
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS deps
WORKDIR /app

# `better-sqlite3` se compila con node-gyp al instalarlo (no trae binarios para
# todas las plataformas): estas herramientas son obligatorias en esta etapa.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# --- 2. Build ---------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG APP_COMMIT_SHA=""
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA

# Las variables NEXT_PUBLIC_* se incrustan en el bundle del cliente durante el
# build: definirlas solo en el entorno del contenedor NO sirve (el widget de
# Turnstile no aparecería y la CSP no autorizaría challenges.cloudflare.com).
# Se pasan como build args para que la imagen pueda llevar captcha:
#   docker compose build --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAA…
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El build no necesita base de datos ni secretos.
RUN npm run build

# --- 3. Runtime -------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runner
WORKDIR /app

# Identidad del build dentro de la imagen. `/api/version` y el pie de página la
# publican para que cualquiera pueda contrastar el contenedor con el repositorio
# y con el digest firmado de la release. Se pasan como build args (no como
# entorno del contenedor) para que no se puedan cambiar en caliente sin cambiar
# la imagen.
ARG APP_COMMIT_SHA=""
ARG APP_BUILD_TIME=""
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA \
    APP_BUILD_TIME=$APP_BUILD_TIME

# Metadatos OCI: `docker inspect` y los registros los muestran sin ejecutar la
# imagen. `revision` ata la imagen al commit del que salió.
LABEL org.opencontainers.image.title="Wanderbibliothek" \
      org.opencontainers.image.source="https://github.com/gallardoalba/WB" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision=$APP_COMMIT_SHA \
      org.opencontainers.image.created=$APP_BUILD_TIME

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db \
    WANDERBIBLIOTHEK_BACKUP_DIR=/backups

# `curl` es útil para diagnosticar desde dentro del contenedor.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /backups \
  && chown -R node:node /data /backups

# Solo dependencias de ejecución (tsx va en dependencies: lo usan los scripts
# de administración, copia y verificación).
#
# `better-sqlite3` 13 no publica binarios para todas las plataformas: npm lo
# compila con node-gyp al instalarlo. Por eso aquí no se vuelve a instalar —
# haría falta python3, make y g++ también en la imagen final—, sino que se
# reutiliza el `node_modules` ya compilado en la etapa `deps` y se quitan las
# devDependencies.
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
# `src` y `scripts` no los necesita Next en ejecución, pero sí los scripts de
# operación (`admin:create`, `db:backup`, `user:verify`).
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/scripts ./scripts

USER node
EXPOSE 3000
VOLUME ["/data", "/backups"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Dentro del contenedor escucha en todas las interfaces: el proxy (nginx,
# Caddy, el del host) es quien pone el TLS delante.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
