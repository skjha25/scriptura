// backend/tests/unit/actionExecutors.test.js
'use strict';

/**
 * P1-B4 tests: services/agents/actionExecutors.js (the registered-action-type
 * → real Blog mutation registry) plus services/agents/recommendationActions.js's
 * createAction/executeAction integration with it, isolated against an
 * in-memory SQLite instance built from the real model factories — same
 * pattern as recommendationActions.test.js (P1-B1). No real DB or network is
 * touched by this file.
 */

jest.mock('../../src/models', () => {
  const { Sequelize } = require('sequelize');
  const sqlite = new Sequelize('sqlite::memory:', { logging: false });
  const User = require('../../src/models/user')(sqlite);
  const AgentActivity = require('../../src/models/agentActivity')(sqlite);
  const AgentRecommendation = require('../../src/models/agentRecommendation')(sqlite);
  const RecommendationAction = require('../../src/models/recommendationAction')(sqlite);
  const Blog = require('../../src/models/blog')(sqlite);

  AgentRecommendation.belongsTo(AgentActivity, { foreignKey: 'source_activity_id', as: 'sourceActivity', constraints: false });
  AgentRecommendation.belongsTo(User, { foreignKey: 'decided_by', as: 'decidedByUser', constraints: false });
  AgentRecommendation.hasMany(RecommendationAction, { foreignKey: 'recommendation_id', as: 'actions' });
  RecommendationAction.belongsTo(AgentRecommendation, { foreignKey: 'recommendation_id', as: 'recommendation' });
  RecommendationAction.belongsTo(User, { foreignKey: 'executed_by', as: 'executedByUser', constraints: false });

  return { User, AgentActivity, AgentRecommendation, RecommendationAction, Blog, sequelize: sqlite, Sequelize };
});

const { AGENT_NAMES } = require('../../src/constants');
const { AgentRecommendation, RecommendationAction, Blog, sequelize } = require('../../src/models');
const { getExecutor } = require('../../src/services/agents/actionExecutors');
const {
  createAction,
  completeAction,
  failAction,
  cancelAction,
  executeAction,
} = require('../../src/services/agents/recommendationActions');

async function makeApprovedRecommendation(overrides = {}) {
  return AgentRecommendation.create({
    trace_id: 'trace-parent',
    agent_name: AGENT_NAMES.SEO_ANALYST,
    recommendation_type: 'recommend_seo_action',
    recommendation_details: { recommendation: 'Update SEO fields on Article #1.', rationale: 'x' },
    status: 'approved',
    decided_by: 1,
    decided_at: new Date(),
    ...overrides,
  });
}

async function makeBlog(overrides = {}) {
  return Blog.create({
    blog_title: 'P1-B4 test blog',
    meta_title: 'Old title',
    meta_description: 'Old description',
    content_blocks: [
      { id: 'block-1', type: 'paragraph', data: { text: 'Old text' } },
      { id: 'block-2', type: 'paragraph', data: { text: 'Second block' } },
    ],
    ...overrides,
  });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await RecommendationAction.destroy({ truncate: true });
  await AgentRecommendation.destroy({ truncate: true });
  await Blog.destroy({ truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('actionExecutors registry — executor units', () => {
  test('blog.update_seo_fields patches only the supplied fields and captures real before/after', async () => {
    const blog = await makeBlog();
    const executor = getExecutor('blog.update_seo_fields');
    const result = await executor.execute(blog, { blog_id: blog.id, meta_title: 'New title' });

    expect(result.before).toEqual({ meta_title: 'Old title' });
    expect(result.after).toEqual({ meta_title: 'New title' });
    expect(result.mutatedFields).toEqual(['meta_title']);

    const reloaded = await Blog.findByPk(blog.id);
    expect(reloaded.meta_title).toBe('New title');
    expect(reloaded.meta_description).toBe('Old description'); // untouched
  });

  test('blog.update_block replaces only the targeted block and rides beforeSave regen', async () => {
    const blog = await makeBlog();
    const executor = getExecutor('blog.update_block');
    const result = await executor.execute(blog, {
      blog_id: blog.id,
      block_id: 'block-2',
      new_data: { text: 'Updated second block' },
    });

    expect(result.before).toEqual({ text: 'Second block' });
    expect(result.after).toEqual({ text: 'Updated second block' });
    expect(result.mutatedFields).toEqual(['content_blocks']);

    const reloaded = await Blog.findByPk(blog.id);
    expect(reloaded.content_blocks[0].data).toEqual({ text: 'Old text' }); // untouched
    expect(reloaded.content_blocks[1].data).toEqual({ text: 'Updated second block' });
    expect(reloaded.word_count).toBeGreaterThan(0); // beforeSave hook actually ran
  });

  test('blog.update_block on a missing block id fails cleanly, no mutation', async () => {
    const blog = await makeBlog();
    const executor = getExecutor('blog.update_block');
    await expect(
      executor.execute(blog, { blog_id: blog.id, block_id: 'nonexistent', new_data: { text: 'x' } })
    ).rejects.toMatchObject({ statusCode: 400, code: 'BLOCK_NOT_FOUND' });

    const reloaded = await Blog.findByPk(blog.id);
    expect(reloaded.content_blocks[1].data).toEqual({ text: 'Second block' });
  });

  test('unregistered action_type has no executor', () => {
    expect(getExecutor('update_blog_content')).toBeNull();
  });
});

describe('createAction — registry integration', () => {
  test('a registered action_type validates parameters and is created as executor_type:automated', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'Proposed title' },
    });
    expect(action.executor_type).toBe('automated');
    expect(action.parameters).toEqual({ blog_id: blog.id, meta_title: 'Proposed title' });
  });

  test('an unregistered action_type is still created as executor_type:manual — zero regression', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    expect(action.executor_type).toBe('manual');
  });

  test('invalid parameters for a registered action_type are rejected at creation — row never exists', async () => {
    const rec = await makeApprovedRecommendation();
    await expect(
      createAction(rec.id, { actionType: 'blog.update_seo_fields', parameters: { blog_id: 'not-a-number' } })
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_ACTION_PARAMETERS' });
    expect(await RecommendationAction.count({ where: { recommendation_id: rec.id } })).toBe(0);
  });

  test('parameters.blog_id mismatching the recommendation target_ref.blog_id is rejected', async () => {
    const blog = await makeBlog();
    const otherBlog = await makeBlog({ blog_title: 'A different blog' });
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    await expect(
      createAction(rec.id, {
        actionType: 'blog.update_seo_fields',
        parameters: { blog_id: otherBlog.id, meta_title: 'x' },
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'ACTION_TARGET_MISMATCH' });
  });

  test('parameters.blog_id matching target_ref.blog_id is accepted', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation({ target_ref: { blog_id: blog.id } });
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'x' },
    });
    expect(action.executor_type).toBe('automated');
  });
});

describe('executeAction — the real mutation path', () => {
  test('happy path: mutates the blog, completes the action, records result_summary', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'Executed title' },
    });

    const completed = await executeAction(action.id, { userId: 7 });
    expect(completed.status).toBe('completed');
    expect(completed.executed_by).toBe(7);
    expect(completed.result_summary).toMatchObject({
      action_type: 'blog.update_seo_fields',
      blog_id: blog.id,
      before: { meta_title: 'Old title' },
      after: { meta_title: 'Executed title' },
      mutated_fields: ['meta_title'],
    });

    const reloaded = await Blog.findByPk(blog.id);
    expect(reloaded.meta_title).toBe('Executed title');
  });

  test('execute() is rejected (409) on a manual (non-automated) action', async () => {
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, { actionType: 'update_blog_content' });
    await expect(executeAction(action.id, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTION_NOT_AUTOMATED',
    });
  });

  test('execute() on an already-completed automated action is a 409, not a silent no-op, and does not re-run the mutation', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'First execution' },
    });
    await executeAction(action.id, { userId: 7 });

    // A second, out-of-band write simulates "if execute() ran again" —
    // asserting it does NOT happen proves the 409 actually blocks re-entry.
    await expect(executeAction(action.id, { userId: 9 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTION_NOT_PENDING',
    });

    const reloaded = await Blog.findByPk(blog.id);
    expect(reloaded.meta_title).toBe('First execution'); // unchanged by the rejected second call
  });

  test('two concurrent execute() calls on the same pending action: only one wins the claim and mutates', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'Race winner' },
    });

    const results = await Promise.allSettled([
      executeAction(action.id, { userId: 7 }),
      executeAction(action.id, { userId: 9 }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ statusCode: 409, code: 'ACTION_ALREADY_CLAIMED' });

    const reloaded = await Blog.findByPk(blog.id);
    expect(reloaded.meta_title).toBe('Race winner'); // mutated exactly once
  });

  test('a thrown error during execute() transitions the action to failed, with no mutation persisted', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_block',
      parameters: { blog_id: blog.id, block_id: 'does-not-exist', new_data: { text: 'x' } },
    });

    await expect(executeAction(action.id, { userId: 7 })).rejects.toMatchObject({ code: 'BLOCK_NOT_FOUND' });

    const reloadedAction = await RecommendationAction.findByPk(action.id);
    expect(reloadedAction.status).toBe('failed');
    expect(reloadedAction.error).toMatch(/does-not-exist/);

    const reloadedBlog = await Blog.findByPk(blog.id);
    expect(reloadedBlog.content_blocks[0].data).toEqual({ text: 'Old text' }); // untouched
  });

  test('completeAction / failAction are rejected (409) for automated actions', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'x' },
    });

    await expect(completeAction(action.id, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTION_IS_AUTOMATED',
    });
    await expect(failAction(action.id, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTION_IS_AUTOMATED',
    });
  });

  test('cancelAction still works for a pending automated action', async () => {
    const blog = await makeBlog();
    const rec = await makeApprovedRecommendation();
    const action = await createAction(rec.id, {
      actionType: 'blog.update_seo_fields',
      parameters: { blog_id: blog.id, meta_title: 'x' },
    });
    const cancelled = await cancelAction(action.id, { userId: 1 });
    expect(cancelled.status).toBe('cancelled');
  });
});
