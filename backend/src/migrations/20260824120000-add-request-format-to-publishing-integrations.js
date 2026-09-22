'use strict';

/**
 * Adds `request_format` to `publishing_integrations`. Built for DivineTalk's
 * real endpoint (`POST /api/blog-info/save`), which validates `blog_picture`
 * with Laravel's `image` rule — that requires an actual uploaded file, not a
 * URL string, so delivery for that integration must send
 * `multipart/form-data` instead of the JSON body every other integration
 * still uses. Per-integration, not global, since other clients may stay JSON.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('publishing_integrations', 'request_format', {
      type: Sequelize.ENUM('json', 'multipart'),
      allowNull: false,
      defaultValue: 'json',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('publishing_integrations', 'request_format');
  },
};
