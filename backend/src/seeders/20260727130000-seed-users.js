'use strict';

/**
 * Seeds Divinetalk team accounts for local development.
 *
 * All three share the same development password, printed by the seeder and
 * documented in the README:
 *
 *     Scriptura@Dev2026
 *
 * These are DEVELOPMENT credentials. The seeder refuses to run when
 * NODE_ENV=production so a demo account can never appear in a real deployment.
 */

const bcrypt = require('bcryptjs');
const config = require('../config');

const DEV_PASSWORD = 'Scriptura@Dev2026';

const TEAM = [
  {
    name: 'Shivam Kumar Jha',
    email: 'shivamkumar@divinetalk.in',
    role: 'admin',
    password: '123456',
  },
  {
    name: 'Harsh Sharma',
    email: 'harsh@divinetalk.com',
    role: 'admin',
  },
  {
    name: 'Ananya Iyer',
    email: 'ananya@divinetalk.com',
    role: 'editor',
  },
  {
    name: 'Rohit Deshpande',
    email: 'rohit@divinetalk.com',
    role: 'editor',
  },
];

module.exports = {
  async up(queryInterface) {
    if (config.isProduction) {
      throw new Error(
        'Refusing to seed demo users in production. Create real accounts instead.'
      );
    }

    const now = new Date();
    // One hash for the shared dev password: bcrypt at 12 rounds is ~250ms, so
    // hashing once instead of per-user keeps `npm run seed` snappy.
    const defaultHash = await bcrypt.hash(DEV_PASSWORD, config.bcryptRounds);

    const rows = await Promise.all(
      TEAM.map(async (member) => ({
        name: member.name,
        email: member.email,
        password_hash: member.password
          ? await bcrypt.hash(member.password, config.bcryptRounds)
          : defaultHash,
        role: member.role,
        is_active: true,
        last_login_at: null,
        token_version: 0,
        created_at: now,
        updated_at: now,
      }))
    );

    await queryInterface.bulkInsert('users_scriptura', rows);

    /* eslint-disable no-console */
    console.log(`  Seeded ${TEAM.length} users. Password for all: ${DEV_PASSWORD}`);
    TEAM.forEach((m) => console.log(`    ${m.role.padEnd(6)} ${m.email}`));
    /* eslint-enable no-console */
  },

  async down(queryInterface) {
    const { Op } = require('sequelize');
    await queryInterface.bulkDelete('users_scriptura', {
      email: { [Op.in]: TEAM.map((m) => m.email) },
    });
  },
};
