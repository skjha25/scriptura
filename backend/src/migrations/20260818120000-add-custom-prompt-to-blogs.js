'use strict';

/**
 * Adds `custom_prompt` to `blogs`.
 *
 * Nullable TEXT, additive only. An admin may optionally supply a free-text
 * instruction (tone, standards, anything) for one specific article via the
 * Wizard's Step 2 — when present it is given priority in that article's
 * generation prompt (see services/ai/prompts.js's articlePrompt). Every
 * existing blog simply has `custom_prompt: null`, meaning "none supplied,"
 * and generation behaves exactly as before this column existed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('blogs', 'custom_prompt', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('blogs', 'custom_prompt');
  },
};
