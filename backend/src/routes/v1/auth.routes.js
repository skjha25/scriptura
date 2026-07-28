'use strict';

/**
 * /api/v1/auth
 *
 * `login` and `refresh` are unauthenticated by necessity, so both carry the
 * tighter `authLimiter` to blunt credential stuffing and refresh-token
 * brute-forcing. `logout` and `me` require a valid access token.
 */

const express = require('express');

const { validate } = require('../../middleware/validate');
const { authLimiter } = require('../../middleware/rateLimit');
const { requireAuth } = require('../../middleware/auth');
const { loginSchema, refreshSchema } = require('../../validators/auth.validators');
const { login, refresh, logout, me } = require('../../controllers/auth.controller');

const router = express.Router();

router.post('/login', authLimiter, validate({ body: loginSchema }), login);
router.post('/refresh', authLimiter, validate({ body: refreshSchema }), refresh);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);

module.exports = router;
