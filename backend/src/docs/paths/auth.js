'use strict';

/** OpenAPI path fragment for /auth. Merged by src/docs/index.js. */

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

module.exports = {
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in',
      description:
        'Returns an access/refresh pair plus the user profile. Rate limited. A wrong email and ' +
        'a wrong password return an identical response so the endpoint cannot be used to ' +
        'enumerate accounts.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'harsh@divinetalk.in' },
          password: { type: 'string', format: 'password', example: 'Scriptura@Dev2026' },
        },
      }),
      responses: {
        200: {
          description: 'Signed in.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        422: { $ref: '#/components/responses/ValidationError' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Exchange a refresh token for a new token pair',
      description:
        'Both tokens are rotated, so a captured refresh token is only useful until its next ' +
        'legitimate use. Returns 401 `REFRESH_TOKEN_REVOKED` if the session was signed out ' +
        'elsewhere.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['refresh_token'],
        properties: { refresh_token: { type: 'string' } },
      }),
      responses: {
        200: {
          description: 'New token pair.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        422: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Sign out',
      description:
        "Increments the account's token version, revoking every outstanding refresh token. " +
        'Access tokens already issued remain valid until they expire — that TTL is the bound.',
      responses: {
        200: {
          description: 'Signed out.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  access_token_valid_until_expiry: { type: 'boolean' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Current user',
      description: 'Validates a stored token and hydrates the signed-in user after a hard refresh.',
      responses: {
        200: {
          description: 'The signed-in user.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { user: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
};
