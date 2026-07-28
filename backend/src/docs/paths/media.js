'use strict';

/**
 * OpenAPI 3.0 path fragment for /media, merged by src/docs/index.js.
 *
 * Keys are relative to the API prefix (the spec's `servers` entry carries
 * `/api/v1`), matching the other fragments in this folder.
 *
 * Written by hand rather than generated from the Zod schemas: the interesting
 * parts of these endpoints — that the response holds a storage-relative path and
 * NOT a URL, that content type is verified from the bytes, that a missing logo
 * degrades instead of failing — are contracts a generator cannot express, and
 * they are exactly what a consumer needs to be told.
 */

const {
  IMAGE_STYLES,
  LOGO_POSITIONS,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
} = require('../../constants');

/** The shape every /media endpoint returns for one stored asset. */
const mediaAsset = {
  type: 'object',
  properties: {
    relativePath: {
      type: 'string',
      description:
        'Storage-relative path, `blogs/{Month}{Year}/{32 alphanumerics}.{ext}`. ' +
        'THIS is the value to persist in blogs.blog_picture or ' +
        'blogs.extra_images[].url — never publicUrl, which changes with the ' +
        'storage driver.',
      example: 'blogs/July2026/Mkz67Ed9NRSC9sTzvmLWbJyNbf1cSt0n85YmSG9q.png',
    },
    publicUrl: {
      type: 'string',
      description:
        'Fetchable URL for the same asset, derived from the active storage ' +
        'driver. For display only.',
      example: '/uploads/blogs/July2026/Mkz67Ed9NRSC9sTzvmLWbJyNbf1cSt0n85YmSG9q.png',
    },
    width: { type: 'integer', example: 1024 },
    height: { type: 'integer', example: 1024 },
    format: { type: 'string', enum: ['png', 'jpeg', 'webp'], example: 'png' },
    bytes: { type: 'integer', example: 284511 },
    contentType: { type: 'string', example: 'image/png' },
    alt_text: {
      type: 'string',
      description: 'HTML-escaped. Defaulted from the topic when not supplied.',
    },
    has_logo_overlay: {
      type: 'boolean',
      description:
        'Whether a logo was actually burned in. False when the overlay was ' +
        'requested but no logo file could be found — the image is still stored.',
    },
    logo_position: { type: 'string', enum: [...LOGO_POSITIONS] },
  },
};

/** Shared logo-placement fields, identical across all three endpoints. */
const logoFields = {
  logo_overlay: {
    type: 'boolean',
    default: false,
    description:
      'Burn the brand logo into the stored bytes. When true and logo_position ' +
      "is 'none', the position defaults to bottom_right.",
  },
  logo_position: { type: 'string', enum: [...LOGO_POSITIONS], default: 'none' },
  size_ratio: {
    type: 'number',
    minimum: 0.02,
    maximum: 0.6,
    default: 0.18,
    description: 'Logo width as a fraction of the image width.',
  },
  opacity: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    default: 0.9,
    description: "Applied to the logo's alpha channel only; the base image is untouched.",
  },
};

const errorResponse = { $ref: '#/components/schemas/Error' };

const responses = {
  401: { description: 'Missing, expired or invalid access token.', content: { 'application/json': { schema: errorResponse } } },
  413: { description: 'File exceeds MAX_UPLOAD_BYTES, or the image exceeds 50 megapixels.', content: { 'application/json': { schema: errorResponse } } },
  415: {
    description:
      'The bytes are not a PNG, JPEG or WebP image. Returned regardless of the ' +
      'declared Content-Type — the file signature and a decode attempt are what count.',
    content: { 'application/json': { schema: errorResponse } },
  },
  422: { description: 'Request validation failed; `details.fieldErrors` names the fields.', content: { 'application/json': { schema: errorResponse } } },
  429: { description: 'Generation rate limit reached.', content: { 'application/json': { schema: errorResponse } } },
};

module.exports = {
  '/media/upload': {
    post: {
      tags: ['Media'],
      summary: 'Upload an image',
      description:
        'Accepts a PNG, JPEG or WebP image, verifies the actual file content ' +
        '(magic bytes plus a decode attempt, not the declared Content-Type), ' +
        'strips EXIF metadata — uploaded photos routinely carry GPS coordinates ' +
        'and these files are served publicly — optionally burns in the brand ' +
        'logo, and stores the result under the production path convention.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['image'],
              properties: {
                image: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP.' },
                ...logoFields,
                alt_text: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Stored.', content: { 'application/json': { schema: mediaAsset } } },
        400: { description: 'No file supplied in the `image` field.', content: { 'application/json': { schema: errorResponse } } },
        401: responses[401],
        413: responses[413],
        415: responses[415],
        422: responses[422],
      },
    },
  },

  '/media/generate-image': {
    post: {
      tags: ['Media'],
      summary: 'Generate blog images with AI',
      description:
        `Generates ${IMAGE_COUNT_MIN}–${IMAGE_COUNT_MAX} images from a prompt or ` +
        'a topic, optionally watermarks them, and stores them. Each call is a paid ' +
        'provider request and is charged against the generation rate limit. Images ' +
        'are produced sequentially, and for count > 1 the prompt asks for a varied ' +
        'composition per image so the set does not repeat itself.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Either `prompt` or `topic` is required.',
              properties: {
                prompt: { type: 'string', maxLength: 2000, description: 'Author-written subject description.' },
                topic: { type: 'string', maxLength: 255, description: "The blog's topic; used when prompt is absent." },
                style: { type: 'string', enum: [...IMAGE_STYLES], default: 'photo' },
                count: {
                  type: 'integer',
                  minimum: IMAGE_COUNT_MIN,
                  maximum: IMAGE_COUNT_MAX,
                  default: IMAGE_COUNT_MIN,
                },
                ...logoFields,
              },
            },
            examples: {
              topicOnly: {
                summary: 'From a blog topic, watermarked',
                value: {
                  topic: 'shravan month significance',
                  style: 'brand_colored',
                  count: 2,
                  logo_overlay: true,
                  logo_position: 'bottom_right',
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Generated and stored.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  count: { type: 'integer' },
                  images: {
                    type: 'array',
                    items: {
                      allOf: [
                        mediaAsset,
                        {
                          type: 'object',
                          properties: {
                            prompt: {
                              type: 'string',
                              description: 'The full prompt sent to the provider, for audit and retry.',
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        401: responses[401],
        422: responses[422],
        429: responses[429],
        502: { description: 'The image provider failed or returned no data.', content: { 'application/json': { schema: errorResponse } } },
      },
    },
  },

  '/media/composite-logo': {
    post: {
      tags: ['Media'],
      summary: 'Apply or re-apply a logo overlay',
      description:
        'Re-watermarks an image that is already stored (pass `relative_path`) or ' +
        'a fresh upload (multipart `image`). Exactly one source is required. This ' +
        'is the cheap way to fix a logo position after generation — it is local ' +
        'CPU work only and is deliberately NOT charged against the generation ' +
        'rate limit. By default a new path is written, because the previous file ' +
        'may already be referenced by published HTML; pass `replace: true` to ' +
        'overwrite in place and keep existing references working. ' +
        "logo_position: 'none' re-stores the image with no overlay.",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['relative_path', 'logo_position'],
              properties: {
                relative_path: {
                  type: 'string',
                  description: 'Storage-relative path of an already-stored image.',
                  example: 'blogs/July2026/Mkz67Ed9NRSC9sTzvmLWbJyNbf1cSt0n85YmSG9q.png',
                },
                logo_position: { type: 'string', enum: [...LOGO_POSITIONS] },
                size_ratio: logoFields.size_ratio,
                opacity: logoFields.opacity,
                alt_text: { type: 'string', maxLength: 500 },
                replace: { type: 'boolean', default: false },
              },
            },
          },
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['image', 'logo_position'],
              properties: {
                image: { type: 'string', format: 'binary' },
                logo_position: { type: 'string', enum: [...LOGO_POSITIONS] },
                size_ratio: logoFields.size_ratio,
                opacity: logoFields.opacity,
                alt_text: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Composited and stored.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  mediaAsset,
                  {
                    type: 'object',
                    properties: {
                      sourcePath: {
                        type: 'string',
                        nullable: true,
                        description: 'The relative_path the composite was read from, or null for an upload.',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        400: { description: 'Neither source supplied, both supplied, or an unsafe relative_path.', content: { 'application/json': { schema: errorResponse } } },
        401: responses[401],
        404: { description: 'No stored file at relative_path.', content: { 'application/json': { schema: errorResponse } } },
        413: responses[413],
        415: responses[415],
        422: responses[422],
      },
    },
  },
};
