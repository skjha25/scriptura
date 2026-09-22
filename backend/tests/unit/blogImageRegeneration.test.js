// backend/tests/unit/blogImageRegeneration.test.js
'use strict';

/**
 * Part C (image regeneration) regression coverage for
 * PATCH /blogs/:id/blocks/:blockId/regenerate-image
 * (controllers/blogs.controller.js's regenerateBlockImage).
 *
 * Real Blog model against in-memory SQLite (same pattern as
 * actionExecutors.test.js), with only the image provider mocked — no real
 * network/image calls. Calls the controller function directly rather than
 * over HTTP: the route/validator wiring is trivial and this keeps the test
 * fast and focused on the actual regeneration logic.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const Blog = require('../../src/models/blog')(sqlite);
  return { Blog, sequelize: sqlite, Sequelize };
});

jest.mock('../../src/services/imageGeneration', () => ({
  generateBlogImage: jest.fn(),
}));

const { Blog, sequelize } = require('../../src/models');
const { generateBlogImage } = require('../../src/services/imageGeneration');
const controller = require('../../src/controllers/blogs.controller');
const { GENERATION_STATUS } = require('../../src/constants');

/**
 * asyncHandler's wrapped function does not return its inner promise (by
 * design — Express 4 never awaits handlers), so `await
 * controller.regenerateBlockImage(...)` would resolve immediately without
 * waiting for the real work. This resolves once either res.json or next is
 * actually called, which is the real completion signal.
 */
function invoke(handler, req) {
  return new Promise((resolve) => {
    const res = {
      json: jest.fn(() => resolve({ res, next })),
      status: jest.fn().mockReturnThis(),
    };
    const next = jest.fn(() => resolve({ res, next }));
    handler(req, res, next);
  });
}

async function makeBlog(overrides = {}) {
  return Blog.create({
    blog_title: 'Mercury retrograde in Virgo',
    topic: 'Mercury retrograde',
    content_blocks: [
      { id: 'heading-1', type: 'heading', data: { level: 2, text: 'Section 1' } },
      { id: 'image-1', type: 'image', data: { url: 'old.png', alt_text: 'old alt', caption: 'old caption' } },
      { id: 'paragraph-1', type: 'paragraph', data: { text: 'Some body text.' } },
    ],
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  jest.clearAllMocks();
  await Blog.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('regenerateBlockImage', () => {
  it('replaces only the target image block, leaving other blocks untouched', async () => {
    const blog = await makeBlog();
    generateBlogImage.mockResolvedValue([
      { relativePath: 'new.png', alt_text: 'new alt' },
    ]);

    const req = { params: { id: blog.id, blockId: 'image-1' }, body: {} };
    const { res, next } = await invoke(controller.regenerateBlockImage, req);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);

    const updated = await Blog.findByPk(blog.id);
    const blocks = updated.content_blocks;
    expect(blocks[0]).toEqual({ id: 'heading-1', type: 'heading', data: { level: 2, text: 'Section 1' } });
    expect(blocks[1]).toEqual({
      id: 'image-1',
      type: 'image',
      data: { url: 'new.png', alt_text: 'new alt', caption: 'old caption' },
    });
    expect(blocks[2]).toEqual({ id: 'paragraph-1', type: 'paragraph', data: { text: 'Some body text.' } });
  });

  it('passes a user-supplied prompt through to generateBlogImage', async () => {
    const blog = await makeBlog();
    generateBlogImage.mockResolvedValue([{ relativePath: 'new.png', alt_text: 'new alt' }]);

    const req = {
      params: { id: blog.id, blockId: 'image-1' },
      body: { prompt: 'Make it more minimal, premium and spiritual' },
    };
    await invoke(controller.regenerateBlockImage, req);

    expect(generateBlogImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Make it more minimal, premium and spiritual', count: 1 })
    );
  });

  it('regenerates with existing context when no prompt is supplied', async () => {
    const blog = await makeBlog();
    generateBlogImage.mockResolvedValue([{ relativePath: 'new.png', alt_text: 'new alt' }]);

    const req = { params: { id: blog.id, blockId: 'image-1' }, body: {} };
    await invoke(controller.regenerateBlockImage, req);

    expect(generateBlogImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: undefined, topic: 'Mercury retrograde', count: 1 })
    );
  });

  it('on provider failure, leaves the original image and other content untouched', async () => {
    const blog = await makeBlog();
    const originalBlocks = JSON.parse(JSON.stringify(blog.content_blocks));
    generateBlogImage.mockRejectedValue(new Error('provider unavailable'));

    const req = { params: { id: blog.id, blockId: 'image-1' }, body: {} };
    const { res, next } = await invoke(controller.regenerateBlockImage, req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();

    const unchanged = await Blog.findByPk(blog.id);
    expect(unchanged.content_blocks).toEqual(originalBlocks);
  });

  it('404s when the block id does not exist or is not an image block', async () => {
    const blog = await makeBlog();
    const req = { params: { id: blog.id, blockId: 'paragraph-1' }, body: {} };
    const { next } = await invoke(controller.regenerateBlockImage, req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
    expect(generateBlogImage).not.toHaveBeenCalled();
  });

  it('refuses while the blog is mid-generation, same guard as updateBlog', async () => {
    const blog = await makeBlog({ generation_status: GENERATION_STATUS.GENERATING });
    const req = { params: { id: blog.id, blockId: 'image-1' }, body: {} };
    const { next } = await invoke(controller.regenerateBlockImage, req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(409);
    expect(generateBlogImage).not.toHaveBeenCalled();
  });
});
