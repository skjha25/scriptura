'use strict';

/**
 * Lets a republish UPDATE the client's existing post instead of creating a
 * duplicate. `endpoint_url` stays the create endpoint; when
 * `update_endpoint_url` is set AND an earlier successful delivery of the same
 * blog captured the client's post id (via `response_id_path`), delivery goes
 * here instead, with that id sent under `update_id_field` (null = 'id').
 *
 * DivineTalk: create `blog-info/save` returns the created blog; update is
 * `blog-info/update` with `id` (required|integer|exists:blogs,id) plus the
 * same fields as create, `blog_picture` nullable.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('publishing_integrations', 'update_endpoint_url', {
      type: Sequelize.STRING(2048),
      allowNull: true,
    });
    await queryInterface.addColumn('publishing_integrations', 'update_id_field', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('publishing_integrations', 'update_id_field');
    await queryInterface.removeColumn('publishing_integrations', 'update_endpoint_url');
  },
};
