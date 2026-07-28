/**
 * Response-envelope contract for the API client.
 *
 * WHY THIS TEST EXISTS
 * The backend uses two response shapes: `{ data: … }` for blogs and analytics, and
 * a top-level object for generation, brand voice, media and SERP. Each wrapper in
 * `src/lib/api.js` has to unwrap the right one.
 *
 * Getting it wrong is **silent**. `r.data.data` on a top-level response yields
 * `undefined` rather than throwing, so the promise resolves, the component renders
 * an empty state, and it looks like a data problem rather than a client bug. That
 * is precisely what happened: eight wrappers unwrapped one level too deep and every
 * AI feature would have returned `undefined` against a real server.
 *
 * So the fixtures below are transcribed from the actual `res.json(...)` calls in
 * `backend/src/controllers/`. If a controller's envelope changes, this fails — which
 * is the point. It is a contract test, not a test of axios.
 */

import {
  blogsApi,
  generateApi,
  brandVoiceApi,
  mediaApi,
  serpApi,
  analyticsApi,
  authApi,
  metaApi,
  api,
} from '../api';

/**
 * Fixtures mirroring each controller's real response body, keyed by
 * `METHOD /path`. Only the envelope shape matters, so payloads are minimal.
 */
const RESPONSES = {
  // --- `{ data: … }` envelope — blogs.controller.js, analytics.controller.js ---
  'GET /blogs/7': { data: { id: 7, blog_title: 'Wrapped' } },
  'POST /blogs': { data: { id: 8, blog_title: 'Created' } },
  'PATCH /blogs/7': { data: { id: 7, blog_title: 'Updated' } },
  'POST /blogs/7/publish': { data: { id: 7, blog_status: 1 } },
  'GET /blogs/linkable': { data: [{ id: 1, blog_title: 'Linkable' }] },
  'GET /analytics/overview': { data: { totals: { total: 3 } } },
  'GET /analytics/in-flight': { data: [{ id: 9, generation_status: 'queued' }] },

  // --- Top-level — generation.controller.js -------------------------------
  'POST /generate/title': { titles: [{ title: 'A title', score: 71 }] },
  'POST /generate/outline': { outline: [{ level: 2, text: 'A section' }] },
  'POST /generate/article': { blog_id: 7, generation_status: 'queued' },
  // Mounted under /blogs but served by the generation controller, so it follows
  // the generation envelope. This is the one that is easy to get wrong.
  'GET /blogs/7/generation-status': { generation_status: 'generated', seo_score: 80 },

  // --- Top-level — brandVoice.controller.js ------------------------------
  'POST /brand-voice/analyze': {
    tone: 'Warm, reverent',
    pov: 'second_person',
    traits: ['Opens with a sensory image'],
    summary: 'Warm and instructive.',
  },

  // --- Top-level — media.controller.js ----------------------------------
  'POST /media/upload': { relativePath: 'blogs/July2026/x.png', publicUrl: '/uploads/blogs/July2026/x.png' },
  'POST /media/generate-image': { images: [{ relativePath: 'blogs/July2026/y.png' }], count: 1 },
  'POST /media/composite-logo': { relativePath: 'blogs/July2026/z.png', publicUrl: '/uploads/blogs/July2026/z.png' },

  // --- Top-level — serp.controller.js -----------------------------------
  'POST /serp/check-rank': { keyword: 'shravan month', position: 4, found: true },
  'POST /serp/ground-facts': { sources: [{ title: 'A source' }], source_count: 1 },

  // --- Auth / meta -------------------------------------------------------
  'POST /auth/login': { access_token: 'a', refresh_token: 'r', user: { id: 1 } },
  'GET /auth/me': { user: { id: 1, email: 'harsh@divinetalk.com' } },
  'GET /meta': { features: { serp_api: false }, enums: {}, defaults: {} },
};

/**
 * Replaces the axios instance's adapter, so the interceptors, base URL and
 * unwrapping all run for real and only the transport is faked. Mocking the
 * wrappers themselves would test nothing.
 */
function installAdapter() {
  api.defaults.adapter = async (config) => {
    const url = (config.url || '').replace(/\?.*$/, '');
    const key = `${config.method.toUpperCase()} ${url}`;
    const body = RESPONSES[key];

    if (body === undefined) {
      throw new Error(
        `No fixture for "${key}". Add the controller's real response shape to RESPONSES.`
      );
    }

    return { data: body, status: 200, statusText: 'OK', headers: {}, config };
  };
}

beforeEach(() => {
  installAdapter();
  // A token so the request interceptor takes its normal path.
  window.localStorage.setItem('scriptura.access_token', 'test-token');
});

afterEach(() => {
  window.localStorage.clear();
  delete api.defaults.adapter;
});

describe('wrappers that unwrap a { data } envelope', () => {
  it('blogsApi.get', async () => {
    await expect(blogsApi.get(7)).resolves.toEqual({ id: 7, blog_title: 'Wrapped' });
  });

  it('blogsApi.create', async () => {
    await expect(blogsApi.create({ blog_title: 'Created' })).resolves.toMatchObject({ id: 8 });
  });

  it('blogsApi.update', async () => {
    await expect(blogsApi.update(7, { topic: 't' })).resolves.toMatchObject({ id: 7 });
  });

  it('blogsApi.publish', async () => {
    await expect(blogsApi.publish(7)).resolves.toMatchObject({ blog_status: 1 });
  });

  it('blogsApi.linkable', async () => {
    await expect(blogsApi.linkable({})).resolves.toHaveLength(1);
  });

  it('analyticsApi.overview', async () => {
    await expect(analyticsApi.overview({})).resolves.toMatchObject({ totals: { total: 3 } });
  });

  it('analyticsApi.inFlight', async () => {
    await expect(analyticsApi.inFlight()).resolves.toHaveLength(1);
  });
});

describe('wrappers that read a top-level response', () => {
  // Each of these was previously unwrapping one level too deep and resolving to
  // undefined. The `toBeDefined` assertions are the regression guard.
  it('generateApi.titles', async () => {
    const result = await generateApi.titles({ topic: 't' });
    expect(result).toBeDefined();
    expect(result.titles).toHaveLength(1);
  });

  it('generateApi.outline', async () => {
    const result = await generateApi.outline({ topic: 't' });
    expect(result?.outline?.[0]).toMatchObject({ level: 2 });
  });

  it('generateApi.article', async () => {
    const result = await generateApi.article({ blog_id: 7 });
    expect(result).toMatchObject({ blog_id: 7, generation_status: 'queued' });
  });

  it('blogsApi.generationStatus', async () => {
    const result = await blogsApi.generationStatus(7);
    expect(result).toMatchObject({ generation_status: 'generated', seo_score: 80 });
  });

  it('brandVoiceApi.analyze', async () => {
    const result = await brandVoiceApi.analyze({ source_type: 'text', text: 'x' });
    expect(result?.tone).toBe('Warm, reverent');
    expect(result?.traits).toHaveLength(1);
  });

  it('brandVoiceApi.analyzeFile', async () => {
    const file = new File(['sample text'], 'voice.txt', { type: 'text/plain' });
    const result = await brandVoiceApi.analyzeFile(file);
    expect(result?.tone).toBe('Warm, reverent');
  });

  it('mediaApi.upload', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const result = await mediaApi.upload(file);
    expect(result?.relativePath).toMatch(/^blogs\//);
  });

  it('mediaApi.generateImage', async () => {
    const result = await mediaApi.generateImage({ topic: 't' });
    expect(result?.images).toHaveLength(1);
  });

  it('mediaApi.compositeLogo', async () => {
    const result = await mediaApi.compositeLogo({ relativePath: 'blogs/July2026/z.png' });
    expect(result?.relativePath).toMatch(/^blogs\//);
  });

  it('serpApi.checkRank', async () => {
    const result = await serpApi.checkRank({ keyword: 'k' });
    expect(result).toMatchObject({ position: 4, found: true });
  });

  it('serpApi.groundFacts', async () => {
    const result = await serpApi.groundFacts({ topic: 't' });
    expect(result?.sources).toHaveLength(1);
  });

  it('authApi.login and me', async () => {
    await expect(authApi.login('a@b.com', 'pw')).resolves.toMatchObject({ access_token: 'a' });
    await expect(authApi.me()).resolves.toMatchObject({ user: { id: 1 } });
  });

  it('metaApi.get', async () => {
    await expect(metaApi.get()).resolves.toMatchObject({ features: { serp_api: false } });
  });
});

describe('no wrapper resolves to undefined', () => {
  it('every wrapper returns a defined value for its real response shape', async () => {
    // A catch-all: a new wrapper added with the wrong unwrapping fails here even if
    // nobody adds a dedicated case above.
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    const calls = [
      ['blogsApi.get', () => blogsApi.get(7)],
      ['blogsApi.create', () => blogsApi.create({ blog_title: 'x' })],
      ['blogsApi.update', () => blogsApi.update(7, {})],
      ['blogsApi.publish', () => blogsApi.publish(7)],
      ['blogsApi.linkable', () => blogsApi.linkable({})],
      ['blogsApi.generationStatus', () => blogsApi.generationStatus(7)],
      ['generateApi.titles', () => generateApi.titles({})],
      ['generateApi.outline', () => generateApi.outline({})],
      ['generateApi.article', () => generateApi.article({})],
      ['brandVoiceApi.analyze', () => brandVoiceApi.analyze({})],
      ['brandVoiceApi.analyzeFile', () => brandVoiceApi.analyzeFile(file)],
      ['mediaApi.upload', () => mediaApi.upload(file)],
      ['mediaApi.generateImage', () => mediaApi.generateImage({})],
      ['mediaApi.compositeLogo', () => mediaApi.compositeLogo({})],
      ['serpApi.checkRank', () => serpApi.checkRank({})],
      ['serpApi.groundFacts', () => serpApi.groundFacts({})],
      ['analyticsApi.overview', () => analyticsApi.overview({})],
      ['analyticsApi.inFlight', () => analyticsApi.inFlight()],
      ['metaApi.get', () => metaApi.get()],
    ];

    const undefinedResults = [];
    for (const [name, call] of calls) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures attributable
      const result = await call();
      if (result === undefined) undefinedResults.push(name);
    }

    expect(undefinedResults).toEqual([]);
  });
});
