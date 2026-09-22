# Scriptura API.
#
# Two stages so the runtime image carries production dependencies only — dev
# tooling (jest, nodemon, eslint) is installed in the build stage for
# `npm ci` determinism and then left behind.

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# ---------------------------------------------------------------------------
# Corporate TLS interception (optional)
# ---------------------------------------------------------------------------
# Networks running an inspecting proxy — Zscaler, Netskope, Blue Coat — terminate
# HTTPS and re-sign it with their own root CA. That CA is installed on the host, but
# a container starts with only the public roots, so npm cannot build a chain to
# registry.npmjs.org and fails with:
#
#   npm error code UNABLE_TO_GET_ISSUER_CERT_LOCALLY
#
# (Note that `apt-get` in the runtime stage still works, which makes this look like
# a dependency problem rather than a TLS one: Debian repos are fetched over HTTP and
# verified by GPG signature, so interception does not break them.)
#
# Drop the proxy's root CA into `certs/` as a PEM `.crt` and it is trusted here. The
# directory is copied unconditionally so the build works identically on and off the
# corporate network — with no certs present, this is a no-op.
#
# Deliberately BUILD-STAGE ONLY. The runtime image never trusts the corporate CA,
# because an image that did would extend that trust to wherever it is deployed. That
# is also why sequelize-cli is installed here rather than in the runtime stage: the
# runtime stage then needs no network access at all.
#
# `update-ca-certificates` updates the system store, but Node ships its own bundled
# root list and ignores it — hence NODE_EXTRA_CA_CERTS, which is what npm actually
# reads.
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

# Only the manifests, so this layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./

# `npm ci` for a lockfile-exact install.
#
# `--omit=dev` also keeps sqlite3 out (it is a devDependency — see the note in
# package.json): its install script downloads a prebuilt binary over the network,
# and when that child process dies npm reports "Exit handler never called!" rather
# than anything actionable. Production uses MySQL and never loads it.
#
# sharp stays, and needs no toolchain: the lockfile carries every
# @img/sharp-linux-* optional dependency, so npm resolves the right prebuilt
# binary here even though the lockfile was generated on Windows.
#
# npm is upgraded first, deliberately. "Exit handler never called!" is an npm client
# crash, not a dependency error — npm 10.9 (which node:22-bookworm-slim ships) exits
# that way when an install child process is killed or a socket dies, so it reports a
# bug in itself instead of the real cause. Newer npm surfaces the underlying error.
#
# `--maxsockets 4` caps parallel connections. The default of 15 is what makes this
# step memory- and socket-hungry; behind a proxy or in a small Docker VM that is the
# difference between finishing and being killed.
#
# Fetch retries are deliberately NOT raised here. Setting them to 5 turned a 77s
# failure into a 512s failure with the identical crash — it only prolonged a retry
# loop that was never going to succeed, and hid how fast the real error appeared.
RUN npm install -g npm@11 --no-audit --no-fund \
  && npm ci --omit=dev --no-audit --no-fund --maxsockets 4 \
  # sequelize-cli is a devDependency, but the entrypoint runs migrations, so it is
  # needed at runtime. Installed HERE rather than in the runtime stage so that stage
  # performs no network access — see the CA note above.
  #
  # `--omit=dev` here too, deliberately: a bare `npm install <pkg>` (no --omit=dev)
  # reconciles the WHOLE tree against package.json, not just the named package —
  # it silently re-installs every devDependency `npm ci --omit=dev` just excluded
  # above (sqlite3 included, whose install script then fails trying to fetch/build
  # a binary with no network/Python in this stage). Omitting it here keeps the
  # first command's exclusion intact.
  && npm install --no-save --omit=dev --no-audit --no-fund --maxsockets 4 sequelize-cli@^6.6.2

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# `mysqladmin`/`mysql` for the entrypoint's readiness wait and for migrations;
# tini as init so SIGTERM reaches Node and the graceful shutdown in
# src/server.js actually runs instead of the container being killed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends default-mysql-client tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json .sequelizerc ./
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

# No network access in this stage: node_modules (including sequelize-cli) came from
# the deps stage. That keeps the corporate CA out of the shipped image.
RUN chmod +x ./docker-entrypoint.sh \
  # Created before dropping privileges, and owned by the runtime user, so the
  # first image write cannot fail on permissions.
  && mkdir -p /app/uploads \
  && chown -R node:node /app/uploads

# The base image ships an unprivileged `node` user; running as root would give a
# container escape far more than it needs.
USER node

EXPOSE 5000

ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
