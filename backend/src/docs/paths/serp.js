'use strict';

/**
 * OpenAPI 3.0 path fragment for /serp.
 *
 * Keyed by path string, merged by src/docs/index.js. Paths omit the `/api/v1`
 * prefix, which the root document's server object supplies.
 *
 * Both operations document 503 FEATURE_DISABLED prominently, because it is the
 * expected response on any deployment that has not set SERPAPI_KEY — which the
 * spec treats as a fully supported configuration, not a misconfiguration. Clients
 * should read `features.serp_api` from `GET /meta` and hide the controls rather
 * than discover this at call time.
 */

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
              code: { type: 'string', example: 'FEATURE_DISABLED' },
              message: { type: 'string' },
              details: {
                type: 'object',
                properties: {
                  feature: { type: 'string', example: 'serp_api' },
                  flag_enabled: { type: 'boolean' },
                  has_key: { type: 'boolean' },
                },
                additionalProperties: true,
              },
            },
            required: ['code', 'message'],
          },
        },
      },
    },
  },
});

const featureDisabledResponse = errorResponse(
  'FEATURE_DISABLED — SerpAPI is switched off for this deployment. Set SERPAPI_ENABLED=true and ' +
    'SERPAPI_KEY to enable it. Every other feature works with SERP disabled.'
);

module.exports = {
  '/serp/check-rank': {
    post: {
      tags: ['SERP'],
      summary: 'Check where a domain ranks for a keyword',
      description:
        'Searches the first 100 organic results and reports the position of the given domain. ' +
        'Subdomains of the target count as a match, and the `www.` prefix is ignored.\n\n' +
        'A `position` of null with HTTP 200 means "not in the top 100" — a successful answer, not an ' +
        'error.\n\n' +
        'When `blog_id` is supplied the result is written to that row\'s `serp_rank_keyword`, ' +
        '`serp_rank_position` and `serp_rank_checked_at`, so the dashboard reads a stored value ' +
        'instead of re-querying a metered API on every page load.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['keyword', 'domain'],
              properties: {
                keyword: { type: 'string', maxLength: 255, example: 'mercury retrograde virgo' },
                domain: {
                  type: 'string',
                  maxLength: 255,
                  description: 'A hostname or a full article URL; both are reduced to a hostname.',
                  example: 'divinetalk.com',
                },
                blog_id: { type: 'integer', minimum: 1 },
                country: {
                  type: 'string',
                  pattern: '^[a-z]{2}$',
                  default: 'in',
                  description: "Google's `gl` parameter. Defaults to India.",
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'The rank lookup result.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  keyword: { type: 'string' },
                  domain: { type: 'string', example: 'divinetalk.com' },
                  position: { type: 'integer', nullable: true, example: 7 },
                  url: { type: 'string', nullable: true },
                  found: { type: 'boolean' },
                  total_results_scanned: { type: 'integer' },
                  depth_searched: { type: 'integer', example: 100 },
                  checked_at: { type: 'string', format: 'date-time' },
                  blog_id: { type: 'integer', nullable: true },
                },
              },
            },
          },
        },
        400: errorResponse('KEYWORD_REQUIRED or DOMAIN_REQUIRED.'),
        401: errorResponse('Missing or invalid access token.'),
        404: errorResponse('blog_id does not exist.'),
        422: errorResponse('Validation failed.'),
        429: errorResponse('Generation rate limit reached — SerpAPI searches are metered.'),
        502: errorResponse('SerpAPI returned an error.'),
        503: featureDisabledResponse,
        504: errorResponse('SerpAPI did not respond within the configured timeout.'),
      },
    },
  },

  '/serp/ground-facts': {
    post: {
      tags: ['SERP'],
      summary: 'Fetch current web facts for grounding',
      description:
        'Returns the top organic results, any featured answer, and related questions, both as a ' +
        'structured `sources` array (persisted with the generation config for auditability) and as a ' +
        'flattened `brief` string, which is what goes into the article prompt.\n\n' +
        'Exposed separately from generation so an editor can see what the model will be given before ' +
        'spending a run on it. All scraped text is stripped to plain text before it leaves this ' +
        'endpoint or enters a prompt.\n\n' +
        'Inside the pipeline this is best-effort: when `external_web_grounding` is true but SerpAPI ' +
        'is disabled or failing, the article is written without grounding and the run still succeeds.',
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
                topic: { type: 'string', maxLength: 255, example: 'shravan month significance' },
                keyword: {
                  type: 'string',
                  maxLength: 255,
                  description: 'Searched instead of the topic when present.',
                },
                country: { type: 'string', pattern: '^[a-z]{2}$', default: 'in' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'The grounding brief.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  sources: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        url: { type: 'string' },
                        snippet: { type: 'string' },
                      },
                    },
                  },
                  related_questions: { type: 'array', items: { type: 'string' } },
                  brief: {
                    type: 'string',
                    description: 'The flattened text actually folded into the article prompt.',
                  },
                  source_count: { type: 'integer' },
                  fetched_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        400: errorResponse('TOPIC_REQUIRED.'),
        401: errorResponse('Missing or invalid access token.'),
        422: errorResponse('Validation failed.'),
        429: errorResponse('Generation rate limit reached — SerpAPI searches are metered.'),
        502: errorResponse('SerpAPI returned an error.'),
        503: featureDisabledResponse,
        504: errorResponse('SerpAPI did not respond within the configured timeout.'),
      },
    },
  },
};
