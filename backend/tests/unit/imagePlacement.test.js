// backend/tests/unit/imagePlacement.test.js
'use strict';

/**
 * Part B (multi-image) regression coverage.
 *
 * placeImagesInBlocks is the sole logic deciding where additional generated
 * images land in content_blocks — see services/imagePlacement.js's header for
 * why this is its own module rather than inline in generation.js.
 */

const { findH2Boundaries, placeImagesInBlocks } = require('../../src/services/imagePlacement');

function heading(level, text) {
  return { type: 'heading', data: { level, text } };
}
function paragraph(text) {
  return { type: 'paragraph', data: { text } };
}
function image(relativePath, alt = 'alt') {
  return { relativePath, alt_text: alt };
}

describe('findH2Boundaries', () => {
  it('finds only H2 headings, not H3', () => {
    const blocks = [heading(2, 'A'), paragraph('p'), heading(3, 'B'), heading(2, 'C')];
    expect(findH2Boundaries(blocks)).toEqual([0, 3]);
  });

  it('treats a heading with no/invalid level as H2 (mirrors outlineFromBlocks coercion)', () => {
    const blocks = [{ type: 'heading', data: { text: 'no level' } }];
    expect(findH2Boundaries(blocks)).toEqual([0]);
  });

  it('returns empty for a block list with no headings', () => {
    expect(findH2Boundaries([paragraph('p')])).toEqual([]);
  });
});

describe('placeImagesInBlocks', () => {
  it('image_count = 1: returns the exact same blocks array (required identity, not just equality)', () => {
    const blocks = [heading(2, 'A'), paragraph('p')];
    const result = placeImagesInBlocks(blocks, [image('hero.png')]);
    expect(result.blocks).toBe(blocks);
    expect(result.overflowImages).toEqual([]);
  });

  it('image_count = 2: hero untouched, second image placed after the one H2', () => {
    const blocks = [heading(2, 'Intro'), paragraph('p1'), paragraph('p2')];
    const images = [image('hero.png'), image('second.png', 'second')];
    const result = placeImagesInBlocks(blocks, images);

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0]).toEqual(blocks[0]);
    expect(result.blocks[1]).toEqual({
      type: 'image',
      data: { url: 'second.png', alt_text: 'second', caption: '' },
    });
    expect(result.blocks[2]).toEqual(blocks[1]);
    expect(result.blocks[3]).toEqual(blocks[2]);
    expect(result.overflowImages).toEqual([]);
    // Original array must not be mutated.
    expect(blocks).toHaveLength(3);
  });

  it('image_count = 3 with two H2 sections: one image after each H2', () => {
    const blocks = [
      heading(2, 'Section 1'),
      paragraph('p1'),
      heading(2, 'Section 2'),
      paragraph('p2'),
    ];
    const images = [image('hero.png'), image('img1.png'), image('img2.png')];
    const result = placeImagesInBlocks(blocks, images);

    const types = result.blocks.map((b) => `${b.type}:${b.data.url || b.data.text}`);
    expect(types).toEqual([
      'heading:Section 1',
      'image:img1.png',
      'paragraph:p1',
      'heading:Section 2',
      'image:img2.png',
      'paragraph:p2',
    ]);
    expect(result.overflowImages).toEqual([]);
  });

  it('more additional images than H2 sections: surplus goes to overflowImages, article not corrupted', () => {
    const blocks = [heading(2, 'Only section'), paragraph('p1')];
    const images = [image('hero.png'), image('a.png'), image('b.png'), image('c.png')];
    const result = placeImagesInBlocks(blocks, images);

    expect(result.blocks).toHaveLength(3); // heading + 1 image + paragraph
    expect(result.blocks[1].data.url).toBe('a.png');
    expect(result.overflowImages.map((i) => i.relativePath)).toEqual(['b.png', 'c.png']);
  });

  it('zero H2 sections: all additional images stay in overflowImages, blocks unchanged', () => {
    const blocks = [paragraph('p1'), paragraph('p2')];
    const images = [image('hero.png'), image('a.png')];
    const result = placeImagesInBlocks(blocks, images);

    expect(result.blocks).toBe(blocks);
    expect(result.overflowImages.map((i) => i.relativePath)).toEqual(['a.png']);
  });

  it('handles no generatedImages at all (include_images off) without throwing', () => {
    const blocks = [paragraph('p1')];
    const result = placeImagesInBlocks(blocks, []);
    expect(result.blocks).toBe(blocks);
    expect(result.overflowImages).toEqual([]);
  });
});
