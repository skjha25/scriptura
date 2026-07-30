'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const topics = [
      'Mercury Retrograde effects', 'Full Moon astrology', 'Zodiac compatibility',
      'Saturn Return meaning', 'Jupiter transit horoscope', 'Venus retrograde love',
      'Solar eclipse astrology', 'Lunar nodes karma', 'Pisces season predictions',
      'Aries season energy', 'Natal chart reading', 'Moon sign personality',
      'Horoscope weekly predictions', 'Astrology birth chart', 'Planetary alignment effects',
    ];

    const now = new Date();
    const rows = topics.map((topic) => ({
      topic,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('automated_topics', rows, { ignoreDuplicates: true });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('automated_topics', null, {});
  },
};
