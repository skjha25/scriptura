// backend/tests/unit/gscSnapshot.test.js
'use strict';

/**
 * Unit tests for the Google Search Console integration: config resolution
 * (services/config/index.js's gsc block), auth (services/gscAuth.js),
 * fetch+persist (services/gsc.js), and the read-only SEO Analyst tool
 * (get_gsc_performance in seoAnalystAgentTools.js).
 *
 * Isolation: same reasoning as tests/unit/serpSnapshot.test.js — this repo's
 * NODE_ENV/dotenv override bug means `npm test`'s usual isolated-SQLite setup
 * cannot be trusted, so this file never touches the real (MySQL-backed)
 * src/models/index.js: it builds its own in-memory SQLite DB from the real
 * model factory files and mocks `../../src/models`. `google-auth-library` is
 * mocked too, so no test here makes a real network call to Google — the real,
 * live GSC verification (once real credentials exist) is done separately,
 * outside Jest, exactly like the SERP live verification was.
 */

describe('GSC configuration resolution (config/index.js)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  test('disabled by default when GSC_ENABLED is unset', () => {
    delete process.env.GSC_ENABLED;
    delete process.env.GSC_SITE_URL;
    delete process.env.GSC_SERVICE_ACCOUNT_KEY;
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.gsc.enabled).toBe(false);
    expect(config.gsc.flagEnabled).toBe(false);
  });

  test('stays disabled, with a config error, when GSC_ENABLED=true but credentials are missing', () => {
    process.env.GSC_ENABLED = 'true';
    delete process.env.GSC_SITE_URL;
    delete process.env.GSC_SERVICE_ACCOUNT_KEY;
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.gsc.enabled).toBe(false);
    expect(config.gsc.flagEnabled).toBe(true);
    expect(config.gsc.hasCredentials).toBe(false);
  });

  test('stays disabled, with a safe (non-leaking) config error, when the key is malformed JSON', () => {
    process.env.GSC_ENABLED = 'true';
    process.env.GSC_SITE_URL = 'sc-domain:divinetalk.in';
    process.env.GSC_SERVICE_ACCOUNT_KEY = '{not valid json, super-secret-should-never-appear';
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.gsc.enabled).toBe(false);
    expect(config.gsc.configError).toBeTruthy();
    expect(config.gsc.configError).not.toContain('super-secret-should-never-appear');
    expect(config.gsc.serviceAccount).toBeNull();
  });

  test('stays disabled when the key JSON is valid but missing client_email/private_key', () => {
    process.env.GSC_ENABLED = 'true';
    process.env.GSC_SITE_URL = 'sc-domain:divinetalk.in';
    process.env.GSC_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'x' });
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.gsc.enabled).toBe(false);
    expect(config.gsc.configError).toMatch(/client_email|private_key/);
  });

  test('becomes enabled automatically once flag, site URL, and a valid key are all present — no code change', () => {
    process.env.GSC_ENABLED = 'true';
    process.env.GSC_SITE_URL = 'sc-domain:divinetalk.in';
    process.env.GSC_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: 'test@test.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    });
    jest.resetModules();
    const config = require('../../src/config');
    expect(config.gsc.enabled).toBe(true);
    expect(config.gsc.siteUrl).toBe('sc-domain:divinetalk.in');
  });
});

describe('GSC service + SEO Analyst tool (enabled, mocked Google client)', () => {
  const FAKE_KEY = {
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  };

  const mockRequest = jest.fn();

  jest.mock('google-auth-library', () => ({
    JWT: jest.fn().mockImplementation(() => ({ request: mockRequest })),
  }));

  jest.mock('../../src/models', () => {
    const { Sequelize } = require('sequelize');
    const sqlite = new Sequelize('sqlite::memory:', { logging: false });
    const GscSnapshot = require('../../src/models/gscSnapshot')(sqlite);
    const GscRow = require('../../src/models/gscRow')(sqlite);
    GscSnapshot.hasMany(GscRow, { foreignKey: 'snapshot_id', as: 'rows', onDelete: 'CASCADE' });
    GscRow.belongsTo(GscSnapshot, { foreignKey: 'snapshot_id', as: 'snapshot' });
    return { GscSnapshot, GscRow, sequelize: sqlite, Sequelize };
  });

  let config;
  let gscAuth;
  let gsc;
  let GscSnapshot;
  let GscRow;
  let sequelize;
  let getGscPerformanceTool;

  beforeAll(async () => {
    process.env.GSC_ENABLED = 'true';
    process.env.GSC_SITE_URL = 'sc-domain:divinetalk.in';
    process.env.GSC_SERVICE_ACCOUNT_KEY = JSON.stringify(FAKE_KEY);
    jest.resetModules();

    config = require('../../src/config');
    gscAuth = require('../../src/services/gscAuth');
    gsc = require('../../src/services/gsc');
    ({ GscSnapshot, GscRow, sequelize } = require('../../src/models'));
    getGscPerformanceTool = require('../../src/services/agents/tools/seoAnalystAgentTools').TOOLS.find(
      (t) => t.name === 'get_gsc_performance'
    );

    await sequelize.sync({ force: true });
  });

  afterEach(async () => {
    await GscRow.destroy({ truncate: true });
    await GscSnapshot.destroy({ truncate: true });
    mockRequest.mockReset();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  function fixtureResponse() {
    return {
      data: {
        rows: [
          { keys: ['best astrologer online', 'https://divinetalk.in/consult', '2026-08-05'], clicks: 40, impressions: 800, ctr: 0.05, position: 4.2 },
          { keys: ['kundli matching free', 'https://divinetalk.in/kundli-match', '2026-08-05'], clicks: 15, impressions: 500, ctr: 0.03, position: 9.1 },
          { keys: ['best astrologer online', 'https://divinetalk.in/consult', '2026-08-06'], clicks: 22, impressions: 600, ctr: 0.0367, position: 3.8 },
        ],
      },
    };
  }

  test('config resolves enabled with a real (fake) service account', () => {
    expect(config.gsc.enabled).toBe(true);
    expect(gscAuth.isEnabled()).toBe(true);
  });

  test('getAuthClient() constructs a JWT client with the read-only webmasters scope', () => {
    const { JWT } = require('google-auth-library');
    const client = gscAuth.getAuthClient();
    expect(client).toBeTruthy();
    expect(JWT).toHaveBeenCalledWith(
      expect.objectContaining({
        email: FAKE_KEY.client_email,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      })
    );
  });

  test('fetchSearchAnalytics normalizes rows by dimension order and persists a snapshot + rows', async () => {
    mockRequest.mockResolvedValueOnce(fixtureResponse());

    const snapshot = await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });

    expect(snapshot.site_url).toBe('sc-domain:divinetalk.in');
    expect(snapshot.date_range_start).toBe('2026-08-05');
    expect(snapshot.dimensions).toEqual(['query', 'page', 'date']);
    expect(snapshot.source_function).toBe('fetchSearchAnalytics');

    const rows = await GscRow.findAll({ where: { snapshot_id: snapshot.id } });
    expect(rows).toHaveLength(3);
    const first = rows.find((r) => r.query === 'best astrologer online' && r.date === '2026-08-05');
    expect(first.page).toBe('https://divinetalk.in/consult');
    expect(first.clicks).toBe(40);
    expect(first.impressions).toBe(800);
    expect(first.country).toBeNull(); // "country" dimension was not requested
  });

  test('a second identical fetch within the dedup window reuses the snapshot; a call made after the window creates new history', async () => {
    mockRequest.mockResolvedValueOnce(fixtureResponse());
    await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });
    let snapshots = await GscSnapshot.findAll();
    expect(snapshots).toHaveLength(1);

    mockRequest.mockResolvedValueOnce(fixtureResponse());
    await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });
    snapshots = await GscSnapshot.findAll();
    expect(snapshots).toHaveLength(1); // reused, not duplicated
    expect(mockRequest).toHaveBeenCalledTimes(2); // dedup only skips the DB write, never the API call itself

    await GscSnapshot.update({ created_at: new Date(Date.now() - 20 * 60 * 1000) }, { where: { id: snapshots[0].id } });
    mockRequest.mockResolvedValueOnce(fixtureResponse());
    await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });
    snapshots = await GscSnapshot.findAll();
    expect(snapshots).toHaveLength(2); // outside the window: real new history, Aug-13-style vs Aug-20-style
  });

  test('an upstream Google API failure is isolated: no snapshot is created, and a clear error is thrown', async () => {
    const gaxiosError = new Error('insufficient permission');
    gaxiosError.response = { status: 403, data: { error: { message: 'The caller does not have permission' } } };
    mockRequest.mockRejectedValueOnce(gaxiosError);

    await expect(gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' })).rejects.toThrow(
      /Google Search Console rejected this request/
    );
    expect(await GscSnapshot.count()).toBe(0);
  });

  test('get_gsc_performance reads only from the DB — zero Google API calls', async () => {
    mockRequest.mockResolvedValueOnce(fixtureResponse());
    await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });
    mockRequest.mockClear();

    await getGscPerformanceTool.execute({ start_date: '2026-08-05', end_date: '2026-08-06' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('get_gsc_performance returns aggregated totals, top queries/pages, and mandatory domain labeling', async () => {
    mockRequest.mockResolvedValueOnce(fixtureResponse());
    await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });

    const result = await getGscPerformanceTool.execute({ start_date: '2026-08-05', end_date: '2026-08-06' });

    expect(result.found).toBe(true);
    expect(result.data_source).toBe('Google Search Console');
    expect(result.site).toBe('divinetalk.in'); // cleaned, no "sc-domain:" prefix
    expect(result.totals.clicks).toBe(77); // 40 + 15 + 22
    expect(result.totals.impressions).toBe(1900); // 800 + 500 + 600
    expect(result.top_queries[0].query).toBe('best astrologer online'); // 62 clicks combined, highest
    expect(result.top_queries[0].clicks).toBe(62);
    expect(result.note).toMatch(/DIFFERENT property/);
    expect(result.note).not.toMatch(/divinetalk\.com is the same/i);
  });

  test('a query filter narrows results correctly without a fresh API call', async () => {
    mockRequest.mockResolvedValueOnce(fixtureResponse());
    await gsc.fetchSearchAnalytics({ startDate: '2026-08-05', endDate: '2026-08-06' });

    const result = await getGscPerformanceTool.execute({
      start_date: '2026-08-05',
      end_date: '2026-08-06',
      query: 'kundli matching free',
    });
    expect(result.rows_matched).toBe(1);
    expect(result.totals.clicks).toBe(15);
  });

  test('no-data behavior: a date range nothing has fetched returns the explicit unavailable message, never fabricated numbers', async () => {
    const result = await getGscPerformanceTool.execute({ start_date: '1999-01-01', end_date: '1999-01-07' });
    expect(result.found).toBe(false);
    expect(result.message).toBe(
      'GSC data is not currently available. GSC integration is disabled or no snapshot has been collected.'
    );
  });
});

describe('get_gsc_performance when GSC is disabled', () => {
  test('returns the disabled message and never touches Google or the DB', async () => {
    jest.resetModules();
    delete process.env.GSC_ENABLED;
    delete process.env.GSC_SITE_URL;
    delete process.env.GSC_SERVICE_ACCOUNT_KEY;

    const { TOOLS } = require('../../src/services/agents/tools/seoAnalystAgentTools');
    const tool = TOOLS.find((t) => t.name === 'get_gsc_performance');
    const result = await tool.execute({});

    expect(result.found).toBe(false);
    expect(result.data_source).toBe('Google Search Console');
    expect(result.message).toMatch(/not currently available/);
  });

  test('is registered on the SEO Analyst agent tool list regardless of enabled state', () => {
    const { TOOLS } = require('../../src/services/agents/tools/seoAnalystAgentTools');
    expect(TOOLS.some((t) => t.name === 'get_gsc_performance')).toBe(true);
  });
});
