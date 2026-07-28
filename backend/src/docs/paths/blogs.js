'use strict';

/** OpenAPI path fragment for /blogs. Merged by src/docs/index.js. */

const { BLOG_STATUS, GENERATION_STATUS } = require('../../constants');
const { SORTABLE_COLUMNS } = require('../../validators/blog.validators');

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Numeric blog id.',
};

const blogResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { data: { $ref: '#/components/schemas/Blog' } },
      },
    },
  },
});

/**
 * Fields a client may write. Server-owned columns (seo_score, word_count,
 * total_views, generation_status, serp_rank_*) are absent by design — the
 * validators strip them, so posting them has no effect.
 */
const writableBlogProperties = {
  blog_title: { type: 'string', maxLength: 255 },
  slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
  topic: { type: 'string', nullable: true },
  seo_keywords: { type: 'string', nullable: true },
  secondary_keywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
  meta_title: { type: 'string', nullable: true },
  meta_description: { type: 'string', nullable: true },
  og_image: { type: 'string', nullable: true },
  canonical_url: { type: 'string', nullable: true },
  content_blocks: {
    type: 'array',
    maxItems: 500,
    items: { $ref: '#/components/schemas/Block' },
    description:
      'The editable source of truth. Sending this regenerates blog_content, word_count and ' +
      'seo_score on the same save.',
  },
  article_type: { type: 'string', nullable: true },
  tone_of_voice: { type: 'string', nullable: true },
  point_of_view: { type: 'string', nullable: true },
  target_country: { type: 'string', nullable: true },
  language: { type: 'string', default: 'en' },
  readability_level: { type: 'string', nullable: true },
  ai_content_cleaning: { type: 'boolean' },
  brand_voice_source_type: { type: 'string', nullable: true },
  brand_voice_source_ref: { type: 'string', nullable: true },
  brand_voice_tone: { type: 'string', nullable: true },
  brand_voice_pov: { type: 'string', nullable: true },
  brand_voice_traits: { type: 'array', items: { type: 'string' } },
  brand_voice_confirmed: {
    type: 'boolean',
    description: 'Set true once a human has reviewed the AI-derived voice. Gates generation.',
  },
  include_images: { type: 'boolean' },
  image_count: { type: 'integer', minimum: 1, maximum: 4 },
  image_style: { type: 'string', nullable: true },
  logo_overlay: { type: 'boolean' },
  logo_position: { type: 'string', nullable: true },
  blog_picture: { type: 'string', nullable: true, description: 'Storage-relative path, not a URL.' },
  extra_images: { type: 'array', items: { type: 'object', additionalProperties: true } },
  seo_structure_config: { type: 'object', additionalProperties: { type: 'boolean' } },
  internal_linking: { type: 'boolean' },
  internal_link_targets: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
  external_web_grounding: {
    type: 'boolean',
    description: 'SerpAPI fact grounding. Ignored when SerpAPI is not configured.',
  },
  outline: {
    type: 'array',
    items: {
      type: 'object',
      properties: { level: { type: 'integer', minimum: 2, maximum: 4 }, text: { type: 'string' } },
    },
  },
  blog_status: {
    oneOf: [
      { type: 'integer', enum: Object.values(BLOG_STATUS) },
      { type: 'string', enum: ['draft', 'published', 'scheduled', 'archived'] },
    ],
    description: 'Accepts the numeric value or its label. Ignored on create (always draft).',
  },
  published_by: { type: 'string', nullable: true },
  publish_date: { type: 'string', format: 'date', nullable: true },
  start_date: { type: 'string', format: 'date', nullable: true },
  end_date: { type: 'string', format: 'date', nullable: true },
  category: { type: 'string', nullable: true },
  tags: { type: 'array', items: { type: 'string' }, maxItems: 30 },
};

module.exports = {
  '/blogs': {
    get: {
      tags: ['Blogs'],
      summary: 'List blogs',
      description:
        'Paginated and filterable. Omits `blog_content` — it is the largest column and a full ' +
        'page of it would be megabytes. Use `GET /blogs/{id}` for the rendered HTML.',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string' },
          description:
            'Numeric value or label; comma-separate for several, e.g. `draft,scheduled` or `0,2`.',
        },
        {
          name: 'generation_status',
          in: 'query',
          schema: { type: 'string', enum: Object.values(GENERATION_STATUS) },
        },
        { name: 'category', in: 'query', schema: { type: 'string' } },
        {
          name: 'q',
          in: 'query',
          schema: { type: 'string' },
          description: 'Free-text search across blog_title, topic and seo_keywords.',
        },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: [...SORTABLE_COLUMNS], default: 'created_at' } },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' } },
        {
          name: 'include_deleted',
          in: 'query',
          schema: { type: 'boolean', default: false },
          description: 'Admin only. Includes soft-deleted rows; ignored for editors.',
        },
      ],
      responses: {
        200: {
          description: 'A page of blogs. `X-Total-Count` carries the unpaginated total.',
          headers: {
            'X-Total-Count': { schema: { type: 'integer' }, description: 'Total matching rows.' },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Blog' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/ValidationError' },
      },
    },

    post: {
      tags: ['Blogs'],
      summary: 'Create a blog',
      description:
        "The wizard's first save: persists configuration before generation runs, so a mid-wizard " +
        'refresh loses nothing. Always created as a draft with `generation_status: draft` — a ' +
        'requested `blog_status` is overridden, because publishing must go through ' +
        '`POST /blogs/{id}/publish` and its review gate.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['blog_title'],
              properties: writableBlogProperties,
            },
          },
        },
      },
      responses: {
        201: blogResponse('Created.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        409: { $ref: '#/components/responses/Conflict' },
        422: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/blogs/linkable': {
    get: {
      tags: ['Blogs'],
      summary: 'Published blogs available as internal-link targets',
      description:
        "Backs the wizard's internal-link picker. Only published articles are returned — linking " +
        'to a draft would emit a dead link on the public site.',
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search term.' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        {
          name: 'exclude_id',
          in: 'query',
          schema: { type: 'integer' },
          description: 'The blog being edited, so it is not offered as a link to itself.',
        },
      ],
      responses: {
        200: {
          description: 'Candidate link targets.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        blog_title: { type: 'string' },
                        slug: { type: 'string', nullable: true },
                        topic: { type: 'string', nullable: true },
                        seo_keywords: { type: 'string', nullable: true },
                        publish_date: { type: 'string', format: 'date', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/blogs/{id}': {
    get: {
      tags: ['Blogs'],
      summary: 'Get one blog',
      description: 'Full record, including `content_blocks` and the derived `blog_content` HTML.',
      parameters: [idParam],
      responses: {
        200: blogResponse('The blog.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },

    patch: {
      tags: ['Blogs'],
      summary: 'Update a blog',
      description:
        'Partial update; at least one field is required. Sending `content_blocks` regenerates ' +
        '`blog_content`, `word_count` and `seo_score` — this is what the block editor autosave ' +
        'calls. Returns 409 while a generation run is writing to the same row.',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', minProperties: 1, properties: writableBlogProperties },
          },
        },
      },
      responses: {
        200: blogResponse('Updated.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
        422: { $ref: '#/components/responses/ValidationError' },
      },
    },

    delete: {
      tags: ['Blogs'],
      summary: 'Soft-delete a blog',
      description:
        'Sets `deleted_at`. Nothing in this application hard-deletes: the table is shared with ' +
        'other systems and a removed row would be unrecoverable for all of them.',
      parameters: [idParam],
      responses: {
        200: {
          description: 'Moved to trash.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      deleted_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },

  '/blogs/{id}/publish': {
    post: {
      tags: ['Blogs'],
      summary: 'Publish or schedule a blog',
      description:
        'Refuses with 422 when the blog has no usable content, or when its last generation run ' +
        'failed or is still running — publishing then would put a broken page on the public site. ' +
        '`publish_date` defaults to today for an immediate publish and is required when scheduling.',
      parameters: [idParam],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                publish_date: { type: 'string', format: 'date', nullable: true },
                scheduled: {
                  type: 'boolean',
                  description: 'True sets status to scheduled instead of published.',
                },
              },
            },
          },
        },
      },
      responses: {
        200: blogResponse('Published or scheduled.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        422: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/blogs/{id}/restore': {
    post: {
      tags: ['Blogs'],
      summary: 'Restore a soft-deleted blog',
      description: 'Admin only. The counterpart to the soft delete.',
      parameters: [idParam],
      responses: {
        200: blogResponse('Restored.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },

  '/blogs/{id}/generation-status': {
    get: {
      tags: ['Blogs', 'Generation'],
      summary: 'Poll generation status for a blog',
      description:
        'Polled by the wizard between submitting a generation and landing in the block editor. ' +
        'Transitions run `queued` → `generating` → `generated` | `failed`; on failure ' +
        '`generation_error` explains why and the run can be retried.',
      parameters: [idParam],
      responses: {
        200: {
          description: 'Current generation state.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      generation_status: { type: 'string', enum: Object.values(GENERATION_STATUS) },
                      generation_error: { type: 'string', nullable: true },
                      seo_score: { type: 'integer', nullable: true },
                      word_count: { type: 'integer', nullable: true },
                      updated_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
};
