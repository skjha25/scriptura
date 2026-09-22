// backend/tests/unit/serpSnapshot.test.js
'use strict';

/**
 * Unit tests for the SERP snapshot persistence layer added on top of the
 * existing, unmodified services/serp.js request logic (services/serp.js ->
 * saveSerpSnapshot -> serp_snapshots/serp_results) and the read-only
 * get_serp_snapshot SEO Analyst tool that reads it back.
 *
 * Isolation note: this repo's own src/config/index.js loads `.env` with
 * `dotenv.config({ override: true })`, which unconditionally re-applies
 * `NODE_ENV=development` from `.env` even when the test runner sets
 * `NODE_ENV=test` — a pre-existing, already-flagged bug, not something this
 * change touches. Relying on `npm test`'s usual "isolated in-memory SQLite"
 * setup would silently run these tests against the real local dev MySQL
 * database instead. To stay safe regardless of that bug, this file never
 * goes through src/models/index.js's real (MySQL-backed) sequelize instance:
 * it builds its own throwaway in-memory SQLite database from the same model
 * factory files (src/models/serpSnapshot.js, serpResult.js, blog.js) and
 * mocks `../../src/models` so every lazy `require('../models')` /
 * `require('../../../models')` call site under test resolves to it instead.
 * axios is mocked too, so no test in this file makes a real network call —
 * live-API verification was done separately, directly, outside Jest, to keep
 * exact control over the SerpAPI free-tier request count.
 */

jest.mock('axios');
const axios = require('axios');

// --- Throwaway in-memory SQLite DB, built from the real model factories ----
// Built entirely inside the jest.mock factory (jest hoists jest.mock calls
// above other module-level code, so the factory cannot close over variables
// declared elsewhere in this file) and then re-obtained below via the same
// relative path — jest.mock caches the factory's return value, so this
// `require` returns the exact same model instances the factory constructed.
// The relative path resolves to the same file (src/models/index.js) that
// serp.js's `require('../models')` and the tool's `require('../../../models')`
// resolve to, so both get intercepted by this one mock.
jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const SerpSnapshot = require('../../src/models/serpSnapshot')(sqlite);
  const SerpResult = require('../../src/models/serpResult')(sqlite);
  const Blog = require('../../src/models/blog')(sqlite);
  SerpSnapshot.hasMany(SerpResult, { foreignKey: 'snapshot_id', as: 'results', onDelete: 'CASCADE' });
  SerpResult.belongsTo(SerpSnapshot, { foreignKey: 'snapshot_id', as: 'snapshot' });
  return { SerpSnapshot, SerpResult, Blog, sequelize: sqlite, Sequelize };
});

const { SerpSnapshot, SerpResult, Blog, sequelize } = require('../../src/models');
const serp = require('../../src/services/serp');
const { TOOLS } = require('../../src/services/agents/tools/seoAnalystAgentTools');
const getSerpSnapshotTool = TOOLS.find((t) => t.name === 'get_serp_snapshot');

/** A response shaped like a real SerpAPI `engine=google` reply, trimmed to what the code actually reads. */
function fixtureBody({ query, totalResults = 130, includeOurDomain = false, includeAstrotalk = true }) {
  const organic_results = [
    {
      position: 1,
      title: 'Consult Lunar Astro: Online Astrology Consultation in India',
      link: 'https://consultlunarastro.com/',
      snippet: 'Book an online astrology consultation in India with expert Vedic Astrologers.',
      displayed_link: 'consultlunarastro.com',
    },
    {
      position: 2,
      title: 'AI Astrology - Free Online Horoscope',
      link: 'https://www.astrosage.com/',
      snippet: 'AI-powered platform for personalized AI horoscope readings.',
      displayed_link: 'astrosage.com',
    },
  ];

  if (includeAstrotalk) {
    organic_results.push({
      position: 3,
      title: 'Astrotalk - Free Online Astrology Predictions by Best Astrologer',
      link: 'https://astrotalk.com/',
      snippet: 'Online astrology consultation brings ancient astrological wisdom to your phone.',
      displayed_link: 'astrotalk.com',
    });
  }

  if (includeOurDomain) {
    organic_results.push({
      position: 4,
      title: 'Divinetalk — Astrology guidance',
      link: 'https://divinetalk.in/astrology',
      snippet: 'Talk to a Divinetalk astrologer.',
      displayed_link: 'divinetalk.in',
    });
  }

  return {
    search_metadata: {
      id: 'fixture-id',
      created_at: '2026-08-13 09:14:17 UTC',
      processed_at: '2026-08-13 09:14:17 UTC',
      google_url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    },
    search_parameters: { engine: 'google', q: query, hl: 'en', gl: 'in' },
    search_information: { query_displayed: query, total_results: totalResults },
    organic_results,
    related_questions: [{ question: 'Is astrology 100% accurate?' }],
    related_searches: [{ query: `${query} free` }],
    ai_overview: { text_blocks: [{ type: 'paragraph', snippet: 'Astrology apps overview text.' }] },
  };
}

function mockAxiosOnce(body, status = 200) {
  axios.get.mockResolvedValueOnce({ status, data: body });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await SerpResult.destroy({ truncate: true });
  await SerpSnapshot.destroy({ truncate: true });
  await Blog.destroy({ truncate: true });
  jest.clearAllMocks();
});

afterAll(async () => {
  await sequelize.close();
});

describe('SERP snapshot persistence (services/serp.js -> saveSerpSnapshot)', () => {
  test('fetchSerpDataForKeyword persists a snapshot and its organic results', async () => {
    mockAxiosOnce(fixtureBody({ query: 'online astrology consultation' }));

    const returned = await serp.fetchSerpDataForKeyword('online astrology consultation');
    expect(returned.top_10_results.length).toBe(3); // unchanged existing return shape

    const snapshots = await SerpSnapshot.findAll();
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot.normalized_keyword).toBe('online astrology consultation');
    expect(snapshot.location).toBe('in');
    expect(snapshot.language).toBe('en');
    expect(snapshot.device).toBe('desktop');
    expect(snapshot.source_function).toBe('fetchSerpDataForKeyword');
    expect(snapshot.total_results).toBe(130);
    expect(snapshot.serp_features.has_ai_overview).toBe(true);
    expect(snapshot.serp_features.has_people_also_ask).toBe(true);

    const results = await SerpResult.findAll({ where: { snapshot_id: snapshot.id }, order: [['position', 'ASC']] });
    expect(results).toHaveLength(3);
    expect(results[2].domain).toBe('astrotalk.com');
    expect(results[2].position).toBe(3);
    expect(results[2].url).toBe('https://astrotalk.com/');
  });

  test('a second call for the same identity inside the dedup window reuses the existing snapshot', async () => {
    mockAxiosOnce(fixtureBody({ query: 'kundli online' }));
    await serp.fetchSerpDataForKeyword('kundli online');

    mockAxiosOnce(fixtureBody({ query: 'kundli online', totalResults: 999 }));
    await serp.fetchSerpDataForKeyword('kundli online');

    const snapshots = await SerpSnapshot.findAll();
    expect(snapshots).toHaveLength(1);
    // Reused the first snapshot (total_results 130), not overwritten by the second call's 999.
    expect(snapshots[0].total_results).toBe(130);
    expect(axios.get).toHaveBeenCalledTimes(2); // dedup only skips the DB write, never the API call itself
  });

  test('a call outside the dedup window creates a new, separate historical snapshot', async () => {
    mockAxiosOnce(fixtureBody({ query: 'astrology app', totalResults: 100 }));
    await serp.fetchSerpDataForKeyword('astrology app');

    const [first] = await SerpSnapshot.findAll();
    // Simulate "checked again next week": back-date the existing row's created_at
    // (what the dedup window actually checks) past the window. Sequelize's
    // instance.update() silently ignores changes to the createdAt-mapped
    // attribute, so this needs the static Model.update() to actually persist.
    await SerpSnapshot.update({ created_at: new Date(Date.now() - 20 * 60 * 1000) }, { where: { id: first.id } });

    mockAxiosOnce(fixtureBody({ query: 'astrology app', totalResults: 150 }));
    await serp.fetchSerpDataForKeyword('astrology app');

    const snapshots = await SerpSnapshot.findAll({ order: [['id', 'ASC']] });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].total_results).toBe(100);
    expect(snapshots[1].total_results).toBe(150);
  });

  test('checkRank still updates blog rank fields (backward compatibility) AND persists a snapshot', async () => {
    const blog = await Blog.create({ blog_title: 'Test blog' });

    mockAxiosOnce(fixtureBody({ query: 'kundli online', includeAstrotalk: true }));
    const result = await serp.checkRank({ keyword: 'kundli online', domain: 'astrotalk.com', blogId: blog.id });

    expect(result.position).toBe(3);
    await blog.reload();
    expect(blog.serp_rank_position).toBe(3);
    expect(blog.serp_rank_keyword).toBe('kundli online');

    const snapshots = await SerpSnapshot.findAll();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].source_function).toBe('checkRank');
    expect(axios.get).toHaveBeenCalledTimes(1); // one API call served both the rank check and the snapshot
  });

  test('a storage failure during saveSerpSnapshot does not break fetchSerpDataForKeyword', async () => {
    mockAxiosOnce(fixtureBody({ query: 'astrology app' }));
    const createSpy = jest.spyOn(SerpSnapshot, 'create').mockRejectedValueOnce(new Error('db unavailable'));

    await expect(serp.fetchSerpDataForKeyword('astrology app')).resolves.toEqual(
      expect.objectContaining({ top_10_results: expect.any(Array) })
    );

    createSpy.mockRestore();
  });
});

describe('get_serp_snapshot SEO Analyst tool', () => {
  test('is registered on the SEO Analyst agent tool list', () => {
    expect(getSerpSnapshotTool).toBeDefined();
    expect(getSerpSnapshotTool.input_schema.required).toContain('keyword');
  });

  test('returns "No SERP snapshot available" for a keyword nothing has checked', async () => {
    const result = await getSerpSnapshotTool.execute({ keyword: 'a keyword nobody ever searched' });
    expect(result.found).toBe(false);
    expect(result.message).toBe('No SERP snapshot available for this query.');
  });

  test('never calls the live API — reads only from stored data', async () => {
    await getSerpSnapshotTool.execute({ keyword: 'anything' });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('surfaces a competitor (Astrotalk) found in the snapshot, with position and URL', async () => {
    mockAxiosOnce(fixtureBody({ query: 'online astrology consultation', includeAstrotalk: true }));
    await serp.fetchSerpDataForKeyword('online astrology consultation');

    const result = await getSerpSnapshotTool.execute({ keyword: 'online astrology consultation' });
    expect(result.found).toBe(true);
    expect(result.domains_in_snapshot).toContain('astrotalk.com');
    const astrotalkRow = result.results.find((r) => r.domain === 'astrotalk.com');
    expect(astrotalkRow.position).toBe(3);
    expect(astrotalkRow.url).toBe('https://astrotalk.com/');
  });

  test('reports our own domain as not found when absent from the snapshot', async () => {
    mockAxiosOnce(fixtureBody({ query: 'kundli online', includeOurDomain: false }));
    await serp.fetchSerpDataForKeyword('kundli online');

    const result = await getSerpSnapshotTool.execute({ keyword: 'kundli online' });
    expect(result.our_domain.found).toBe(false);
    expect(result.our_domain.note).toMatch(/does not mean the domain does not rank/i);
  });

  test('reports our own domain position when present in the snapshot', async () => {
    mockAxiosOnce(fixtureBody({ query: 'astrology app', includeOurDomain: true }));
    await serp.fetchSerpDataForKeyword('astrology app');

    const result = await getSerpSnapshotTool.execute({ keyword: 'astrology app' });
    expect(result.our_domain.found).toBe(true);
    expect(result.our_domain.position).toBe(4);
    expect(result.our_domain.url).toBe('https://divinetalk.in/astrology');
  });

  test('lists which SERP features were present, without inventing ones that were not', async () => {
    mockAxiosOnce(fixtureBody({ query: 'kundli online' }));
    await serp.fetchSerpDataForKeyword('kundli online');

    const result = await getSerpSnapshotTool.execute({ keyword: 'kundli online' });
    expect(result.serp_features).toEqual(
      expect.arrayContaining(['AI Overview', 'People Also Ask', 'Related Searches'])
    );
    expect(result.serp_features).not.toContain('Local Pack');
    expect(result.serp_features).not.toContain('Ads');
  });

  test('response carries an explicit limitation note (hallucination guard) rather than causal claims', async () => {
    mockAxiosOnce(fixtureBody({ query: 'kundli online' }));
    await serp.fetchSerpDataForKeyword('kundli online');

    const result = await getSerpSnapshotTool.execute({ keyword: 'kundli online' });
    expect(result.note).toMatch(/does not explain WHY/i);
    expect(result.note).not.toMatch(/backlinks are stronger|higher domain authority|better content/i);
  });
});
