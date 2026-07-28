'use strict';

/**
 * The single Sequelize instance for the process.
 *
 * Dialect is chosen by NODE_ENV (see config/index.js):
 *   - mysql  — the real runtime target for dev / staging / production
 *   - sqlite — in-memory, tests only
 *
 * Why two dialects: the test suite must be runnable on a fresh clone with no
 * database server installed. Everything the app actually relies on (JSON
 * columns, LONGTEXT, TINYINT, soft deletes, unique indexes) is expressed with
 * portable Sequelize DataTypes that both dialects implement, so the same model
 * definitions drive both. The two places the dialects genuinely differ are
 * handled explicitly:
 *
 *   1. JSON — MySQL has a native JSON type; SQLite stores TEXT and Sequelize
 *      serialises/parses transparently. Consequence: you cannot use MySQL
 *      JSON path operators (`->>`) in queries. We never do; JSON columns are
 *      read/written whole in application code. Enforced by a unit test that
 *      greps the source for JSON operators.
 *
 *   2. Case sensitivity in LIKE — MySQL's default collation is
 *      case-insensitive, SQLite's LIKE is case-insensitive for ASCII only.
 *      Search helpers lower-case both sides rather than depending on collation.
 *
 * ARCHITECTURE.md records this trade-off in full.
 */

const { Sequelize } = require('sequelize');
const config = require('./index');

const { database } = config;

/** Shared options applied to both dialects. */
const commonOptions = {
  logging: database.logging ? (msg) => console.log(`[sql] ${msg}`) : false,
  define: {
    // The production `blogs` table uses snake_case columns and
    // created_at/updated_at/deleted_at. Match it globally so models do not
    // each have to restate it.
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    freezeTableName: true,
  },
  // Bound queries only. Sequelize parameterises by default; this makes any
  // accidental raw-string interpolation stand out in review.
  benchmark: false,
};

function buildSequelize() {
  if (database.dialect === 'sqlite') {
    return new Sequelize({
      ...commonOptions,
      dialect: 'sqlite',
      // `:memory:` keeps each Jest worker fully isolated and leaves no files.
      storage: database.name === ':memory:' ? ':memory:' : database.name,
      // SQLite is single-writer; a retry loop avoids spurious SQLITE_BUSY when
      // integration tests fire concurrent requests.
      retry: { max: 5, match: [/SQLITE_BUSY/] },
    });
  }

  return new Sequelize(database.name, database.user, database.password, {
    ...commonOptions,
    dialect: 'mysql',
    host: database.host,
    port: database.port,
    pool: database.pool,
    dialectOptions: {
      // The production data contains Devanagari and emoji in blog content;
      // utf8mb4 is mandatory, not optional.
      charset: 'utf8mb4',
      // Return DATE columns as 'YYYY-MM-DD' strings rather than Date objects,
      // so publish_date / start_date / end_date never shift by a timezone.
      dateStrings: ['DATE'],
      typeCast: true,
      connectTimeout: 20000,
    },
    timezone: '+00:00',
  });
}

const sequelize = buildSequelize();

/**
 * Verifies the connection and returns a short diagnostic string.
 * Called on boot so a bad DB config fails fast and legibly.
 */
async function assertConnection() {
  await sequelize.authenticate();
  return database.dialect === 'sqlite'
    ? `sqlite (${database.name})`
    : `mysql://${database.user}@${database.host}:${database.port}/${database.name}`;
}

module.exports = { sequelize, Sequelize, assertConnection };
