'use strict';

/**
 * Model registry.
 *
 * Models are registered explicitly rather than by directory scan: an explicit
 * list makes the dependency order obvious, keeps a stray file in the folder
 * from being loaded as a model, and lets editors follow the imports.
 *
 * There are no associations. `blogs` and `users` are intentionally unrelated —
 * `published_by` is a free-text attribution string on the existing production
 * table, not a foreign key, and turning it into one would change the meaning of
 * data other systems already read.
 */

const { sequelize, Sequelize } = require('../config/database');

const Blog = require('./blog')(sequelize);
const User = require('./user')(sequelize);
const AutomatedTopic = require('./automatedTopic')(sequelize);
const ScripturaKeyword = require('./scripturaKeyword')(sequelize);

// Set up associations
ScripturaKeyword.hasMany(Blog, { foreignKey: 'keyword_pool_id', as: 'blogs' });
Blog.belongsTo(ScripturaKeyword, { foreignKey: 'keyword_pool_id', as: 'keyword' });

const db = {
  sequelize,
  Sequelize,
  Blog,
  User,
  AutomatedTopic,
  ScripturaKeyword,
};

/**
 * Creates the schema from the model definitions.
 *
 * Used by the test suite (against in-memory SQLite) and by the Docker
 * entrypoint's first-run path. Real environments use `npm run migrate`, which
 * is the reviewable, reversible path — a unit test asserts the migration and
 * these models define the same columns, so the two cannot drift.
 *
 * Refuses to run in production, where an implicit ALTER is never what you want.
 */
async function syncSchema({ force = false } = {}) {
  const config = require('../config');
  if (config.isProduction) {
    throw new Error('syncSchema() must not be used in production — run migrations instead.');
  }
  await sequelize.sync({ force });
  return db;
}

module.exports = { ...db, syncSchema };
