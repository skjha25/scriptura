'use strict';

/**
 * API server for end-to-end tests.
 *
 * WHY THIS EXISTS
 * The E2E suite needs a real HTTP server with a real database behind it, but no
 * MySQL instance is required to run it. This boots the actual Express app against
 * in-memory SQLite, builds the schema from the models, and seeds the demo data —
 * so `npm test` in e2e/ works on a fresh clone with nothing installed but Node.
 *
 * It is a TEST HARNESS, not a deployment path. `NODE_ENV=test` is what selects
 * SQLite and the deterministic mock AI providers (see src/config/index.js), which
 * is also what makes the E2E run hermetic: no network, no API keys, no spend, and
 * generated content is identical on every run so assertions can be exact.
 *
 * In-memory SQLite survives for the life of THIS process, so data written by one
 * request is visible to the next — which is all the E2E flow needs.
 *
 *   node scripts/e2e-server.js
 */

process.env.NODE_ENV = 'test';
// Distinct from the dev API port so an E2E run cannot collide with a dev server,
// and so a stray E2E process is obvious.
process.env.PORT = process.env.E2E_PORT || '5055';
// The Playwright-hosted frontend serves from this origin.
process.env.CORS_ORIGIN = process.env.E2E_WEB_ORIGIN || 'http://localhost:3055';

const config = require('../src/config');
const { createApp } = require('../src/app');
const { sequelize, syncSchema } = require('../src/models');
const { ensureStorageReady } = require('../src/services/storage');

/* eslint-disable no-console */

async function main() {
  if (!config.isTest) {
    throw new Error('e2e-server must run with NODE_ENV=test.');
  }
  if (config.database.dialect !== 'sqlite') {
    throw new Error(
      `Refusing to start: expected the sqlite dialect, got "${config.database.dialect}".`
    );
  }

  console.log('[e2e] Building schema from models (in-memory sqlite)…');
  await syncSchema({ force: true });

  console.log('[e2e] Seeding demo data…');
  const queryInterface = sequelize.getQueryInterface();
  await require('../src/seeders/20260727130000-seed-users').up(queryInterface);
  await require('../src/seeders/20260727130100-seed-blogs').up(queryInterface);

  await ensureStorageReady();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[e2e] API listening on http://localhost:${config.port}`);
    console.log(`[e2e]   providers: text=${config.ai.textProvider} image=${config.ai.imageProvider}`);
    console.log(`[e2e]   cors:      ${JSON.stringify(config.corsOrigin)}`);
    // Playwright's webServer waits for the port; this line is the human signal.
    console.log('[e2e] READY');
  });

  const shutdown = () => {
    server.close(() => sequelize.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[e2e] Failed to start:', err.message);
  console.error(err.stack);
  process.exit(1);
});
