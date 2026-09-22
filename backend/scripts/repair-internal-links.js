'use strict';

/**
 * Repairs internal blog links in already-generated articles.
 *
 * Generation now verifies and repairs every `/blog/<slug>` href before saving
 * (src/services/internalLinks.js), but articles written before that shipped
 * with slugs the model rebuilt from the target's title — typically with an
 * inserted `and` where the title had a comma — so those links 404 on
 * divinetalk.in today.
 *
 * This walks the stored `content_blocks` of each blog through the same repair
 * and reports, or applies, the result. Saving re-renders `blog_content` through
 * the model's beforeSave hook, so the two never drift.
 *
 * Blogs with no `content_blocks` — rows that predate the block editor and hold
 * their article only as `blog_content` HTML — are repaired directly on that
 * column. An earlier version skipped them silently while still reporting them
 * as "scanned", which hid the very links this script exists to find. Setting
 * `blog_content` alone is safe: the model only regenerates it when
 * `content_blocks` changes.
 *
 *     node scripts/repair-internal-links.js                 # dry run, all blogs
 *     node scripts/repair-internal-links.js --ids 110,116   # dry run, specific blogs
 *     node scripts/repair-internal-links.js --apply         # write the changes
 *
 * A repaired blog is only live on the client's site once it is republished —
 * see CLIENT_PUBLISH_FLOW.md §2 for create-vs-update.
 *
 * Safe to re-run: a blog whose links already resolve is left untouched.
 */

const { Blog, sequelize } = require('../src/models');
const {
  repairInternalLinks,
  repairInternalLinksInHtml,
} = require('../src/services/internalLinks');

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const idsFlag = argv.indexOf('--ids');
  const ids =
    idsFlag === -1
      ? null
      : String(argv[idsFlag + 1] || '')
          .split(',')
          .map((value) => Number(value.trim()))
          .filter(Number.isFinite);
  return { apply, ids: ids && ids.length ? ids : null };
}

async function main() {
  const { apply, ids } = parseArgs(process.argv.slice(2));

  const blogs = await Blog.findAll({
    where: ids ? { id: ids } : undefined,
    order: [['id', 'ASC']],
  });
  console.log(`Scanning ${blogs.length} blog(s)${apply ? '' : ' (dry run — nothing is written)'}.`);

  let changed = 0;
  let repairedLinks = 0;
  let strippedLinks = 0;
  let legacyRows = 0;
  let emptyRows = 0;

  for (const blog of blogs) {
    const blocks = blog.content_blocks;

    if (!Array.isArray(blocks) || blocks.length === 0) {
      // No blocks: repair the rendered HTML directly, if there is any.
      if (!blog.blog_content) {
        emptyRows += 1;
        continue;
      }
      legacyRows += 1;

      // eslint-disable-next-line no-await-in-loop
      const { html, outcome } = await repairInternalLinksInHtml(blog.blog_content);
      if (outcome.repaired.length === 0 && outcome.stripped.length === 0) continue;

      changed += 1;
      repairedLinks += outcome.repaired.length;
      strippedLinks += outcome.stripped.length;

      console.log(`\n#${blog.id} ${blog.slug}  [no content_blocks — blog_content only]`);
      for (const fix of outcome.repaired) console.log(`  repair  ${fix.from}\n       -> ${fix.to}`);
      for (const slug of outcome.stripped) console.log(`  strip   ${slug} (no published blog matches)`);

      if (apply) {
        blog.set('blog_content', html);
        // eslint-disable-next-line no-await-in-loop
        await blog.save();
        console.log('  saved (blog_content updated in place)');
      }
      continue;
    }

    // The repair mutates in place. Work on a copy so a dry run cannot leave a
    // half-edited instance behind, and so Sequelize sees a genuinely new value
    // rather than the same object it already holds.
    const working = JSON.parse(JSON.stringify(blocks));
    // eslint-disable-next-line no-await-in-loop -- one-off maintenance script; sequential keeps the output readable and the DB unstressed.
    const outcome = await repairInternalLinks(working);
    if (outcome.repaired.length === 0 && outcome.stripped.length === 0) continue;

    changed += 1;
    repairedLinks += outcome.repaired.length;
    strippedLinks += outcome.stripped.length;

    console.log(`\n#${blog.id} ${blog.slug}`);
    for (const fix of outcome.repaired) console.log(`  repair  ${fix.from}\n       -> ${fix.to}`);
    for (const slug of outcome.stripped) console.log(`  strip   ${slug} (no published blog matches)`);

    if (apply) {
      blog.set('content_blocks', working);
      blog.changed('content_blocks', true);
      // eslint-disable-next-line no-await-in-loop
      await blog.save();
      console.log('  saved (blog_content re-rendered)');
    }
  }

  console.log(
    `\n${changed} blog(s) affected: ${repairedLinks} link(s) repaired, ${strippedLinks} stripped.`
  );
  console.log(
    `Of ${blogs.length} scanned: ${blogs.length - legacyRows - emptyRows} with blocks, ` +
      `${legacyRows} legacy (blog_content only), ${emptyRows} with no content at all.`
  );
  if (!apply && changed > 0) console.log('Re-run with --apply to write these changes.');
  if (apply && changed > 0) console.log('Republish each affected blog to update the client site.');
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error(err);
    await sequelize.close();
    process.exit(1);
  });
