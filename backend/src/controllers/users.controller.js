// backend/src/controllers/users.controller.js
'use strict';

/**
 * /users — platform user management (the Users page). Admin-only.
 *
 * There is no registration endpoint (see auth.controller.js's header
 * comment) — this is the "admin creates accounts out-of-band" path made
 * self-service instead of requiring direct DB/seeder access.
 */

const { Op } = require('sequelize');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const config = require('../config');
const { User } = require('../models');

const listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = config.pagination.defaultLimit, role, is_active, q } = req.query;

  const where = {};
  if (role) where.role = role;
  if (is_active !== undefined) where.is_active = is_active;
  if (q) {
    where[Op.or] = [{ name: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }];
  }

  const { rows, count } = await User.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });

  res.json({
    data: rows.map((u) => u.toSafeJSON()),
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.max(1, Math.ceil(count / limit)),
      has_next: page * limit < count,
      has_prev: page > 1,
    },
  });
});

const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  let user;
  try {
    user = await User.create({
      name,
      email,
      password_hash: await User.hashPassword(password),
      role,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw ApiError.conflict('A user with this email already exists.', { code: 'EMAIL_TAKEN' });
    }
    throw err;
  }

  res.status(201).json({ data: user.toSafeJSON() });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw ApiError.notFound(`No user with id ${req.params.id}.`);

  const { role, is_active } = req.body;
  const isSelf = req.user.id === Number(user.id);

  // An admin editing their own row could otherwise lock themselves out with
  // no other admin around to undo it — block role/deactivation changes on
  // one's own account rather than trying to detect "last remaining admin".
  if (isSelf && role !== undefined && role !== user.role) {
    throw ApiError.badRequest('You cannot change your own role.', { code: 'CANNOT_MODIFY_SELF' });
  }
  if (isSelf && is_active === false) {
    throw ApiError.badRequest('You cannot deactivate your own account.', { code: 'CANNOT_MODIFY_SELF' });
  }

  if (role !== undefined) user.role = role;
  if (is_active !== undefined) user.is_active = is_active;

  await user.save();
  res.json({ data: user.toSafeJSON() });
});

module.exports = { listUsers, createUser, updateUser };
