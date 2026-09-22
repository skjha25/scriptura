// backend/src/services/imagePlacement.js
'use strict';

/**
 * Decides where generated images land inside an article's content blocks.
 *
 * Kept as its own module — deliberately not inlined into generation.js —
 * because the placement rule below (one image after each H2 section) is only
 * this implementation's backward-compatible default. A future change to how
 * placement works (a different strategy, a per-blog/per-client setting)
 * should only ever need to change this file, not the generation pipeline
 * that calls it.
 *
 * The hero image (generatedImages[0]) is intentionally out of scope here —
 * it stays exactly as blog.blog_picture, handled by the caller, and is never
 * duplicated into a content block by this module.
 */

/**
 * Finds indices of H2 heading blocks — the only "eligible content location"
 * this default strategy recognises. Mirrors the same predicate
 * generation.js's outlineFromBlocks uses to identify section boundaries.
 *
 * @param {Array} blocks
 * @returns {number[]} indices into `blocks`, in document order
 */
function findH2Boundaries(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const indices = [];
  list.forEach((block, index) => {
    if (block?.type !== 'heading') return;
    // Mirrors outlineFromBlocks's coercion exactly: anything that isn't
    // explicitly level 3 counts as an H2 boundary.
    const level = Number.parseInt(block?.data?.level, 10);
    const isH3 = level === 3;
    if (!isH3) indices.push(index);
  });
  return indices;
}

/**
 * Builds the content_blocks image entry for one generated image. Shape must
 * match what blocksToHtml.js/seoScore.js/aeoScore.js already expect from a
 * `type: 'image'` block.
 *
 * @param {{relativePath: string, alt_text: string}} image
 */
function toImageBlock(image) {
  return {
    type: 'image',
    data: {
      url: image.relativePath,
      alt_text: image.alt_text || '',
      caption: '',
    },
  };
}

/**
 * Splices additional generated images into `blocks` as new image content
 * blocks, one immediately after each eligible location (H2 boundary), in
 * order. Never touches `generatedImages[0]` — that's the hero image, handled
 * separately by the caller as blog.blog_picture.
 *
 * When there are more additional images than eligible locations, the surplus
 * is returned as `overflowImages` rather than being placed — the caller
 * already stores every generated image in blog.extra_images regardless, so
 * nothing is lost, and the article is never corrupted by cramming images
 * where there's no natural location for them.
 *
 * @param {Array} blocks Original content blocks (not mutated).
 * @param {Array<{relativePath: string, alt_text: string}>} generatedImages
 *   All images generated for this run, index 0 being the hero.
 * @returns {{blocks: Array, overflowImages: Array}}
 */
function placeImagesInBlocks(blocks, generatedImages) {
  const originalBlocks = Array.isArray(blocks) ? blocks : [];
  const additionalImages = (Array.isArray(generatedImages) ? generatedImages : []).slice(1);

  if (additionalImages.length === 0) {
    // image_count === 1 (or no images at all): identical output, not just
    // equivalent — required for backward compatibility.
    return { blocks: originalBlocks, overflowImages: [] };
  }

  const eligibleLocations = findH2Boundaries(originalBlocks);
  const placedCount = Math.min(additionalImages.length, eligibleLocations.length);
  const overflowImages = additionalImages.slice(placedCount);

  if (placedCount === 0) {
    // No eligible locations (e.g. no H2 sections) — handle gracefully rather
    // than corrupting the article by appending images with no context.
    return { blocks: originalBlocks, overflowImages: additionalImages };
  }

  const result = [];
  let nextImageIndex = 0;
  let boundaryPointer = 0;

  originalBlocks.forEach((block, index) => {
    result.push(block);
    const isNextEligibleBoundary =
      boundaryPointer < placedCount && eligibleLocations[boundaryPointer] === index;
    if (isNextEligibleBoundary) {
      result.push(toImageBlock(additionalImages[nextImageIndex]));
      nextImageIndex += 1;
      boundaryPointer += 1;
    }
  });

  return { blocks: result, overflowImages };
}

module.exports = {
  findH2Boundaries,
  placeImagesInBlocks,
};
