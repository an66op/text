# syntax=docker/dockerfile:1
# Registry index digests verified against Docker Official Images, 2026-10-27.
FROM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS node-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node-deps AS frontend-build
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node-deps AS admin-build
ARG VITE_FRONTEND_URL
ENV VITE_FRONTEND_URL=${VITE_FRONTEND_URL}
# The admin is built with the root lockfile, which pins its shared dependencies.
COPY admin/package.json admin/tsconfig.json admin/vite.config.ts admin/index.html ./admin/
COPY admin/src ./admin/src
COPY src/shared/api ./src/shared/api
RUN npm --prefix admin run build

FROM nginx:1.31.8-alpine@sha256:1ef7ca94d7879df82421428ce13bd1eaa412404953859cf7a5b6512c25e67a60 AS static-base
RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080
USER nginx
ENTRYPOINT ["nginx", "-g", "daemon off;"]

FROM static-base AS frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html

FROM static-base AS admin
COPY --from=admin-build /app/admin/dist /usr/share/nginx/html

FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS api-build
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/cmd ./cmd
COPY server/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS api
# CA roots come from the pinned builder; the runtime does not require apk/network.
COPY --from=api-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=api-build /out/api /usr/local/bin/gongming-api
COPY --chmod=0555 deploy/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN mkdir -p /var/lib/gongming/media && chown 65532:65532 /var/lib/gongming/media && chmod 0700 /var/lib/gongming/media
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api-entrypoint"]
