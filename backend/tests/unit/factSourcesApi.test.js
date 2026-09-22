// backend/tests/unit/factSourcesApi.test.js
'use strict';

/**
 * P6-B tests: the real HTTP wiring for fact-source management
 * (routes/v1/factSources.routes.js -> controllers/factSources.controller.js
 * -> services/factSources.js), reusing the REAL requireAuth middleware and
 * REAL token signing. `brandVoice`/`storage` are mocked (no real network
 * fetch/file write); the models layer is real in-memory SQLite.
 */

jest.mock('../../src/services/brandVoice', () => ({
  extractFromUrl: jest.fn(),
  extractFromFile: jest.fn(),
}));

jest.mock('../../src/services/storage', () => ({
  saveImage: jest.fn(),
}));

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const ScripturaSettings = require('../../src/models/scripturaSettings')(sqlite);
  return { User, ScripturaSettings, sequelize: sqlite, Sequelize };
});

const { extractFromUrl } = require('../../src/services/brandVoice');
const { saveImage } = require('../../src/services/storage');
const { User, ScripturaSettings, sequelize } = require('../../src/models');

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  jest.clearAllMocks();
  await ScripturaSettings.destroy({ truncate: true });
  await User.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Fact Sources API (real HTTP + real auth)', () => {
  const request = require('supertest');
  const { signAccessToken } = require('../../src/services/tokens');
  let app;
  let user;

  beforeAll(() => {
    const { createApp } = require('../../src/app');
    app = createApp();
  });

  beforeEach(async () => {
    user = await User.create({ name: 'Editor', email: 'editor@test.local', password_hash: 'x', role: 'editor', is_active: true });
  });

  function tokenFor(u) {
    return signAccessToken({ id: u.id, email: u.email, role: u.role });
  }

  test('an unauthenticated request is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/settings/fact-sources');
    expect(res.status).toBe(401);
  });

  test('GET returns an empty list and the default policy when nothing is configured', async () => {
    const res = await request(app).get('/api/v1/settings/fact-sources').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sources: [], policy: 'primary_only' });
  });

  test('POST adds a website source, real fetch reused via extractFromUrl', async () => {
    extractFromUrl.mockResolvedValue({ sample: 'The festival is on 15 August.', finalUrl: 'https://drikpanchang.com' });

    const res = await request(app)
      .post('/api/v1/settings/fact-sources')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'Drik Panchang', sourceType: 'website', url: 'https://drikpanchang.com', priority: 'primary' });

    expect(res.status).toBe(201);
    expect(res.body.data.contentStatus).toBe('full');
    expect(res.body.data.priority).toBe('primary');

    const listRes = await request(app).get('/api/v1/settings/fact-sources').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(listRes.body.data.sources).toHaveLength(1);
  });

  test('POST adds a reference_text source with no external fetch at all', async () => {
    const res = await request(app)
      .post('/api/v1/settings/fact-sources')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'Manual note', sourceType: 'reference_text', referenceText: 'Diwali is on 20 October this year.' });

    expect(res.status).toBe(201);
    expect(res.body.data.contentStatus).toBe('user_provided');
    expect(extractFromUrl).not.toHaveBeenCalled();
  });

  test('POST rejects document/pdf sourceType — those go through the upload endpoint (422)', async () => {
    const res = await request(app)
      .post('/api/v1/settings/fact-sources')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'x', sourceType: 'pdf' });
    expect(res.status).toBe(422);
  });

  test('POST rejects a missing name (422)', async () => {
    const res = await request(app)
      .post('/api/v1/settings/fact-sources')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ sourceType: 'reference_text', referenceText: 'x' });
    expect(res.status).toBe(422);
  });

  test('POST /upload stores a .pdf and honestly marks it unavailable', async () => {
    saveImage.mockResolvedValue({ relativePath: 'uploads/cal.pdf', publicUrl: '/uploads/cal.pdf', bytes: 123 });

    const res = await request(app)
      .post('/api/v1/settings/fact-sources/upload')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .field('name', 'Hindu Calendar 2026')
      .field('source_type', 'pdf')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'calendar.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.contentStatus).toBe('unavailable');
    expect(res.body.data.sourceType).toBe('pdf');
  });

  test('POST /upload rejects an unsupported file extension (422 via multer fileFilter)', async () => {
    const res = await request(app)
      .post('/api/v1/settings/fact-sources/upload')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .field('name', 'x')
      .field('source_type', 'document')
      .attach('file', Buffer.from('fake exe'), { filename: 'virus.exe', contentType: 'application/octet-stream' });

    expect(res.status).toBe(422);
  });

  test('PUT updates metadata only (name/priority/active/tags)', async () => {
    const created = await request(app)
      .post('/api/v1/settings/fact-sources')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'Original', sourceType: 'reference_text', referenceText: 'x' });

    const res = await request(app)
      .put(`/api/v1/settings/fact-sources/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'Renamed', active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
    expect(res.body.data.active).toBe(false);
  });

  test('PUT on a nonexistent id is a 404', async () => {
    const res = await request(app)
      .put('/api/v1/settings/fact-sources/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('DELETE removes a source', async () => {
    const created = await request(app)
      .post('/api/v1/settings/fact-sources')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'Temp', sourceType: 'reference_text', referenceText: 'x' });

    const res = await request(app)
      .delete(`/api/v1/settings/fact-sources/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(204);

    const listRes = await request(app).get('/api/v1/settings/fact-sources').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(listRes.body.data.sources).toHaveLength(0);
  });

  test('PUT /settings/fact-verification-policy persists a valid policy', async () => {
    const res = await request(app)
      .put('/api/v1/settings/fact-verification-policy')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ policy: 'compare_all' });
    expect(res.status).toBe(200);
    expect(res.body.data.policy).toBe('compare_all');

    const listRes = await request(app).get('/api/v1/settings/fact-sources').set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(listRes.body.data.policy).toBe('compare_all');
  });

  test('PUT /settings/fact-verification-policy rejects an invalid value (422)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/fact-verification-policy')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ policy: 'whatever' });
    expect(res.status).toBe(422);
  });
});
