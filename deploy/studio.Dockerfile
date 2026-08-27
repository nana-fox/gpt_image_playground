FROM node:24-alpine AS build

ARG STUDIO_BASE_PATH=/
ENV VITE_STUDIO_BASE_PATH=$STUDIO_BASE_PATH
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:studio

FROM node:24-alpine

ENV NODE_ENV=production \
    STUDIO_HOST=0.0.0.0 \
    STUDIO_PORT=8788 \
    STUDIO_GENERATION_ENABLED=true \
    STUDIO_ARTWORK_ROOT=/data/artworks \
    STUDIO_STATIC_ROOT=/app/dist

RUN addgroup -S studio && adduser -S -G studio studio && mkdir -p /app /data/artworks && chown -R studio:studio /app /data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=studio:studio /app/dist ./dist
COPY --from=build --chown=studio:studio /app/studio-server ./studio-server

USER studio
EXPOSE 8788
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 CMD ["node", "-e", "fetch('http://127.0.0.1:8788/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "studio-server/server.mjs"]
