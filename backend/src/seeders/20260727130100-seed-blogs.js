'use strict';

/**
 * Seeds realistic Divinetalk blog rows.
 *
 * Shaped to match the live production data (see the sample row for id 813 in
 * the spec): astrology/spiritual subject matter, `published_by` of
 * "DivineTalk Astrology", `blog_picture` paths of the form
 * `blogs/{Month}{Year}/{random}.png`, and rich HTML in `blog_content`.
 *
 * Two properties are deliberate:
 *
 *   1. `blog_content` is DERIVED from `content_blocks` by the real renderer, not
 *      hand-written. That means the seed data exercises the same code path a
 *      generated article does, and can never encode HTML the renderer would not
 *      produce.
 *
 *   2. The rows span every `blog_status` and `generation_status`, with
 *      publish_dates spread over ~7 months and varied word counts and SEO
 *      scores, so the dashboard's charts and the list view's filters all have
 *      meaningful data the moment `npm run seed` finishes.
 */

const { buildStoragePath } = require('../services/storage');
const { blocksToHtml, countWords } = require('../services/blocksToHtml');
const { slugifyTitle } = require('../services/slug');
const {
  BLOG_STATUS,
  GENERATION_STATUS,
  DEFAULT_PUBLISHED_BY,
  DEFAULT_SEO_STRUCTURE,
} = require('../constants');

/**
 * Seed image paths.
 *
 * Delegates to StorageService rather than reimplementing the convention. The
 * earlier local copy here stripped `-`/`_` *after* slicing, so it emitted 27–32
 * characters instead of a fixed length — seed rows that did not quite look like
 * production rows. One implementation means that cannot drift again.
 */
function imagePath(date) {
  return buildStoragePath({ ext: 'png', date });
}

/** 'YYYY-MM-DD' for DATEONLY columns. */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Content licences run a year from publication, matching the sample row. */
function plusOneYear(date) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + 1);
  return next;
}

function d(iso) {
  return new Date(`${iso}T09:30:00Z`);
}

// ---------------------------------------------------------------------------
// Blog definitions. `blocks` drives both content_blocks and blog_content.
// ---------------------------------------------------------------------------

const BLOGS = [
  {
    blog_title: "Embrace Shrawan's Energy: A Cosmic Shift",
    topic: 'shravan month significance',
    seo_keywords: 'shravan month',
    secondary_keywords: ['sawan somwar', 'shravan puja vidhi', 'shiva worship july'],
    category: 'Festivals',
    tags: ['shravan', 'shiva', 'monsoon', 'vrat'],
    article_type: 'general',
    created: d('2026-07-27'),
    blog_status: BLOG_STATUS.PUBLISHED,
    generation_status: GENERATION_STATUS.GENERATED,
    seo_score: 88,
    tone_of_voice: 'reverent yet accessible',
    point_of_view: 'second_person',
    readability_level: '8th_grade',
    image_count: 2,
    logo_overlay: true,
    logo_position: 'bottom_right',
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Warm, reverent, gently instructive',
      pov: 'second_person',
      traits: [
        'Opens with a sensory image of the season',
        'Explains Sanskrit terms in plain language on first use',
        'Closes with a practical next step for the reader',
      ],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'The first rains of Shravan do something to the air. Temples fill with the scent of wet bel leaves, and the month that Hindus consider the most auspicious of the year begins in earnest.' } },
      { type: 'heading', data: { level: 2, text: 'The Essence of Shravana' } },
      { type: 'paragraph', data: { html: 'Shravan (or <em>Sawan</em>) is the fifth month of the Hindu lunar calendar, and it belongs to Lord Shiva. The month takes its name from the <strong>Shravana Nakshatra</strong>, the lunar mansion that governs listening, learning and receptivity.' } },
      { type: 'paragraph', data: { text: 'Astrologically, the Sun transits into Leo during this period while the monsoon peaks. Classical texts read that combination as a rare window when material effort and spiritual receptivity reinforce one another rather than compete.' } },
      { type: 'heading', data: { level: 2, text: 'Why Mondays Carry the Most Weight' } },
      { type: 'paragraph', data: { text: 'Every Monday of Shravan is a Sawan Somwar. Monday is ruled by the Moon, and the Moon sits in Shiva’s crown in iconography, so the day is understood to carry his blessing most directly.' } },
      { type: 'list', data: { style: 'numbered', items: ['Bathe before sunrise and wear clean, unstitched cloth if you are observing a full vrat.', 'Offer water mixed with milk to the Shiva lingam, pouring in a slow, unbroken stream.', 'Add bel patra (three-leaf clusters), white flowers and a little sandalwood paste.', 'Chant "Om Namah Shivaya" 108 times, keeping the pace steady rather than fast.'] } },
      { type: 'image', data: { url: 'PLACEHOLDER_PRIMARY', alt_text: 'Devotee performing abhishekam on a Shiva lingam with milk and bel leaves', caption: 'Abhishekam at dawn during Sawan Somwar' } },
      { type: 'heading', data: { level: 2, text: 'The Sixteen Mondays Vow' } },
      { type: 'paragraph', data: { text: 'Some devotees extend the practice into the Solah Somwar vrat, a sixteen-Monday commitment traditionally undertaken to seek a harmonious marriage or resolve a long-standing family matter. Shravan is the customary month to begin.' } },
      { type: 'key_takeaway', data: { title: 'Key takeaways', items: ['Shravan runs for one lunar month and is dedicated to Lord Shiva.', 'Mondays are the highest-potency days; water and bel patra are the core offerings.', 'The month favours beginnings — new practices, vows and reconciliations.'] } },
      { type: 'heading', data: { level: 2, text: 'What to Avoid' } },
      { type: 'list', data: { style: 'bullet', items: ['Non-vegetarian food, alcohol, onion and garlic are traditionally set aside for the month.', 'Many families avoid leafy greens in Shravan, a practice with a practical monsoon-hygiene root.', 'Avoid starting disputes; the month’s character is receptive rather than assertive.'] } },
      { type: 'quote', data: { text: 'Shravan does not ask for grand gestures. It asks for consistency.', attribution: 'Traditional teaching' } },
      { type: 'faq_accordion', data: { items: [
        { question: 'When does Shravan begin and end in 2026?', answer: 'In most of North India it runs from late July into late August, following the Purnimanta calendar. Maharashtra, Gujarat and the South follow the Amanta reckoning, which shifts the dates by roughly a fortnight.' },
        { question: 'Can I observe a partial fast?', answer: 'Yes. A phalahar fast on fruit and milk is widely practised and is considered fully valid, particularly for anyone with a medical condition.' },
        { question: 'Is Shravan a good month for a wedding?', answer: 'Traditionally no — most communities avoid weddings during Shravan and resume after the month closes. It is, however, considered excellent for engagements and for beginning a vow.' },
      ] } },
      { type: 'paragraph', data: { text: 'If you are unsure which calendar your family follows, or which vrat suits your chart, a short consultation is usually more useful than a generic almanac.' } },
      { type: 'cta_button', data: { text: 'Talk to a DivineTalk astrologer', url: 'https://divinetalk.in/astrology' } },
    ],
  },

  {
    blog_title: 'Mercury Retrograde in Virgo: What It Actually Affects',
    topic: 'mercury retrograde virgo',
    seo_keywords: 'mercury retrograde virgo',
    secondary_keywords: ['mercury retrograde 2026', 'retrograde communication issues'],
    category: 'Transits',
    tags: ['mercury', 'retrograde', 'virgo', 'transits'],
    article_type: 'how_to',
    created: d('2026-06-12'),
    blog_status: BLOG_STATUS.PUBLISHED,
    generation_status: GENERATION_STATUS.GENERATED,
    seo_score: 76,
    tone_of_voice: 'calm, myth-busting',
    point_of_view: 'second_person',
    readability_level: '8th_grade',
    total_views: 4820,
    image_count: 1,
    serp: { keyword: 'mercury retrograde virgo', position: 7, checked: d('2026-07-20') },
    brand_voice: {
      source_type: 'web_scrape',
      source_ref: 'https://divinetalk.com/blog/transits',
      tone: 'Calm, evidence-aware, reassuring',
      pov: 'second_person',
      traits: ['Names the common fear, then right-sizes it', 'Prefers concrete examples over abstractions'],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'Mercury retrograde has become shorthand for "everything is going wrong." That reading is broader than the astrology actually supports, and the wider version tends to cause more anxiety than the transit does.' } },
      { type: 'heading', data: { level: 2, text: 'What Retrograde Motion Really Is' } },
      { type: 'paragraph', data: { text: 'Mercury never reverses course. From our vantage point on a faster-moving Earth, it appears to slow, stop and drift backwards for roughly three weeks. It is a matter of relative perspective, not a change in the planet’s behaviour.' } },
      { type: 'heading', data: { level: 2, text: 'Why Virgo Sharpens the Effect' } },
      { type: 'paragraph', data: { html: 'Mercury <strong>rules</strong> Virgo, so the planet is on home ground here. That amplifies rather than dampens the signature: the themes show up in Virgo’s domain — detail, process, health routines, editing, logistics.' } },
      { type: 'table', data: { caption: 'Where the friction usually lands', headers: ['Area', 'Typical form', 'Practical response'], rows: [['Written communication', 'Ambiguous wording, missed context', 'Re-read before sending; confirm in a second channel'], ['Contracts and paperwork', 'Clauses skimmed rather than read', 'Delay signing where you can; read fully where you cannot'], ['Travel and logistics', 'Schedule slippage, connections missed', 'Build slack into timings'], ['Devices and data', 'Sync failures, lost work', 'Back up before the station date, not after']] } },
      { type: 'heading', data: { level: 2, text: 'What the Transit Is Genuinely Good For' } },
      { type: 'list', data: { style: 'bullet', items: ['Reviewing and editing work that already exists.', 'Reopening a conversation that stalled without resolution.', 'Auditing systems, subscriptions and recurring commitments.', 'Finishing the thing that has been ninety percent done for a month.'] } },
      { type: 'key_takeaway', data: { title: 'The short version', items: ['Nothing is inherently doomed; precision simply matters more than usual.', 'Re-doing, reviewing and repairing are favoured over launching.', 'In Virgo, the friction concentrates in details and process.'] } },
      { type: 'faq_accordion', data: { items: [
        { question: 'Should I avoid signing a contract entirely?', answer: 'Not necessarily. Where a deadline is fixed, read the document properly and get a second pair of eyes on it. The caution is about care, not prohibition.' },
        { question: 'Does the shadow period matter?', answer: 'Many astrologers track the pre- and post-retrograde shadow, roughly two weeks either side, when Mercury covers the same degrees. Effects there are usually milder.' },
      ] } },
      { type: 'cta_button', data: { text: 'Check your chart for this transit', url: 'https://divinetalk.in/astrology' } },
    ],
  },

  {
    blog_title: 'Saturn in Pisces: The Slow Lessons of 2026',
    topic: 'saturn in pisces 2026',
    seo_keywords: 'saturn in pisces',
    secondary_keywords: ['saturn transit 2026', 'shani pisces effects'],
    category: 'Transits',
    tags: ['saturn', 'shani', 'pisces', 'transits'],
    article_type: 'general',
    created: d('2026-05-03'),
    blog_status: BLOG_STATUS.PUBLISHED,
    generation_status: GENERATION_STATUS.GENERATED,
    seo_score: 81,
    tone_of_voice: 'measured, grounded',
    point_of_view: 'third_person',
    readability_level: 'college',
    total_views: 9130,
    image_count: 1,
    serp: { keyword: 'saturn in pisces', position: 3, checked: d('2026-07-22') },
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Measured, unhurried, respectful of difficulty',
      pov: 'third_person',
      traits: ['Never promises easy outcomes', 'Uses the Sanskrit name alongside the Western one'],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'Saturn asks for structure. Pisces dissolves it. The transit that pairs them is one of the more uncomfortable combinations in the zodiac, and one of the more productive.' } },
      { type: 'heading', data: { level: 2, text: 'A Planet Out of Its Element' } },
      { type: 'paragraph', data: { text: 'Shani governs boundaries, discipline, consequence and time. Pisces governs the places where boundaries thin — imagination, compassion, faith, escape. Saturn in Pisces therefore works on something diffuse rather than something solid.' } },
      { type: 'heading', data: { level: 2, text: 'What the Transit Tends to Surface' } },
      { type: 'list', data: { style: 'bullet', items: ['Commitments made from guilt rather than genuine intention.', 'Boundaries that were never actually stated out loud.', 'Creative work that has stayed private for years.', 'Faith that has gone unexamined, in either direction.'] } },
      { type: 'quote', data: { text: 'Saturn does not remove what is real. It removes what was only ever assumed.', attribution: 'Classical reading of Shani' } },
      { type: 'heading', data: { level: 2, text: 'Working With It Rather Than Against It' } },
      { type: 'paragraph', data: { text: 'The practical instruction is unglamorous: name things precisely. Put the vague arrangement in writing. Give the creative practice a fixed hour. Saturn rewards specificity, and Pisces is where specificity is hardest to maintain.' } },
      { type: 'key_takeaway', data: { title: 'Key takeaways', items: ['Saturn in Pisces tests structures built on assumption rather than agreement.', 'Discomfort in this transit is usually information, not punishment.', 'Precision and routine are the effective responses.'] } },
    ],
  },

  {
    blog_title: '7 Gemstones for Career Growth (And Who Should Avoid Them)',
    topic: 'gemstones for career growth',
    seo_keywords: 'gemstones for career',
    secondary_keywords: ['career gemstone remedies', 'which gemstone for job promotion'],
    category: 'Remedies',
    tags: ['gemstones', 'remedies', 'career', 'ratna'],
    article_type: 'listicle',
    created: d('2026-04-18'),
    blog_status: BLOG_STATUS.PUBLISHED,
    generation_status: GENERATION_STATUS.GENERATED,
    seo_score: 71,
    tone_of_voice: 'practical, cautionary',
    point_of_view: 'second_person',
    readability_level: '8th_grade',
    total_views: 15240,
    image_count: 3,
    logo_overlay: true,
    logo_position: 'top_left',
    brand_voice: {
      source_type: 'file_upload',
      source_ref: 'divinetalk-remedies-style-guide.docx',
      tone: 'Practical, cautionary, never salesy',
      pov: 'second_person',
      traits: ['Always states the contraindication alongside the recommendation', 'Refuses to promise guaranteed outcomes'],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'A gemstone remedy is a targeted intervention, not a general tonic. Worn without reference to your chart, the wrong stone can amplify exactly the placement you were hoping to soften.' } },
      { type: 'paragraph', data: { html: '<strong>Read the contraindications.</strong> Every entry below lists who should not wear the stone. That column matters more than the benefits column.' } },
      { type: 'heading', data: { level: 2, text: '1. Blue Sapphire (Neelam) — Saturn' } },
      { type: 'paragraph', data: { text: 'The most potent and the most frequently misprescribed. Suited to those with a well-placed but weak Saturn seeking recognition for long-term work. Effects tend to appear quickly, in either direction.' } },
      { type: 'paragraph', data: { html: '<em>Avoid if:</em> Saturn is a malefic functional lord in your chart, or you are in a Saturn mahadasha you already find punishing. Trial for three days before committing.' } },
      { type: 'heading', data: { level: 2, text: '2. Emerald (Panna) — Mercury' } },
      { type: 'paragraph', data: { text: 'For work that depends on communication, analysis or negotiation. Commonly recommended to those in writing, law, accountancy and trade.' } },
      { type: 'paragraph', data: { html: '<em>Avoid if:</em> Mercury is combust or closely afflicted by Mars in your chart.' } },
      { type: 'heading', data: { level: 2, text: '3. Yellow Sapphire (Pukhraj) — Jupiter' } },
      { type: 'paragraph', data: { text: 'Associated with mentorship, teaching and advancement through goodwill rather than confrontation. Among the safer stones for general use.' } },
      { type: 'image', data: { url: 'PLACEHOLDER_PRIMARY', alt_text: 'Assortment of astrological gemstones including sapphire, emerald and ruby on dark cloth', caption: 'Stones are prescribed against a chart, never against a symptom' } },
      { type: 'heading', data: { level: 2, text: '4. Ruby (Manik) — Sun' } },
      { type: 'paragraph', data: { text: 'For visibility and authority. Suits those seeking a leadership role or public recognition. Can be too assertive for collaborative environments.' } },
      { type: 'heading', data: { level: 2, text: '5. Red Coral (Moonga) — Mars' } },
      { type: 'paragraph', data: { text: 'Drive, initiative and courage in the face of competition. Useful during a stalled job search where confidence is the bottleneck.' } },
      { type: 'paragraph', data: { html: '<em>Avoid if:</em> you already run hot — Mars-dominant charts rarely benefit.' } },
      { type: 'heading', data: { level: 2, text: '6. Pearl (Moti) — Moon' } },
      { type: 'paragraph', data: { text: 'Emotional steadiness under workplace pressure. Often recommended alongside a primary stone rather than on its own.' } },
      { type: 'heading', data: { level: 2, text: '7. Hessonite (Gomed) — Rahu' } },
      { type: 'paragraph', data: { text: 'For unconventional career paths and sudden change. Genuinely unpredictable; prescribe and wear with caution.' } },
      { type: 'table', data: { caption: 'Quick reference', headers: ['Stone', 'Planet', 'Metal', 'Finger'], rows: [['Blue Sapphire', 'Saturn', 'Silver or panchdhatu', 'Middle'], ['Emerald', 'Mercury', 'Gold', 'Little'], ['Yellow Sapphire', 'Jupiter', 'Gold', 'Index'], ['Ruby', 'Sun', 'Gold or copper', 'Ring'], ['Red Coral', 'Mars', 'Copper or gold', 'Ring'], ['Pearl', 'Moon', 'Silver', 'Little'], ['Hessonite', 'Rahu', 'Silver', 'Middle']] } },
      { type: 'key_takeaway', data: { title: 'Before you buy anything', items: ['Get the chart read first; the stone follows the diagnosis.', 'Trial period before permanent wear, for any strong stone.', 'Certification matters — an untreated stone of modest size beats a treated large one.'] } },
      { type: 'cta_button', data: { text: 'Get a remedy consultation', url: 'https://divinetalk.in/astrology' } },
    ],
  },

  {
    blog_title: 'Kundli Matching vs Modern Compatibility: A Comparison',
    topic: 'kundli matching vs modern compatibility',
    seo_keywords: 'kundli matching',
    secondary_keywords: ['guna milan explained', 'horoscope matching accuracy'],
    category: 'Relationships',
    tags: ['kundli', 'matching', 'marriage', 'compatibility'],
    article_type: 'comparison',
    created: d('2026-07-21'),
    // Generated and waiting on a human in the block editor — never auto-published.
    blog_status: BLOG_STATUS.DRAFT,
    generation_status: GENERATION_STATUS.GENERATED,
    seo_score: 64,
    tone_of_voice: 'balanced, non-dogmatic',
    point_of_view: 'third_person',
    readability_level: 'college',
    image_count: 1,
    internal_linking: true,
    internal_link_targets: ['saturn-in-pisces-the-slow-lessons-of-2026'],
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Balanced, non-dogmatic',
      pov: 'third_person',
      traits: ['Presents both traditions fairly', 'Avoids dismissing either framework'],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'Guna Milan assigns a marriage a score out of thirty-six. A modern compatibility questionnaire assigns it a percentage. Both are trying to answer the same question with very different instruments.' } },
      { type: 'heading', data: { level: 2, text: 'What Guna Milan Measures' } },
      { type: 'paragraph', data: { text: 'The eight kootas weigh temperament, mental affinity, physical constitution, lineage and longevity indicators, drawn from the Moon’s nakshatra in each chart. Eighteen of thirty-six is the conventional threshold.' } },
      { type: 'heading', data: { level: 2, text: 'What Modern Frameworks Measure' } },
      { type: 'paragraph', data: { text: 'Contemporary compatibility instruments test stated values, conflict style, attachment patterns and life goals — self-reported and present-tense, where Guna Milan is birth-data-derived and fixed.' } },
      { type: 'table', data: { caption: 'Two instruments, side by side', headers: ['Dimension', 'Guna Milan', 'Modern assessment'], rows: [['Input', 'Birth date, time, place', 'Self-reported answers'], ['Stability over time', 'Fixed at birth', 'Shifts as people change'], ['Blind spots', 'Cannot see lived behaviour', 'Cannot see what is unadmitted'], ['Best used for', 'A structural first filter', 'Working through specifics together']] } },
      { type: 'heading', data: { level: 2, text: 'Where They Agree' } },
      { type: 'paragraph', data: { text: 'Both flag temperament mismatch as the strongest predictor of friction, and both treat communication style as more decisive than shared interests. The overlap is larger than partisans of either method tend to admit.' } },
      { type: 'key_takeaway', data: { title: 'Key takeaways', items: ['A low Guna score is a prompt for a closer reading, not a verdict.', 'The two frameworks measure different things and are not interchangeable.', 'Used together they cover each other’s blind spots.'] } },
      { type: 'faq_accordion', data: { items: [
        { question: 'Is a score below 18 disqualifying?', answer: 'No. It indicates areas needing attention, and specific doshas have recognised cancellations. A full chart reading is the appropriate next step.' },
      ] } },
    ],
  },

  {
    blog_title: 'Navratri 2026: Nine Nights, Nine Practices',
    topic: 'navratri 2026 guide',
    seo_keywords: 'navratri 2026',
    secondary_keywords: ['navratri colours 2026', 'durga puja dates'],
    category: 'Festivals',
    tags: ['navratri', 'durga', 'festival'],
    article_type: 'how_to',
    created: d('2026-07-25'),
    // Scheduled ahead of the festival.
    blog_status: BLOG_STATUS.SCHEDULED,
    generation_status: GENERATION_STATUS.GENERATED,
    publish_date_override: '2026-10-05',
    seo_score: 79,
    tone_of_voice: 'celebratory, instructive',
    point_of_view: 'second_person',
    readability_level: '5th_grade',
    image_count: 2,
    logo_overlay: true,
    logo_position: 'bottom_left',
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Celebratory, warm, instructive',
      pov: 'second_person',
      traits: ['Uses the day-by-day structure as a spine', 'Keeps sentences short enough to read aloud'],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'Nine nights, nine forms of the Goddess, and nine distinct qualities to work on. Navratri is one of the few festivals with a built-in daily curriculum.' } },
      { type: 'heading', data: { level: 2, text: 'The Structure of the Nine Nights' } },
      { type: 'paragraph', data: { text: 'The festival divides into three sets of three: the first three nights address inertia and old patterns, the middle three address abundance and sustenance, and the final three address wisdom.' } },
      { type: 'list', data: { style: 'numbered', items: ['Shailaputri — steadiness. Begin simply.', 'Brahmacharini — discipline. Hold one small commitment.', 'Chandraghanta — courage. Say the difficult thing kindly.', 'Kushmanda — warmth. Feed someone.', 'Skandamata — care. Check on a dependent.', 'Katyayani — resolve. Finish an unfinished task.', 'Kalaratri — release. Let one grievance go.', 'Mahagauri — clarity. Clean a neglected space.', 'Siddhidatri — integration. Sit quietly and take stock.'] } },
      { type: 'image', data: { url: 'PLACEHOLDER_PRIMARY', alt_text: 'Nine oil lamps arranged in a row for Navratri', caption: 'One lamp for each night' } },
      { type: 'heading', data: { level: 2, text: 'Fasting Without Overdoing It' } },
      { type: 'paragraph', data: { text: 'A full nine-day fast is not required and not advisable for everyone. A single-meal-a-day observance, or simply setting aside grains, carries the same intent without the medical risk.' } },
      { type: 'key_takeaway', data: { title: 'Key takeaways', items: ['Each night has a distinct quality to practise, not just a colour to wear.', 'Partial fasting is fully valid.', 'Consistency across the nine nights matters more than severity on any one.'] } },
    ],
  },

  {
    blog_title: 'Reading Your Dasha Chart: A Beginner Walkthrough',
    topic: 'vimshottari dasha explained',
    seo_keywords: 'dasha chart',
    secondary_keywords: ['vimshottari dasha calculation', 'mahadasha antardasha'],
    category: 'Learn Astrology',
    tags: ['dasha', 'vimshottari', 'beginner'],
    article_type: 'how_to',
    created: d('2026-07-26'),
    // Wizard configured, generation not yet started.
    blog_status: BLOG_STATUS.DRAFT,
    generation_status: GENERATION_STATUS.DRAFT,
    tone_of_voice: 'patient, teacherly',
    point_of_view: 'second_person',
    readability_level: '8th_grade',
    image_count: 1,
    external_web_grounding: false,
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Patient, teacherly',
      pov: 'second_person',
      traits: ['Defines every term before using it'],
      // Deliberately unconfirmed: exercises the gate that blocks generation
      // until a human approves the derived voice.
      confirmed: false,
    },
    outline: [
      { level: 2, text: 'What a dasha actually is' },
      { level: 2, text: 'The 120-year Vimshottari cycle' },
      { level: 3, text: 'Why it starts from the Moon' },
      { level: 2, text: 'Reading mahadasha and antardasha together' },
      { level: 2, text: 'Common beginner mistakes' },
    ],
    blocks: [],
  },

  {
    blog_title: 'Vastu for Small Apartments: Practical Fixes',
    topic: 'vastu tips small apartment',
    seo_keywords: 'vastu small apartment',
    secondary_keywords: ['vastu without renovation', 'apartment vastu direction'],
    category: 'Vastu',
    tags: ['vastu', 'home', 'apartment'],
    article_type: 'listicle',
    created: d('2026-07-27'),
    // A generation run that failed on an upstream provider error — exercises the
    // failure/retry path in the UI.
    blog_status: BLOG_STATUS.DRAFT,
    generation_status: GENERATION_STATUS.FAILED,
    generation_error:
      'Anthropic API request failed after 3 attempts: 529 overloaded_error. The provider was ' +
      'temporarily unavailable. Retry from the wizard — the saved configuration is unchanged.',
    tone_of_voice: 'practical, budget-aware',
    point_of_view: 'second_person',
    readability_level: '8th_grade',
    image_count: 2,
    external_web_grounding: true,
    brand_voice: {
      source_type: 'web_scrape',
      source_ref: 'https://divinetalk.com/blog/vastu',
      tone: 'Practical, budget-aware',
      pov: 'second_person',
      traits: ['Assumes the reader cannot renovate', 'Gives a no-cost option for every suggestion'],
      confirmed: true,
    },
    blocks: [],
  },

  {
    blog_title: 'Full Moon Rituals for Letting Go',
    topic: 'full moon ritual',
    seo_keywords: 'full moon ritual',
    secondary_keywords: ['purnima practice', 'releasing ritual full moon'],
    category: 'Practices',
    tags: ['moon', 'purnima', 'ritual'],
    article_type: 'general',
    created: d('2026-07-27'),
    // Actively in flight — the dashboard should show a live progress state.
    blog_status: BLOG_STATUS.DRAFT,
    generation_status: GENERATION_STATUS.GENERATING,
    tone_of_voice: 'gentle, reflective',
    point_of_view: 'second_person',
    readability_level: '8th_grade',
    image_count: 1,
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Gentle, reflective',
      pov: 'second_person',
      traits: ['Uses short paragraphs and plenty of white space'],
      confirmed: true,
    },
    blocks: [],
  },

  {
    blog_title: 'Mangal Dosha: Myths That Need Retiring',
    topic: 'mangal dosha myths',
    seo_keywords: 'mangal dosha',
    secondary_keywords: ['manglik myths', 'kuja dosha cancellation'],
    category: 'Relationships',
    tags: ['mangal', 'manglik', 'myths'],
    article_type: 'general',
    created: d('2026-01-14'),
    // Superseded by a newer piece; kept for history rather than deleted.
    blog_status: BLOG_STATUS.ARCHIVED,
    generation_status: GENERATION_STATUS.GENERATED,
    seo_score: 58,
    tone_of_voice: 'corrective, calm',
    point_of_view: 'third_person',
    readability_level: 'college',
    total_views: 2210,
    image_count: 1,
    brand_voice: {
      source_type: 'text',
      source_ref: null,
      tone: 'Corrective, calm',
      pov: 'third_person',
      traits: ['States the myth, then the correction, in that order'],
      confirmed: true,
    },
    blocks: [
      { type: 'paragraph', data: { is_lead: true, text: 'Few terms in Indian astrology cause as much unnecessary distress as "manglik." Most of that distress rests on claims the classical texts do not actually make.' } },
      { type: 'heading', data: { level: 2, text: 'Myth: A Manglik Match Is Forbidden' } },
      { type: 'paragraph', data: { text: 'The texts describe Mangal Dosha as a factor to weigh, with numerous recognised cancellations — including when both charts carry it, and when Mars sits in specific signs. It was never framed as an absolute bar.' } },
      { type: 'heading', data: { level: 2, text: 'Myth: It Predicts Widowhood' } },
      { type: 'paragraph', data: { text: 'This reading comes from a narrow interpretation of a single verse and ignores the surrounding conditions. Responsible practitioners do not make that claim.' } },
      { type: 'key_takeaway', data: { title: 'Key takeaways', items: ['Mangal Dosha is one factor among many, with well-documented cancellations.', 'Any practitioner presenting it as a verdict is overreaching.'] } },
    ],
  },
];

module.exports = {
  async up(queryInterface) {
    const rows = BLOGS.map((blog) => {
      const created = blog.created;
      const primaryImage = blog.include_images === false ? null : imagePath(created);

      // Substitute the generated storage path into the image blocks, so
      // content_blocks and blog_picture reference the same asset.
      const blocks = (blog.blocks || []).map((block, index) => ({
        id: `blk_${index + 1}`,
        type: block.type,
        data:
          block.type === 'image' && block.data.url === 'PLACEHOLDER_PRIMARY'
            ? { ...block.data, url: primaryImage }
            : block.data,
      }));

      const hasContent = blocks.length > 0;
      const html = hasContent ? blocksToHtml(blocks) : null;
      const words = hasContent ? countWords(blocks) : null;

      const publishDate =
        blog.publish_date_override ||
        (blog.blog_status === BLOG_STATUS.PUBLISHED || blog.blog_status === BLOG_STATUS.ARCHIVED
          ? isoDate(created)
          : null);

      const bv = blog.brand_voice || {};

      // Images beyond the primary one. Kept consistent with image_count so the
      // editor's image panel and the stored data agree.
      const extraCount = Math.max(0, (blog.image_count || 1) - 1);
      const extraImages = hasContent
        ? Array.from({ length: extraCount }, () => ({
            url: imagePath(created),
            alt_text: `Supporting illustration for ${blog.blog_title}`,
            has_logo_overlay: Boolean(blog.logo_overlay),
            logo_position: blog.logo_position || 'none',
          }))
        : [];

      return {
        blog_title: blog.blog_title,
        slug: slugifyTitle(blog.blog_title),
        topic: blog.topic || null,
        seo_keywords: blog.seo_keywords || null,
        secondary_keywords: JSON.stringify(blog.secondary_keywords || []),

        blog_picture: hasContent ? primaryImage : null,
        blog_content: html,
        content_blocks: JSON.stringify(blocks),

        blog_status: blog.blog_status,
        published_by: DEFAULT_PUBLISHED_BY,
        publish_date: publishDate,
        total_views: blog.total_views || 0,
        start_date: publishDate,
        end_date: publishDate ? isoDate(plusOneYear(new Date(publishDate))) : null,

        meta_title: blog.blog_title.slice(0, 60),
        meta_description: hasContent
          ? `${blocksToHtml(blocks.slice(0, 1)).replace(/<[^>]+>/g, '').slice(0, 150)}...`
          : null,
        og_image: hasContent ? primaryImage : null,
        canonical_url: `https://divinetalk.com/blog/${slugifyTitle(blog.blog_title)}`,

        article_type: blog.article_type || 'general',
        tone_of_voice: blog.tone_of_voice || null,
        point_of_view: blog.point_of_view || null,
        target_country: 'IN',
        language: 'en',
        readability_level: blog.readability_level || '8th_grade',
        ai_content_cleaning: true,

        brand_voice_source_type: bv.source_type || 'none',
        brand_voice_source_ref: bv.source_ref || null,
        brand_voice_tone: bv.tone || null,
        brand_voice_pov: bv.pov || null,
        brand_voice_traits: JSON.stringify(bv.traits || []),
        brand_voice_confirmed: bv.confirmed === true,

        include_images: blog.include_images !== false,
        image_count: blog.image_count || 1,
        image_style: blog.image_style || 'photo',
        logo_overlay: Boolean(blog.logo_overlay),
        logo_position: blog.logo_position || 'none',
        extra_images: JSON.stringify(extraImages),

        seo_structure_config: JSON.stringify(blog.seo_structure_config || DEFAULT_SEO_STRUCTURE),
        internal_linking: Boolean(blog.internal_linking),
        internal_link_targets: JSON.stringify(blog.internal_link_targets || []),
        external_web_grounding: Boolean(blog.external_web_grounding),
        outline: JSON.stringify(blog.outline || []),

        seo_score: blog.seo_score ?? null,
        word_count: words,
        serp_rank_keyword: blog.serp?.keyword || null,
        serp_rank_position: blog.serp?.position ?? null,
        serp_rank_checked_at: blog.serp?.checked || null,

        generation_status: blog.generation_status,
        generation_config: JSON.stringify({
          seeded: true,
          article_type: blog.article_type || 'general',
          tone_of_voice: blog.tone_of_voice || null,
          readability_level: blog.readability_level || '8th_grade',
          image_count: blog.image_count || 1,
          external_web_grounding: Boolean(blog.external_web_grounding),
        }),
        generation_error: blog.generation_error || null,

        category: blog.category || null,
        tags: JSON.stringify(blog.tags || []),

        created_at: created,
        updated_at: created,
        deleted_at: null,
      };
    });

    await queryInterface.bulkInsert('blogs', rows);

    /* eslint-disable no-console */
    const byStatus = rows.reduce((acc, r) => {
      acc[r.blog_status] = (acc[r.blog_status] || 0) + 1;
      return acc;
    }, {});
    console.log(`  Seeded ${rows.length} blogs.`);
    console.log(
      `    blog_status: ${Object.entries(byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')} (0=draft 1=published 2=scheduled 3=archived)`
    );
    /* eslint-enable no-console */
  },

  async down(queryInterface) {
    const { Op } = require('sequelize');
    await queryInterface.bulkDelete('blogs', {
      slug: { [Op.in]: BLOGS.map((b) => slugifyTitle(b.blog_title)) },
    });
  },
};
