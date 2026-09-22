// backend/tests/unit/learningCandidates.test.js
'use strict';

/**
 * P4-B tests: services/agents/learningCandidates.js — deterministic
 * detection over real P2/P3 outcome data. Same in-memory SQLite pattern as
 * every prior P2/P3 test file. No real DB or network touched, no AI
 * provider call anywhere in this path.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const RecommendationOutcome = require('../../src/models/recommendationOutcome')(sqlite);
  const LearningCandidate = require('../../src/models/learningCandidate')(sqlite);
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);

  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
  RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

  AgentRecommendation.hasMany(RecommendationOutcome, { foreignKey: 'recommendation_id', as: 'outcomes' });
  RecommendationOutcome.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.hasOne(RecommendationOutcome, { foreignKey: 'action_id', as: 'outcome' });
  RecommendationOutcome.belongsTo(RecommendationAction, { foreignKey: 'action_id', as: 'action' });

  LearningCandidate.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer', constraints: false });
  LearningCandidate.belongsTo(AgentKnowledge, { foreignKey: 'confirmed_knowledge_id', as: 'confirmedKnowledge', constraints: false });

  return {
    User,
    AgentActivity,
    AgentRecommendation,
    RecommendationAction,
    RecommendationOutcome,
    LearningCandidate,
    AgentKnowledge,
    sequelize: sqlite,
    Sequelize,
  };
});

const { AGENT_NAMES } = require('../../src/constants');
const {
  AgentRecommendation,
  RecommendationAction,
  RecommendationOutcome,
  LearningCandidate,
  AgentKnowledge,
  sequelize,
} = require('../../src/models');
const {
  detectLearningCandidates,
  evaluateCandidateEligibility,
  normalizeEvidenceIds,
  sameEvidenceIds,
  MIN_SAMPLE_SIZE_FOR_CANDIDATE,
  CANDIDATE_RATE_THRESHOLD,
} = require('../../src/services/agents/learningCandidates');

let n = 0;
async function seedOutcome({ actionType = 'blog.update_seo_fields', agentName = AGENT_NAMES.SEO_ANALYST, outcome, status = 'evaluated' }) {
  n += 1;
  const rec = await AgentRecommendation.create({
    trace_id: `trace-${n}`,
    agent_name: agentName,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'x', rationale: 'x' },
    status: 'approved',
    decided_by: 1,
    decided_at: new Date(),
  });
  const action = await RecommendationAction.create({
    recommendation_id: rec.id,
    action_type: actionType,
    status: 'completed',
    executor_type: 'automated',
  });
  return RecommendationOutcome.create({
    recommendation_id: rec.id,
    action_id: action.id,
    baseline_captured_at: new Date(),
    baseline_evidence_refs: [{ type: 'blog', id: 1 }],
    baseline_metric_snapshot: [{ metric: 'seo_score', value: 50 }],
    observation_window_days: 14,
    due_at: new Date(),
    status,
    outcome,
    evaluated_at: status === 'pending' ? null : new Date(),
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await LearningCandidate.destroy({ truncate: true });
  await RecommendationOutcome.destroy({ truncate: true });
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('evaluateCandidateEligibility — pure eligibility formula', () => {
  test('exact constants this test suite relies on', () => {
    expect(MIN_SAMPLE_SIZE_FOR_CANDIDATE).toBe(5);
    expect(CANDIDATE_RATE_THRESHOLD).toBe(0.6);
  });

  test('below MIN_SAMPLE_SIZE_FOR_CANDIDATE -> ineligible regardless of rate', () => {
    expect(evaluateCandidateEligibility({ sample_size: 4, improved: 4, declined: 0 })).toBeNull();
  });

  test('sample crosses threshold, improved_rate >= 0.6 -> eligible, direction "improved"', () => {
    const result = evaluateCandidateEligibility({ sample_size: 5, improved: 3, declined: 1 });
    expect(result).toEqual({ direction: 'improved', rate: 3 / 5 });
  });

  test('sample crosses threshold, declined_rate >= 0.6 -> eligible, direction "declined"', () => {
    const result = evaluateCandidateEligibility({ sample_size: 5, improved: 1, declined: 3 });
    expect(result).toEqual({ direction: 'declined', rate: 3 / 5 });
  });

  test('mixed/neutral-heavy sample below the 0.6 threshold either direction -> ineligible', () => {
    expect(evaluateCandidateEligibility({ sample_size: 5, improved: 2, declined: 2 })).toBeNull();
  });

  test('all-inconclusive sample (decidable=0) -> ineligible regardless of sample_size — "no candidate from inconclusive-only outcomes"', () => {
    expect(evaluateCandidateEligibility({ sample_size: 10, improved: 0, declined: 0 })).toBeNull();
  });
});

describe('detectLearningCandidates — insufficient vs sufficient evidence', () => {
  test('insufficient evidence (below sample threshold) creates no candidate', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });

    const result = await detectLearningCandidates();

    expect(result.created).toHaveLength(0);
    expect(await LearningCandidate.count()).toBe(0);
  });

  test('"no candidate from a single successful action" — one improved outcome alone never qualifies', async () => {
    await seedOutcome({ outcome: 'improved' });
    const result = await detectLearningCandidates();
    expect(result.created).toHaveLength(0);
  });

  test('sufficient repeated evidence (>=5, clear improved majority) creates exactly one candidate', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const result = await detectLearningCandidates();

    expect(result.created).toHaveLength(1);
    expect(result.created[0].claim).toMatch(/tended to improve/);
    expect(result.created[0].sample_size).toBe(5);
    expect(result.created[0].improved_count).toBe(4);
  });

  test('a clear declined majority creates a candidate with a "tended to decline" claim', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'declined' });
    await seedOutcome({ outcome: 'improved' });

    const result = await detectLearningCandidates();

    expect(result.created).toHaveLength(1);
    expect(result.created[0].claim).toMatch(/tended to decline/);
    expect(result.created[0].declined_count).toBe(4);
  });

  test('neutral/inconclusive-heavy outcomes (no clear majority either direction) create no candidate', async () => {
    for (let i = 0; i < 3; i += 1) await seedOutcome({ outcome: 'neutral' });
    for (let i = 0; i < 2; i += 1) await seedOutcome({ outcome: 'inconclusive' });

    const result = await detectLearningCandidates();
    expect(result.created).toHaveLength(0);
  });

  test('pending (not-yet-evaluated) outcomes never count toward eligibility', async () => {
    for (let i = 0; i < 3; i += 1) await seedOutcome({ outcome: 'improved' });
    for (let i = 0; i < 3; i += 1) await seedOutcome({ outcome: null, status: 'pending' });

    const result = await detectLearningCandidates();
    expect(result.created).toHaveLength(0); // only 3 real evaluated outcomes, below the 5 threshold
  });
});

describe('detectLearningCandidates — provenance', () => {
  test('evidence_refs point at the real recommendation_outcome ids that produced the pattern — never fabricated', async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) outcomes.push(await seedOutcome({ outcome: 'improved' }));
    outcomes.push(await seedOutcome({ outcome: 'declined' }));

    const result = await detectLearningCandidates();

    const refs = result.created[0].evidence_refs;
    expect(refs).toHaveLength(5);
    expect(refs.every((r) => r.type === 'recommendation_outcome')).toBe(true);
    const refIds = refs.map((r) => r.id).sort((a, b) => a - b);
    const realIds = outcomes.map((o) => o.id).sort((a, b) => a - b);
    expect(refIds).toEqual(realIds);
  });

  test('evidence and claim are deterministic strings restating the real counts, not LLM-authored', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const result = await detectLearningCandidates();
    expect(result.created[0].evidence).toContain('improved: 4');
    expect(result.created[0].evidence).toContain('declined: 1');

    const reloaded = await LearningCandidate.findByPk(result.created[0].id);
    expect(reloaded.reasoning).toBeNull(); // P4-C (LLM-authored narrative) was cut — never populated by this phase
  });
});

describe('detectLearningCandidates — scope and cross-agent isolation', () => {
  test('every new candidate defaults to scope:"agent", never "global"', async () => {
    for (let i = 0; i < 5; i += 1) await seedOutcome({ outcome: 'improved' });

    const result = await detectLearningCandidates();
    expect(result.created[0].scope).toBe('agent');
    expect(result.created[0].agent_name).toBe(AGENT_NAMES.SEO_ANALYST);
  });

  test('two different agents observing the same action_type pattern get two separate, agent-scoped candidates — no cross-agent contamination', async () => {
    for (let i = 0; i < 5; i += 1) await seedOutcome({ outcome: 'improved', agentName: AGENT_NAMES.SEO_ANALYST });
    for (let i = 0; i < 5; i += 1) await seedOutcome({ outcome: 'improved', agentName: AGENT_NAMES.BLOG_OPS });

    const result = await detectLearningCandidates();

    expect(result.created).toHaveLength(2);
    const byAgent = Object.fromEntries(result.created.map((c) => [c.agent_name, c]));
    expect(byAgent[AGENT_NAMES.SEO_ANALYST].sample_size).toBe(5);
    expect(byAgent[AGENT_NAMES.BLOG_OPS].sample_size).toBe(5);
    // Each candidate's evidence only references that agent's own outcomes.
    expect(byAgent[AGENT_NAMES.SEO_ANALYST].pattern_key).not.toBe(byAgent[AGENT_NAMES.BLOG_OPS].pattern_key);
  });
});

describe('detectLearningCandidates — duplicate detection / idempotency', () => {
  test('running detection twice for the same pattern creates only one pending_review row', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    expect(first.created).toHaveLength(1);

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(0);
    expect(second.skipped.some((s) => s.reason === 'already_pending')).toBe(true);

    expect(await LearningCandidate.count()).toBe(1);
  });

  test('a rejected candidate does not block re-detection of a fresh pattern once new evidence accumulates', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });
    const first = await detectLearningCandidates();
    await first.created[0].update({ status: 'rejected', reviewed_by: 1, reviewed_at: new Date() });

    // More evidence accumulates for the exact same pattern.
    for (let i = 0; i < 5; i += 1) await seedOutcome({ outcome: 'improved' });

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(1); // a fresh, re-detected candidate is allowed
    expect(await LearningCandidate.count({ where: { status: 'pending_review' } })).toBe(1);
    expect(await LearningCandidate.count()).toBe(2); // the old rejected row is untouched, not overwritten
  });
});

describe('normalizeEvidenceIds / sameEvidenceIds — pure helpers', () => {
  test('F. same evidence ids in a different insertion order normalize to the same sorted set and compare as identical', () => {
    const a = normalizeEvidenceIds([{ id: 3 }, { id: 1 }, { id: 2 }]);
    const b = normalizeEvidenceIds([{ id: 2 }, { id: 3 }, { id: 1 }]);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(sameEvidenceIds(a, b)).toBe(true);
  });

  test('a genuinely different id set compares as not identical', () => {
    const a = normalizeEvidenceIds([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const b = normalizeEvidenceIds([{ id: 1 }, { id: 2 }, { id: 4 }]);
    expect(sameEvidenceIds(a, b)).toBe(false);
  });

  test('a superset (genuinely new evidence added) compares as not identical', () => {
    const a = normalizeEvidenceIds([{ id: 1 }, { id: 2 }]);
    const b = normalizeEvidenceIds([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(sameEvidenceIds(a, b)).toBe(false);
  });
});

describe('detectLearningCandidates — evidence-aware deduplication (P4 dedup-semantics fix)', () => {
  test('A. a still-pending candidate with the same evidence blocks re-creation, reason "already_pending"', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    expect(first.created).toHaveLength(1);

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(0);
    expect(second.skipped.some((s) => s.reason === 'already_pending')).toBe(true);
    expect(await LearningCandidate.count()).toBe(1);
  });

  test('B. a confirmed candidate with identical evidence blocks re-creation, reason "no_new_evidence"', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    await first.created[0].update({ status: 'confirmed', reviewed_by: 1, reviewed_at: new Date() });

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(0);
    expect(second.skipped.some((s) => s.reason === 'no_new_evidence')).toBe(true);
    expect(await LearningCandidate.count()).toBe(1);
  });

  test('C. a rejected candidate with identical evidence blocks re-creation, reason "no_new_evidence"', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    await first.created[0].update({ status: 'rejected', reviewed_by: 1, reviewed_at: new Date() });

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(0);
    expect(second.skipped.some((s) => s.reason === 'no_new_evidence')).toBe(true);
    expect(await LearningCandidate.count()).toBe(1);
  });

  test('D. a confirmed candidate + one genuinely new outcome allows a new candidate to be created', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    await first.created[0].update({ status: 'confirmed', reviewed_by: 1, reviewed_at: new Date() });

    await seedOutcome({ outcome: 'improved' }); // one genuinely new outcome for the same pattern

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(1);
    expect(await LearningCandidate.count()).toBe(2);
    expect(await LearningCandidate.count({ where: { status: 'pending_review' } })).toBe(1);
    expect(await LearningCandidate.count({ where: { status: 'confirmed' } })).toBe(1);
  });

  test('E. a rejected candidate + one genuinely new outcome allows a new candidate to be created', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    await first.created[0].update({ status: 'rejected', reviewed_by: 1, reviewed_at: new Date() });

    await seedOutcome({ outcome: 'improved' }); // one genuinely new outcome for the same pattern

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(1);
    expect(await LearningCandidate.count()).toBe(2);
  });

  test('F (end-to-end). a confirmed candidate whose stored evidence_refs are in a different order than the freshly recomputed evidence is still recognized as identical', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    const reversedRefs = [...first.created[0].evidence_refs].reverse();
    await first.created[0].update({
      status: 'confirmed',
      reviewed_by: 1,
      reviewed_at: new Date(),
      evidence_refs: reversedRefs,
    });

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(0);
    expect(second.skipped.some((s) => s.reason === 'no_new_evidence')).toBe(true);
  });

  test('G. additional evidence accumulates for a pattern but it remains below the eligibility threshold -> still no candidate', async () => {
    for (let i = 0; i < 2; i += 1) await seedOutcome({ outcome: 'improved' });
    for (let i = 0; i < 2; i += 1) await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    expect(first.created).toHaveLength(0);
    expect(first.skipped.some((s) => s.reason === 'below_threshold')).toBe(true);

    // Sample size now crosses 5, but the split (2 improved / 2 declined / 1
    // neutral) still doesn't cross the 0.6 rate threshold either direction.
    await seedOutcome({ outcome: 'neutral' });
    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(0);
    expect(await LearningCandidate.count()).toBe(0);
  });

  test('H. no agent_knowledge writes occur during detection, including across repeated no-new-evidence ticks', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    await first.created[0].update({ status: 'confirmed', reviewed_by: 1, reviewed_at: new Date() });

    await detectLearningCandidates();
    await detectLearningCandidates();

    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('I. cross-agent patterns remain isolated under the new dedup semantics — one agent confirming its candidate never blocks or affects another agent\'s pattern', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved', agentName: AGENT_NAMES.SEO_ANALYST });
    await seedOutcome({ outcome: 'declined', agentName: AGENT_NAMES.SEO_ANALYST });
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved', agentName: AGENT_NAMES.BLOG_OPS });
    await seedOutcome({ outcome: 'declined', agentName: AGENT_NAMES.BLOG_OPS });

    const first = await detectLearningCandidates();
    expect(first.created).toHaveLength(2);

    const seoCandidate = first.created.find((c) => c.agent_name === AGENT_NAMES.SEO_ANALYST);
    await seoCandidate.update({ status: 'confirmed', reviewed_by: 1, reviewed_at: new Date() });

    // New evidence only for the SEO agent's pattern.
    await seedOutcome({ outcome: 'improved', agentName: AGENT_NAMES.SEO_ANALYST });

    const second = await detectLearningCandidates();
    expect(second.created).toHaveLength(1);
    expect(second.created[0].agent_name).toBe(AGENT_NAMES.SEO_ANALYST);

    // The Blog Ops agent's still-pending candidate is untouched.
    const blogOpsCandidate = await LearningCandidate.findOne({ where: { agent_name: AGENT_NAMES.BLOG_OPS } });
    expect(blogOpsCandidate.status).toBe('pending_review');
    expect(await LearningCandidate.count({ where: { agent_name: AGENT_NAMES.BLOG_OPS } })).toBe(1);
  });

  test('REGRESSION: confirmed candidate #1 + repeated detection ticks over the exact same 5 evaluated outcomes never fabricates a duplicate candidate', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    const first = await detectLearningCandidates();
    expect(first.created).toHaveLength(1);
    const candidateOne = first.created[0];
    await candidateOne.update({ status: 'confirmed', reviewed_by: 1, reviewed_at: new Date(), confirmed_knowledge_id: null });

    expect(await LearningCandidate.count()).toBe(1);

    // Real-DB reproduction: detection runs again and again with zero new
    // outcomes seeded — must never create candidate #2/#3/#4 for the exact
    // same, already-reviewed evidence.
    await detectLearningCandidates();
    await detectLearningCandidates();
    const third = await detectLearningCandidates();

    expect(third.created).toHaveLength(0);
    expect(third.skipped.some((s) => s.reason === 'no_new_evidence')).toBe(true);
    expect(await LearningCandidate.count()).toBe(1);

    const stillCandidateOne = await LearningCandidate.findByPk(candidateOne.id);
    expect(stillCandidateOne.status).toBe('confirmed');
  });
});

describe('detectLearningCandidates — no side effects outside learning_candidates', () => {
  test('detection never writes to agent_knowledge — detection is not teaching', async () => {
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });
    await seedOutcome({ outcome: 'declined' });

    await detectLearningCandidates();

    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('detection never mutates the underlying recommendation/action/outcome rows it read', async () => {
    const outcome = await seedOutcome({ outcome: 'improved' });
    for (let i = 0; i < 4; i += 1) await seedOutcome({ outcome: 'improved' });

    await detectLearningCandidates();

    const reloaded = await RecommendationOutcome.findByPk(outcome.id);
    expect(reloaded.status).toBe('evaluated'); // untouched
    expect(reloaded.outcome).toBe('improved'); // untouched
  });

  test('no code path in this file references a system prompt, tool registry, or AI provider — detection cannot auto-modify agent behavior', () => {
    const source = require('fs').readFileSync(
      require.resolve('../../src/services/agents/learningCandidates.js'),
      'utf8'
    );
    expect(source).not.toMatch(/systemPrompts|registry\.js|runAgentStep|getTextProvider|anthropic|openai/i);
  });
});
