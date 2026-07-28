// frontend/src/components/wizard/titleScore.js
/**
 * Client-side mirror of the backend's title scorer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DUPLICATE EXISTS
 * ---------------------------------------------------------------------------
 * The spec requires the chosen title to re-score live as the author types. The
 * only endpoint that scores a title is POST /generate/title, and that endpoint
 * *invents* titles: it is a paid provider call, it is rate-limited, and it cannot
 * score a string the caller already has. Calling it on a debounced keystroke
 * would burn the generation budget and return somebody else's titles.
 *
 * So the scoring is done here. That is defensible only because
 * backend/src/services/seoScore.js `scoreTitle` is deliberately a pure function
 * of its arguments — no AI, no network, no I/O — precisely so the score is
 * reproducible and explainable. Reproducing a pure heuristic is a copy; it is
 * not a second, disagreeing implementation of a judgement call.
 *
 * The same trade-off is already made in src/lib/constants.js, and it carries the
 * same risk: this file and the backend can drift. Two things contain that:
 *   - the weights, bands and vocabulary below are copied verbatim, in the same
 *     order the backend pushes them, so a diff is a readable diff;
 *   - src/components/wizard/__tests__/titleScore.test.js pins the exported
 *     weights and several whole-title scores, so a one-sided change fails a test.
 *
 * The honest fix is a cheap, un-rate-limited `POST /generate/score-title` on the
 * backend, at which point this file should be deleted and the call swapped in.
 * That is a backend change, and this workstream does not own the backend.
 *
 * Scores shown for AI-suggested titles come from the server (`suggestion.seo`)
 * and are NOT recomputed here — the picker shows what the server said.
 */

/** Title weights. Mirrors TITLE_WEIGHTS in backend/src/services/seoScore.js. */
export const TITLE_WEIGHTS = Object.freeze({
  KEYWORD_PRESENCE: 25,
  LENGTH: 20,
  KEYWORD_POSITION: 15,
  POWER_WORD: 15,
  READABILITY: 15,
  NUMBER_OR_YEAR: 10,
});

/** Title character band. 50–60 is what Google renders before truncating. */
export const TITLE_LENGTH = Object.freeze({
  MIN: 50,
  MAX: 60,
  ACCEPTABLE_MIN: 40,
  ACCEPTABLE_MAX: 70,
});

/**
 * Power words, copied from the backend list.
 *
 * Curated for this brand: "guaranteed", "shocking" and "miracle" are absent on
 * purpose, because rewarding a word Divinetalk's style guide bans would make the
 * score actively harmful.
 */
export const POWER_WORDS = Object.freeze([
  'actually', 'avoid', 'beginner', 'best', 'complete', 'essential', 'explained',
  'guide', 'how', 'important', 'mistakes', 'myths', 'need', 'practical', 'proven',
  'real', 'right', 'simple', 'step', 'truth', 'ultimate', 'understand', 'why',
  'without', 'worth',
]);

/** Lower case, collapsed whitespace, trimmed. */
function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Counts whole-phrase occurrences, word-boundary anchored so "sun" does not
 * match inside "Sunday".
 *
 * The backend anchors the left edge with a lookbehind. This uses a leading
 * capture group instead, which is equivalent for counting here — the consumed
 * separator can never be needed by the following match, because two occurrences
 * of the same phrase are always separated by at least one non-word character.
 * The reason for the difference is browser support: Safari only shipped
 * lookbehind in 16.4 and Babel cannot transpile it, so the backend's regex would
 * throw at parse time on browsers this app still targets.
 */
function countPhrase(haystack, phrase) {
  if (!haystack || !phrase) return 0;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`,
    'giu'
  );
  return (haystack.match(pattern) || []).length;
}

/**
 * One breakdown row, in the exact shape the API returns.
 *
 * "Met" means full marks unless the caller overrides: a partial band is
 * informative but it is not a pass, and showing it as one would hide the fixable
 * thing.
 */
function row(criterion, max, ratio, detail, met) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const points = Math.round(max * clamped);
  return {
    criterion,
    points,
    max,
    met: met === undefined ? points === max : met,
    detail,
  };
}

/**
 * Scores a title 0–100 with a per-criterion breakdown.
 *
 * @param {string} title
 * @param {object} [options]
 * @param {string} [options.keyword] Primary target keyword.
 * @returns {{score: number, breakdown: Array<{criterion: string, points: number, max: number, met: boolean, detail: string}>}}
 */
export function scoreTitle(title, { keyword } = {}) {
  const raw = typeof title === 'string' ? title.trim() : '';
  const normalisedTitle = normalise(raw);
  const normalisedKeyword = normalise(keyword);
  const breakdown = [];

  // --- Keyword presence ----------------------------------------------------
  const exact = normalisedKeyword !== '' && countPhrase(normalisedTitle, normalisedKeyword) > 0;
  const keywordWords = normalisedKeyword.split(' ').filter(Boolean);
  const presentWords = keywordWords.filter((word) => countPhrase(normalisedTitle, word) > 0);
  const partialRatio = keywordWords.length ? presentWords.length / keywordWords.length : 0;

  if (normalisedKeyword === '') {
    breakdown.push(
      row(
        'KEYWORD_PRESENCE',
        TITLE_WEIGHTS.KEYWORD_PRESENCE,
        0,
        'No target keyword was set, so keyword placement cannot be scored. Set one on the blog to score this.',
        false
      )
    );
  } else if (exact) {
    breakdown.push(
      row(
        'KEYWORD_PRESENCE',
        TITLE_WEIGHTS.KEYWORD_PRESENCE,
        1,
        `Contains the exact keyword "${keyword}".`
      )
    );
  } else if (partialRatio > 0) {
    // 60% of the weight: all the right words in the wrong order still gives the
    // page a topical claim, but it will not match the phrase query.
    breakdown.push(
      row(
        'KEYWORD_PRESENCE',
        TITLE_WEIGHTS.KEYWORD_PRESENCE,
        0.6 * partialRatio,
        `Contains ${presentWords.length} of ${keywordWords.length} keyword words but not the exact phrase "${keyword}".`
      )
    );
  } else {
    breakdown.push(
      row(
        'KEYWORD_PRESENCE',
        TITLE_WEIGHTS.KEYWORD_PRESENCE,
        0,
        `Does not contain the keyword "${keyword}".`
      )
    );
  }

  // --- Keyword position ----------------------------------------------------
  if (exact) {
    const at = normalisedTitle.indexOf(normalisedKeyword);
    const position = normalisedTitle.length ? at / normalisedTitle.length : 1;
    // Four coarse bands rather than a continuous curve: the difference between
    // 12% and 15% through the title is noise, and a banded score is explainable.
    const ratio = position <= 0.1 ? 1 : position <= 0.3 ? 0.7 : position <= 0.5 ? 0.4 : 0.15;
    breakdown.push(
      row(
        'KEYWORD_POSITION',
        TITLE_WEIGHTS.KEYWORD_POSITION,
        ratio,
        `Keyword starts at character ${at} (${Math.round(position * 100)}% through the title). Earlier is better.`
      )
    );
  } else {
    breakdown.push(
      row(
        'KEYWORD_POSITION',
        TITLE_WEIGHTS.KEYWORD_POSITION,
        0,
        'The exact keyword is not present, so it has no position to score.',
        false
      )
    );
  }

  // --- Length --------------------------------------------------------------
  const length = raw.length;
  let lengthRatio;
  let lengthDetail;
  if (length >= TITLE_LENGTH.MIN && length <= TITLE_LENGTH.MAX) {
    lengthRatio = 1;
    lengthDetail = `${length} characters — inside the optimal ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} band.`;
  } else if (length >= TITLE_LENGTH.ACCEPTABLE_MIN && length <= TITLE_LENGTH.ACCEPTABLE_MAX) {
    lengthRatio = 0.7;
    lengthDetail =
      length < TITLE_LENGTH.MIN
        ? `${length} characters — a little short. Aim for ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX}.`
        : `${length} characters — Google will likely truncate. Aim for ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX}.`;
  } else if (length >= 30 && length <= 80) {
    lengthRatio = 0.4;
    lengthDetail = `${length} characters — well outside the ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} band.`;
  } else {
    lengthRatio = length === 0 ? 0 : 0.1;
    lengthDetail =
      length === 0
        ? 'The title is empty.'
        : `${length} characters — far outside the ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} band.`;
  }
  breakdown.push(row('LENGTH', TITLE_WEIGHTS.LENGTH, lengthRatio, lengthDetail));

  // --- Power words ---------------------------------------------------------
  const found = POWER_WORDS.filter((word) => countPhrase(normalisedTitle, word) > 0);
  let powerRatio;
  let powerDetail;
  if (found.length === 0) {
    powerRatio = 0;
    powerDetail =
      'No motivating word. Consider "practical", "explained", "mistakes", "why", "without".';
  } else if (found.length <= 2) {
    powerRatio = 1;
    powerDetail = `Uses ${found.length === 1 ? 'the power word' : 'power words'} ${found
      .map((w) => `"${w}"`)
      .join(', ')}.`;
  } else {
    // Three or more starts to read as copywriting rather than as an article
    // title, which is the failure mode this brand cares about.
    powerRatio = 0.6;
    powerDetail = `Uses ${found.length} power words (${found
      .map((w) => `"${w}"`)
      .join(', ')}) — one or two reads more credibly.`;
  }
  breakdown.push(row('POWER_WORD', TITLE_WEIGHTS.POWER_WORD, powerRatio, powerDetail));

  // --- Number or year ------------------------------------------------------
  const year = /\b(?:19|20)\d{2}\b/.exec(raw);
  const number = /\b\d+\b/.exec(raw);
  breakdown.push(
    row(
      'NUMBER_OR_YEAR',
      TITLE_WEIGHTS.NUMBER_OR_YEAR,
      year || number ? 1 : 0,
      year
        ? `Includes the year ${year[0]}, which helps for seasonal and dated topics.`
        : number
          ? `Includes the number ${number[0]}, which lifts click-through on list articles.`
          : 'No number or year. Optional, but both lift click-through where they fit the topic.'
    )
  );

  // --- Readability ---------------------------------------------------------
  // Four independent faults, each costing a quarter of the weight, so the detail
  // string can name exactly what to fix.
  const words = raw.split(/\s+/).filter(Boolean);
  const shouty = words.filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
  const colons = (raw.match(/:/g) || []).length;
  const bangs = (raw.match(/[!?]/g) || []).length;
  const lowerStart = words.length > 0 && /^[a-z]/.test(words[0]);

  const faults = [];
  if (shouty.length > 0) faults.push(`${shouty.length} ALL-CAPS word${shouty.length === 1 ? '' : 's'}`);
  if (colons > 1) faults.push(`${colons} colons`);
  if (bangs > 1) faults.push(`${bangs} exclamation or question marks`);
  if (lowerStart) faults.push('does not start with a capital');

  breakdown.push(
    // An empty title has no faults to find, which would otherwise earn it full
    // readability marks and a non-zero total for having no title at all.
    words.length === 0
      ? row('READABILITY', TITLE_WEIGHTS.READABILITY, 0, 'There is no title to assess.')
      : row(
          'READABILITY',
          TITLE_WEIGHTS.READABILITY,
          1 - faults.length * 0.25,
          faults.length === 0
            ? 'Clean title case, no shouting, no stacked punctuation.'
            : `Readability issues: ${faults.join('; ')}.`
        )
  );

  return {
    score: breakdown.reduce((sum, item) => sum + item.points, 0),
    breakdown,
  };
}

export default scoreTitle;
