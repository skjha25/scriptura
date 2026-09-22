'use strict';

/**
 * OpenAPI 3.0 path fragment for /generate.
 *
 * Keyed by path string, merged into the root document by src/docs/index.js. The
 * paths are written WITHOUT the `/api/v1` prefix because the server object in the
 * root document carries it — repeating it here would produce `/api/v1/api/v1/...`
 * in the generated client.
 *
 * Schemas are inlined rather than referenced from a shared components section.
 * That is a deliberate trade for a fragment file: it is self-contained and
 * reviewable next to the route it documents, at the cost of some repetition
 * across fragments.
 */

/** Reusable inline error response, matching utils/ApiError.toJSON(). */
const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
            required: ['code', 'message'],
          },
        },
      },
    },
  },
});

const brandVoiceSchema = {
  type: 'object',
  description:
    'The confirmed brand voice. `confirmed` must be true whenever `source_type` is not "none", ' +
    'or generation is refused with 422 BRAND_VOICE_NOT_CONFIRMED.',
  properties: {
    source_type: { type: 'string', enum: ['text', 'web_scrape', 'file_upload', 'none'], default: 'none' },
    source_ref: { type: 'string', nullable: true, example: 'https://divinetalk.in/blog/transits' },
    tone: { type: 'string', example: 'Calm, evidence-aware, reassuring' },
    pov: {
      type: 'string',
      enum: ['first_person_singular', 'first_person_plural', 'second_person', 'third_person'],
    },
    traits: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    summary: { type: 'string', nullable: true },
    confirmed: { type: 'boolean', default: false },
  },
};

const seoStructureSchema = {
  type: 'object',
  description:
    'Structure toggles. A false value means the generator emits no block of that kind — ' +
    '`faq: false` produces no faq_accordion, `tables: false` produces no table.',
  properties: {
    h1: { type: 'boolean', default: true },
    h2: { type: 'boolean', default: true },
    h3: { type: 'boolean', default: true },
    faq: { type: 'boolean', default: true },
    tables: { type: 'boolean', default: false },
    key_takeaways: { type: 'boolean', default: true },
    quotes: { type: 'boolean', default: false },
    lists: { type: 'boolean', default: true },
    emphasis: { type: 'boolean', default: true },
  },
};

const outlineSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      level: { type: 'integer', enum: [2, 3], default: 2 },
      text: { type: 'string', maxLength: 255, example: 'Why Mondays Carry the Most Weight' },
    },
    required: ['text'],
  },
};

const seoBreakdownSchema = {
  type: 'object',
  description: 'The transparent scoring breakdown. Every criterion reports its own points and reason.',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100, example: 82 },
    breakdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string', example: 'KEYWORD_PRESENCE' },
          points: { type: 'integer', example: 25 },
          max: { type: 'integer', example: 25 },
          met: { type: 'boolean' },
          detail: { type: 'string', example: 'Contains the exact keyword "shravan month".' },
        },
      },
    },
  },
};

const generationConfigSchema = {
  type: 'object',
  description:
    'The full wizard submission. Persisted verbatim to `blogs.generation_config` as an audit ' +
    'snapshot, so unknown properties are rejected rather than stored.',
  additionalProperties: false,
  required: ['topic'],
  properties: {
    topic: { type: 'string', maxLength: 255, example: 'shravan month significance' },
    title: { type: 'string', maxLength: 255 },
    keyword: { type: 'string', maxLength: 255, example: 'shravan month' },
    secondary_keywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    article_type: {
      type: 'string',
      enum: ['how_to', 'listicle', 'product_review', 'comparison', 'case_study', 'general'],
      default: 'general',
    },
    tone_of_voice: { type: 'string', maxLength: 100 },
    point_of_view: {
      type: 'string',
      enum: ['first_person_singular', 'first_person_plural', 'second_person', 'third_person'],
    },
    readability_level: {
      type: 'string',
      enum: ['5th_grade', '8th_grade', 'college', 'none'],
      default: '8th_grade',
    },
    language: { type: 'string', default: 'en' },
    target_country: { type: 'string', maxLength: 100, example: 'IN' },
    target_word_count: { type: 'integer', minimum: 300, maximum: 4000, default: 1200 },
    ai_content_cleaning: { type: 'boolean', default: false },
    outline: outlineSchema,
    seo_structure_config: seoStructureSchema,
    internal_linking: { type: 'boolean', default: false },
    internal_link_targets: {
      type: 'array',
      description: 'Blog ids or slugs. Only published rows are used; the rest are silently skipped.',
      items: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
      maxItems: 20,
    },
    external_web_grounding: {
      type: 'boolean',
      default: false,
      description:
        'Fetch current web facts via SerpAPI before writing. Silently skipped when SERPAPI_ENABLED ' +
        'is false, so a request with this true still succeeds.',
    },
    brand_voice: brandVoiceSchema,
    include_images: { type: 'boolean', default: true },
    image_count: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
    image_style: { type: 'string', enum: ['photo', 'illustration', 'minimal', 'brand_colored'] },
    meta_title: { type: 'string', maxLength: 255 },
    meta_description: { type: 'string', maxLength: 500 },
  },
};

module.exports = {
  '/generate/title': {
    post: {
      tags: ['Generation'],
      summary: 'Suggest SEO titles',
      description:
        'Returns title candidates, each with its own transparent SEO breakdown from ' +
        'services/seoScore.js. Nothing is persisted — the wizard holds the suggestions until one ' +
        'is chosen. Rate-limited: each call costs money at the configured provider.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['topic'],
              properties: {
                topic: { type: 'string', maxLength: 255, example: 'mercury retrograde virgo' },
                keyword: { type: 'string', maxLength: 255, example: 'mercury retrograde virgo' },
                secondary_keywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
                article_type: {
                  type: 'string',
                  enum: ['how_to', 'listicle', 'product_review', 'comparison', 'case_study', 'general'],
                },
                tone_of_voice: { type: 'string', maxLength: 100 },
                point_of_view: {
                  type: 'string',
                  enum: [
                    'first_person_singular',
                    'first_person_plural',
                    'second_person',
                    'third_person',
                  ],
                },
                readability_level: { type: 'string', enum: ['5th_grade', '8th_grade', 'college', 'none'] },
                language: { type: 'string', default: 'en' },
                target_country: { type: 'string', maxLength: 100 },
                count: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
                brand_voice: brandVoiceSchema,
                blog_id: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Title candidates, best-scoring first.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  provider: { type: 'string', example: 'anthropic' },
                  titles: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string', example: 'Mercury Retrograde in Virgo: What It Affects' },
                        angle: { type: 'string', nullable: true, example: 'myth-busting' },
                        char_count: { type: 'integer', example: 55 },
                        seo: seoBreakdownSchema,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: errorResponse('Missing or invalid access token.'),
        422: errorResponse('Validation failed.'),
        429: errorResponse('Generation rate limit reached.'),
        502: errorResponse('The AI provider failed after all retries.'),
      },
    },
  },

  '/generate/outline': {
    post: {
      tags: ['Generation'],
      summary: 'Generate an article outline',
      description:
        'Produces `[{level, text}]` matching the `blogs.outline` column. When `blog_id` is ' +
        'supplied the outline is saved to that row, which is how the wizard hands an ' +
        'edited outline to the article step. Refused with 409 while a generation is in flight.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['topic'],
              properties: {
                topic: { type: 'string', maxLength: 255 },
                title: { type: 'string', maxLength: 255 },
                keyword: { type: 'string', maxLength: 255 },
                secondary_keywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
                article_type: {
                  type: 'string',
                  enum: ['how_to', 'listicle', 'product_review', 'comparison', 'case_study', 'general'],
                },
                tone_of_voice: { type: 'string', maxLength: 100 },
                point_of_view: {
                  type: 'string',
                  enum: [
                    'first_person_singular',
                    'first_person_plural',
                    'second_person',
                    'third_person',
                  ],
                },
                readability_level: { type: 'string', enum: ['5th_grade', '8th_grade', 'college', 'none'] },
                language: { type: 'string', default: 'en' },
                target_country: { type: 'string', maxLength: 100 },
                target_word_count: { type: 'integer', minimum: 300, maximum: 4000, default: 1200 },
                seo_structure_config: seoStructureSchema,
                external_web_grounding: { type: 'boolean', default: false },
                brand_voice: brandVoiceSchema,
                blog_id: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'The generated outline.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  provider: { type: 'string' },
                  outline: outlineSchema,
                  saved_to_blog_id: { type: 'integer', nullable: true },
                  grounding_used: {
                    type: 'boolean',
                    description: 'False when SerpAPI is disabled or the lookup failed.',
                  },
                },
              },
            },
          },
        },
        401: errorResponse('Missing or invalid access token.'),
        404: errorResponse('blog_id does not exist.'),
        409: errorResponse('A generation run is in flight for that blog.'),
        422: errorResponse('Validation failed.'),
        429: errorResponse('Generation rate limit reached.'),
        502: errorResponse('The AI provider failed after all retries.'),
      },
    },
  },

  '/generate/article': {
    post: {
      tags: ['Generation'],
      summary: 'Start an article generation run',
      description:
        'Claims the blog row and returns 202 immediately; the run continues in the background. ' +
        'Poll `/generate/status/{blogId}` until `generation_status` is "generated" or "failed".\n\n' +
        '**The blog is never published by this endpoint.** Generation ends at ' +
        '`generation_status: "generated"` with `blog_status` untouched, because a human review pass ' +
        'in the block editor is required first.\n\n' +
        '**Brand voice gate:** when `config.brand_voice.source_type` is not "none", ' +
        '`config.brand_voice.confirmed` must be true, or the request is refused with 422 ' +
        'BRAND_VOICE_NOT_CONFIRMED.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['blog_id', 'config'],
              properties: {
                blog_id: { type: 'integer', minimum: 1 },
                config: generationConfigSchema,
              },
            },
          },
        },
      },
      responses: {
        202: {
          description: 'Generation accepted and queued.',
          headers: {
            Location: { description: 'The status endpoint to poll.', schema: { type: 'string' } },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  blog_id: { type: 'integer' },
                  generation_status: { type: 'string', enum: ['queued'] },
                  queued_at: { type: 'string', format: 'date-time' },
                  poll: { type: 'string', example: '/generate/status/42' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        401: errorResponse('Missing or invalid access token.'),
        404: errorResponse('The blog does not exist.'),
        409: errorResponse('GENERATION_IN_PROGRESS — a run is already queued or generating.'),
        422: errorResponse('VALIDATION_ERROR, or BRAND_VOICE_NOT_CONFIRMED.'),
        429: errorResponse('Generation rate limit reached.'),
      },
    },
  },

  '/generate/status/{blogId}': {
    get: {
      tags: ['Generation'],
      summary: 'Poll generation status',
      description:
        'Narrow payload, safe to poll every couple of seconds. Not rate-limited, because the ' +
        'wizard depends on it while a run is in flight. The identical handler is also mounted at ' +
        '`GET /blogs/{id}/generation-status`.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'blogId',
          in: 'path',
          required: true,
          schema: { type: 'integer', minimum: 1 },
        },
      ],
      responses: {
        200: {
          description: 'Current generation state.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  blog_id: { type: 'integer' },
                  generation_status: {
                    type: 'string',
                    enum: ['draft', 'queued', 'generating', 'generated', 'failed'],
                  },
                  generation_error: { type: 'string', nullable: true },
                  seo_score: { type: 'integer', nullable: true, minimum: 0, maximum: 100 },
                  word_count: { type: 'integer', nullable: true },
                  updated_at: { type: 'string', format: 'date-time' },
                  is_in_flight: { type: 'boolean' },
                },
              },
            },
          },
        },
        401: errorResponse('Missing or invalid access token.'),
        404: errorResponse('The blog does not exist.'),
        422: errorResponse('The blog id is not a positive integer.'),
      },
    },
  },

  '/generate/reap-stale': {
    post: {
      tags: ['Generation'],
      summary: 'Recover interrupted generations (admin)',
      description:
        'Moves rows left in `queued`/`generating` by a server restart to `failed`, so the user can ' +
        'retry. This exists because generation runs in-process rather than on a durable queue — see ' +
        'the header of src/services/generation.js. Rows this process is actively generating are ' +
        'never reaped.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                older_than_ms: {
                  type: 'integer',
                  minimum: 0,
                  default: 1800000,
                  description: 'Age threshold in milliseconds. Default 30 minutes.',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'How many rows were recovered.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reaped: { type: 'integer' },
                  blog_ids: { type: 'array', items: { type: 'integer' } },
                  in_flight_statuses: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        401: errorResponse('Missing or invalid access token.'),
        403: errorResponse('Requires the admin role.'),
      },
    },
  },
};
