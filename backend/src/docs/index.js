'use strict';

/**
 * OpenAPI 3.0 specification, assembled from per-route-group fragments.
 *
 * Each route group contributes a fragment under src/docs/paths/ so the spec is
 * maintained next to the code it describes rather than in one file nobody
 * updates. Fragments are merged here; shared schemas and the error envelope live
 * in this file because every group references them.
 *
 * Served as JSON at /openapi.json in every environment, and via Swagger UI at
 * /api-docs outside production.
 */

const config = require('../config');
const {
  BLOG_STATUS,
  GENERATION_STATUS,
  ARTICLE_TYPES,
  READABILITY_LEVELS,
  BRAND_VOICE_SOURCE_TYPES,
  IMAGE_STYLES,
  LOGO_POSITIONS,
  BLOCK_TYPES,
  POINTS_OF_VIEW,
} = require('../constants');

const pathFragments = [
  require('./paths/auth'),
  require('./paths/blogs'),
  require('./paths/generation'),
  require('./paths/brandVoice'),
  require('./paths/media'),
  require('./paths/serp'),
  require('./paths/analytics'),
];

/**
 * Merges fragments, combining operations when two fragments describe the same
 * path (e.g. /blogs/{id} documented for both GET and PATCH in separate files).
 * A genuine duplicate — the same path AND method twice — is a mistake worth
 * surfacing loudly rather than silently resolving.
 */
function mergePaths(fragments) {
  const merged = {};
  for (const fragment of fragments) {
    for (const [path, operations] of Object.entries(fragment || {})) {
      if (!merged[path]) {
        merged[path] = { ...operations };
        continue;
      }
      for (const [method, operation] of Object.entries(operations)) {
        if (merged[path][method]) {
          throw new Error(
            `Duplicate OpenAPI operation ${method.toUpperCase()} ${path} — two fragments in ` +
              'src/docs/paths/ describe the same endpoint.'
          );
        }
        merged[path][method] = operation;
      }
    }
  }
  return merged;
}

/** Reusable error response, referenced by every operation. */
const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'VALIDATION_ERROR' },
        message: { type: 'string', example: 'Request validation failed.' },
        details: {
          type: 'object',
          description: 'Present on validation errors; maps `part.field` to a list of messages.',
          additionalProperties: true,
          example: { fieldErrors: { 'body.blog_title': ['blog_title is required.'] } },
        },
      },
    },
  },
};

function errorResponse(description) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Scriptura API',
    version: '1.0.0',
    description:
      'Internal AI blog automation API for Divinetalk.\n\n' +
      '**Single organisation.** There is no tenancy model and no `organization_id` — ' +
      'authorisation is simply "is this a signed-in Divinetalk team member, and are they ' +
      'an admin or an editor".\n\n' +
      '**Content model.** `content_blocks` (JSON) is the editable source of truth for an ' +
      'article. `blog_content` (HTML) is *derived* from it on every save and is effectively ' +
      'read-only through this API — writing it directly has no effect, because a model hook ' +
      'regenerates it from the blocks on the same save.\n\n' +
      '**Feature flags.** SerpAPI-backed endpoints return `503 FEATURE_DISABLED` when ' +
      '`SERPAPI_ENABLED` is off or no key is set. Call `GET /api/v1/meta` to discover what ' +
      'is available before rendering controls for it.',
    contact: { name: 'Divinetalk engineering' },
  },
  servers: [
    { url: `${config.appUrl}${config.apiPrefix}`, description: `${config.env} server` },
  ],
  tags: [
    { name: 'Auth', description: 'Sign in, refresh, sign out.' },
    { name: 'Blogs', description: 'CRUD, publishing, and the internal-link picker.' },
    { name: 'Generation', description: 'Title, outline and article generation (Claude).' },
    { name: 'Brand voice', description: 'Tone analysis from pasted text, a scraped URL, or a file.' },
    { name: 'Media', description: 'Uploads, AI image generation, logo compositing.' },
    { name: 'SERP', description: 'Rank checking and fact grounding. Feature-flagged.' },
    { name: 'Analytics', description: 'Dashboard aggregates.' },
    { name: 'Meta', description: 'Capability and enum discovery.' },
  ],
  paths: {
    '/meta': {
      get: {
        tags: ['Meta'],
        summary: 'Capability and enum discovery',
        description:
          'Unauthenticated. Returns which optional features are active and the canonical ' +
          'enum values, so the frontend never offers a control backed by a disabled feature.',
        security: [],
        responses: {
          200: {
            description: 'Capabilities and enums.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    features: { type: 'object', additionalProperties: true },
                    enums: { type: 'object', additionalProperties: true },
                    defaults: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    ...mergePaths(pathFragments),
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from `POST /auth/login`. Short-lived (15m by default); exchange the ' +
          'refresh token at `POST /auth/refresh` when it expires.',
      },
    },
    schemas: {
      Error: errorSchema,

      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 137 },
          total_pages: { type: 'integer', example: 7 },
          has_next: { type: 'boolean' },
          has_prev: { type: 'boolean' },
        },
      },

      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Harsh Sharma' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'editor'] },
          is_active: { type: 'boolean' },
          last_login_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },

      TokenPair: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          refresh_token: { type: 'string' },
          token_type: { type: 'string', example: 'Bearer' },
          expires_in: { type: 'string', example: '15m' },
          user: { $ref: '#/components/schemas/User' },
        },
      },

      Block: {
        type: 'object',
        required: ['type'],
        description:
          'One editor block. `data` fields depend on `type`; the renderer tolerates missing ' +
          'and extra keys, so unknown block types degrade to "not rendered" rather than failing ' +
          'the whole article.',
        properties: {
          id: { type: 'string', example: 'blk_1' },
          type: { type: 'string', enum: [...BLOCK_TYPES] },
          data: { type: 'object', additionalProperties: true },
        },
      },

      Blog: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          blog_title: { type: 'string' },
          slug: { type: 'string', nullable: true },
          topic: { type: 'string', nullable: true },
          seo_keywords: { type: 'string', nullable: true },
          secondary_keywords: { type: 'array', items: { type: 'string' } },
          blog_status: {
            type: 'integer',
            enum: Object.values(BLOG_STATUS),
            description: '0=draft, 1=published, 2=scheduled, 3=archived',
          },
          blog_status_label: { type: 'string', enum: ['draft', 'published', 'scheduled', 'archived'] },
          generation_status: { type: 'string', enum: Object.values(GENERATION_STATUS), nullable: true },
          generation_error: { type: 'string', nullable: true },
          content_blocks: { type: 'array', items: { $ref: '#/components/schemas/Block' } },
          blog_content: {
            type: 'string',
            nullable: true,
            readOnly: true,
            description: 'Rendered HTML, derived from content_blocks. Writes are ignored.',
          },
          blog_picture: { type: 'string', nullable: true, description: 'Storage-relative path.' },
          blog_picture_url: { type: 'string', nullable: true, description: 'Resolved public URL.' },
          extra_images: { type: 'array', items: { type: 'object', additionalProperties: true } },
          article_type: { type: 'string', enum: [...ARTICLE_TYPES], nullable: true },
          tone_of_voice: { type: 'string', nullable: true },
          point_of_view: { type: 'string', enum: [...POINTS_OF_VIEW], nullable: true },
          readability_level: { type: 'string', enum: [...READABILITY_LEVELS], nullable: true },
          brand_voice: {
            type: 'object',
            properties: {
              source_type: { type: 'string', enum: [...BRAND_VOICE_SOURCE_TYPES], nullable: true },
              source_ref: { type: 'string', nullable: true },
              tone: { type: 'string', nullable: true },
              pov: { type: 'string', nullable: true },
              traits: { type: 'array', items: { type: 'string' } },
              confirmed: {
                type: 'boolean',
                description:
                  'Must be true before article generation will run when a brand voice was supplied.',
              },
            },
          },
          images_config: {
            type: 'object',
            properties: {
              include_images: { type: 'boolean' },
              image_count: { type: 'integer', minimum: 1, maximum: 4 },
              image_style: { type: 'string', enum: [...IMAGE_STYLES], nullable: true },
              logo_overlay: { type: 'boolean' },
              logo_position: { type: 'string', enum: [...LOGO_POSITIONS], nullable: true },
            },
          },
          seo_structure_config: { type: 'object', additionalProperties: { type: 'boolean' } },
          outline: {
            type: 'array',
            items: {
              type: 'object',
              properties: { level: { type: 'integer' }, text: { type: 'string' } },
            },
          },
          seo_score: { type: 'integer', nullable: true, minimum: 0, maximum: 100, readOnly: true },
          word_count: { type: 'integer', nullable: true, readOnly: true },
          total_views: { type: 'integer', readOnly: true },
          serp: {
            type: 'object',
            properties: {
              keyword: { type: 'string', nullable: true },
              position: { type: 'integer', nullable: true },
              checked_at: { type: 'string', format: 'date-time', nullable: true },
              available: { type: 'boolean', description: 'False when SerpAPI is not configured.' },
            },
          },
          category: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          published_by: { type: 'string', nullable: true },
          publish_date: { type: 'string', format: 'date', nullable: true },
          start_date: { type: 'string', format: 'date', nullable: true },
          end_date: { type: 'string', format: 'date', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
    responses: {
      Unauthorized: errorResponse('Missing, expired or invalid access token.'),
      Forbidden: errorResponse('Authenticated but not permitted (wrong role, or account disabled).'),
      NotFound: errorResponse('No such resource.'),
      Conflict: errorResponse('The request conflicts with current state, e.g. a generation is running.'),
      ValidationError: errorResponse('Request validation failed. `details.fieldErrors` lists the problems.'),
      RateLimited: errorResponse('Rate limit exceeded. `details.retryAfterSeconds` says how long to wait.'),
      FeatureDisabled: errorResponse('The feature is switched off by configuration (e.g. SERPAPI_ENABLED=false).'),
      UpstreamError: errorResponse('An AI or SERP provider failed or timed out.'),
    },
  },
  // Applied to every operation; individual operations override with
  // `security: []` where they are public (login, refresh, meta).
  security: [{ bearerAuth: [] }],
};

/**
 * Mounts Swagger UI. Kept out of production, where an interactive API console on
 * an internal tool is more attack surface than convenience.
 *
 * @param {import('express').Application} app
 */
function mountSwagger(app) {
  const swaggerUi = require('swagger-ui-express');
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'Scriptura API',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        tryItOutEnabled: true,
      },
    })
  );
}

module.exports = { openApiSpec, mountSwagger, errorResponse, mergePaths };
