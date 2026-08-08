'use strict';

/**
 * Regenerates shared/block-fixtures.json.
 *
 * The fixture file pins the exact HTML that `content_blocks` must render to. The
 * backend renderer (src/services/blocksToHtml.js) is canonical; the frontend's React
 * renderer (frontend/src/components/BlockRenderer.js) must produce a matching DOM.
 * Both test suites read this file, so it is the mechanism that keeps the editor
 * preview and the public blog page from drifting apart.
 *
 * Run this ONLY when you have deliberately changed the markup:
 *
 *     node scripts/generate-block-fixtures.js
 *
 * Then re-run both suites. If the frontend suite fails afterwards, the frontend
 * mirror still needs the same change — that failure is the point.
 */

const fs = require('fs');
const path = require('path');
const { blocksToHtml, countWords } = require('../src/services/blocksToHtml');

/**
 * Cases are chosen to cover every block type plus the edge cases that have
 * actually caused bugs: empty blocks, unknown types, XSS payloads, missing
 * fields, and non-array values where an array is expected.
 */
const cases = [
  {
    name: 'all_block_types',
    description: 'One of every supported block type, in insert-menu order.',
    blocks: [
      { id: 'b1', type: 'paragraph', data: { text: 'Shravana arrives with a shift in cosmic rhythm.', is_lead: true } },
      { id: 'b2', type: 'heading', data: { level: 2, text: 'The Essence of Shravana' } },
      { id: 'b3', type: 'paragraph', data: { html: 'This is <strong>devotion</strong> and <a href="https://divinetalk.com/shravana">renewal</a>.' } },
      { id: 'b4', type: 'heading', data: { level: 3, text: 'Rituals that matter' } },
      { id: 'b5', type: 'list', data: { style: 'bullet', items: ['Offer water to Shiva', 'Observe Monday fasts'] } },
      { id: 'b6', type: 'list', data: { style: 'numbered', items: ['Wake before sunrise', 'Bathe the lingam', 'Offer bel leaves'] } },
      { id: 'b7', type: 'image', data: { url: 'blogs/July2026/shravana.png', alt_text: 'A Shiva lingam during abhishekam', caption: 'Abhishekam at dawn' } },
      { id: 'b8', type: 'quote', data: { text: 'Devotion is the shortest path.', attribution: 'Sant Tukaram' } },
      { id: 'b9', type: 'table', data: { caption: 'Auspicious days', headers: ['Day', 'Ritual'], rows: [['Monday', 'Rudrabhishek'], ['Saturday', 'Deep daan']] } },
      { id: 'b10', type: 'faq_accordion', data: { items: [{ question: 'When does Shravana begin?', answer: 'It begins in late July and runs for a lunar month.' }, { question: 'Who should fast?', answer: 'Anyone in good health may observe Monday fasts.' }] } },
      { id: 'b11', type: 'key_takeaway', data: { title: 'Key takeaways', items: ['Shravana favours new beginnings', 'Mondays carry the strongest charge'] } },
      { id: 'b12', type: 'cta_button', data: { text: 'Talk to an astrologer', url: 'https://divinetalk.in/astrology' } },
      { id: 'b13', type: 'embed', data: { url: 'https://www.youtube.com/embed/abc123', title: 'Shravana aarti' } },
    ],
  },
  {
    name: 'empty_and_unknown_blocks_are_omitted',
    description:
      'Blocks with no content, and block types this renderer does not know, leave no trace in the output.',
    blocks: [
      { id: 'c1', type: 'paragraph', data: { text: 'Kept.' } },
      { id: 'c2', type: 'paragraph', data: { text: '' } },
      { id: 'c3', type: 'heading', data: { level: 2, text: '' } },
      { id: 'c4', type: 'list', data: { items: [] } },
      { id: 'c5', type: 'table', data: { headers: [], rows: [] } },
      { id: 'c6', type: 'faq_accordion', data: { items: [] } },
      { id: 'c7', type: 'image', data: { alt_text: 'no url given' } },
      { id: 'c8', type: 'cta_button', data: { text: 'No link' } },
      { id: 'c9', type: 'a_type_from_a_newer_frontend', data: { text: 'must not appear' } },
      { id: 'c10', type: 'paragraph', data: { text: 'Also kept.' } },
    ],
  },
  {
    name: 'xss_payloads_are_neutralised',
    description:
      'Script tags, event handlers, javascript: URLs and data: images must not survive rendering.',
    blocks: [
      { id: 'x1', type: 'paragraph', data: { html: '<script>alert(1)</script>Tail survives.' } },
      { id: 'x2', type: 'paragraph', data: { html: 'Click <a href="javascript:alert(2)">here</a>.' } },
      { id: 'x3', type: 'image', data: { url: 'javascript:alert(3)', alt_text: 'blocked' } },
      { id: 'x4', type: 'image', data: { url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt_text: 'blocked too' } },
      { id: 'x5', type: 'cta_button', data: { text: 'Bad', url: 'javascript:alert(4)' } },
      { id: 'x6', type: 'heading', data: { level: 2, text: '<img src=x onerror=alert(5)>' } },
      { id: 'x7', type: 'table', data: { headers: ['<script>h</script>'], rows: [['<img src=x onerror=alert(6)>']] } },
      { id: 'x8', type: 'embed', data: { url: 'http://insecure.example.com/frame', title: 'Downgraded to a link' } },
    ],
  },
  {
    name: 'heading_levels_are_clamped',
    description:
      'h1 is reserved for the page title and levels beyond h4 are not offered, so out-of-range levels clamp into 2..4.',
    blocks: [
      { id: 'h1', type: 'heading', data: { level: 1, text: 'Clamped up to h2' } },
      { id: 'h2', type: 'heading', data: { level: 2, text: 'Stays h2' } },
      { id: 'h3', type: 'heading', data: { level: 4, text: 'Stays h4' } },
      { id: 'h4', type: 'heading', data: { level: 6, text: 'Clamped down to h4' } },
      { id: 'h5', type: 'heading', data: { level: 'not a number', text: 'Defaults to h2' } },
    ],
  },
  {
    name: 'malformed_data_degrades_gracefully',
    description:
      'Wrong types where a shape is expected must not throw; the block is skipped or coerced.',
    blocks: [
      { id: 'm1', type: 'paragraph', data: { text: 'Before.' } },
      { id: 'm2', type: 'list', data: { items: 'not an array' } },
      { id: 'm3', type: 'table', data: { headers: 'nope', rows: 'nope' } },
      { id: 'm4', type: 'faq_accordion', data: { items: [null, { question: 'Only a question' }] } },
      { id: 'm5', type: 'list', data: { items: ['ok', null, undefined, '', '  ', 'also ok'] } },
      { id: 'm6', type: 'paragraph', data: {} },
      { id: 'm7', type: 'heading', data: null },
      { id: 'm8', type: 'paragraph', data: { text: 'After.' } },
    ],
  },
  {
    name: 'multiline_text_becomes_line_breaks',
    description: 'Explicit newlines in plain text survive as <br /> rather than collapsing.',
    blocks: [
      { id: 'n1', type: 'paragraph', data: { text: 'First line.\nSecond line.\nThird line.' } },
    ],
  },
  {
    name: 'unicode_content_round_trips',
    description:
      'The live table holds Devanagari and emoji; neither may be mangled or dropped.',
    blocks: [
      { id: 'u1', type: 'heading', data: { level: 2, text: 'श्रावण मास की महिमा' } },
      { id: 'u2', type: 'paragraph', data: { text: 'ॐ नमः शिवाय 🙏 — chanted at dawn.' } },
      { id: 'u3', type: 'list', data: { items: ['सोमवार व्रत', 'रुद्राभिषेक'] } },
    ],
  },
  {
    name: 'empty_block_list',
    description: 'No blocks renders to an empty string, not to stray wrapper markup.',
    blocks: [],
  },
];

const fixtures = {
  $comment:
    'GENERATED FILE — do not hand-edit. Regenerate with `node backend/scripts/generate-block-fixtures.js`. ' +
    'Pins the contract between backend/src/services/blocksToHtml.js (canonical) and ' +
    'frontend/src/components/BlockRenderer.js (must produce a matching DOM).',
  generator: 'backend/scripts/generate-block-fixtures.js',
  cases: cases.map((testCase) => ({
    name: testCase.name,
    description: testCase.description,
    blocks: testCase.blocks,
    expected_html: blocksToHtml(testCase.blocks),
    expected_word_count: countWords(testCase.blocks),
  })),
};

const outputPath = path.resolve(__dirname, '..', '..', 'shared', 'block-fixtures.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');

console.log(`Wrote ${fixtures.cases.length} fixture cases to ${outputPath}`);
for (const testCase of fixtures.cases) {
  console.log(
    `  ${testCase.name.padEnd(38)} ${String(testCase.expected_html.length).padStart(5)} chars, ` +
      `${testCase.expected_word_count} words`
  );
}
