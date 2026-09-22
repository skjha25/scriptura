// backend/tests/unit/internalLinks.test.js
'use strict';

/**
 * Internal blog link verification and repair.
 *
 * Both "written" slugs used here are real production failures: the model
 * rebuilt the slug from the target's title and wrote `and` where the title had
 * a comma, so divinetalk.in served a 404 for a blog that exists.
 *
 * `models` is mocked because this is a unit suite and the module's only
 * database use is two `Blog.scope('linkable')` reads.
 */

const PUBLISHED = [
  { slug: 'sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-puja-vidhi' },
  { slug: 'pitru-paksha-2026-complete-dates-tithi-calendar-shradh-timings' },
  { slug: 'mangal-dosha-remedies' },
];

const mockFindAll = jest.fn();
jest.mock('../../src/models', () => ({
  Blog: { scope: () => ({ findAll: (...args) => mockFindAll(...args) }) },
}));

const {
  repairInternalLinks,
  findRealSlug,
  blogSlugFromHref,
  slugKey,
} = require('../../src/services/internalLinks');

/**
 * Answers the two queries the module makes: the first filters by slug, the
 * second (no `where`) asks for every published slug.
 */
function withPublished(rows = PUBLISHED) {
  mockFindAll.mockImplementation((options = {}) => {
    if (!options.where) return Promise.resolve(rows);
    const wanted = options.where.slug[Object.getOwnPropertySymbols(options.where.slug)[0]] || [];
    return Promise.resolve(rows.filter((r) => wanted.includes(r.slug)));
  });
}

beforeEach(() => {
  mockFindAll.mockReset();
  withPublished();
});

const link = (slug, text = 'read more') =>
  `<a href="https://divinetalk.in/blog/${slug}">${text}</a>`;

describe('blogSlugFromHref', () => {
  it('reads the slug from relative, absolute, trailing-slash and query forms', () => {
    expect(blogSlugFromHref('/blog/mangal-dosha-remedies')).toBe('mangal-dosha-remedies');
    expect(blogSlugFromHref('https://divinetalk.in/blog/mangal-dosha-remedies')).toBe('mangal-dosha-remedies');
    expect(blogSlugFromHref('https://divinetalk.in/blog/mangal-dosha-remedies/')).toBe('mangal-dosha-remedies');
    expect(blogSlugFromHref('/blog/mangal-dosha-remedies?utm=x#top')).toBe('mangal-dosha-remedies');
  });

  it('returns null for anything that is not an internal blog link', () => {
    expect(blogSlugFromHref('https://divinetalk.in/astrology')).toBeNull();
    expect(blogSlugFromHref('mailto:hi@example.com')).toBeNull();
    expect(blogSlugFromHref('#faq')).toBeNull();
    expect(blogSlugFromHref('')).toBeNull();
  });
});

describe('slugKey', () => {
  it('collapses an inserted joining word onto the real slug', () => {
    expect(slugKey('sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-and-puja-vidhi')).toBe(
      slugKey('sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-puja-vidhi')
    );
  });

  it('keeps topical words, so two different articles never share a key', () => {
    expect(slugKey('pitru-paksha-2026-dates')).not.toBe(slugKey('pitru-paksha-2025-dates'));
  });
});

describe('findRealSlug', () => {
  it('places both production failures on the real slug', () => {
    expect(
      findRealSlug('sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-and-puja-vidhi', PUBLISHED)
    ).toBe('sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-puja-vidhi');
    expect(
      findRealSlug('pitru-paksha-2026-complete-dates-tithi-calendar-and-shradh-timings', PUBLISHED)
    ).toBe('pitru-paksha-2026-complete-dates-tithi-calendar-shradh-timings');
  });

  it('refuses to guess when two published blogs share a key', () => {
    const ambiguous = [{ slug: 'shani-sade-sati' }, { slug: 'shani-and-sade-sati' }];
    expect(findRealSlug('shani-the-sade-sati', ambiguous)).toBeNull();
  });

  it('returns null for a slug that resembles nothing published', () => {
    expect(findRealSlug('kaal-sarp-dosh-complete-guide', PUBLISHED)).toBeNull();
  });
});

describe('repairInternalLinks', () => {
  it('rewrites a near-miss href in a paragraph and leaves the link text alone', async () => {
    const blocks = [
      {
        type: 'paragraph',
        data: {
          html: `Read our ${link(
            'pitru-paksha-2026-complete-dates-tithi-calendar-and-shradh-timings',
            'Pitru Paksha calendar'
          )} first.`,
        },
      },
    ];

    const outcome = await repairInternalLinks(blocks);

    expect(blocks[0].data.html).toContain(
      'https://divinetalk.in/blog/pitru-paksha-2026-complete-dates-tithi-calendar-shradh-timings'
    );
    expect(blocks[0].data.html).toContain('>Pitru Paksha calendar</a>');
    expect(outcome.repaired).toEqual([
      {
        from: 'pitru-paksha-2026-complete-dates-tithi-calendar-and-shradh-timings',
        to: 'pitru-paksha-2026-complete-dates-tithi-calendar-shradh-timings',
      },
    ]);
  });

  it('repairs links in the fields the old data.html-only check never scanned', async () => {
    const broken = 'sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-and-puja-vidhi';
    const fixed = 'sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-puja-vidhi';

    const blocks = [
      { type: 'list', data: { items: [`See ${link(broken, 'the vidhi')}`] } },
      { type: 'key_takeaway', data: { items: [link(broken, 'muhurat')] } },
      { type: 'faq_accordion', data: { items: [{ question: 'When?', answer_html: link(broken) }] } },
      { type: 'table', data: { headers: ['Day'], rows: [[link(broken, 'Amavasya')]] } },
      { type: 'cta_button', data: { text: 'Read', url: `/blog/${broken}` } },
    ];

    await repairInternalLinks(blocks);

    expect(blocks[0].data.items[0]).toContain(`/blog/${fixed}`);
    expect(blocks[1].data.items[0]).toContain(`/blog/${fixed}`);
    expect(blocks[2].data.items[0].answer_html).toContain(`/blog/${fixed}`);
    expect(blocks[3].data.rows[0][0]).toContain(`/blog/${fixed}`);
    expect(blocks[4].data.url).toBe(`https://divinetalk.in/blog/${fixed}`);
  });

  it('strips an unplaceable link but keeps its words', async () => {
    const blocks = [
      { type: 'paragraph', data: { html: `Also see ${link('kaal-sarp-dosh-full-guide', 'this guide')}.` } },
    ];

    const outcome = await repairInternalLinks(blocks);

    expect(blocks[0].data.html).toBe('Also see this guide.');
    expect(outcome.stripped).toEqual(['kaal-sarp-dosh-full-guide']);
  });

  it('absolutizes a valid relative link and never touches external ones', async () => {
    const blocks = [
      {
        type: 'paragraph',
        data: {
          html:
            '<a href="/blog/mangal-dosha-remedies">remedies</a> and ' +
            '<a href="https://example.com/x">example</a>',
        },
      },
    ];

    await repairInternalLinks(blocks);

    expect(blocks[0].data.html).toContain('href="https://divinetalk.in/blog/mangal-dosha-remedies"');
    expect(blocks[0].data.html).toContain('href="https://example.com/x"');
  });

  it('leaves an unrepairable bare url alone rather than blanking the block', async () => {
    const blocks = [{ type: 'cta_button', data: { text: 'Go', url: '/blog/does-not-exist-at-all' } }];
    await repairInternalLinks(blocks);
    expect(blocks[0].data.url).toBe('/blog/does-not-exist-at-all');
  });

  it('skips the second query entirely when every link is already valid', async () => {
    const blocks = [{ type: 'paragraph', data: { html: link('mangal-dosha-remedies') } }];
    await repairInternalLinks(blocks);
    expect(mockFindAll).toHaveBeenCalledTimes(1);
  });

  describe('strip: false (a person is driving the save)', () => {
    it('still repairs a near-miss', async () => {
      const blocks = [
        { type: 'paragraph', data: { html: link('pitru-paksha-2026-complete-dates-tithi-calendar-and-shradh-timings') } },
      ];
      const outcome = await repairInternalLinks(blocks, { strip: false });
      expect(blocks[0].data.html).toContain('/blog/pitru-paksha-2026-complete-dates-tithi-calendar-shradh-timings');
      expect(outcome.repaired).toHaveLength(1);
    });

    it('leaves an unplaceable link alone instead of removing it mid-keystroke', async () => {
      const blocks = [
        { type: 'paragraph', data: { html: `Also see ${link('an-article-not-published-yet', 'this one')}.` } },
      ];
      const outcome = await repairInternalLinks(blocks, { strip: false });
      expect(blocks[0].data.html).toContain('an-article-not-published-yet');
      expect(blocks[0].data.html).toContain('>this one</a>');
      expect(outcome.stripped).toEqual([]);
      expect(outcome.kept).toEqual(['an-article-not-published-yet']);
    });

    it('still absolutizes a valid relative link', async () => {
      const blocks = [
        { type: 'paragraph', data: { html: '<a href="/blog/mangal-dosha-remedies">remedies</a>' } },
      ];
      await repairInternalLinks(blocks, { strip: false });
      expect(blocks[0].data.html).toContain('href="https://divinetalk.in/blog/mangal-dosha-remedies"');
    });
  });

  describe('links the model wrote as text, not as an <a> tag', () => {
    const broken = 'sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-and-puja-vidhi';
    const fixed = 'sarva-pitru-amavasya-2026-date-tithi-shradh-muhurat-puja-vidhi';

    it('repairs a bare absolute URL in a sentence', async () => {
      const blocks = [
        { type: 'paragraph', data: { html: `Read more: https://divinetalk.in/blog/${broken} for details.` } },
      ];
      const outcome = await repairInternalLinks(blocks);
      expect(blocks[0].data.html).toBe(`Read more: https://divinetalk.in/blog/${fixed} for details.`);
      expect(outcome.repaired).toHaveLength(1);
    });

    it('repairs a bare root-relative path', async () => {
      const blocks = [{ type: 'paragraph', data: { html: `See /blog/${broken} here.` } }];
      await repairInternalLinks(blocks);
      expect(blocks[0].data.html).toBe(`See /blog/${fixed} here.`);
    });

    it('repairs a markdown-style link', async () => {
      const blocks = [
        { type: 'paragraph', data: { text: `[Sarva Pitru](https://divinetalk.in/blog/${broken})` } },
      ];
      await repairInternalLinks(blocks);
      expect(blocks[0].data.text).toBe(`[Sarva Pitru](https://divinetalk.in/blog/${fixed})`);
    });

    it('repairs a bare URL inside a list item', async () => {
      const blocks = [{ type: 'list', data: { items: [`Guide: /blog/${broken}`] } }];
      await repairInternalLinks(blocks);
      expect(blocks[0].data.items[0]).toBe(`Guide: /blog/${fixed}`);
    });

    it('never rewrites an href attribute twice', async () => {
      const blocks = [{ type: 'paragraph', data: { html: link(broken, 'vidhi') } }];
      await repairInternalLinks(blocks);
      expect(blocks[0].data.html).toBe(
        `<a href="https://divinetalk.in/blog/${fixed}">vidhi</a>`
      );
    });

    it('leaves a bare URL it cannot place, rather than cutting the sentence', async () => {
      const blocks = [
        { type: 'paragraph', data: { html: 'Read /blog/totally-unknown-article now.' } },
      ];
      await repairInternalLinks(blocks);
      expect(blocks[0].data.html).toBe('Read /blog/totally-unknown-article now.');
    });

    it("never rewrites another site's /blog/ url, even a near-miss one", async () => {
      const blocks = [
        { type: 'paragraph', data: { html: `See https://example.com/blog/${broken} here.` } },
      ];
      const outcome = await repairInternalLinks(blocks);
      expect(blocks[0].data.html).toBe(`See https://example.com/blog/${broken} here.`);
      expect(outcome.repaired).toEqual([]);
    });

    it('repairs a bare url on the admin host too', async () => {
      const blocks = [
        { type: 'paragraph', data: { html: `See https://admin.divinetalk.live/blog/${broken} here.` } },
      ];
      await repairInternalLinks(blocks);
      expect(blocks[0].data.html).toContain(`/blog/${fixed}`);
    });
  });

  it('leaves blocks untouched when the lookup fails', async () => {
    mockFindAll.mockRejectedValue(new Error('db down'));
    const blocks = [{ type: 'paragraph', data: { html: link('anything-at-all') } }];
    await expect(repairInternalLinks(blocks)).rejects.toThrow('db down');
    expect(blocks[0].data.html).toContain('anything-at-all');
  });
});
