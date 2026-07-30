'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { AutomatedTopic } = require('../models');

/**
 * Settings API for automated topics.
 */

const getTopics = asyncHandler(async (req, res) => {
  const topics = await AutomatedTopic.findAll({
    order: [['created_at', 'DESC']],
  });
  res.json({
    data: topics.map((t) => ({
      id: t.id,
      topic: t.topic,
      created_at: t.created_at,
    })),
  });
});

const addTopic = asyncHandler(async (req, res) => {
  const { topic } = req.body;
  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return res.status(400).json({ error: { message: 'Topic is required and must be a non-empty string.' } });
  }

  const existing = await AutomatedTopic.findOne({ where: { topic: topic.trim() } });
  if (existing) {
    return res.status(409).json({ error: { message: 'Topic already exists.' } });
  }

  const newTopic = await AutomatedTopic.create({ topic: topic.trim() });
  res.status(201).json({
    data: {
      id: newTopic.id,
      topic: newTopic.topic,
      created_at: newTopic.created_at,
    },
  });
});

const deleteTopic = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const topic = await AutomatedTopic.findByPk(id);
  
  if (!topic) {
    return res.status(404).json({ error: { message: 'Topic not found.' } });
  }

  await topic.destroy();
  res.status(204).send();
});

const suggestTopics = asyncHandler(async (req, res) => {
  const { getTextProvider } = require('../services/ai');
  const provider = getTextProvider();
  
  const result = await provider.suggestTopics({ count: 5 });
  res.json({ data: result.topics });
});

module.exports = {
  getTopics,
  addTopic,
  deleteTopic,
  suggestTopics,
};
