// backend/tests/unit/factVerification.test.js
'use strict';

/**
 * P6-B tests: services/factVerification.js — the real fact-checking step
 * wired into generation.js. `./factSources` and `./ai` are mocked (no real
 * network/model call); `selectSourcesForPolicy`/`buildArticleText` are pure
 * functions tested directly against real block/source shapes.
 */

jest.mock('../../src/services/factSources', () => ({
  listFactSources: jest.fn(),
}));

jest.mock('../../src/services/ai', () => ({
  getTextProvider: jest.fn(),
}));

const factSources = require('../../src/services/factSources');
const { getTextProvider } = require('../../src/services/ai');
const { verifyBlocks, selectSourcesForPolicy, buildArticleText } = require('../../src/services/factVerification');

function makeSource(overrides = {}) {
  return {
    id: 's1',
    name: 'Test Source',
    sourceType: 'website',
    extractedText: 'The festival falls on 15 August this year.',
    contentStatus: 'full',
    priority: 'primary',
    active: true,
    ...overrides,
  };
}

describe('selectSourcesForPolicy — deterministic, no LLM involved', () => {
  test('primary_only: picks only active, readable, primary sources', () => {
    const primary = makeSource({ id: 'p', priority: 'primary' });
    const secondary = makeSource({ id: 's', priority: 'secondary' });
    expect(selectSourcesForPolicy([primary, secondary], 'primary_only')).toEqual([primary]);
  });

  test('primary_only: falls back to all active sources when none is marked primary', () => {
    const secondary = makeSource({ id: 's', priority: 'secondary' });
    expect(selectSourcesForPolicy([secondary], 'primary_only')).toEqual([secondary]);
  });

  test('compare_all: includes every active, readable source regardless of priority', () => {
    const primary = makeSource({ id: 'p', priority: 'primary' });
    const secondary = makeSource({ id: 's', priority: 'secondary' });
    const result = selectSourcesForPolicy([primary, secondary], 'compare_all');
    expect(result.map((s) => s.id).sort()).toEqual(['p', 's']);
  });

  test('inactive sources are never selected under any policy', () => {
    const inactive = makeSource({ active: false });
    expect(selectSourcesForPolicy([inactive], 'compare_all')).toEqual([]);
  });

  test('an unreadable source (e.g. an unparsed PDF) is never selected — never fabricated evidence', () => {
    const unreadable = makeSource({ contentStatus: 'unavailable' });
    expect(selectSourcesForPolicy([unreadable], 'compare_all')).toEqual([]);
  });
});

describe('buildArticleText — real block shapes only, never invented', () => {
  test('extracts text from every supported block type', () => {
    const blocks = [
      { type: 'heading', data: { text: 'Title' } },
      { type: 'paragraph', data: { text: 'Body text.' } },
      { type: 'list', data: { items: ['a', 'b'] } },
      { type: 'quote', data: { text: 'A quote.' } },
    ];
    const text = buildArticleText(blocks);
    expect(text).toContain('Title');
    expect(text).toContain('Body text.');
    expect(text).toContain('a; b');
    expect(text).toContain('A quote.');
  });

  test('an unsupported block type contributes nothing, never a fabricated placeholder', () => {
    const blocks = [{ type: 'embed', data: { url: 'https://example.com' } }];
    expect(buildArticleText(blocks)).toBe('');
  });

  test('empty/missing blocks -> empty string, never throws', () => {
    expect(buildArticleText([])).toBe('');
    expect(buildArticleText(null)).toBe('');
  });
});

describe('verifyBlocks — real processing step, never fabricates confidence', () => {
  const blocks = [{ type: 'paragraph', data: { text: 'The festival falls on 15 August.' } }];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('no fact sources configured -> null (verification did not run, not "unverified")', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [], policy: 'primary_only' });
    expect(await verifyBlocks(blocks)).toBeNull();
    expect(getTextProvider).not.toHaveBeenCalled();
  });

  test('sources configured but none are active/readable -> null, and the provider is never called', async () => {
    factSources.listFactSources.mockResolvedValue({
      sources: [makeSource({ active: false })],
      policy: 'primary_only',
    });
    expect(await verifyBlocks(blocks)).toBeNull();
    expect(getTextProvider).not.toHaveBeenCalled();
  });

  test('empty blocks -> null without ever calling the provider', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'primary_only' });
    expect(await verifyBlocks([])).toBeNull();
    expect(getTextProvider).not.toHaveBeenCalled();
  });

  test('a verified claim from the model -> overall status "verified"', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'primary_only' });
    const provider = {
      analyzeKnowledgeSample: jest.fn().mockResolvedValue({
        parsed: { claims: [{ claim: 'The festival falls on 15 August.', status: 'verified', sourceName: 'Test Source', conflictDetail: null }] },
      }),
    };
    getTextProvider.mockReturnValue(provider);

    const result = await verifyBlocks(blocks);
    expect(result.status).toBe('verified');
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].sourceName).toBe('Test Source');
    expect(provider.analyzeKnowledgeSample).toHaveBeenCalledTimes(1);
  });

  test('a conflict claim -> overall status "conflict", regardless of other claims', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'primary_only' });
    getTextProvider.mockReturnValue({
      analyzeKnowledgeSample: jest.fn().mockResolvedValue({
        parsed: {
          claims: [
            { claim: 'Claim A', status: 'verified', sourceName: 'Test Source' },
            { claim: 'Claim B', status: 'conflict', sourceName: 'Test Source', conflictDetail: 'Source A says 15 August, Source B says 16 August.' },
          ],
        },
      }),
    });

    const result = await verifyBlocks(blocks);
    expect(result.status).toBe('conflict');
    expect(result.claims.find((c) => c.status === 'conflict').conflictDetail).toContain('15 August');
  });

  test('no checkable claims returned -> overall status "not_applicable"', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'primary_only' });
    getTextProvider.mockReturnValue({
      analyzeKnowledgeSample: jest.fn().mockResolvedValue({ parsed: { claims: [] } }),
    });

    const result = await verifyBlocks(blocks);
    expect(result.status).toBe('not_applicable');
    expect(result.claims).toEqual([]);
  });

  test('a malformed/garbage-status claim from the model is dropped, never trusted as-is', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'primary_only' });
    getTextProvider.mockReturnValue({
      analyzeKnowledgeSample: jest.fn().mockResolvedValue({
        parsed: { claims: [{ claim: 'Bad claim', status: 'definitely_true' }] }, // not a real status
      }),
    });

    const result = await verifyBlocks(blocks);
    expect(result.claims).toEqual([]);
    expect(result.status).toBe('not_applicable');
  });

  test('a provider failure fails open — "unverified" with a reason, never throws into the generation pipeline', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'primary_only' });
    getTextProvider.mockReturnValue({
      analyzeKnowledgeSample: jest.fn().mockRejectedValue(new Error('provider down')),
    });

    const result = await verifyBlocks(blocks);
    expect(result.status).toBe('unverified');
    expect(result.reason).toBe('verification_failed');
  });

  test('the policy actually used is recorded on the result', async () => {
    factSources.listFactSources.mockResolvedValue({ sources: [makeSource()], policy: 'compare_all' });
    getTextProvider.mockReturnValue({
      analyzeKnowledgeSample: jest.fn().mockResolvedValue({ parsed: { claims: [] } }),
    });

    const result = await verifyBlocks(blocks);
    expect(result.policy).toBe('compare_all');
  });
});
