// backend/tests/unit/knowledgeLifecycle.test.js
'use strict';

/**
 * Regression tests for the Knowledge Layer's source -> extraction ->
 * validation -> confirmation lifecycle, verifying EXISTING behavior
 * (knowledgeIngestion.js, knowledgeExtraction.js, knowledgeValidation.js,
 * knowledgeBase.js) — none of that production code is modified by this file.
 *
 * Isolation: same reasoning as tests/unit/serpSnapshot.test.js — this repo's
 * NODE_ENV/dotenv override bug means `npm test`'s assumed isolated-SQLite
 * setup cannot be trusted, so this file never touches the real (MySQL-backed)
 * src/models/index.js. It builds its own in-memory SQLite DB from the real
 * model factory files and mocks `../../src/models`.
 *
 * No AI SDK is mocked: extractCandidates/extractFromSources/validateCandidates
 * all accept an injectable `options.provider` (a real, existing test seam in
 * the production code, not something added for this test), so a plain fake
 * object implementing `analyzeKnowledgeSample` stands in for Claude/OpenAI —
 * zero network calls. `OPENAI_API_KEY` is cleared before requiring config so
 * knowledgeBase.js's embedClaim() deterministically returns null (its own
 * documented fail-open behavior when unconfigured), matching how a keyless
 * dev machine already behaves in production.
 */

delete process.env.OPENAI_API_KEY;

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const KnowledgeSource = require('../../src/models/knowledgeSource')(sqlite);
  const SourceChunk = require('../../src/models/sourceChunk')(sqlite);
  const AgentKnowledge = require('../../src/models/agentKnowledge')(sqlite);
  KnowledgeSource.hasMany(SourceChunk, { foreignKey: 'source_id', as: 'chunks', constraints: false });
  SourceChunk.belongsTo(KnowledgeSource, { foreignKey: 'source_id', as: 'source', constraints: false });
  return { KnowledgeSource, SourceChunk, AgentKnowledge, sequelize: sqlite, Sequelize };
});

const { KnowledgeSource, SourceChunk, AgentKnowledge, sequelize } = require('../../src/models');
const ingestion = require('../../src/services/agents/knowledge/knowledgeIngestion');
const extraction = require('../../src/services/agents/knowledge/knowledgeExtraction');
const validation = require('../../src/services/agents/knowledge/knowledgeValidation');
const knowledgeBase = require('../../src/services/agents/knowledge/knowledgeBase');
const { AGENT_NAMES } = require('../../src/constants');

const TEST_AGENT = AGENT_NAMES.RESEARCH;

/** A fake provider implementing only what these production code paths call. */
function fakeProvider(candidatesOrClassifications) {
  return {
    name: 'fake',
    analyzeKnowledgeSample: jest.fn().mockResolvedValue({
      raw: JSON.stringify(candidatesOrClassifications),
      parsed: candidatesOrClassifications,
    }),
  };
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await SourceChunk.destroy({ truncate: true });
  await KnowledgeSource.destroy({ truncate: true });
  await AgentKnowledge.destroy({ truncate: true });
  jest.clearAllMocks();
});

afterAll(async () => {
  await sequelize.close();
});

describe('Ingestion — knowledgeIngestion.js', () => {
  test('persistTextSource creates a new source + chunks for new content', async () => {
    const result = await ingestion.persistTextSource({
      sourceType: 'manual_text',
      content: 'DivineTalk offers Vedic astrology consultations.',
      contentStatus: 'user_provided',
      method: 'manual_text',
    });
    expect(result.reused).toBe(false);
    expect(result.contentStatus).toBe('user_provided');
    const stored = await KnowledgeSource.findByPk(result.sourceId);
    expect(stored.content).toBe('DivineTalk offers Vedic astrology consultations.');
  });

  test('persistTextSource reuses an existing row for identical content (content_hash dedup)', async () => {
    const content = 'Astrology apps rank well when they answer specific birth-chart questions.';
    const first = await ingestion.persistTextSource({
      sourceType: 'manual_text',
      content,
      contentStatus: 'user_provided',
      method: 'manual_text',
    });
    const second = await ingestion.persistTextSource({
      sourceType: 'manual_text',
      content,
      contentStatus: 'user_provided',
      method: 'manual_text',
    });
    expect(second.reused).toBe(true);
    expect(second.sourceId).toBe(first.sourceId);
    expect(await KnowledgeSource.count()).toBe(1);
  });

  test('detectAccessGate flags an unambiguous interstitial regardless of length', () => {
    expect(ingestion.detectAccessGate('Access Denied. You do not have permission to view this page.')).toBe(true);
    expect(ingestion.detectAccessGate('Please verify you are human before continuing. Checking your browser...')).toBe(true);
  });

  test('detectAccessGate flags a short login-wall page but not the same phrase inside real long-form content', () => {
    expect(ingestion.detectAccessGate('Please sign in to continue reading this article.')).toBe(true);

    const longArticle =
      'Vedic astrology has been practiced for centuries. '.repeat(40) +
      'Readers who want deeper personalization can sign in for a tailored chart, but the tradition itself predates any login system.';
    expect(longArticle.length).toBeGreaterThan(1000);
    expect(ingestion.detectAccessGate(longArticle)).toBe(false);
  });

  test('gatherContent isolates a per-link failure: the failed source is reported but not treated as ingested', async () => {
    const brandVoice = require('../../src/services/brandVoice');
    const spy = jest.spyOn(brandVoice, 'extractFromUrl').mockRejectedValueOnce(new Error('SSRF-blocked host'));

    const result = await ingestion.gatherContent({ links: ['https://blocked.example.com/'] });

    expect(result.sources).toHaveLength(0);
    expect(result.sourcesMeta).toHaveLength(1);
    expect(result.sourcesMeta[0]).toMatchObject({ type: 'link', content_status: 'unavailable' });
    expect(result.sourcesMeta[0].error).toMatch(/SSRF-blocked host/);

    spy.mockRestore();
  });
});

describe('Extraction — knowledgeExtraction.js', () => {
  test('extractCandidates parses and cleans a well-formed provider response', async () => {
    const provider = fakeProvider({
      candidates: [
        { category: 'seo', topic: 'astrology apps', claim: 'Long-tail keywords convert better for consultation bookings.', evidence: 'Admin observation', knowledge_type: 'observation' },
      ],
    });

    const candidates = await extraction.extractCandidates(
      { agentName: TEST_AGENT, textContent: 'some source text' },
      { provider }
    );

    expect(provider.analyzeKnowledgeSample).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].claim).toBe('Long-tail keywords convert better for consultation bookings.');
    expect(candidates[0].knowledge_type).toBe('observation');
  });

  test('extractFromSources gates metadata_only/unavailable sources — never sent to the provider (source-honesty)', async () => {
    const provider = fakeProvider({ candidates: [] });
    const sources = [
      { sourceId: 1, sourceType: 'youtube', contentStatus: 'metadata_only', reused: false, images: [], fullText: 'Title/author only', chunkRows: [] },
    ];

    await expect(extraction.extractFromSources({ agentName: TEST_AGENT, sources }, { provider })).rejects.toThrow(
      /No substantive content/
    );
    expect(provider.analyzeKnowledgeSample).not.toHaveBeenCalled();
  });

  test('extractFromSources skips a reused source without re-extracting', async () => {
    const provider = fakeProvider({ candidates: [{ category: 'x', topic: 'x', claim: 'should not appear', evidence: null, knowledge_type: 'fact' }] });
    const sources = [
      { sourceId: 2, sourceType: 'manual_text', contentStatus: 'user_provided', reused: true, images: [], fullText: 'text', chunkRows: [] },
    ];

    await expect(extraction.extractFromSources({ agentName: TEST_AGENT, sources }, { provider })).rejects.toThrow(
      /already been submitted/
    );
    expect(provider.analyzeKnowledgeSample).not.toHaveBeenCalled();
  });

  test('extractFromSources batches one long source into multiple provider calls', async () => {
    const provider = fakeProvider({
      candidates: [{ category: 'seo', topic: 'x', claim: 'a distinct claim from this batch', evidence: null, knowledge_type: 'fact' }],
    });
    // Two chunk "groups" worth of text — each over CHUNK_BATCH_CHAR_TARGET(10000)/len forces 2 batches.
    const chunkRows = [
      { id: 1, sequence: 0, text: 'x'.repeat(9000) },
      { id: 2, sequence: 1, text: 'y'.repeat(9000) },
    ];
    const sources = [
      {
        sourceId: 3,
        sourceType: 'web_link',
        contentStatus: 'full',
        reused: false,
        images: [],
        fullText: 'x'.repeat(9000) + 'y'.repeat(9000), // > SINGLE_CALL_CHAR_THRESHOLD (12000)
        chunkRows,
      },
    ];

    const result = await extraction.extractFromSources({ agentName: TEST_AGENT, sources }, { provider });
    expect(provider.analyzeKnowledgeSample.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Both batches produced the identically-worded candidate; dedupeCandidates collapses it to one.
    expect(result).toHaveLength(1);
    expect(result[0].source_id).toBe(3);
  });
});

describe('Validation — knowledgeValidation.js', () => {
  test('skips the model call entirely when there is no existing knowledge to compare against', async () => {
    const provider = fakeProvider({ classifications: [] });
    const candidates = [{ category: 'seo', topic: 'x', claim: 'a brand new claim nothing relates to', evidence: null }];

    const result = await validation.validateCandidates(TEST_AGENT, candidates, { provider });

    expect(provider.analyzeKnowledgeSample).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({ verdict: 'new', relatedId: null }),
    ]);
  });

  test('classifies against existing knowledge and maps verdicts back by candidate_index', async () => {
    await AgentKnowledge.create({
      scope: 'agent',
      agent_name: TEST_AGENT,
      category: 'seo',
      topic: 'astrology apps',
      claim: 'Consultation CTAs convert better than generic sign-up CTAs.',
      source_type: 'manual_text',
      confidence: 0.7,
      status: 'confirmed',
    });
    const existingRow = await AgentKnowledge.findOne();

    const provider = fakeProvider({
      classifications: [{ candidate_index: 0, verdict: 'supports', related_id: existingRow.id, reason: 'Same claim, more specific.' }],
    });
    const candidates = [{ category: 'seo', topic: 'astrology apps', claim: 'Consultation CTAs work better than sign-up CTAs.', evidence: null }];

    const result = await validation.validateCandidates(TEST_AGENT, candidates, { provider });

    expect(provider.analyzeKnowledgeSample).toHaveBeenCalledTimes(1);
    expect(result[0].verdict).toBe('supports');
    expect(result[0].relatedId).toBe(existingRow.id);
  });
});

describe('Confirmation — knowledgeBase.js confirmKnowledgeBatch (the sole writer)', () => {
  test('a "skip" decision writes nothing', async () => {
    const result = await knowledgeBase.confirmKnowledgeBatch(
      { agentName: TEST_AGENT, items: [{ decision: 'skip', claim: 'irrelevant' }] },
      { userId: null }
    );
    expect(result.skipped).toBe(1);
    expect(await AgentKnowledge.count()).toBe(0);
  });

  test('a "new" verdict creates an unverified row at confidence 0.5', async () => {
    const result = await knowledgeBase.confirmKnowledgeBatch(
      {
        agentName: TEST_AGENT,
        items: [{ decision: 'accept', verdict: 'new', category: 'seo', topic: 'kw', claim: 'Long-tail keywords convert better.', knowledge_type: 'observation' }],
      },
      { userId: null }
    );
    expect(result.created).toHaveLength(1);
    expect(result.created[0].status).toBe('unverified');
    expect(result.created[0].confidence).toBe(0.5);
  });

  test('a "duplicate" verdict only bumps usage_count, creates nothing', async () => {
    const existing = await AgentKnowledge.create({
      scope: 'agent', agent_name: TEST_AGENT, category: 'seo', topic: 'kw', claim: 'x', source_type: 'manual_text', confidence: 0.5, status: 'unverified', usage_count: 2,
    });
    const result = await knowledgeBase.confirmKnowledgeBatch(
      { agentName: TEST_AGENT, items: [{ decision: 'accept', verdict: 'duplicate', related_id: existing.id, claim: 'x' }] },
      { userId: null }
    );
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toBe(1);
    await existing.reload();
    expect(existing.usage_count).toBe(3);
  });

  test('a "supports" verdict bumps confidence by +0.15, capped at 0.95, and sets confirmed', async () => {
    const nearCap = await AgentKnowledge.create({
      scope: 'agent', agent_name: TEST_AGENT, category: 'seo', topic: 'kw', claim: 'x', source_type: 'manual_text', confidence: 0.9, status: 'unverified',
    });
    const result = await knowledgeBase.confirmKnowledgeBatch(
      { agentName: TEST_AGENT, items: [{ decision: 'accept', verdict: 'supports', related_id: nearCap.id, claim: 'x reinforced' }] },
      { userId: null }
    );
    expect(result.updated[0].confidence).toBe(0.95); // 0.9 + 0.15 = 1.05, capped
    expect(result.updated[0].status).toBe('confirmed');
  });

  test('a "contradicts" verdict flags BOTH sides as contested and cross-links them (no silent overwrite)', async () => {
    const existing = await AgentKnowledge.create({
      scope: 'agent', agent_name: TEST_AGENT, category: 'seo', topic: 'kw', claim: 'Post at 9am for best reach.', source_type: 'manual_text', confidence: 0.6, status: 'confirmed',
    });
    const result = await knowledgeBase.confirmKnowledgeBatch(
      {
        agentName: TEST_AGENT,
        items: [{ decision: 'accept', verdict: 'contradicts', related_id: existing.id, category: 'seo', topic: 'kw', claim: 'Post at 6pm for best reach.', knowledge_type: 'observation' }],
      },
      { userId: null }
    );

    expect(result.created).toHaveLength(1);
    const newRow = result.created[0];
    expect(newRow.status).toBe('contested');
    expect(newRow.confidence).toBe(0.4);
    expect(newRow.related_knowledge_ids).toEqual([existing.id]);

    await existing.reload();
    expect(existing.status).toBe('contested');
    expect(existing.related_knowledge_ids).toEqual([newRow.id]);
  });
});
