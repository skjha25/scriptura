'use strict';

/**
 * Model registry.
 *
 * Models are registered explicitly rather than by directory scan: an explicit
 * list makes the dependency order obvious, keeps a stray file in the folder
 * from being loaded as a model, and lets editors follow the imports.
 *
 * `blogs` and `users` remain intentionally unrelated — `published_by` is a
 * free-text attribution string on the existing production table, not a
 * foreign key, and turning it into one would change the meaning of data other
 * systems already read.
 *
 * `keyword_clusters`, `cluster_keywords` and `scriptura_settings` (added for
 * the cluster-scheduling and tri-score features) DO carry real associations —
 * they are new tables with no legacy readers, so normal FK relations are safe.
 */

const { sequelize, Sequelize } = require('../config/database');

const Blog = require('./blog')(sequelize);
const User = require('./user')(sequelize);
const AutomatedTopic = require('./automatedTopic')(sequelize);
const ScripturaKeyword = require('./scripturaKeyword')(sequelize);
const KeywordCluster = require('./keywordCluster')(sequelize);
const ClusterKeyword = require('./clusterKeyword')(sequelize);
const ScripturaSettings = require('./scripturaSettings')(sequelize);
const ScripturaLog = require('./scripturaLog')(sequelize);
const AgentActivity = require('./agentActivity')(sequelize);
const AgentKnowledge = require('./agentKnowledge')(sequelize);
const KnowledgeSource = require('./knowledgeSource')(sequelize);
const SourceChunk = require('./sourceChunk')(sequelize);
const AgentKnowledgeUsage = require('./agentKnowledgeUsage')(sequelize);

// Set up associations
ScripturaKeyword.hasMany(Blog, { foreignKey: 'keyword_pool_id', as: 'blogs' });
Blog.belongsTo(ScripturaKeyword, { foreignKey: 'keyword_pool_id', as: 'keyword' });

// Keyword clusters: a cluster has many sub-keywords, and (via blogs.cluster_id)
// many generated blogs. The pillar_blog_id FK is a single distinguished blog
// among those, so it is modelled as its own belongsTo rather than reusing the
// hasMany — a cluster's pillar is not just "one of the blogs", it is a specific,
// separately-tracked one.
KeywordCluster.hasMany(ClusterKeyword, { foreignKey: 'cluster_id', as: 'keywords', onDelete: 'CASCADE' });
ClusterKeyword.belongsTo(KeywordCluster, { foreignKey: 'cluster_id', as: 'cluster' });

KeywordCluster.hasMany(Blog, { foreignKey: 'cluster_id', as: 'blogs' });
Blog.belongsTo(KeywordCluster, { foreignKey: 'cluster_id', as: 'cluster' });

KeywordCluster.belongsTo(Blog, { foreignKey: 'pillar_blog_id', as: 'pillarBlog' });

ClusterKeyword.belongsTo(Blog, { foreignKey: 'assigned_blog_id', as: 'assignedBlog' });

// scriptura_settings: user-scoped rows optionally reference a user, purely for
// FK integrity (ON DELETE CASCADE) — no reverse association is declared on
// User because nothing in the app currently needs "this user's settings" as a
// navigable relation; ScripturaSettings.getValue()/setValue() cover every
// current call site.
ScripturaSettings.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// scriptura_logs: lightweight associations for query convenience — logs reference
// blogs, clusters, and keywords but no cascade (logs survive entity deletion).
ScripturaLog.belongsTo(Blog, { foreignKey: 'blog_id', as: 'blog', constraints: false });
ScripturaLog.belongsTo(KeywordCluster, { foreignKey: 'cluster_id', as: 'cluster', constraints: false });
ScripturaLog.belongsTo(ClusterKeyword, { foreignKey: 'keyword_id', as: 'keyword', constraints: false });
ScripturaLog.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });

// agent_activity: same "logs survive the referenced entity" spirit as
// scriptura_logs — an admin's account or a settings row can change or be
// removed without invalidating the audit trail.
AgentActivity.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });

// agent_knowledge: self-referencing version chain (a superseding row points
// back at the one it replaces) plus who taught it, if a human did.
AgentKnowledge.belongsTo(AgentKnowledge, { foreignKey: 'supersedes_id', as: 'supersedes', constraints: false });
AgentKnowledge.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });

// Knowledge Layer v2: a claim optionally traces back to the raw source it was
// distilled from; a source has many chunks; usage rows reference the claim
// they were retrieved for. `constraints: false` throughout for the same
// reason as agent_activity/scriptura_logs above — Sequelize's own `sync()`
// (test suite only, see syncSchema below) shouldn't try to auto-create FKs
// the real migrations already own.
AgentKnowledge.belongsTo(KnowledgeSource, { foreignKey: 'source_id', as: 'source', constraints: false });
KnowledgeSource.hasMany(SourceChunk, { foreignKey: 'source_id', as: 'chunks', constraints: false });
SourceChunk.belongsTo(KnowledgeSource, { foreignKey: 'source_id', as: 'source', constraints: false });
KnowledgeSource.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });
AgentKnowledgeUsage.belongsTo(AgentKnowledge, { foreignKey: 'knowledge_id', as: 'knowledge', constraints: false });

const db = {
  sequelize,
  Sequelize,
  Blog,
  User,
  AutomatedTopic,
  ScripturaKeyword,
  KeywordCluster,
  ClusterKeyword,
  ScripturaSettings,
  ScripturaLog,
  AgentActivity,
  AgentKnowledge,
  KnowledgeSource,
  SourceChunk,
  AgentKnowledgeUsage,
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
