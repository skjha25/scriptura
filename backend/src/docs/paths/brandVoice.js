'use strict';

/**
 * OpenAPI 3.0 path fragment for /brand-voice.
 *
 * Keyed by path string, merged by src/docs/index.js. Paths omit the `/api/v1`
 * prefix, which the root document's server object supplies.
 *
 * The one endpoint accepts two content types for the same logical action, so both
 * are documented on the same operation via a `requestBody` with two entries —
 * that is what tells a generated client it may send either.
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
              code: { type: 'string', example: 'URL_NOT_ALLOWED' },
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

const analysisResponse = {
  type: 'object',
  properties: {
    source_type: { type: 'string', enum: ['text', 'web_scrape', 'file_upload'] },
    source_ref: {
      type: 'string',
      nullable: true,
      description:
        'Provenance. For a scrape this is the URL actually read, after redirects — not necessarily ' +
        'the one submitted. For an upload it is the original filename.',
      example: 'https://divinetalk.in/blog/transits',
    },
    sample_length: {
      type: 'integer',
      description: 'Characters of the sample sent to the model, after the token-cost cap.',
    },
    tone: { type: 'string', nullable: true, example: 'Calm, evidence-aware, reassuring' },
    pov: {
      type: 'string',
      nullable: true,
      enum: ['first_person_singular', 'first_person_plural', 'second_person', 'third_person'],
    },
    traits: {
      type: 'array',
      items: { type: 'string' },
      example: ['Names the common fear, then right-sizes it', 'Prefers concrete examples'],
    },
    summary: { type: 'string', nullable: true },
    confirmed: {
      type: 'boolean',
      enum: [false],
      description:
        'Always false. A human must review and confirm the voice before it may shape an article; ' +
        'article generation is refused with 422 BRAND_VOICE_NOT_CONFIRMED until they do.',
    },
    attached_to_blog_id: {
      type: 'integer',
      nullable: true,
      description:
        'Set when `blog_id` was supplied. Writing the analysis also resets ' +
        '`brand_voice_confirmed` to false on that row, so a re-analysis invalidates a previous ' +
        'confirmation.',
    },
    supported_source_types: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' },
  },
};

module.exports = {
  '/brand-voice/analyze': {
    post: {
      tags: ['Brand voice'],
      summary: 'Derive a brand voice from a writing sample',
      description:
        'Accepts pasted text, a URL to scrape, or an uploaded .txt/.docx file, and returns a tone, ' +
        'point of view, style rules and a summary.\n\n' +
        '**Security:** the `web_scrape` branch makes the server fetch a user-supplied URL, so it is ' +
        'guarded against SSRF. Non-http(s) schemes, embedded credentials, non-standard ports, ' +
        'loopback and link-local addresses, RFC1918 ranges, cloud metadata hostnames and ' +
        '`*.local`/`*.internal` names are all refused with 422 URL_NOT_ALLOWED. DNS is resolved and ' +
        'every returned address is checked, and the whole check re-runs on each redirect hop.\n\n' +
        '**Uploads:** memory storage, 2 MB limit, `.txt` and `.docx` only, with both the mimetype ' +
        'and the extension validated.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              oneOf: [
                {
                  title: 'Pasted text',
                  type: 'object',
                  additionalProperties: false,
                  required: ['source_type', 'text'],
                  properties: {
                    source_type: { type: 'string', enum: ['text'] },
                    text: {
                      type: 'string',
                      minLength: 200,
                      maxLength: 40000,
                      description: 'At least 200 characters of real published copy.',
                    },
                    blog_id: { type: 'integer', minimum: 1 },
                  },
                },
                {
                  title: 'Scrape a URL',
                  type: 'object',
                  additionalProperties: false,
                  required: ['source_type', 'url'],
                  properties: {
                    source_type: { type: 'string', enum: ['web_scrape'] },
                    url: {
                      type: 'string',
                      format: 'uri',
                      maxLength: 2000,
                      example: 'https://divinetalk.in/blog/transits',
                    },
                    blog_id: { type: 'integer', minimum: 1 },
                  },
                },
              ],
            },
          },
          'multipart/form-data': {
            schema: {
              title: 'Upload a file',
              type: 'object',
              required: ['source_type', 'file'],
              properties: {
                source_type: { type: 'string', enum: ['file_upload'] },
                file: {
                  type: 'string',
                  format: 'binary',
                  description: '.txt or .docx, at most 2 MB.',
                },
                blog_id: { type: 'integer', minimum: 1 },
              },
            },
            encoding: {
              file: {
                contentType:
                  'text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'The derived voice — a proposal awaiting human confirmation.',
          content: { 'application/json': { schema: analysisResponse } },
        },
        401: errorResponse('Missing or invalid access token.'),
        404: errorResponse('blog_id does not exist.'),
        413: errorResponse('The uploaded file exceeds 2 MB.'),
        422: errorResponse(
          'VALIDATION_ERROR, SAMPLE_TOO_SHORT, URL_NOT_ALLOWED, TOO_MANY_REDIRECTS, ' +
            'UNSUPPORTED_FILE_TYPE, UNSUPPORTED_CONTENT_TYPE, DOCX_PARSE_FAILED or FILE_REQUIRED.'
        ),
        429: errorResponse('Generation rate limit reached — analysis calls a paid provider.'),
        502: errorResponse('SCRAPE_FAILED, or the AI provider failed after all retries.'),
      },
    },
  },
};
