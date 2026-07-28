#!/bin/sh
# Container entrypoint: wait for MySQL, apply migrations, optionally seed, then
# exec the given command.
#
# `set -e` matters here. Without it a failed migration would be logged and the
# API would start anyway against a half-built schema, turning a loud, obvious
# failure into a confusing one.
set -e

: "${DB_HOST:=mysql}"
: "${DB_PORT:=3306}"
: "${DB_USER:=scriptura}"
: "${DB_NAME:=scriptura}"
: "${SEED_ON_START:=false}"
: "${DB_WAIT_TIMEOUT:=90}"

echo "[entrypoint] Waiting for MySQL at ${DB_HOST}:${DB_PORT} (timeout ${DB_WAIT_TIMEOUT}s)…"

waited=0
until mysqladmin ping -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --silent 2>/dev/null; do
  if [ "$waited" -ge "$DB_WAIT_TIMEOUT" ]; then
    echo "[entrypoint] ERROR: MySQL did not become reachable within ${DB_WAIT_TIMEOUT}s." >&2
    echo "[entrypoint] Check DB_HOST/DB_USER/DB_PASSWORD and that the mysql service is healthy." >&2
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done

echo "[entrypoint] MySQL is up after ${waited}s."

# `db:migrate` is idempotent — sequelize-cli records applied migrations in
# `sequelize_meta` and skips them — so running it on every boot is safe and means
# a redeploy never needs a separate migration step.
echo "[entrypoint] Applying migrations…"
npx sequelize-cli db:migrate

if [ "$SEED_ON_START" = "true" ]; then
  # Seeders are NOT idempotent, so they only run when the table is empty.
  # Re-seeding a populated database would duplicate every demo row on each boot.
  echo "[entrypoint] Checking whether to seed…"
  BLOG_COUNT=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" \
    -N -B -e "SELECT COUNT(*) FROM blogs;" "$DB_NAME" 2>/dev/null || echo "0")

  if [ "$BLOG_COUNT" = "0" ]; then
    echo "[entrypoint] blogs is empty — seeding demo data…"
    npx sequelize-cli db:seed:all
  else
    echo "[entrypoint] blogs already has ${BLOG_COUNT} rows — skipping seed."
  fi
fi

echo "[entrypoint] Starting: $*"
exec "$@"
