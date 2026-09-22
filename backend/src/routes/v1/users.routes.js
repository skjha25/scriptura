'use strict';

/**
 * /api/v1/users — platform user management (create/list/edit team members).
 *
 * Admin-only, same convention as agents.routes.js: creating an account or
 * changing someone's role/active status is platform-wide, not per-blog
 * editor territory.
 */

const express = require('express');

const { requireAuth, requireAdmin } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const controller = require('../../controllers/users.controller');
const {
  createUserBody,
  updateUserParams,
  updateUserBody,
  listUsersQuery,
} = require('../../validators/users.validators');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', validate({ query: listUsersQuery }), controller.listUsers);
router.post('/', validate({ body: createUserBody }), controller.createUser);
router.patch('/:id', validate({ params: updateUserParams, body: updateUserBody }), controller.updateUser);

module.exports = router;
