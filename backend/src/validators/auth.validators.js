'use strict';

/**
 * Zod schemas for the auth endpoints.
 *
 * Note what is deliberately *not* validated: the login password has no
 * complexity or max-length rule beyond a sanity bound. Enforcing format on
 * login tells an attacker which candidate passwords are worth trying, and a
 * legitimate user's existing password must keep working regardless of a policy
 * introduced later. Complexity belongs on password *creation*.
 */

const { z } = require('zod');

/** Upper bound on password length. bcrypt only reads the first 72 bytes. */
const MAX_PASSWORD_LENGTH = 200;

const loginSchema = z.object({
  email: z
    .string({ required_error: 'email is required.' })
    .trim()
    .min(1, 'email is required.')
    .max(255, 'email is too long.')
    .email('email must be a valid email address.')
    // Normalised to match the model's setter, so the lookup is a plain equality
    // match and capitalisation cannot create a second identity.
    .transform((value) => value.toLowerCase()),
  password: z
    .string({ required_error: 'password is required.' })
    .min(1, 'password is required.')
    .max(MAX_PASSWORD_LENGTH, 'password is too long.'),
});

const refreshSchema = z.object({
  refresh_token: z
    .string({ required_error: 'refresh_token is required.' })
    .trim()
    .min(1, 'refresh_token is required.'),
});

/**
 * Logout accepts an optional refresh token. It is optional because the useful
 * work — bumping the user's token_version — is driven by the authenticated
 * access token, so logout still succeeds if the client has already discarded
 * its refresh token.
 */
const logoutSchema = z.object({
  refresh_token: z.string().trim().min(1).optional(),
});

module.exports = { loginSchema, refreshSchema, logoutSchema, MAX_PASSWORD_LENGTH };
