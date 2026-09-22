// backend/tests/unit/contentSettingsApi.test.js
'use strict';

/**
 * P6-A tests: the real HTTP wiring for global content image defaults
 * (routes/v1/settings.routes.js -> controllers/settings.controller.js),
 * reusing the REAL, unmodified requireAuth middleware and REAL token
 * signing — only the models layer is mocked (in-memory SQLite), same
 * pattern as every other *Api.test.js file this session. `/settings` uses
 * `requireAuth` only (no `requireAdmin`) — matches the pre-existing
 * `/settings/autopilot` posture, so an editor-role user is expected to
 * succeed here, not be rejected.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const ScripturaSettings = require('../../src/models/scripturaSettings')(sqlite);
  const AutomatedTopic = require('../../src/models/automatedTopic')(sqlite);

  return {
    User,
    ScripturaSettings,
    AutomatedTopic,
    sequelize: sqlite,
    Sequelize,
  };
});

const { User, ScripturaSettings, sequelize } = require('../../src/models');

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await ScripturaSettings.destroy({ truncate: true });
  await User.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Global image defaults API (real HTTP + real auth)', () => {
  const request = require('supertest');
  const { signAccessToken } = require('../../src/services/tokens');
  let app;
  let editorUser;

  beforeAll(() => {
    const { createApp } = require('../../src/app');
    app = createApp();
  });

  beforeEach(async () => {
    editorUser = await User.create({ name: 'Editor', email: 'editor@test.local', password_hash: 'x', role: 'editor', is_active: true });
  });

  function tokenFor(user) {
    return signAccessToken({ id: user.id, email: user.email, role: user.role });
  }

  test('an unauthenticated request is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/settings/image-defaults');
    expect(res.status).toBe(401);
  });

  test('GET returns the real fallback (1024x1024) when nothing has been configured — never a fabricated 1200x630', async () => {
    const res = await request(app)
      .get('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ width: 1024, height: 1024, lockAspectRatio: true });
  });

  test('PUT persists a new default, and GET reflects it afterwards', async () => {
    const putRes = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 1200, height: 630, lockAspectRatio: true });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data).toMatchObject({ width: 1200, height: 630, lockAspectRatio: true });

    const getRes = await request(app)
      .get('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`);
    expect(getRes.body.data).toMatchObject({ width: 1200, height: 630, lockAspectRatio: true });
  });

  test('PUT is org-scoped — it is stored with no user_id, so it applies to every user, not just the one who saved it', async () => {
    await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 900, height: 500 });

    const row = await ScripturaSettings.findOne({ where: { setting_key: 'content.image_defaults' } });
    expect(row.scope).toBe('org');
    expect(row.user_id).toBeNull();

    const anotherUser = await User.create({ name: 'Admin', email: 'admin@test.local', password_hash: 'x', role: 'admin', is_active: true });
    const res = await request(app)
      .get('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(anotherUser)}`);
    expect(res.body.data).toMatchObject({ width: 900, height: 500 });
  });

  test('rejects a width below the minimum bound (422)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 10, height: 630 });
    expect(res.status).toBe(422);
  });

  test('rejects a height above the maximum bound (422)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 1200, height: 5000 });
    expect(res.status).toBe(422);
  });

  test('rejects a non-integer dimension (422)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 1200.5, height: 630 });
    expect(res.status).toBe(422);
  });

  test('rejects an unknown extra field (strict schema, 422)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 1200, height: 630, unexpectedField: 'nope' });
    expect(res.status).toBe(422);
  });

  test('lockAspectRatio defaults to true when omitted', async () => {
    const res = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 1200, height: 630 });
    expect(res.body.data.lockAspectRatio).toBe(true);
  });

  test('lockAspectRatio:false is respected, not silently coerced to true', async () => {
    const res = await request(app)
      .put('/api/v1/settings/image-defaults')
      .set('Authorization', `Bearer ${tokenFor(editorUser)}`)
      .send({ width: 1200, height: 630, lockAspectRatio: false });
    expect(res.body.data.lockAspectRatio).toBe(false);
  });
});
