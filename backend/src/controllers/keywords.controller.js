'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ScripturaKeyword } = require('../models');
const { getTextProvider } = require('../services/ai');
const ApiError = require('../utils/ApiError');

/**
 * GET /api/v1/keywords
 */
const list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  
  const where = {};
  if (status) where.status = status;

  const { count, rows } = await ScripturaKeyword.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit, 10),
    offset,
  });

  res.json({
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(count / parseInt(limit, 10)),
    },
  });
});

/**
 * POST /api/v1/keywords
 */
const create = asyncHandler(async (req, res) => {
  const { primary_keyword, secondary_keywords = [], search_intent = 'informational' } = req.body;
  if (!primary_keyword) throw ApiError.badRequest('primary_keyword is required');
  
  const keyword = await ScripturaKeyword.create({
    primary_keyword,
    secondary_keywords,
    search_intent,
    status: 'not_used',
  });
  
  res.status(201).json({ data: keyword });
});

/**
 * PUT /api/v1/keywords/:id
 */
const update = asyncHandler(async (req, res) => {
  const keyword = await ScripturaKeyword.findByPk(req.params.id);
  if (!keyword) throw ApiError.notFound('Keyword not found');
  
  const { primary_keyword, secondary_keywords, search_intent, status } = req.body;
  
  if (primary_keyword !== undefined) keyword.primary_keyword = primary_keyword;
  if (secondary_keywords !== undefined) keyword.secondary_keywords = secondary_keywords;
  if (search_intent !== undefined) keyword.search_intent = search_intent;
  if (status !== undefined) keyword.status = status;
  
  await keyword.save();
  res.json({ data: keyword });
});

/**
 * DELETE /api/v1/keywords/:id
 */
const remove = asyncHandler(async (req, res) => {
  const keyword = await ScripturaKeyword.findByPk(req.params.id);
  if (!keyword) throw ApiError.notFound('Keyword not found');
  
  await keyword.destroy();
  res.json({ data: { id: req.params.id, deleted: true } });
});

/**
 * POST /api/v1/keywords/bulk-import
 * Bulk imports keywords. Accepts an array of objects.
 */
const bulkImport = asyncHandler(async (req, res) => {
  const keywords = Array.isArray(req.body) ? req.body : [];
  
  if (keywords.length === 0) {
    return res.status(400).json({ error: { message: 'Expected a JSON array of keywords' } });
  }

  const payload = keywords.map(kw => ({
    primary_keyword: kw.primary_keyword,
    secondary_keywords: Array.isArray(kw.secondary_keywords) ? kw.secondary_keywords : [],
    search_intent: kw.search_intent || 'informational',
    status: 'not_used',
  })).filter(kw => kw.primary_keyword); 

  await ScripturaKeyword.bulkCreate(payload);

  res.status(201).json({ message: `Successfully imported ${payload.length} keywords.` });
});

/**
 * GET /api/v1/keywords/suggest
 * Generates keyword suggestions using Claude.
 */
const suggest = asyncHandler(async (req, res) => {
  const { topic } = req.query;
  if (!topic) throw ApiError.badRequest('Topic query parameter is required for suggestions');

  const textProvider = getTextProvider();
  
  // Create a quick prompt for keyword suggestions
  const prompt = `You are an SEO expert for an astrology platform. Generate a list of 5 high-value primary SEO keywords related to the topic: "${topic}". 
  Respond ONLY with a JSON array of strings. No markdown, no explanation, just the raw array. Example: ["keyword one", "keyword two"]`;

  try {
    const raw = await textProvider.complete({
      operation: 'suggestKeywords',
      prompt,
      temperature: 0.7,
      maxTokens: 500,
    });
    
    // Attempt to parse JSON from the response
    let suggestions = [];
    const match = raw.match(/\[.*\]/s);
    if (match) {
      suggestions = JSON.parse(match[0]);
    } else {
      suggestions = JSON.parse(raw);
    }
    
    res.json({ data: suggestions });
  } catch (err) {
    throw ApiError.upstream(`Failed to generate suggestions: ${err.message}`);
  }
});

module.exports = {
  list,
  create,
  update,
  remove,
  bulkImport,
  suggest,
};
