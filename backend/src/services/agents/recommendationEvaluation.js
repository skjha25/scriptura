'use strict';

/**
 * P3-A: "does this type of recommendation tend to work?" — a read-only
 * aggregation over P2's outcome data.
 *
 * NOT REQUIRED: new storage. `recommendation_outcomes` (P2-A) already has
 * everything needed — this file is a pure SQL GROUP BY plus code-computed
 * rates, no new table, no cache, no materialized view. At this app's
 * verified scale (low thousands of rows across the whole Knowledge/
 * Recommendation surface) a live query is trivial; a separate storage layer
 * here would be architecture inflation for a report that changes every time
 * a new outcome is evaluated anyway.
 *
 * Joins recommendation_outcomes -> recommendation_actions (for action_type)
 * and -> agent_recommendations (for recommendation_type/agent_name) using
 * the exact FK associations P2-A already established in models/index.js
 * (`RecommendationOutcome.belongsTo(RecommendationAction, {as:'action'})`,
 * `RecommendationOutcome.belongsTo(AgentRecommendation, {as:'recommendation'})`)
 * — no new relation, no duplicate join logic.
 *
 * Every number returned here is a real COUNT computed directly from stored
 * rows. Nothing in this file calls an AI provider, estimates a value, or
 * accepts an LLM-supplied number as input — see the P2 architecture review
 * this session for the same guarantee already established at the outcome
 * layer; this file preserves it one level up, at the aggregation layer.
 */

/** Below this many total outcomes for a dimension value, the rate is reported as null with an explicit low-confidence flag rather than a misleadingly precise percentage. */
const MIN_SAMPLE_SIZE_FOR_RATE = 5;

/**
 * Aggregates already-evaluated `recommendation_outcomes` by `action_type`
 * (default) or `recommendation_type`, returning one breakdown row per
 * distinct value actually observed in the (optionally filtered) data.
 *
 * `status:'pending'` outcomes are always excluded — they have no
 * `outcome` classification yet, so counting them would silently deflate
 * every rate rather than correctly excluding them from the denominator.
 *
 * `improved_rate` is `improved / sample_size` (share of ALL outcomes for
 * that dimension value, including neutral/inconclusive in the
 * denominator) — deliberately the plain, standard definition rather than
 * a narrower "share of only the outcomes that moved," which would hide a
 * large neutral/inconclusive share behind an artificially high-looking
 * percentage. All four raw counts are always returned alongside it so a
 * caller can see the full picture, never just the rate.
 *
 * @param {object} [input]
 * @param {'action_type'|'recommendation_type'} [input.groupBy='action_type']
 * @param {string} [input.actionType] Exact-match filter — narrows the breakdown to one action_type.
 * @param {string} [input.recommendationType] Exact-match filter on recommendation_type.
 * @param {string} [input.agentName] Exact-match filter on the parent recommendation's agent_name.
 * @param {Date|string} [input.sinceDate] Only outcomes evaluated on/after this date.
 * @returns {Promise<Array<{
 *   dimension_value: string,
 *   sample_size: number,
 *   improved: number,
 *   declined: number,
 *   neutral: number,
 *   inconclusive: number,
 *   improved_rate: number|null,
 *   confidence_note: 'insufficient_sample'|null,
 * }>>} Sorted by sample_size descending — the best-evidenced dimension values first.
 */
async function getActionTypeEffectiveness({
  groupBy = 'action_type',
  actionType,
  recommendationType,
  agentName,
  sinceDate,
} = {}) {
  if (!['action_type', 'recommendation_type'].includes(groupBy)) {
    throw new Error(`getActionTypeEffectiveness: groupBy must be 'action_type' or 'recommendation_type', got "${groupBy}".`);
  }

  const { Op } = require('sequelize');
  const { RecommendationOutcome, RecommendationAction, AgentRecommendation } = require('../../models');

  const outcomeWhere = { status: { [Op.in]: ['evaluated', 'inconclusive'] } };
  if (sinceDate) outcomeWhere.evaluated_at = { [Op.gte]: sinceDate };

  const actionWhere = {};
  if (actionType) actionWhere.action_type = actionType;

  const recommendationWhere = {};
  if (recommendationType) recommendationWhere.recommendation_type = recommendationType;
  if (agentName) recommendationWhere.agent_name = agentName;

  const rows = await RecommendationOutcome.findAll({
    where: outcomeWhere,
    attributes: ['id', 'outcome'],
    include: [
      {
        model: RecommendationAction,
        as: 'action',
        attributes: ['action_type'],
        where: Object.keys(actionWhere).length ? actionWhere : undefined,
        required: true,
      },
      {
        model: AgentRecommendation,
        as: 'recommendation',
        attributes: ['recommendation_type', 'agent_name'],
        where: Object.keys(recommendationWhere).length ? recommendationWhere : undefined,
        required: true,
      },
    ],
  });

  const OUTCOME_KEYS = ['improved', 'declined', 'neutral', 'inconclusive'];
  const buckets = new Map(); // dimension_value -> {improved, declined, neutral, inconclusive, outcomeIds}

  for (const row of rows) {
    const dimensionValue = groupBy === 'action_type' ? row.action.action_type : row.recommendation.recommendation_type;
    if (!buckets.has(dimensionValue)) {
      buckets.set(dimensionValue, { improved: 0, declined: 0, neutral: 0, inconclusive: 0, outcomeIds: [] });
    }
    const bucket = buckets.get(dimensionValue);
    // row.outcome is always one of the four classification values once
    // status is evaluated/inconclusive (never null past the outcomeWhere
    // filter above) — an unrecognized value is skipped rather than
    // silently miscounted under a wrong bucket.
    if (OUTCOME_KEYS.includes(row.outcome)) bucket[row.outcome] += 1;
    // P4-A provenance: the real outcome row ids behind this bucket's
    // counts — already fetched above, just carried through rather than
    // re-queried. This is the "minimal exported helper" P4 needed from this
    // file (no new function, no new query) so a learning candidate's
    // evidence_refs can point at real rows instead of being invented.
    bucket.outcomeIds.push(row.id);
  }

  return Array.from(buckets.entries())
    .map(([dimensionValue, counts]) => {
      const sampleSize = counts.improved + counts.declined + counts.neutral + counts.inconclusive;
      const belowMinSample = sampleSize < MIN_SAMPLE_SIZE_FOR_RATE;
      return {
        dimension_value: dimensionValue,
        sample_size: sampleSize,
        improved: counts.improved,
        declined: counts.declined,
        neutral: counts.neutral,
        inconclusive: counts.inconclusive,
        improved_rate: belowMinSample ? null : counts.improved / sampleSize,
        confidence_note: belowMinSample ? 'insufficient_sample' : null,
        outcome_ids: counts.outcomeIds,
      };
    })
    .sort((a, b) => b.sample_size - a.sample_size);
}

module.exports = { getActionTypeEffectiveness, MIN_SAMPLE_SIZE_FOR_RATE };
