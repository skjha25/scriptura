'use strict';

/**
 * Brand-voice analysis endpoint.
 *
 * Handles both request shapes for one logical action:
 *   - `application/json` with `{source_type: 'text'|'web_scrape', ...}`
 *   - `multipart/form-data` with `source_type=file_upload` and a `file` part
 *
 * One endpoint rather than two because the wizard presents one control with three
 * tabs; splitting it would push the "which URL do I call?" decision into the
 * frontend for no gain.
 *
 * The response deliberately reports `confirmed: false` and says so in a message.
 * Section 4 Step 2 requires an explicit human confirmation before the voice may
 * shape an article, and services/generation.js enforces it — so the analyze
 * response is a proposal, and the API should read like one.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const brandVoice = require('../services/brandVoice');
const { BRAND_VOICE_SOURCE_TYPES } = require('../constants');

/**
 * POST /brand-voice/analyze
 */
const analyze = asyncHandler(async (req, res) => {
  const sourceType = req.body.source_type;

  if (sourceType === 'file_upload' && !req.file) {
    // Multer has already rejected wrong types and oversized files; reaching here
    // means the `file` part was simply absent.
    throw ApiError.unprocessable(
      `A file is required when source_type is "file_upload". Send it as the "file" part of a ` +
        `multipart/form-data request (${brandVoice.ALLOWED_FILE_EXTENSIONS.join(' or ')}).`,
      { code: 'FILE_REQUIRED' }
    );
  }

  const analysis = await brandVoice.analyzeBrandVoice({
    sourceType,
    text: req.body.text,
    url: req.body.url,
    file: req.file,
  });

  // Attaching to a blog is optional and non-destructive: the derived fields are
  // written, `brand_voice_confirmed` is explicitly reset to false. A re-analysis
  // must invalidate a previous confirmation, or an editor could confirm voice A
  // and silently generate with voice B.
  let attachedTo = null;
  if (req.body.blog_id !== undefined) {
    const { Blog } = require('../models');
    const blog = await Blog.findByPk(req.body.blog_id);
    if (!blog) throw ApiError.notFound(`Blog ${req.body.blog_id} was not found.`);

    blog.brand_voice_source_type = analysis.source_type;
    blog.brand_voice_source_ref = analysis.source_ref;
    blog.brand_voice_tone = analysis.tone;
    blog.brand_voice_pov = analysis.pov;
    blog.brand_voice_traits = analysis.traits;
    blog.brand_voice_confirmed = false;
    await blog.save();
    attachedTo = Number(blog.id);
  }

  res.json({
    ...analysis,
    attached_to_blog_id: attachedTo,
    supported_source_types: BRAND_VOICE_SOURCE_TYPES,
    message:
      'Review the tone, point of view and style rules, edit anything that is wrong, then confirm. ' +
      'Article generation is blocked until the voice is confirmed.',
  });
});

module.exports = { analyze };
