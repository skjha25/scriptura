// backend/tests/unit/clusterGenerationSettings.test.js
'use strict';

/**
 * Regression coverage for the per-cluster autopilot generation settings
 * (language, image_count) added to KeywordCluster — both nullable, both
 * falling back to the app-wide default when absent so every pre-existing
 * cluster keeps generating exactly as before these columns existed.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const KeywordCluster = require('../../src/models/keywordCluster')(sqlite);
  return { KeywordCluster, sequelize: sqlite, Sequelize };
});

const { KeywordCluster, sequelize } = require('../../src/models');
const { createClusterBody, updateClusterBody } = require('../../src/validators/cluster.validators');

async function makeCluster(overrides = {}) {
  return KeywordCluster.create({
    name: 'Test cluster',
    head_keyword: 'mercury retrograde',
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await KeywordCluster.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('KeywordCluster.language / image_count model validation', () => {
  it('defaults both to null (falls back to app default), matching pre-existing clusters', async () => {
    const cluster = await makeCluster();
    expect(cluster.language).toBeNull();
    expect(cluster.image_count).toBeNull();
  });

  it('accepts a supported language and a valid image_count', async () => {
    const cluster = await makeCluster({ language: 'gu', image_count: 3 });
    expect(cluster.language).toBe('gu');
    expect(cluster.image_count).toBe(3);
  });

  it('rejects an unsupported language', async () => {
    await expect(makeCluster({ language: 'xx' })).rejects.toThrow(/language must be one of/);
  });

  it('rejects an image_count outside the app-wide bounds', async () => {
    await expect(makeCluster({ image_count: 99 })).rejects.toThrow(/image_count must be at most/);
  });
});

describe('cluster.validators language/image_count schemas', () => {
  it('createClusterBody accepts a supported language and image_count', () => {
    const result = createClusterBody.parse({
      name: 'Test',
      head_keyword: 'mercury retrograde',
      language: 'hi',
      image_count: 2,
    });
    expect(result.language).toBe('hi');
    expect(result.image_count).toBe(2);
  });

  it('createClusterBody rejects an unsupported language', () => {
    expect(() =>
      createClusterBody.parse({ name: 'Test', head_keyword: 'x', language: 'xx' })
    ).toThrow();
  });

  it('updateClusterBody accepts a null language/image_count to reset to the app default', () => {
    const result = updateClusterBody.parse({ language: null, image_count: null });
    expect(result.language).toBeNull();
    expect(result.image_count).toBeNull();
  });
});
