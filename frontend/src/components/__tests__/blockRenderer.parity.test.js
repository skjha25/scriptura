/**
 * BlockRenderer ↔ backend renderer parity.
 *
 * WHY THIS TEST EXISTS
 * There are two renderers for `content_blocks`:
 *
 *   backend/src/services/blocksToHtml.js  → writes `blog_content`, the HTML the
 *                                           existing Divinetalk site and crawlers read
 *   src/components/BlockRenderer.js       → what the editor preview and the
 *                                           in-app blog page render
 *
 * If they diverge, an author reviews one thing and publishes another. That is the
 * exact failure the spec's "use the same rendering component" requirement exists
 * to prevent, and a shared component alone cannot enforce it across the
 * language boundary — so it is enforced here instead.
 *
 * `shared/block-fixtures.json` is generated from the BACKEND renderer (it is
 * canonical) by `node backend/scripts/generate-block-fixtures.js`. This test
 * renders the same block input through React and asserts the resulting DOM
 * matches.
 *
 * COMPARISON METHOD
 * Not raw string equality — that would fail on cosmetic serialisation
 * differences that mean nothing: the backend writes `<img … />` (self-closing)
 * while `innerHTML` reads back `<img …>`, because `img` is a void element in
 * HTML5. So both sides are passed through the SAME `innerHTML` round-trip, which
 * normalises void elements and entity spelling while preserving attribute order,
 * class values and text content. Anything that still differs after that is a real
 * divergence.
 *
 * If this fails, one of the two renderers changed. Fix whichever is wrong, then
 * regenerate the fixtures.
 */

import { render } from '@testing-library/react';
import BlockRenderer from '../BlockRenderer';
import fixtures from '../../../../shared/block-fixtures.json';

/**
 * Normalises an HTML string by round-tripping it through the DOM.
 * Both sides of every comparison go through this, so only genuine structural or
 * attribute differences survive.
 */
function normalize(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.innerHTML;
}

/**
 * Renders blocks through the React component and returns the inner markup,
 * stripping BlockRenderer's own `.prose-scriptura` wrapper — the backend emits only
 * the article body, with the wrapper being a frontend styling concern.
 */
function renderBlocks(blocks) {
  const { container } = render(<BlockRenderer blocks={blocks} />);
  const wrapper = container.querySelector('.prose-scriptura');
  // No wrapper means the component rendered null, which is correct for an empty
  // or fully-skipped block list.
  return wrapper ? wrapper.innerHTML : '';
}

describe('BlockRenderer matches the backend renderer', () => {
  it('has fixtures to compare against', () => {
    expect(Array.isArray(fixtures.cases)).toBe(true);
    expect(fixtures.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of fixtures.cases) {
    it(`${testCase.name}: ${testCase.description}`, () => {
      const actual = normalize(renderBlocks(testCase.blocks));
      const expected = normalize(testCase.expected_html);
      expect(actual).toBe(expected);
    });
  }
});

describe('BlockRenderer safety', () => {
  it('does not execute or emit script from block content', () => {
    const blocks = [
      { id: 'a', type: 'paragraph', data: { html: '<script>window.__pwned = true;</script>Safe.' } },
      { id: 'b', type: 'paragraph', data: { html: '<img src=x onerror="window.__pwned = true">' } },
      { id: 'c', type: 'cta_button', data: { text: 'Bad', url: 'javascript:window.__pwned=true' } },
      { id: 'd', type: 'list', data: { items: ['<script>window.__pwned = true;</script>item'] } },
    ];

    const html = renderBlocks(blocks);

    expect(window.__pwned).toBeUndefined();
    expect(html).not.toMatch(/<script/i);
    // Only an event handler inside a real tag is dangerous; an escaped one is
    // inert visible text.
    expect(html).not.toMatch(/<[^>]*\son\w+\s*=/i);
    expect(html).not.toMatch(/<[^>]*javascript:/i);
  });

  it('renders nothing for an empty or non-array block list', () => {
    expect(renderBlocks([])).toBe('');
    expect(renderBlocks(null)).toBe('');
    expect(renderBlocks(undefined)).toBe('');
  });

  it('skips an unknown block type without dropping its neighbours', () => {
    // A block type from a newer build must degrade to "not shown", never blank the
    // whole article.
    const html = renderBlocks([
      { id: '1', type: 'paragraph', data: { text: 'Before.' } },
      { id: '2', type: 'some_future_block', data: { text: 'Must not appear.' } },
      { id: '3', type: 'paragraph', data: { text: 'After.' } },
    ]);

    expect(html).toContain('Before.');
    expect(html).toContain('After.');
    expect(html).not.toContain('Must not appear.');
  });
});

describe('resolveUrl', () => {
  it('is applied to image sources so storage-relative paths become loadable', () => {
    // Blocks hold storage-relative paths (`blogs/July2026/x.png`), not URLs — the
    // resolver is what makes the same stored value work under the local driver and
    // under S3.
    const { container } = render(
      <BlockRenderer
        blocks={[
          { id: 'i', type: 'image', data: { url: 'blogs/July2026/x.png', alt_text: 'A' } },
        ]}
        resolveUrl={(url) => `/uploads/${url}`}
      />
    );

    expect(container.querySelector('img').getAttribute('src')).toBe('/uploads/blogs/July2026/x.png');
  });
});
