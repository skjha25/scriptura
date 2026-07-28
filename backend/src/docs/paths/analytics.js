'use strict';

/** OpenAPI path fragment for /analytics. Merged by src/docs/index.js. */

module.exports = {
  '/analytics/overview': {
    get: {
      tags: ['Analytics'],
      summary: 'Everything the dashboard renders',
      description:
        'Totals, the time-series and distribution charts, top keywords, category breakdown and ' +
        'recent activity in one request. The `serp_rank` block is present only when SerpAPI is ' +
        'configured — check `meta.serp_enabled` rather than assuming.',
      parameters: [
        {
          name: 'months',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 36, default: 7 },
          description:
            'Window for the time-series charts. Bounded because the aggregation walks rows in ' +
            'application code rather than in SQL.',
        },
      ],
      responses: {
        200: {
          description: 'Dashboard aggregates.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      totals: {
                        type: 'object',
                        properties: {
                          total: { type: 'integer' },
                          draft: { type: 'integer' },
                          published: { type: 'integer' },
                          scheduled: { type: 'integer' },
                          archived: { type: 'integer' },
                          total_views: { type: 'integer' },
                          avg_seo_score: { type: 'number', nullable: true },
                          avg_word_count: { type: 'number', nullable: true },
                          in_flight: { type: 'integer' },
                          generation: { type: 'object', additionalProperties: { type: 'integer' } },
                        },
                      },
                      status_breakdown: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            status: { type: 'integer' },
                            label: { type: 'string' },
                            count: { type: 'integer' },
                          },
                        },
                      },
                      published_over_time: {
                        type: 'array',
                        description: 'Gap-filled monthly series; months with no posts appear as 0.',
                        items: {
                          type: 'object',
                          properties: {
                            month: { type: 'string', example: '2026-07' },
                            count: { type: 'integer' },
                          },
                        },
                      },
                      word_count_trend: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true },
                      },
                      seo_score_trend: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true },
                      },
                      seo_score_distribution: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            label: { type: 'string', example: '81–100' },
                            range: { type: 'array', items: { type: 'integer' } },
                            count: { type: 'integer' },
                          },
                        },
                      },
                      top_keywords: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true },
                      },
                      category_breakdown: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true },
                      },
                      recent: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      serp_rank: {
                        type: 'array',
                        description: 'Present only when SerpAPI is enabled.',
                        items: { type: 'object', additionalProperties: true },
                      },
                      meta: {
                        type: 'object',
                        properties: {
                          months: { type: 'integer' },
                          serp_enabled: { type: 'boolean' },
                          generated_at: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/analytics/in-flight': {
    get: {
      tags: ['Analytics'],
      summary: 'Generations currently queued or running',
      description: 'Polled by the dashboard to show live generation progress.',
      responses: {
        200: {
          description: 'In-flight generations.',
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
                        generation_status: { type: 'string', enum: ['queued', 'generating'] },
                        started_at: { type: 'string', format: 'date-time' },
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
};
