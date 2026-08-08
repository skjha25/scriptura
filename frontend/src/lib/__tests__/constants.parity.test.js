// frontend/src/lib/__tests__/constants.parity.test.js
/**
 * Frontend ↔ backend constants parity.
 *
 * WHY THIS TEST EXISTS
 * `src/lib/constants.js` duplicates `backend/src/constants/index.js`. That
 * duplication is deliberate — the wizard's dropdowns and the list filters need
 * these values during the first render, and blocking the whole UI on a network
 * round trip for a set that changes once a year would be a bad trade.
 *
 * But a silent divergence is nasty in a specific way: the UI would offer an
 * option the API rejects with a 422 that looks, to the user, like a bug in their
 * input rather than in ours. So the duplication is allowed and the drift is not.
 *
 * This imports the backend module directly (CommonJS, which Jest loads fine —
 * and it only ever runs under Jest, never in the webpack build, so CRA's
 * src-directory import restriction does not apply).
 */

import * as frontend from '../constants';

// eslint-disable-next-line import/no-extraneous-dependencies -- test-only reach into the backend
const backend = require('../../../../backend/src/constants');

describe('enum values match the backend exactly', () => {
  it('BLOG_STATUS', () => {
    expect(frontend.BLOG_STATUS).toEqual(backend.BLOG_STATUS);
  });

  it('BLOG_STATUS_LABELS', () => {
    // The backend keys these numerically and the frontend as object keys, which
    // JS stringifies identically — compare after normalising both.
    const normalise = (obj) =>
      Object.fromEntries(Object.entries(obj).map(([key, value]) => [String(key), value]));
    expect(normalise(frontend.BLOG_STATUS_LABELS)).toEqual(normalise(backend.BLOG_STATUS_LABELS));
  });

  it('GENERATION_STATUS', () => {
    expect(frontend.GENERATION_STATUS).toEqual(backend.GENERATION_STATUS);
  });

  it('GENERATION_IN_FLIGHT', () => {
    expect([...frontend.GENERATION_IN_FLIGHT].sort()).toEqual(
      [...backend.GENERATION_IN_FLIGHT].sort()
    );
  });

  it('ARTICLE_TYPES', () => {
    // Order matters: it is the order the wizard's dropdown presents.
    expect([...frontend.ARTICLE_TYPES]).toEqual([...backend.ARTICLE_TYPES]);
  });

  it('READABILITY_LEVELS', () => {
    expect([...frontend.READABILITY_LEVELS]).toEqual([...backend.READABILITY_LEVELS]);
  });

  it('BRAND_VOICE_SOURCE_TYPES', () => {
    expect([...frontend.BRAND_VOICE_SOURCE_TYPES]).toEqual([...backend.BRAND_VOICE_SOURCE_TYPES]);
  });

  it('IMAGE_STYLES', () => {
    expect([...frontend.IMAGE_STYLES]).toEqual([...backend.IMAGE_STYLES]);
  });

  it('LOGO_POSITIONS', () => {
    expect([...frontend.LOGO_POSITIONS]).toEqual([...backend.LOGO_POSITIONS]);
  });

  it('BLOCK_TYPES', () => {
    // Order matters here too: it drives the editor's insert menu.
    expect([...frontend.BLOCK_TYPES]).toEqual([...backend.BLOCK_TYPES]);
  });

  it('POINTS_OF_VIEW', () => {
    expect([...frontend.POINTS_OF_VIEW]).toEqual([...backend.POINTS_OF_VIEW]);
  });

  it('DEFAULT_SEO_STRUCTURE', () => {
    expect(frontend.DEFAULT_SEO_STRUCTURE).toEqual(backend.DEFAULT_SEO_STRUCTURE);
  });

  it('image count bounds', () => {
    expect(frontend.IMAGE_COUNT_MIN).toBe(backend.IMAGE_COUNT_MIN);
    expect(frontend.IMAGE_COUNT_MAX).toBe(backend.IMAGE_COUNT_MAX);
  });

  it('DEFAULT_PUBLISHED_BY', () => {
    // This string appears on every published row in the live table; a mismatch
    // would quietly split attribution across two spellings.
    expect(frontend.DEFAULT_PUBLISHED_BY).toBe(backend.DEFAULT_PUBLISHED_BY);
  });

  it('USER_ROLES', () => {
    expect(frontend.USER_ROLES).toEqual(backend.USER_ROLES);
  });

  it('OPTIMIZATION_PROFILES', () => {
    expect(frontend.OPTIMIZATION_PROFILES).toEqual(backend.OPTIMIZATION_PROFILES);
  });
});

describe('label maps cover every enum value', () => {
  // A missing label renders as `undefined` in a dropdown, which is the kind of
  // bug that ships because it only shows on the one option nobody clicks.
  const cases = [
    ['ARTICLE_TYPE_LABELS', frontend.ARTICLE_TYPES, frontend.ARTICLE_TYPE_LABELS],
    ['READABILITY_LABELS', frontend.READABILITY_LEVELS, frontend.READABILITY_LABELS],
    ['POV_LABELS', frontend.POINTS_OF_VIEW, frontend.POV_LABELS],
    ['IMAGE_STYLE_LABELS', frontend.IMAGE_STYLES, frontend.IMAGE_STYLE_LABELS],
    ['LOGO_POSITION_LABELS', frontend.LOGO_POSITIONS, frontend.LOGO_POSITION_LABELS],
  ];

  it.each(cases)('%s has an entry for every value', (name, values, labels) => {
    const missing = values.filter((value) => !labels[value]);
    expect(missing).toEqual([]);
  });

  it('BLOCK_TYPE_META covers every block type', () => {
    const missing = frontend.BLOCK_TYPES.filter((type) => !frontend.BLOCK_TYPE_META[type]);
    expect(missing).toEqual([]);
  });

  it('BLOG_STATUS_META covers every status', () => {
    const missing = Object.values(frontend.BLOG_STATUS).filter(
      (status) => !frontend.BLOG_STATUS_META[status]
    );
    expect(missing).toEqual([]);
  });

  it('GENERATION_STATUS_META covers every generation status', () => {
    const missing = Object.values(frontend.GENERATION_STATUS).filter(
      (status) => !frontend.GENERATION_STATUS_META[status]
    );
    expect(missing).toEqual([]);
  });

  it('OPTIMIZATION_PROFILE_META covers every profile, and ORDER contains exactly them', () => {
    const profiles = Object.values(frontend.OPTIMIZATION_PROFILES);
    const missingMeta = profiles.filter((p) => !frontend.OPTIMIZATION_PROFILE_META[p]);
    expect(missingMeta).toEqual([]);
    expect([...frontend.OPTIMIZATION_PROFILE_ORDER].sort()).toEqual([...profiles].sort());
  });

  it('AEO_CRITERION_LABELS covers every backend AEO_WEIGHTS key', () => {
    // eslint-disable-next-line import/no-extraneous-dependencies -- test-only reach into the backend
    const { AEO_WEIGHTS } = require('../../../../backend/src/services/aeoScore');
    const missing = Object.keys(AEO_WEIGHTS).filter((key) => !frontend.AEO_CRITERION_LABELS[key]);
    expect(missing).toEqual([]);
  });

  it('GEO_CRITERION_LABELS covers every backend GEO_WEIGHTS key', () => {
    // eslint-disable-next-line import/no-extraneous-dependencies -- test-only reach into the backend
    const { GEO_WEIGHTS } = require('../../../../backend/src/services/geoScore');
    const missing = Object.keys(GEO_WEIGHTS).filter((key) => !frontend.GEO_CRITERION_LABELS[key]);
    expect(missing).toEqual([]);
  });
});

describe('chart palette', () => {
  it('provides exactly the eight validated categorical slots', () => {
    // The set was validated as a whole against the panel surface for CVD
    // separation and contrast. Adding a ninth hue invalidates that result, so the
    // count is pinned — a ninth category must fold into "Other" instead.
    expect(frontend.SERIES_COLORS).toHaveLength(8);
    expect(new Set(frontend.SERIES_COLORS).size).toBe(8);
    frontend.SERIES_COLORS.forEach((hex) => expect(hex).toMatch(/^#[0-9a-f]{6}$/i));
  });

  it('keeps status colours disjoint from series colours', () => {
    // A status colour doubling as a series colour would let a chart imply a
    // severity it does not mean.
    const series = new Set(frontend.SERIES_COLORS.map((hex) => hex.toLowerCase()));
    Object.values(frontend.STATUS_COLORS).forEach((hex) => {
      expect(series.has(hex.toLowerCase())).toBe(false);
    });
  });

  it('matches the surface the palette was validated against', () => {
    // Contrast results are only meaningful against the surface the chart actually
    // renders on; if this changes, the palette must be re-validated.
    expect(frontend.CHART_CHROME.surface).toBe('#141221');
  });
});

describe('humanizeEnum', () => {
  it('turns a snake_case value into a readable label', () => {
    expect(frontend.humanizeEnum('how_to')).toBe('How to');
    expect(frontend.humanizeEnum('product_review')).toBe('Product review');
  });

  it('handles empty and non-string input', () => {
    expect(frontend.humanizeEnum('')).toBe('');
    expect(frontend.humanizeEnum(null)).toBe('');
    expect(frontend.humanizeEnum(undefined)).toBe('');
  });
});
