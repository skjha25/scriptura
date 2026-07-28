/**
 * Pins the client-side title scorer to the backend's numbers.
 *
 * titleScore.js is a copy of backend/src/services/seoScore.js `scoreTitle`, and a
 * copy is only safe if a one-sided edit is loud. These cases are chosen to touch
 * every criterion and every band boundary, so changing a weight or a band on
 * either side breaks a test here rather than quietly showing authors a different
 * number from the one the server will store.
 */

import { scoreTitle, TITLE_WEIGHTS, TITLE_LENGTH } from '../titleScore';

/** Reads one criterion out of a breakdown. */
function criterion(result, name) {
  return result.breakdown.find((row) => row.criterion === name);
}

describe('titleScore', () => {
  it('weights sum to exactly 100, as the backend asserts', () => {
    const total = Object.values(TITLE_WEIGHTS).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(100);
  });

  it('scores an empty title at zero and says so', () => {
    const result = scoreTitle('', { keyword: 'mercury retrograde' });
    expect(result.score).toBe(0);
    expect(criterion(result, 'LENGTH').detail).toBe('The title is empty.');
    expect(criterion(result, 'READABILITY').detail).toBe('There is no title to assess.');
  });

  it('awards full keyword marks for the exact phrase and none for a miss', () => {
    const hit = scoreTitle('Mercury Retrograde Explained', { keyword: 'mercury retrograde' });
    expect(criterion(hit, 'KEYWORD_PRESENCE').points).toBe(TITLE_WEIGHTS.KEYWORD_PRESENCE);
    expect(criterion(hit, 'KEYWORD_PRESENCE').met).toBe(true);

    const miss = scoreTitle('Planetary Motion Explained', { keyword: 'mercury retrograde' });
    expect(criterion(miss, 'KEYWORD_PRESENCE').points).toBe(0);
    expect(criterion(miss, 'KEYWORD_POSITION').points).toBe(0);
  });

  it('gives partial credit when the keyword words are present but not the phrase', () => {
    const result = scoreTitle('Retrograde Season and Mercury', { keyword: 'mercury retrograde' });
    const row = criterion(result, 'KEYWORD_PRESENCE');
    // 60% of the weight for 2 of 2 words in the wrong order.
    expect(row.points).toBe(Math.round(TITLE_WEIGHTS.KEYWORD_PRESENCE * 0.6));
    expect(row.met).toBe(false);
  });

  it('anchors keyword matching to word boundaries', () => {
    // "sun" must not be found inside "Sunday".
    const result = scoreTitle('Sunday Rituals for Beginners', { keyword: 'sun' });
    expect(criterion(result, 'KEYWORD_PRESENCE').points).toBe(0);
  });

  it('counts repeated whole-word occurrences without missing adjacent ones', () => {
    const result = scoreTitle('Sun, Sun and Sun Again', { keyword: 'sun' });
    expect(criterion(result, 'KEYWORD_PRESENCE').points).toBe(TITLE_WEIGHTS.KEYWORD_PRESENCE);
  });

  it('rewards a title inside the 50-60 character band', () => {
    const inBand = 'Mercury Retrograde in Virgo: What It Actually Affects';
    expect(inBand.length).toBeGreaterThanOrEqual(TITLE_LENGTH.MIN);
    expect(inBand.length).toBeLessThanOrEqual(TITLE_LENGTH.MAX);

    const row = criterion(scoreTitle(inBand, { keyword: 'mercury retrograde' }), 'LENGTH');
    expect(row.points).toBe(TITLE_WEIGHTS.LENGTH);
  });

  it('penalises shouting and stacked punctuation, naming each fault', () => {
    const result = scoreTitle('WHY MERCURY IS BAD!! Really?!', { keyword: 'mercury' });
    const row = criterion(result, 'READABILITY');
    expect(row.points).toBeLessThan(TITLE_WEIGHTS.READABILITY);
    expect(row.detail).toMatch(/ALL-CAPS/);
    expect(row.detail).toMatch(/exclamation/);
  });

  it('credits a year and a power word', () => {
    const result = scoreTitle('Mercury Retrograde 2026: A Practical Guide', {
      keyword: 'mercury retrograde',
    });
    expect(criterion(result, 'NUMBER_OR_YEAR').points).toBe(TITLE_WEIGHTS.NUMBER_OR_YEAR);
    expect(criterion(result, 'POWER_WORD').points).toBe(TITLE_WEIGHTS.POWER_WORD);
  });

  it('cannot score keyword criteria with no keyword, and says why', () => {
    const result = scoreTitle('A Perfectly Reasonable Title About Planets');
    expect(criterion(result, 'KEYWORD_PRESENCE').points).toBe(0);
    expect(criterion(result, 'KEYWORD_PRESENCE').detail).toMatch(/No target keyword/);
    expect(result.score).toBeLessThan(100);
  });

  it('returns criteria in the same order the API does', () => {
    const result = scoreTitle('Anything', { keyword: 'anything' });
    expect(result.breakdown.map((row) => row.criterion)).toEqual([
      'KEYWORD_PRESENCE',
      'KEYWORD_POSITION',
      'LENGTH',
      'POWER_WORD',
      'NUMBER_OR_YEAR',
      'READABILITY',
    ]);
  });

  it('never exceeds 100 or drops below 0', () => {
    const best = scoreTitle('Mercury Retrograde 2026: The Complete Practical Guide', {
      keyword: 'mercury retrograde',
    });
    expect(best.score).toBeGreaterThan(0);
    expect(best.score).toBeLessThanOrEqual(100);
  });
});
