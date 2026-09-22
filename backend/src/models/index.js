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
const SerpSnapshot = require('./serpSnapshot')(sequelize);
const SerpResult = require('./serpResult')(sequelize);
const GscSnapshot = require('./gscSnapshot')(sequelize);
const GscRow = require('./gscRow')(sequelize);
const AgentRecommendation = require('./agentRecommendation')(sequelize);
const RecommendationAction = require('./recommendationAction')(sequelize);
const RecommendationOutcome = require('./recommendationOutcome')(sequelize);
const LearningCandidate = require('./learningCandidate')(sequelize);
const PublishingIntegration = require('./publishingIntegration')(sequelize);
const PublishingFieldMapping = require('./publishingFieldMapping')(sequelize);
const PublishingDeliveryLog = require('./publishingDeliveryLog')(sequelize);

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

// serp_snapshots/serp_results: brand-new tables, no legacy readers, so a real
// FK cascade is safe — deleting a snapshot deletes its result rows with it.
SerpSnapshot.hasMany(SerpResult, { foreignKey: 'snapshot_id', as: 'results', onDelete: 'CASCADE' });
SerpResult.belongsTo(SerpSnapshot, { foreignKey: 'snapshot_id', as: 'snapshot' });

// gsc_snapshots/gsc_rows: same shape/reasoning as serp_snapshots/serp_results
// above — brand-new tables, real FK cascade is safe.
GscSnapshot.hasMany(GscRow, { foreignKey: 'snapshot_id', as: 'rows', onDelete: 'CASCADE' });
GscRow.belongsTo(GscSnapshot, { foreignKey: 'snapshot_id', as: 'snapshot' });

// agent_recommendations: references the agent_activity row it was captured
// from. constraints:false, same reasoning as agent_activity's own audit-log
// references (scriptura_logs, agent_knowledge, etc.) — this is an
// audit-adjacent link to a row that is never deleted, not a real ownership
// relationship that should cascade.
AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
// P1-A: who decided. Same constraints:false posture as every other
// audit-adjacent User reference (AgentActivity.belongsTo(User) above,
// KnowledgeSource.belongsTo(User), etc.) — the real FK lives in the migration.
AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });

// recommendation_actions: an owned child of the recommendation it tracks
// execution for — real FK cascade posture (like serp_snapshots/serp_results
// above), not constraints:false, since an action row has no meaning without
// its parent recommendation (see the migration's ON DELETE RESTRICT).
AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
// Who actually did/reported the work — same constraints:false posture as
// every other audit-adjacent User reference (decided_by, created_by, etc.).
RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

// recommendation_outcomes: P2-A. An owned child of the action it measures —
// real FK cascade posture (not constraints:false), same reasoning as
// RecommendationAction's own link to AgentRecommendation: an outcome row has
// no meaning without the action it followed up on (see the migration's ON
// DELETE RESTRICT). hasOne, not hasMany, on the action side — action_id is
// unique, one action earns at most one outcome row.
AgentRecommendation.hasMany(RecommendationOutcome, { foreignKey: 'recommendation_id', as: 'outcomes' });
RecommendationOutcome.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
RecommendationAction.hasOne(RecommendationOutcome, { foreignKey: 'action_id', as: 'outcome' });
RecommendationOutcome.belongsTo(RecommendationAction, { foreignKey: 'action_id', as: 'action' });

// learning_candidates: P4-A. No association to RecommendationOutcome — its
// evidence_refs stays a JSON pointer array by deliberate design (see the
// migration), not a real FK/join table. reviewed_by/confirmed_knowledge_id
// are audit-adjacent references only, same constraints:false posture as
// every other User/cross-table reference in this file (decided_by,
// executed_by, created_by, etc.) — a candidate row is never deleted or
// invalidated just because the reviewing user's account or the resulting
// knowledge row changes.
LearningCandidate.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer', constraints: false });
LearningCandidate.belongsTo(AgentKnowledge, { foreignKey: 'confirmed_knowledge_id', as: 'confirmedKnowledge', constraints: false });

// publishing_field_mappings / publishing_delivery_logs: owned children of the
// integration they belong to — real FK RESTRICT posture (like
// recommendation_actions above), since there is no delete-integration
// affordance in v1 (see the migrations). delivery_logs.blog_id is a soft
// reference (constraints:false), matching ScripturaLog's own blog_id posture
// above — a delivery log must survive regardless of any future change to how
// blogs are deleted/archived.
PublishingIntegration.hasMany(PublishingFieldMapping, { foreignKey: 'integration_id', as: 'fieldMappings' });
PublishingFieldMapping.belongsTo(PublishingIntegration, { foreignKey: 'integration_id', as: 'integration' });
PublishingIntegration.hasMany(PublishingDeliveryLog, { foreignKey: 'integration_id', as: 'deliveryLogs' });
PublishingDeliveryLog.belongsTo(PublishingIntegration, { foreignKey: 'integration_id', as: 'integration' });
PublishingDeliveryLog.belongsTo(Blog, { foreignKey: 'blog_id', as: 'blog', constraints: false });

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
  SerpSnapshot,
  SerpResult,
  GscSnapshot,
  GscRow,
  AgentRecommendation,
  RecommendationAction,
  RecommendationOutcome,
  LearningCandidate,
  PublishingIntegration,
  PublishingFieldMapping,
  PublishingDeliveryLog,
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
