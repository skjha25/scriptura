'use strict';

/**
 * Back-fills `slug` for rows that predate Scriptura.
 *
 * WHY THIS IS A SCRIPT AND NOT SQL
 * A good slug needs transliteration (the live titles contain Devanagari and
 * typographic punctuation) and uniqueness resolution. MySQL can do neither well,
 * and hand-rolling it in SQL would produce slugs that differ from the ones the
 * application generates — so this reuses `src/services/slug.js` directly and the
 * two cannot disagree.
 *
 * WHY IT IS SEPARATE FROM THE DDL
 * 001-add-ai-columns.sql only adds columns; it never writes to an existing row.
 * This is the one adoption step that modifies live data, so it is opt-in, has a
 * dry run, and is the last thing you do.
 *
 * USAGE
 *   node scripts/prod-adoption/backfill-slugs.js --dry-run      # report only
 *   node scripts/prod-adoption/backfill-slugs.js --commit       # write
 *   node scripts/prod-adoption/backfill-slugs.js --commit --limit 500
 *
 * Reads database credentials from backend/.env, like the rest of the app. Point
 * it at a restored copy of production first.
 */

const { Op } = require('sequelize');
const config = require('../../src/config');
const { sequelize, Blog } = require('../../src/models');
const { slugifyTitle } = require('../../src/services/slug');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = args.includes('--dry-run') || !COMMIT;
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number.parseInt(args[limitArg + 1], 10) : null;

/** Batch size. Small enough that one bad batch is cheap to investigate. */
const BATCH_SIZE = 200;

function log(...parts) {
  /* eslint-disable-next-line no-console */
  console.log(...parts);
}

async function main() {
  log('─'.repeat(72));
  log('Scriptura slug back-fill');
  log(`  database : ${config.database.name} @ ${config.database.host}:${config.database.port}`);
  log(`  mode     : ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMIT (will write)'}`);
  if (LIMIT) log(`  limit    : ${LIMIT} rows`);
  log('─'.repeat(72));

  await sequelize.authenticate();

  // `paranoid: false` on purpose: a soft-deleted row still occupies the unique
  // index, so it needs a slug too — otherwise restoring it later collides.
  const total = await Blog.count({
    where: { slug: { [Op.is]: null } },
    paranoid: false,
  });

  if (total === 0) {
    log('Nothing to do — every row already has a slug.');
    return;
  }

  log(`${total} row(s) have no slug.\n`);

  /**
   * Slugs already in use, held in memory.
   *
   * One query up front instead of a uniqueness check per row: on a table with
   * thousands of rows that is the difference between one round trip and thousands.
   */
  const existing = await Blog.findAll({
    attributes: ['slug'],
    where: { slug: { [Op.not]: null } },
    paranoid: false,
    raw: true,
  });
  const taken = new Set(existing.map((row) => row.slug));
  log(`${taken.size} slug(s) already in use — they will not be reused.\n`);

  let processed = 0;
  let updated = 0;
  let collisions = 0;
  const samples = [];

  /* eslint-disable no-await-in-loop -- batches must be sequential to keep memory flat */
  while (processed < total) {
    if (LIMIT && processed >= LIMIT) break;

    const batch = await Blog.findAll({
      attributes: ['id', 'blog_title', 'slug'],
      where: { slug: { [Op.is]: null } },
      order: [['id', 'ASC']],
      limit: Math.min(BATCH_SIZE, LIMIT ? LIMIT - processed : BATCH_SIZE),
      offset: DRY_RUN ? processed : 0, // committing shrinks the result set as it goes
      paranoid: false,
    });

    if (batch.length === 0) break;

    for (const blog of batch) {
      const base = slugifyTitle(blog.blog_title) || `blog-${blog.id}`;

      // Resolve uniqueness against the in-memory set, matching the application's
      // `-2`, `-3`, … convention.
      let candidate = base;
      let suffix = 2;
      while (taken.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
        if (suffix > 500) {
          candidate = `${base}-${blog.id}`;
          break;
        }
      }
      if (candidate !== base) collisions += 1;
      taken.add(candidate);

      if (samples.length < 10) {
        samples.push(`  #${blog.id}  ${blog.blog_title.slice(0, 48).padEnd(50)} → ${candidate}`);
      }

      if (!DRY_RUN) {
        // A bare UPDATE, not `blog.save()`: the model's beforeSave hooks would
        // also try to regenerate derived content, and this script must touch the
        // slug column and nothing else.
        await Blog.update(
          { slug: candidate },
          { where: { id: blog.id }, hooks: false, paranoid: false, silent: true }
        );
        updated += 1;
      }
      processed += 1;
    }

    log(`  …${processed}/${LIMIT ? Math.min(LIMIT, total) : total}`);
  }
  /* eslint-enable no-await-in-loop */

  log('\nSample of generated slugs:');
  samples.forEach((line) => log(line));

  log('\n─'.repeat(72));
  log(`Rows examined      : ${processed}`);
  log(`Rows updated       : ${DRY_RUN ? 0 : updated}`);
  log(`Suffixed to dedupe : ${collisions}`);
  if (DRY_RUN) {
    log('\nDRY RUN — nothing was written. Re-run with --commit to apply.');
  } else {
    log('\nDone.');
  }
  log('─'.repeat(72));
}

main()
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    /* eslint-disable-next-line no-console */
    console.error('\nFAILED:', err.message);
    /* eslint-disable-next-line no-console */
    console.error(err.stack);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
