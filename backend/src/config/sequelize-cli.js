'use strict';

/**
 * Configuration consumed by `sequelize-cli` (migrations and seeders).
 *
 * It reads the same validated config object as the application, so there is no
 * second copy of the database credentials to drift out of sync. The CLI expects
 * a plain object keyed by environment name.
 */

const config = require('./index');

const { database } = config;

const mysqlConfig = {
  username: database.user,
  password: database.password || null,
  database: database.name,
  host: database.host,
  port: database.port,
  dialect: 'mysql',
  logging: database.logging ? console.log : false,
  dialectOptions: {
    charset: 'utf8mb4',
    connectTimeout: 20000,
  },
  // Applied to tables the CLI creates itself (SequelizeMeta).
  define: { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
  migrationStorageTableName: 'sequelize_meta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'sequelize_seeds',
};

module.exports = {
  development: mysqlConfig,
  staging: mysqlConfig,
  production: mysqlConfig,
  // The Jest suite builds its schema from the models via sync() against
  // in-memory SQLite and never invokes the CLI. This entry exists only so
  // `NODE_ENV=test sequelize-cli` does not blow up if someone runs it by hand.
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
    migrationStorageTableName: 'sequelize_meta',
    seederStorage: 'sequelize',
    seederStorageTableName: 'sequelize_seeds',
  },
};
