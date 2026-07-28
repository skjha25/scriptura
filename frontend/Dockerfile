# frontend/Dockerfile
# Scriptura web app.
#
# Builds the Create React App bundle, then serves the static output from nginx.
# Node is not in the runtime image at all — the built app is just files.

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Corporate TLS interception (optional) — see backend/Dockerfile for the full
# explanation. Short version: an inspecting proxy (Zscaler and similar) re-signs
# HTTPS with its own root CA, which a container does not trust, so npm fails with
# UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Drop the root CA into `certs/` as a PEM `.crt`
# and it is trusted here.
#
# Build stage only: the nginx runtime image never trusts the corporate CA, and it
# fetches nothing anyway — it serves static files.
COPY certs/ /usr/local/share/ca-certificates/
RUN if ls /usr/local/share/ca-certificates/*.crt >/dev/null 2>&1; then \
      echo "Trusting $(ls -1 /usr/local/share/ca-certificates/*.crt | wc -l) extra CA file(s)"; \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates \
      && update-ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "No extra CA certificates supplied — using the public roots."; \
    fi
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY package.json package-lock.json ./
# Dev dependencies are required: react-scripts, tailwind and postcss all run at
# build time. npm is upgraded first because npm 10.9 reports a killed install child
# as "Exit handler never called!", which hides the real cause.
RUN npm install -g npm@11 --no-audit --no-fund \
  && npm ci --no-audit --no-fund --maxsockets 4

COPY . .

# CRA inlines REACT_APP_* variables into the bundle at build time, so the API URL
# is a build argument rather than a runtime environment variable. Changing it
# means rebuilding this image.
ARG REACT_APP_API_URL=http://localhost:5000
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# CI=true makes react-scripts treat warnings as warnings rather than prompting,
# and keeps the output non-interactive.
ENV CI=true
# The default heap is not enough for a webpack production build in a constrained
# container, and the failure mode is an opaque OOM kill.
ENV NODE_OPTIONS=--max-old-space-size=3072

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — serve
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# nginx's own entrypoint handles config templating; this just keeps it foregrounded.
CMD ["nginx", "-g", "daemon off;"]
