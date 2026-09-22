// backend/src/validators/users.validators.js
'use strict';

/**
 * Zod schemas for /users (platform user management). Admin-only — see
 * routes/v1/users.routes.js.
 */

const { z } = require('zod');
const { USER_ROLE_VALUES } = require('../constants');

const role = z.enum(USER_ROLE_VALUES);

/** `true`/`false` as query-string literals, not `z.coerce.boolean()` — that coerces any non-empty string (e.g. "false") to `true`. */
const booleanQueryParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const createUserBody = z
  .object({
    name: z.string().trim().min(1, 'A name is required.').max(150),
    email: z.string().trim().min(1, 'An email is required.').email('Must be a valid email address.').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
    role: role.optional(),
  })
  .strict();

const updateUserParams = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

const updateUserBody = z
  .object({
    role: role.optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.role !== undefined || data.is_active !== undefined, {
    message: 'Provide role and/or is_active.',
  });

const listUsersQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    role: role.optional(),
    is_active: booleanQueryParam,
    q: z.string().trim().max(255).optional(),
  })
  .strict();

module.exports = { createUserBody, updateUserParams, updateUserBody, listUsersQuery };
