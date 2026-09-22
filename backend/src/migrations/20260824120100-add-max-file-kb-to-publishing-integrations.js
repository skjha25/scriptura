'use strict';

/**
 * `max_file_kb` — only meaningful for `request_format: 'multipart'`
 * integrations with a `kind: 'file'` field mapped (currently just the
 * featured image). DivineTalk's real endpoint validates `blog_picture` with
 * Laravel's `max:2048` (KB) rule; Scriptura's generated images run
 * ~2.6-2.9MB, well over that, so every delivery would 422 without
 * compressing down first. Null = no cap enforced (existing/JSON
 * integrations, or a client with no stated limit).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('publishing_integrations', 'max_file_kb', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('publishing_integrations', 'max_file_kb');
  },
};
