'use strict';

/**
 * /api/v1/blogs
 *
 * Every route requires authentication — this is an internal tool and there is no
 * public read surface here (the public site reads the `blogs` table directly).
 *
 * Route order matters: `/linkable` is declared before `/:id`, otherwise Express
 * matches it as an id and the numeric coercion rejects it with a 422.
 */

const express = require('express');

const { validate } = require('../../middleware/validate');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const {
  createBlogSchema,
  updateBlogSchema,
  publishBlogSchema,
  listBlogsSchema,
  linkableSearchSchema,
  idParamSchema,
  blockIdParamSchema,
  regenerateBlockImageSchema,
} = require('../../validators/blog.validators');
const controller = require('../../controllers/blogs.controller');
const { generationStatusHandler } = require('../../controllers/generation.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', validate({ query: listBlogsSchema }), controller.list);
router.post('/', validate({ body: createBlogSchema }), controller.create);

// Declared before '/:id' — see the note in the file header.
router.get('/linkable', validate({ query: linkableSearchSchema }), controller.linkable);

router.get('/:id', validate({ params: idParamSchema }), controller.detail);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateBlogSchema }),
  controller.update
);
router.delete('/:id', validate({ params: idParamSchema }), controller.remove);

router.patch(
  '/:id/blocks/:blockId/regenerate-image',
  validate({ params: blockIdParamSchema, body: regenerateBlockImageSchema }),
  controller.regenerateBlockImage
);

router.post(
  '/:id/publish',
  validate({ params: idParamSchema, body: publishBlogSchema }),
  controller.publish
);

router.post('/:id/restore', requireAdmin, validate({ params: idParamSchema }), controller.restore);

/**
 * The spec places generation-status polling under the blog resource. The handler
 * itself belongs to the generation pipeline, so it is imported rather than
 * duplicated; it also stays mounted under /generate for symmetry with the other
 * generation endpoints.
 */
router.get(
  '/:id/generation-status',
  validate({ params: idParamSchema }),
  generationStatusHandler
);

module.exports = router;
