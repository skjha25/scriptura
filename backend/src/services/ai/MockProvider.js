'use strict';

/**
 * Deterministic, offline provider. Used by the whole test suite and by any dev
 * environment without API keys.
 *
 * ---------------------------------------------------------------------------
 * WHY DETERMINISTIC RATHER THAN RANDOM
 * ---------------------------------------------------------------------------
 * A mock that returns random filler makes every assertion about generated
 * content either trivial ("length > 0") or flaky. Everything here is derived
 * from a SHA-256 of the inputs, so the same request always produces byte-identical
 * output and a test can assert an exact title, an exact block count, an exact
 * SEO score. Change the inputs and the output changes — which is also what lets
 * a test prove that, say, the keyword actually reaches the article.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONTENT IS REAL PROSE, NOT "lorem ipsum"
 * ---------------------------------------------------------------------------
 * Two reasons, both practical:
 *
 *   1. A keyless `npm run dev` has to be demonstrable. The wizard, the block
 *      editor, the live preview and the SEO panel all need content that looks
 *      like a Divinetalk article or the demo is useless.
 *   2. The SEO scorer is measuring real properties — keyword density, heading
 *      structure, word count bands. Filler text would score in a way that tells
 *      you nothing about whether the scorer works.
 *
 * The tone follows src/seeders/20260727130100-seed-blogs.js: measured, respectful
 * of the tradition, never promising outcomes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * No network, no API key, no retry policy. It cannot fail transiently, so
 * exercising the retry path is the real providers' unit tests' job, not this
 * one's.
 */

const crypto = require('crypto');

const { BaseProvider, normalizeBlocks } = require('./BaseProvider');
const prompts = require('./prompts');
const { BLOCK_TYPES, DEFAULT_SEO_STRUCTURE, POINTS_OF_VIEW } = require('../../constants');

// ---------------------------------------------------------------------------
// Deterministic selection
// ---------------------------------------------------------------------------

/**
 * Stable JSON stringify: object key order must not change the hash, or the
 * "same input, same output" promise breaks the moment a caller builds its
 * options object in a different order.
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * A deterministic byte stream seeded from the inputs.
 *
 * Re-hashes with a counter when the first 32 bytes run out, so a long article
 * never runs off the end of the seed and start reusing byte 0.
 */
class Picker {
  /**
   * @param {string} namespace Operation name, so two tasks with identical
   *   inputs (titles vs outline) do not make identical choices.
   * @param {*} input Any JSON-serialisable value.
   */
  constructor(namespace, input) {
    this.seed = `${namespace}:${stableStringify(input)}`;
    this.block = crypto.createHash('sha256').update(this.seed).digest();
    this.round = 0;
    this.offset = 0;
  }

  /** Next byte, 0..255. */
  byte() {
    if (this.offset >= this.block.length) {
      this.round += 1;
      this.block = crypto.createHash('sha256').update(`${this.seed}:${this.round}`).digest();
      this.offset = 0;
    }
    const value = this.block[this.offset];
    this.offset += 1;
    return value;
  }

  /** Integer in [0, max). */
  int(max) {
    if (max <= 0) return 0;
    // Two bytes so lists longer than 256 stay evenly distributed.
    return ((this.byte() << 8) | this.byte()) % max;
  }

  /** One element of `list`. */
  pick(list) {
    return list[this.int(list.length)];
  }

  /**
   * `count` distinct elements of `list`, in a deterministic order.
   * Falls back to repeating when `count` exceeds the list length.
   */
  sample(list, count) {
    const pool = [...list];
    const out = [];
    while (out.length < count) {
      if (pool.length === 0) {
        out.push(list[out.length % list.length]);
        continue;
      }
      out.push(pool.splice(this.int(pool.length), 1)[0]);
    }
    return out;
  }

  /** True with probability `percent`/100. */
  chance(percent) {
    return this.int(100) < percent;
  }
}

// ---------------------------------------------------------------------------
// Content pools. Written to read like the seeded production rows.
// ---------------------------------------------------------------------------

/** Title-case a phrase for use inside a heading or a title. */
function titleCase(text) {
  const minor = new Set(['a', 'an', 'and', 'the', 'or', 'of', 'in', 'on', 'for', 'to', 'vs', 'with']);
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && minor.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

/** Sentence-case a phrase for mid-sentence use. */
function lower(text) {
  return String(text || '').trim().toLowerCase();
}

/** Title templates. `{T}` is the title-cased topic, `{Y}` the current year. */
const TITLE_TEMPLATES = [
  '{T}: What It Actually Affects',
  '{T} Explained: A Practical Guide',
  '{T} in {Y}: Dates, Rituals and Cautions',
  'Understanding {T} Without the Fear',
  '{T}: 7 Things the Texts Actually Say',
  'A Beginner Walkthrough to {T}',
  '{T}: Myths That Need Retiring',
  'How to Work With {T} This Month',
  '{T} and Your Chart: Where to Start',
  'The Quiet Logic Behind {T}',
];

/** One short phrase describing each template's angle, in the same order. */
const TITLE_ANGLES = [
  'myth-busting',
  'explainer',
  'seasonal, date-led',
  'reassurance',
  'listicle',
  'beginner guide',
  'corrective',
  'practical how-to',
  'personalised reading',
  'analytical',
];

/** Section headings. `{T}` is the title-cased topic. */
const SECTION_HEADINGS = [
  'What {T} Actually Means',
  'Where the Tradition Is Clear',
  'Where the Classical Sources Stay Silent',
  'Reading {T} in Your Own Chart',
  'Timing: When It Carries the Most Weight',
  'Common Mistakes Worth Avoiding',
  'What to Do, and What to Leave Alone',
  'How Practitioners Actually Use This',
];

/** Level-3 subsections, used only when the h3 toggle is on. */
const SUBSECTION_HEADINGS = [
  'A worked example',
  'The exception nobody mentions',
  'What changes for a Moon-dominant chart',
  'If you only have a birth date',
];

/**
 * Lead paragraphs. `{k}` is the primary keyword in lower case, `{t}` the topic.
 * Each opens with an image or a stated tension, never with "in this article".
 */
const LEAD_TEMPLATES = [
  'Ask ten astrologers about {k} and you will get ten answers that agree on far more than they admit. The disagreement is almost always about emphasis, and emphasis is where the practical advice lives.',
  'There is a version of {k} that circulates in family WhatsApp groups, and there is the version the classical texts describe. They are not the same, and the gap matters to anyone planning around it.',
  'Most people meet {k} at a moment of uncertainty — a decision pending, a date to fix, a chart handed over by a relative with a warning attached. That is exactly when precision earns its keep.',
  '{T} arrives with a great deal of inherited certainty attached to it. Very little of that certainty survives a careful reading of what the tradition actually sets down.',
];

/** Body paragraphs. `{k}` keyword, `{t}` topic, `{s}` a secondary keyword. */
const BODY_TEMPLATES = [
  'The tradition treats {k} as a factor to weigh rather than a verdict to accept. That single distinction dissolves most of the anxiety attached to it, because a factor can be balanced against others and a verdict cannot.',
  'Practitioners who work with {t} daily tend to be far more cautious than the popular summaries suggest. They will name what the placement indicates, then immediately name the three conditions that would change the reading.',
  'The mechanics are less mysterious than the vocabulary makes them sound. Positions are calculated, relationships between them are graded, and the grading is compared against a body of recorded observation built up over centuries.',
  'Where {s} enters the picture, the reading shifts in degree rather than in kind. It is worth checking, and it is not worth reorganising a decision around on its own.',
  'A useful habit is to write down what you expect before you look. When the reading is checked against a prediction you committed to in advance, {k} becomes something you can actually calibrate rather than something you feel.',
  'Season matters more than most summaries allow. The same configuration read in the monsoon and read in late winter carries a different practical emphasis, because the life it is describing is differently paced.',
  'None of this replaces judgement. The chart describes terrain; it does not walk the path. A reading that leaves you with less agency than you started with has been done badly, whatever the technique.',
  'If you are working from an approximate birth time, treat the finer subdivisions as indicative only. Rectification is real work, and skipping it while quoting precise degrees is the most common error in amateur readings of {t}.',
];

/** Bullet-list items. */
const LIST_TEMPLATES = [
  'Check the birth time before you check anything else; everything downstream depends on it.',
  'Read the whole chart, not the one placement someone warned you about.',
  'Write down the question you actually want answered, in one sentence.',
  'Note which claims are traditional readings and which are a practitioner\'s own inference.',
  'Give any remedy a fixed trial period rather than an open-ended commitment.',
  'Keep a short log of what happened; a reading you cannot check teaches you nothing.',
];

/** Numbered, procedural steps. */
const STEP_TEMPLATES = [
  'Confirm your birth date, time and place, and note how confident you are in the time.',
  'Identify the placement or period the question concerns, and write down what you expect.',
  'Read the supporting and contradicting factors before drawing any conclusion.',
  'Decide what you would actually do differently, and set a date to review it.',
];

/** Key-takeaway lines. */
const TAKEAWAY_TEMPLATES = [
  '{T} is one factor among several, with well-documented conditions that modify it.',
  'Traditional readings describe tendencies and timing, never guaranteed outcomes.',
  'Precision about the birth data matters more than sophistication of technique.',
];

/** FAQ pairs. */
const FAQ_TEMPLATES = [
  {
    question: 'Is {k} always a bad sign?',
    answer:
      'No. The classical treatment lists several recognised conditions that soften or cancel it entirely, and a competent reading checks those before saying anything at all. Framed as a verdict, it is being overstated.',
  },
  {
    question: 'How much does the exact birth time matter?',
    answer:
      'A great deal for the finer subdivisions, and much less for the broad picture. If your recorded time is uncertain by more than about twenty minutes, treat degree-level claims as indicative and focus on the larger pattern.',
  },
  {
    question: 'Can I act on this without a consultation?',
    answer:
      'You can read and reflect on it freely. Where a real decision turns on it — a date, a commitment, a remedy worn continuously — a reading of the full chart is worth the hour it takes.',
  },
  {
    question: 'Do the different regional calendars change the answer?',
    answer:
      'They change the dates, not the underlying reading. North Indian Purnimanta and the Amanta reckoning used in Maharashtra, Gujarat and the South can differ by roughly a fortnight, so confirm which one your family follows.',
  },
  {
    question: 'What if two practitioners disagree?',
    answer:
      'Ask each of them which factors they weighted and why. Disagreement about weighting is normal and informative; disagreement about the calculated positions means one of them has the birth data wrong.',
  },
];

/** Table rows for the comparison table, when the tables toggle is on. */
const TABLE_ROWS = [
  ['Birth data quality', 'Degree-level claims', 'Rectify, or read broadly'],
  ['Supporting factors', 'Strength of the reading', 'Check at least three'],
  ['Timing period', 'When it surfaces', 'Note the review date'],
  ['Remedy chosen', 'What it is meant to shift', 'Fixed trial period'],
];

/** Quotes, when the quotes toggle is on. Attributed to a tradition, never invented people. */
const QUOTE_TEMPLATES = [
  {
    text: 'The chart shows the season. It does not sow the field.',
    attribution: 'Traditional teaching',
  },
  {
    text: 'What is indicated may be modified. What is assumed cannot be.',
    attribution: 'Classical reading',
  },
];

/** Brand-voice tone descriptors, for analyzeBrandVoice. */
const TONE_POOL = [
  'Warm, reverent, gently instructive',
  'Calm, evidence-aware, reassuring',
  'Measured, unhurried, respectful of difficulty',
  'Practical, cautionary, never salesy',
  'Balanced, non-dogmatic, plainly written',
];

/** Brand-voice traits, for analyzeBrandVoice. Concrete and checkable by design. */
const TRAIT_POOL = [
  'Opens with a concrete image rather than a summary of the article',
  'Glosses every Sanskrit term in plain English on first use',
  'Names the common fear, then right-sizes it instead of dismissing it',
  'States the contraindication alongside every recommendation',
  'Prefers short paragraphs with plenty of white space',
  'Closes with one practical next step the reader can take today',
  'Never promises a guaranteed outcome',
  'Uses the traditional name alongside the Western one',
];

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Fills `{T}` (title-cased topic), `{t}` (lower topic), `{k}` (keyword),
 * `{s}` (a secondary keyword) and `{Y}` (year).
 */
function fill(template, vars) {
  return String(template)
    .replace(/\{T\}/g, vars.T)
    .replace(/\{t\}/g, vars.t)
    .replace(/\{k\}/g, vars.k)
    .replace(/\{s\}/g, vars.s)
    .replace(/\{Y\}/g, vars.Y);
}

/**
 * Builds the substitution map from a caller's options.
 *
 * The year is taken from a fixed reference rather than `new Date()` on purpose:
 * a mock whose output changes on 1 January is not deterministic, and a snapshot
 * assertion written in December should not fail in January.
 */
const MOCK_REFERENCE_YEAR = 2026;

function varsFor({ topic, keyword, secondaryKeywords = [] }) {
  const t = lower(topic || keyword || 'vedic astrology');
  const k = lower(keyword || topic || 'vedic astrology');
  return {
    t,
    T: titleCase(t),
    k,
    s: lower(secondaryKeywords[0] || `${k} explained`),
    Y: String(MOCK_REFERENCE_YEAR),
  };
}

class MockProvider extends BaseProvider {
  /**
   * @param {object} [options]
   * @param {(ms: number) => Promise<void>} [options.sleep] Unused; accepted so
   *   the constructor signature matches the real providers.
   */
  constructor(options = {}) {
    super({ name: 'mock', ...options });
  }

  /**
   * Deterministic title candidates.
   *
   * Candidates are generated from every template and then ordered by distance
   * from 55 characters, so the first suggestion is always the one that scores
   * best on the length criterion in services/seoScore.js. That makes the mock
   * useful for demonstrating the SEO panel rather than merely populating it.
   *
   * @param {object} opts See prompts.titlesPrompt.
   * @returns {Promise<{titles: Array<{title: string, angle: string, char_count: number}>}>}
   */
  async generateTitles(opts = {}) {
    const { topic, keyword, secondaryKeywords, count = 5 } = opts;
    const vars = varsFor({ topic, keyword, secondaryKeywords });
    const picker = new Picker('titles', { topic, keyword, secondaryKeywords, count });

    const candidates = TITLE_TEMPLATES.map((template, index) => {
      const title = fill(template, vars);
      return {
        title,
        angle: TITLE_ANGLES[index],
        char_count: title.length,
        // Stable tiebreaker so equal-distance candidates never swap order.
        distance: Math.abs(title.length - 55),
        index,
      };
    }).sort((a, b) => a.distance - b.distance || a.index - b.index);

    // One deterministic byte of the seed rotates which near-optimal candidate
    // leads, so two different topics do not always surface the same template.
    const rotation = picker.int(Math.max(1, Math.min(3, candidates.length)));
    const ordered = [...candidates.slice(rotation), ...candidates.slice(0, rotation)];

    return {
      titles: ordered.slice(0, Math.max(1, Math.min(10, count))).map(({ title, angle, char_count }) => ({
        title,
        angle,
        char_count,
      })),
    };
  }

  /**
   * Deterministic brand-voice analysis.
   *
   * Returns the same `{ raw, parsed }` envelope as the real providers so
   * services/brandVoice.js runs its own parser in tests too — otherwise the
   * parser would only ever be exercised by its unit test and never in the
   * integration path.
   *
   * @param {{sample: string}} opts
   * @returns {Promise<{raw: string, parsed: object}>}
   */
  async analyzeBrandVoice({ sample } = {}) {
    const clamped = prompts.clamp(sample, prompts.BRAND_VOICE_SAMPLE_MAX_CHARS);
    const picker = new Picker('brandVoice', clamped);

    const parsed = {
      tone: picker.pick(TONE_POOL),
      pov: picker.pick(POINTS_OF_VIEW),
      traits: picker.sample(TRAIT_POOL, 4),
      summary:
        `Reads as an experienced editor writing for a reader who is interested but not ` +
        `initiated. Explains before it asserts, and never raises the stakes to hold attention.`,
    };

    // Fenced on purpose: the mock exercises the same fence-stripping path the
    // real providers occasionally need, so that code cannot rot untested.
    return { raw: ['```json', JSON.stringify(parsed), '```'].join('\n'), parsed };
  }

  /**
   * Deterministic outline.
   *
   * @param {object} opts See prompts.outlinePrompt.
   * @returns {Promise<{outline: Array<{level: number, text: string}>}>}
   */
  async generateOutline(opts = {}) {
    const { topic, keyword, secondaryKeywords, targetWordCount = 1200, seoStructure } = opts;
    const structure = { ...DEFAULT_SEO_STRUCTURE, ...(seoStructure || {}) };
    const vars = varsFor({ topic, keyword, secondaryKeywords });
    const picker = new Picker('outline', { topic, keyword, targetWordCount, structure });

    const sectionCount = Math.max(3, Math.min(SECTION_HEADINGS.length, Math.round(targetWordCount / 200)));
    const chosen = picker.sample(SECTION_HEADINGS, sectionCount);

    const outline = [];
    // Subsections are consumed in order rather than picked independently, so one
    // outline never repeats the same subsection heading twice.
    const subsections = picker.sample(SUBSECTION_HEADINGS, SUBSECTION_HEADINGS.length);
    let subsectionIndex = 0;

    for (const heading of chosen) {
      outline.push({ level: 2, text: fill(heading, vars) });
      // A subsection under roughly a third of the sections: enough to exercise
      // nested rendering, not enough to look padded.
      if (structure.h3 && subsectionIndex < subsections.length && picker.chance(35)) {
        outline.push({ level: 3, text: titleCase(subsections[subsectionIndex]) });
        subsectionIndex += 1;
      }
    }
    if (structure.faq) {
      outline.push({ level: 2, text: 'Frequently Asked Questions' });
    }

    return { outline };
  }

  /**
   * Deterministic article body.
   *
   * Every SEO structure toggle is honoured directly here rather than being left
   * to normalizeBlocks, because the mock is the one provider that can guarantee
   * it — and the E2E flow is only convincing if `tables: false` visibly produces
   * an article with no table.
   *
   * The keyword is placed in the lead, in one heading, in several body
   * paragraphs, in the takeaways and in the FAQ, landing keyword density inside
   * the 0.5–2.5% band services/seoScore.js rewards.
   *
   * @param {object} opts See prompts.articlePrompt.
   * @returns {Promise<{blocks: Array, meta_title: string, meta_description: string}>}
   */
  async generateArticle(opts = {}) {
    const {
      topic,
      title,
      keyword,
      secondaryKeywords = [],
      outline = [],
      targetWordCount = 1200,
      seoStructure,
      internalLinks = [],
    } = opts;

    const structure = { ...DEFAULT_SEO_STRUCTURE, ...(seoStructure || {}) };
    const vars = varsFor({ topic, keyword, secondaryKeywords });
    const picker = new Picker('article', {
      topic,
      title,
      keyword,
      secondaryKeywords,
      outline,
      targetWordCount,
      structure,
      internalLinks,
    });

    const blocks = [];

    // --- Lead ---------------------------------------------------------------
    blocks.push({
      type: 'paragraph',
      data: { is_lead: true, text: fill(picker.pick(LEAD_TEMPLATES), vars) },
    });

    // --- Sections -----------------------------------------------------------
    // Reuse the caller's approved outline when there is one; that is the whole
    // point of the two-step wizard, and the mock must respect it or the
    // integration test proves nothing about outline handoff.
    const sections = outline.length
      ? outline.filter((s) => s && typeof s.text === 'string')
      : (await this.generateOutline(opts)).outline;

    const prose = picker.sample(BODY_TEMPLATES, BODY_TEMPLATES.length);
    let proseIndex = 0;
    const nextParagraph = () => {
      const template = prose[proseIndex % prose.length];
      proseIndex += 1;
      return fill(template, vars);
    };

    let listPlaced = false;
    let tablePlaced = false;
    let quotePlaced = false;
    let linkPlaced = 0;

    for (const section of sections) {
      const isFaqSection = /frequently asked questions/i.test(section.text);
      if (isFaqSection) continue; // handled after the loop, so it stays last.

      if (structure.h2 || structure.h3) {
        blocks.push({
          type: 'heading',
          data: { level: structure.h3 === false ? 2 : section.level || 2, text: section.text },
        });
      }

      blocks.push({ type: 'paragraph', data: { text: nextParagraph() } });

      // An internal link, rendered as inline html so the renderer's link
      // handling and the SEO scorer's link criterion both have something real.
      if (linkPlaced < internalLinks.length) {
        const target = internalLinks[linkPlaced];
        linkPlaced += 1;
        blocks.push({
          type: 'paragraph',
          data: {
            html:
              `We covered the groundwork for this in ` +
              `<a href="/blog/${target.slug}">${target.title}</a>, which is worth reading first ` +
              `if ${vars.k} is new to you.`,
          },
        });
      } else {
        blocks.push({ type: 'paragraph', data: { text: nextParagraph() } });
      }

      if (structure.lists && !listPlaced) {
        listPlaced = true;
        blocks.push({
          type: 'list',
          data: { style: 'bullet', items: picker.sample(LIST_TEMPLATES, 4) },
        });
      } else if (structure.lists && !tablePlaced && structure.tables) {
        tablePlaced = true;
        blocks.push({
          type: 'table',
          data: {
            caption: `Where the weight falls for ${vars.k}`,
            headers: ['Factor', 'What it affects', 'Practical response'],
            rows: TABLE_ROWS,
          },
        });
      } else if (structure.quotes && !quotePlaced) {
        quotePlaced = true;
        blocks.push({ type: 'quote', data: picker.pick(QUOTE_TEMPLATES) });
      }
    }

    // A numbered procedure, so both list styles appear in a demo article.
    if (structure.lists) {
      blocks.push({
        type: 'heading',
        data: { level: 2, text: `A Simple Way to Approach ${vars.T}` },
      });
      blocks.push({
        type: 'list',
        data: { style: 'numbered', items: STEP_TEMPLATES },
      });
    }

    // --- Takeaways ----------------------------------------------------------
    if (structure.key_takeaways) {
      blocks.push({
        type: 'key_takeaway',
        data: {
          title: 'Key takeaways',
          items: TAKEAWAY_TEMPLATES.map((line) => fill(line, vars)),
        },
      });
    }

    // --- FAQ ----------------------------------------------------------------
    if (structure.faq) {
      blocks.push({ type: 'heading', data: { level: 2, text: 'Frequently Asked Questions' } });
      blocks.push({
        type: 'faq_accordion',
        data: {
          items: picker.sample(FAQ_TEMPLATES, 4).map((item) => ({
            question: fill(item.question, vars),
            answer: fill(item.answer, vars),
          })),
        },
      });
    }

    // --- CTA ----------------------------------------------------------------
    blocks.push({
      type: 'cta_button',
      data: { text: 'Talk to a DivineTalk astrologer', url: 'https://divinetalk.com/consult' },
    });

    const metaTitle = (title || fill(TITLE_TEMPLATES[0], vars)).slice(0, 60);

    return {
      blocks: normalizeBlocks(blocks, {
        seoStructure: structure,
        provider: this.name,
        allowedTypes: BLOCK_TYPES,
      }),
      meta_title: metaTitle,
      meta_description:
        `A plain-English guide to ${vars.k}: what the tradition actually says, where it ` +
        `stays silent, and how to read it in your own chart without overstating it.`.slice(0, 160),
    };
  }

  /**
   * Synthesises a small, valid PNG.
   *
   * A real PNG rather than a fake buffer because the storage layer runs it
   * through sharp for resizing and logo compositing — a placeholder that is not
   * decodable would fail there instead of here, which is a much worse place to
   * discover it.
   *
   * The colour is derived from the prompt, so two different prompts produce
   * visibly different placeholders and a demo gallery does not look broken.
   *
   * @param {{prompt: string, size?: string, style?: string}} opts
   * @returns {Promise<{buffer: Buffer, mimeType: string}>}
   */
  async generateImage({ prompt = 'divinetalk placeholder', size = '1536x1024', style = 'photo' } = {}) {
    const picker = new Picker('image', { prompt, size, style });

    // Deliberately tiny: the tests generate these repeatedly and nothing about
    // the pipeline depends on the placeholder's resolution.
    const [width, height] = (() => {
      const match = /^(\d+)x(\d+)$/.exec(String(size));
      if (!match) return [128, 72];
      const ratio = Number(match[1]) / Number(match[2]);
      return [128, Math.max(16, Math.round(128 / ratio))];
    })();

    // Kept in the devotional palette rather than fully random, so a placeholder
    // still looks like it belongs on a Divinetalk page.
    const palette = [
      { r: 200, g: 120, b: 40 }, // saffron
      { r: 60, g: 50, b: 120 }, // indigo
      { r: 180, g: 150, b: 60 }, // warm gold
      { r: 70, g: 100, b: 90 }, // temple green
    ];
    const base = picker.pick(palette);

    // Required lazily: sharp is a native module and only the mock's image path
    // needs it, so a text-only run never pays its load cost.
    const sharp = require('sharp');
    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { ...base, alpha: 1 },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return { buffer, mimeType: 'image/png' };
  }
}

module.exports = {
  MockProvider,
  Picker,
  stableStringify,
  titleCase,
  fill,
  varsFor,
  MOCK_REFERENCE_YEAR,
  TITLE_TEMPLATES,
  SECTION_HEADINGS,
  TONE_POOL,
  TRAIT_POOL,
};
