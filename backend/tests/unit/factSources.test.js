// backend/tests/unit/factSources.test.js
'use strict';

/**
 * P6-B tests: services/factSources.js — CRUD over the ScripturaSettings-backed
 * fact-source list. `./brandVoice` and `./storage` are mocked (no real
 * network fetch/file write); `../models` uses real in-memory SQLite so the
 * KV read/write semantics are exercised for real.
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
  const ScripturaSettings = require('../../src/models/scripturaSettings')(sqlite);
  return { ScripturaSettings, sequelize: sqlite, Sequelize };
});

const { extractFromUrl, extractFromFile } = require('../../src/services/brandVoice');
const { saveImage } = require('../../src/services/storage');
const { ScripturaSettings, sequelize } = require('../../src/models');
const factSources = require('../../src/services/factSources');

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  jest.clearAllMocks();
  await ScripturaSettings.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('listFactSources — real KV read, real fallback', () => {
  test('empty -> [] sources, default policy', async () => {
    const result = await factSources.listFactSources();
    expect(result).toEqual({ sources: [], policy: 'primary_only' });
  });
});

describe('addFactSource — website', () => {
  test('fetches via the EXISTING brandVoice.extractFromUrl, never a second scraper', async () => {
    extractFromUrl.mockResolvedValue({ sample: 'The festival is on 15 August.', finalUrl: 'https://example.com' });

    const created = await factSources.addFactSource({ name: 'Example Site', sourceType: 'website', url: 'https://example.com' });

    expect(extractFromUrl).toHaveBeenCalledWith('https://example.com');
    expect(created.contentStatus).toBe('full');
    expect(created.extractedText).toContain('15 August');
    expect(created.id).toBeTruthy();

    const { sources } = await factSources.listFactSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe(created.id);
  });

  test('a failed fetch -> a real error, not a silently-created "full" source', async () => {
    extractFromUrl.mockRejectedValue(new Error('Could not fetch'));
    await expect(factSources.addFactSource({ name: 'Bad Site', sourceType: 'website', url: 'https://bad.example' })).rejects.toThrow();
    expect((await factSources.listFactSources()).sources).toHaveLength(0);
  });

  test('missing url -> 400, never calls extractFromUrl', async () => {
    await expect(factSources.addFactSource({ name: 'x', sourceType: 'website' })).rejects.toMatchObject({ statusCode: 400 });
    expect(extractFromUrl).not.toHaveBeenCalled();
  });
});

describe('addFactSource — reference_text', () => {
  test('stores the pasted text directly, contentStatus "user_provided", no fetch at all', async () => {
    const created = await factSources.addFactSource({
      name: 'Manual note',
      sourceType: 'reference_text',
      referenceText: 'The festival is on 15 August this year.',
    });
    expect(created.contentStatus).toBe('user_provided');
    expect(created.extractedText).toBe('The festival is on 15 August this year.');
    expect(extractFromUrl).not.toHaveBeenCalled();
  });

  test('empty referenceText -> 400', async () => {
    await expect(factSources.addFactSource({ name: 'x', sourceType: 'reference_text', referenceText: '   ' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('addFactSource — document (.txt/.docx) vs pdf', () => {
  test('a .docx/.txt upload is extracted via the EXISTING brandVoice.extractFromFile and stored', async () => {
    saveImage.mockResolvedValue({ relativePath: 'uploads/doc.docx', publicUrl: '/uploads/doc.docx', bytes: 100 });
    extractFromFile.mockResolvedValue('Extracted document text — 15 August.');

    const created = await factSources.addFactSource({
      name: 'Hindu Calendar 2026',
      sourceType: 'document',
      file: { buffer: Buffer.from('fake docx bytes'), originalname: 'calendar.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    });

    expect(extractFromFile).toHaveBeenCalledWith(expect.any(Buffer), 'calendar.docx');
    expect(created.contentStatus).toBe('full');
    expect(created.extractedText).toContain('15 August');
    expect(created.filePath).toBe('uploads/doc.docx');
  });

  test('a .pdf upload is STORED but honestly marked unavailable — no fabricated extraction, extractFromFile never called for it', async () => {
    saveImage.mockResolvedValue({ relativePath: 'uploads/calendar.pdf', publicUrl: '/uploads/calendar.pdf', bytes: 500 });

    const created = await factSources.addFactSource({
      name: 'Hindu Calendar 2026 (PDF)',
      sourceType: 'pdf',
      file: { buffer: Buffer.from('%PDF-1.4 fake'), originalname: 'calendar.pdf', mimetype: 'application/pdf' },
    });

    expect(extractFromFile).not.toHaveBeenCalled();
    expect(created.contentStatus).toBe('unavailable');
    expect(created.extractedText).toBeNull();
    expect(created.filePath).toBe('uploads/calendar.pdf');
    expect(saveImage).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ ext: 'pdf' }));
  });

  test('no file provided -> 400, storage is never touched', async () => {
    await expect(factSources.addFactSource({ name: 'x', sourceType: 'document' })).rejects.toMatchObject({ statusCode: 400 });
    expect(saveImage).not.toHaveBeenCalled();
  });
});

describe('updateFactSource — metadata only, never re-fetches', () => {
  test('edits name/tags/priority/active without touching extractedText/contentStatus', async () => {
    extractFromUrl.mockResolvedValue({ sample: 'Original content.', finalUrl: 'https://example.com' });
    const created = await factSources.addFactSource({ name: 'Original', sourceType: 'website', url: 'https://example.com' });

    const updated = await factSources.updateFactSource(created.id, { name: 'Renamed', priority: 'primary', active: false, tags: ['festival'] });

    expect(updated.name).toBe('Renamed');
    expect(updated.priority).toBe('primary');
    expect(updated.active).toBe(false);
    expect(updated.tags).toEqual(['festival']);
    expect(updated.extractedText).toBe('Original content.'); // untouched
    expect(extractFromUrl).toHaveBeenCalledTimes(1); // never re-fetched on edit
  });

  test('a nonexistent id is a 404, not a crash', async () => {
    await expect(factSources.updateFactSource('does-not-exist', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('removeFactSource', () => {
  test('removes exactly the targeted source, leaves others untouched', async () => {
    extractFromUrl.mockResolvedValue({ sample: 'A', finalUrl: 'https://a.example' });
    const a = await factSources.addFactSource({ name: 'A', sourceType: 'website', url: 'https://a.example' });
    extractFromUrl.mockResolvedValue({ sample: 'B', finalUrl: 'https://b.example' });
    const b = await factSources.addFactSource({ name: 'B', sourceType: 'website', url: 'https://b.example' });

    await factSources.removeFactSource(a.id);

    const { sources } = await factSources.listFactSources();
    expect(sources.map((s) => s.id)).toEqual([b.id]);
  });

  test('a nonexistent id is a 404', async () => {
    await expect(factSources.removeFactSource('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('setPolicy', () => {
  test('persists a valid policy', async () => {
    await factSources.setPolicy('compare_all');
    expect((await factSources.listFactSources()).policy).toBe('compare_all');
  });

  test('rejects an invalid policy value', async () => {
    await expect(factSources.setPolicy('whatever_i_want')).rejects.toMatchObject({ statusCode: 400 });
  });
});
