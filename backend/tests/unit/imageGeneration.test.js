// backend/tests/unit/imageGeneration.test.js
'use strict';

/**
 * P6-A tests: services/imageGeneration.js — the org-configured global image
 * default (crop-to-fill via sharp) applied to every generated image. Real
 * `sharp` is used throughout (it's a pure image-processing library, not an
 * external call) so dimension assertions are against real, decoded output —
 * never mocked pixels. The AI provider and storage layer are mocked (real
 * network calls and real disk/S3 writes are out of scope for a unit test).
 */

const sharp = require('sharp');

jest.mock('../../src/models', () => ({
  ScripturaSettings: { getValue: jest.fn() },
}));

jest.mock('../../src/services/ai', () => ({
  getImageProvider: jest.fn(),
}));

jest.mock('../../src/services/storage', () => ({
  saveImage: jest.fn(),
}));

const { ScripturaSettings } = require('../../src/models');
const { getImageProvider } = require('../../src/services/ai');
const { saveImage } = require('../../src/services/storage');
const {
  generateBlogImage,
  resizeToConfiguredDefault,
  providerCanvasForTarget,
  STYLE_DIRECTIVES,
  DEFAULT_SIZE,
} = require('../../src/services/imageGeneration');

/** A real, decodable 400x300 red PNG — not a stub buffer, so sharp's real decode/resize path is exercised. */
async function makeFixtureImage(width = 400, height = 300) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();
}

describe('resizeToConfiguredDefault — real sharp blur fill, never a crop', () => {
  test('crops a real image to the exact configured width/height', async () => {
    const fixture = await makeFixtureImage(400, 300);
    const resized = await resizeToConfiguredDefault(fixture, { width: 200, height: 100 });
    const meta = await sharp(resized).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });

  test('a mismatched aspect still yields exactly the configured size', async () => {
    const fixture = await makeFixtureImage(1024, 1024);
    const resized = await resizeToConfiguredDefault(fixture, { width: 1200, height: 630 });
    const meta = await sharp(resized).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });

  test('keeps the top and bottom edges of a 3:2 image when filling to 16:9 — nothing is cropped', async () => {
    // 300x200 red image with a green top band and a blue bottom band.
    const band = (r, g, b) => sharp({ create: { width: 300, height: 12, channels: 3, background: { r, g, b } } }).png().toBuffer();
    const fixture = await sharp(await makeFixtureImage(300, 200))
      .composite([
        { input: await band(0, 200, 0), left: 0, top: 0 },
        { input: await band(0, 0, 200), left: 0, top: 188 },
      ])
      .png()
      .toBuffer();

    const resized = await resizeToConfiguredDefault(fixture, { width: 640, height: 360 });
    const { data, info } = await sharp(resized).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => Array.from(data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));

    expect([info.width, info.height]).toEqual([640, 360]);
    const [, topG] = pixel(320, 3);
    const [, , bottomB] = pixel(320, 356);
    expect(topG).toBeGreaterThan(150); // green band survived at the very top
    expect(bottomB).toBeGreaterThan(150); // blue band survived at the very bottom
  });

  test('side strips continue the edge colour, undarkened — centre content is not pulled into the margins', async () => {
    // 300x200 red image with a bright blue block in the middle.
    const block = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .png()
      .toBuffer();
    const fixture = await sharp(await makeFixtureImage(300, 200))
      .composite([{ input: block, left: 100, top: 50 }])
      .png()
      .toBuffer();

    const resized = await resizeToConfiguredDefault(fixture, { width: 640, height: 360 });
    const { data, info } = await sharp(resized).raw().toBuffer({ resolveWithObject: true });
    const offset = (180 * info.width + 8) * info.channels; // inside the left strip, vertically centred

    expect(data[offset]).toBeGreaterThan(180); // red edge colour at full brightness (fixture r=200)
    expect(data[offset + 2]).toBeLessThan(60); // no blue from the centre block
  });

  test('invalid/missing target dimensions -> returns the original buffer unchanged, never throws', async () => {
    const fixture = await makeFixtureImage(400, 300);
    expect(await resizeToConfiguredDefault(fixture, {})).toBe(fixture);
    expect(await resizeToConfiguredDefault(fixture, { width: 'not-a-number', height: 100 })).toBe(fixture);
    expect(await resizeToConfiguredDefault(fixture, null)).toBe(fixture);
  });
});

describe('generateBlogImage — the configured global default reaches every generated image', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getImageProvider.mockReturnValue({
      generateImage: jest.fn(async () => ({
        buffer: await makeFixtureImage(1024, 1024), // provider's raw (square) output
        mimeType: 'image/png',
      })),
    });
    saveImage.mockImplementation(async (buffer) => ({
      relativePath: 'uploads/test.png',
      publicUrl: '/uploads/test.png',
      bytes: buffer.length,
    }));
  });

  /**
   * `ScripturaSettings.getValue` is also called by `buildImagePrompt` for a
   * DIFFERENT key (`agents.image.style_overrides`) on every image — a
   * blanket `mockResolvedValue` would return the image-defaults fixture for
   * that lookup too. Branching on `key` keeps each call getting its own
   * real fallback, matching production behavior exactly.
   */
  function mockSettingsFor(imageDefaults) {
    ScripturaSettings.getValue.mockImplementation(async (key, { fallback } = {}) =>
      key === 'content.image_defaults' ? imageDefaults : fallback
    );
  }

  test('with an org-configured default, the STORED image is cropped to exactly that size', async () => {
    mockSettingsFor({ width: 1200, height: 630, lockAspectRatio: true });

    const [image] = await generateBlogImage({ topic: 'Saturn transit', style: 'photo' });

    expect(image.width).toBe(1200);
    expect(image.height).toBe(630);
    expect(ScripturaSettings.getValue).toHaveBeenCalledWith(
      'content.image_defaults',
      expect.objectContaining({ fallback: expect.objectContaining({ width: 1024, height: 1024 }) })
    );
  });

  test('with nothing configured, the fallback (the real current 1024x1024 behavior) is used — never a fabricated 1200x630', async () => {
    // Simulates getValue's real "no row exists yet" behavior: it returns its own `fallback` arg verbatim.
    ScripturaSettings.getValue.mockImplementation(async (key, { fallback } = {}) => fallback);

    const [image] = await generateBlogImage({ topic: 'Saturn transit', style: 'photo' });

    expect(image.width).toBe(1024);
    expect(image.height).toBe(1024);
  });

  test('a multi-image run applies the SAME configured default to every image', async () => {
    mockSettingsFor({ width: 800, height: 450, lockAspectRatio: true });

    const images = await generateBlogImage({ topic: 'Saturn transit', style: 'photo', count: 2 });

    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.width).toBe(800);
      expect(image.height).toBe(450);
    }
  });

  test('DEFAULT_SIZE (the provider size hint) is untouched by this change — still 1024x1024', () => {
    expect(DEFAULT_SIZE).toBe('1024x1024');
  });

  test('a 1920x1080 target requests the 1536x1024 canvas and stores exactly 1920x1080', async () => {
    mockSettingsFor({ width: 1920, height: 1080, lockAspectRatio: true });

    const [image] = await generateBlogImage({ topic: 'Saturn transit', style: 'photo' });
    const call = getImageProvider.mock.results[0].value.generateImage.mock.calls[0][0];

    expect(call.size).toBe('1536x1024');
    expect(image.width).toBe(1920);
    expect(image.height).toBe(1080);
  });

  test('with no style given, the prompt uses the illustration directive and the hopeful-mood rules', async () => {
    mockSettingsFor({ width: 1920, height: 1080, lockAspectRatio: true });

    await generateBlogImage({ topic: 'Shani Sade Sati' });
    const call = getImageProvider.mock.results[0].value.generateImage.mock.calls[0][0];

    expect(call.prompt).toContain(STYLE_DIRECTIVES.illustration);
    expect(call.prompt).not.toContain(STYLE_DIRECTIVES.photo);
    expect(call.prompt).toMatch(/never sad, worried, crying or distressed/);
    expect(call.prompt).toMatch(/Prefer symbolic imagery over portraits/);
  });

  test('the mood rules are appended for an explicitly chosen style too (photo)', async () => {
    mockSettingsFor({ width: 1920, height: 1080, lockAspectRatio: true });

    await generateBlogImage({ topic: 'Shani Sade Sati', style: 'photo' });
    const call = getImageProvider.mock.results[0].value.generateImage.mock.calls[0][0];

    expect(call.prompt).toContain(STYLE_DIRECTIVES.photo);
    expect(call.prompt).toMatch(/never sad, worried, crying or distressed/);
  });

  test('a square target keeps the square canvas', async () => {
    mockSettingsFor({ width: 1024, height: 1024, lockAspectRatio: true });

    await generateBlogImage({ topic: 'Saturn transit', style: 'photo' });
    const call = getImageProvider.mock.results[0].value.generateImage.mock.calls[0][0];

    expect(call.size).toBe('1024x1024');
  });

  test('an explicit size from the caller still wins over the derived canvas', async () => {
    mockSettingsFor({ width: 1920, height: 1080, lockAspectRatio: true });

    await generateBlogImage({ topic: 'Saturn transit', style: 'photo', size: '1024x1024' });
    const call = getImageProvider.mock.results[0].value.generateImage.mock.calls[0][0];

    expect(call.size).toBe('1024x1024');
  });
});

describe('providerCanvasForTarget — the closest canvas keeps the filled strips narrow', () => {
  test('picks the closest provider canvas for each configured aspect', () => {
    expect(providerCanvasForTarget({ width: 1920, height: 1080 }).size).toBe('1536x1024');
    expect(providerCanvasForTarget({ width: 1200, height: 630 }).size).toBe('1536x1024');
    expect(providerCanvasForTarget({ width: 1080, height: 1920 }).size).toBe('1024x1536');
    expect(providerCanvasForTarget({ width: 1024, height: 1024 }).size).toBe('1024x1024');
    expect(providerCanvasForTarget(null).size).toBe('1024x1024');
  });
});
