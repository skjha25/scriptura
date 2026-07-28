'use strict';

/**
 * Brand-voice analysis: pasted text, a scraped URL, or an uploaded file.
 *
 * ---------------------------------------------------------------------------
 * THE SECURITY-CRITICAL PART: SSRF
 * ---------------------------------------------------------------------------
 * `POST /brand-voice/analyze` with `source_type: 'web_scrape'` takes a URL from
 * an authenticated user and makes the *server* fetch it. That is textbook
 * server-side request forgery: the attacker gets to issue requests from inside
 * our network, to addresses their own browser cannot reach — the cloud metadata
 * endpoint (169.254.169.254), an internal admin panel on a private subnet, or a
 * localhost service with no auth because "it's only bound locally".
 *
 * "Only editors can call it" is not a mitigation. An internal tool's editors are
 * a phishing target, and the endpoint is exactly the primitive an attacker wants
 * after a single stolen token.
 *
 * The guard therefore:
 *   1. Allows only http/https, and rejects credentials embedded in the URL.
 *   2. Rejects hostnames that name a loopback or metadata service by name.
 *   3. Resolves DNS and checks EVERY returned address against the blocked
 *      ranges — because `evil.com A 127.0.0.1` is legal DNS, and a name-only
 *      check catches nothing.
 *   4. Re-runs the whole check on every redirect hop, with `maxRedirects: 0` and
 *      a manual loop. A guard that validates only the first URL is defeated by
 *      a 302 to 169.254.169.254 — this is the most commonly missed step.
 *   5. Caps redirect count and response size.
 *
 * `assertSafeUrl` and `isBlockedAddress` are exported and unit-tested directly,
 * because a security control that is only exercised through an integration test
 * is a security control nobody is really checking.
 *
 * Residual risk, stated honestly: DNS is resolved and then fetched separately,
 * so a rebinding attack (TTL 0, second lookup returns a private address) is not
 * fully closed. Closing it needs a pinned-IP HTTP agent. For an internal tool
 * behind SSO, on a network with no unauthenticated internal services, that is
 * recorded as accepted risk rather than fixed here.
 */

const dns = require('dns').promises;
const net = require('net');
const path = require('path');

const axios = require('axios');
const cheerio = require('cheerio');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { toPlainText } = require('./sanitize');
const { getTextProvider } = require('./ai');
const prompts = require('./ai/prompts');
const { POINTS_OF_VIEW, BRAND_VOICE_SOURCE_TYPES } = require('../constants');

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Shortest sample we will analyse. Below this the answer would be invented. */
const MIN_SAMPLE_CHARS = 200;

/** Largest page body we will download. Enough for any article; bounds memory. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Redirect hops allowed. Three covers http->https->canonical; more is a loop. */
const MAX_REDIRECTS = 3;

/** Fetch timeout. A brand-voice scrape is interactive — the user is waiting. */
const FETCH_TIMEOUT_MS = 15000;

/** Uploaded file extensions accepted, mirrored by the route's multer filter. */
const ALLOWED_FILE_EXTENSIONS = Object.freeze(['.txt', '.docx']);

/** Traits and their length are capped so one response cannot bloat the row. */
const MAX_TRAITS = 8;
const MAX_TRAIT_CHARS = 300;
/** `brand_voice_tone` is STRING(255) on the model; keep the parser inside it. */
const MAX_TONE_CHARS = 255;
const MAX_SUMMARY_CHARS = 600;

/**
 * A browser-ish User-Agent.
 *
 * Not deception: many CMS front-ends serve a stripped page or a consent wall to
 * an unrecognised agent, and a stripped page produces a brand-voice analysis of
 * boilerplate. The identifier still names the tool.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; ScripturaBrandVoice/1.0; +https://divinetalk.com)';

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

/**
 * Blocked IPv4 ranges as `[network, prefixLength]`.
 *
 * Loopback, link-local (which is where cloud metadata lives) and the three
 * RFC1918 private ranges are the ones that matter operationally. The rest —
 * CGNAT, benchmarking, documentation, multicast, reserved — are included because
 * none of them can host a legitimate public brand page, so allowing them buys
 * nothing and costs a bypass.
 */
const BLOCKED_IPV4 = Object.freeze([
  ['0.0.0.0', 8], // "this host on this network"
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // RFC6598 carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — AWS/GCP/Azure metadata endpoint
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
]);

/** Hostnames blocked by name, independent of what DNS says they resolve to. */
const BLOCKED_HOSTNAMES = Object.freeze([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Hostname suffixes blocked by name. `.local` is mDNS; `.internal` is cloud DNS. */
const BLOCKED_HOSTNAME_SUFFIXES = Object.freeze([
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.localdomain',
]);

/** Ports allowed. Anything else on a "brand page" is a service probe. */
const ALLOWED_PORTS = Object.freeze([80, 443, 8080, 8443]);

/** Converts dotted-quad IPv4 to an unsigned 32-bit integer. */
function ipv4ToInt(address) {
  return address
    .split('.')
    .reduce((acc, octet) => (acc << 8) + (Number.parseInt(octet, 10) & 0xff), 0) >>> 0;
}

/** True when an IPv4 address falls inside `network/prefix`. */
function inIpv4Range(address, network, prefix) {
  // A /0 mask would shift by 32, which is a no-op in JS — special-cased rather
  // than silently matching nothing.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(network) & mask);
}

/**
 * True when an address must not be fetched.
 *
 * Handles IPv4, IPv6, and the IPv4-mapped/NAT64 IPv6 forms — `::ffff:127.0.0.1`
 * is loopback wearing a different hat, and a checker that only reads the IPv6
 * prefix waves it through.
 *
 * @param {string} address An IPv4 or IPv6 literal.
 * @returns {boolean} True if blocked. Unparseable input is treated as blocked.
 */
function isBlockedAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  const version = net.isIP(value);

  if (version === 4) {
    return BLOCKED_IPV4.some(([network, prefix]) => inIpv4Range(value, network, prefix));
  }

  if (version === 6) {
    // Unwrap an embedded IPv4 and re-check it as IPv4.
    const embedded = /^(?:::ffff:|64:ff9b::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(value);
    if (embedded && net.isIP(embedded[1]) === 4) return isBlockedAddress(embedded[1]);

    // Hex-encoded IPv4-mapped form, e.g. ::ffff:7f00:1.
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
    if (hexMapped) {
      const high = Number.parseInt(hexMapped[1], 16);
      const low = Number.parseInt(hexMapped[2], 16);
      const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
      return isBlockedAddress(dotted);
    }

    if (value === '::' || value === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // fe80::/10 link-local
    if (/^ff[0-9a-f]{2}:/.test(value)) return true; // ff00::/8 multicast
    if (/^2001:0*db8:/.test(value)) return true; // documentation
    return false;
  }

  // Not an IP literal at all — the caller passed something unexpected. Blocking
  // is the only safe default for a security check.
  return true;
}

/**
 * Validates a user-supplied URL for server-side fetching.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {(hostname: string) => Promise<Array<{address: string}>>} [options.resolve]
 *   DNS lookup, injected so the unit tests never touch a resolver.
 * @returns {Promise<{url: string, hostname: string, addresses: string[]}>}
 * @throws {ApiError} 422 URL_NOT_ALLOWED with a reason the UI can show.
 */
async function assertSafeUrl(url, { resolve } = {}) {
  const raw = String(url || '').trim();

  const reject = (reason, details = {}) => {
    throw ApiError.unprocessable(`That URL cannot be fetched: ${reason}`, {
      code: 'URL_NOT_ALLOWED',
      details: { url: raw, reason, ...details },
    });
  };

  if (raw === '') reject('no URL was supplied.');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return reject('it is not a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    // file:, gopher:, ftp: and dict: are all classic SSRF escalation schemes.
    reject(`the "${parsed.protocol.replace(':', '')}" scheme is not allowed. Use http or https.`);
  }

  if (parsed.username !== '' || parsed.password !== '') {
    // Credentials in a URL are how `http://expected.com@169.254.169.254/` is
    // smuggled past a human reviewer.
    reject('URLs containing credentials are not allowed.');
  }

  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port);
  if (!ALLOWED_PORTS.includes(port)) {
    reject(`port ${port} is not allowed. Allowed ports: ${ALLOWED_PORTS.join(', ')}.`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '') reject('it has no hostname.');
  if (BLOCKED_HOSTNAMES.includes(hostname)) reject(`the hostname "${hostname}" is not allowed.`);
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    reject(`internal hostnames like "${hostname}" are not allowed.`);
  }

  // A bare IP literal skips DNS entirely, so check it directly.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) reject(`${hostname} is a private or reserved address.`);
    return { url: parsed.toString(), hostname, addresses: [hostname] };
  }

  // IPv6 literals arrive bracketed; URL.hostname keeps the brackets.
  const unbracketed = hostname.replace(/^\[|\]$/g, '');
  if (unbracketed !== hostname && net.isIP(unbracketed)) {
    if (isBlockedAddress(unbracketed)) reject(`${unbracketed} is a private or reserved address.`);
    return { url: parsed.toString(), hostname: unbracketed, addresses: [unbracketed] };
  }

  const lookup = resolve || ((name) => dns.lookup(name, { all: true, verbatim: true }));
  let records;
  try {
    records = await lookup(hostname);
  } catch (err) {
    reject(`the hostname "${hostname}" could not be resolved.`, { dnsCode: err.code });
  }

  const addresses = (Array.isArray(records) ? records : [records])
    .map((record) => (typeof record === 'string' ? record : record?.address))
    .filter(Boolean);

  if (addresses.length === 0) reject(`the hostname "${hostname}" resolved to no addresses.`);

  // EVERY address, not the first: a host with one public and one private A
  // record would otherwise be a coin flip at connect time.
  const blocked = addresses.filter((address) => isBlockedAddress(address));
  if (blocked.length > 0) {
    reject(`"${hostname}" resolves to a private or reserved address (${blocked.join(', ')}).`, {
      addresses,
    });
  }

  return { url: parsed.toString(), hostname, addresses };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Elements that are chrome, not prose. Removed before text extraction. */
const CHROME_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'textarea',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[aria-hidden="true"]', '[hidden]',
  '.nav', '.navbar', '.menu', '.sidebar', '.breadcrumb', '.cookie', '.newsletter',
  '.comments', '.related-posts', '.share', '.social',
];

/**
 * Content containers, most specific first.
 *
 * `<article>` before `<main>` before the body, because a listing page has a
 * `<main>` full of teasers and one `<article>` of real prose — analysing the
 * teasers would describe the site's card layout rather than its writing voice.
 */
const CONTENT_SELECTORS = ['article', 'main', '[role="main"]', '#content', '.post-content', '.entry-content'];

/**
 * Normalises a pasted or extracted writing sample.
 *
 * @param {string} text
 * @returns {string}
 */
function extractFromText(text) {
  const value = typeof text === 'string' ? text : '';
  // toPlainText because a user pasting from a CMS pastes HTML, and analysing tag
  // soup produces a voice description of the markup.
  const cleaned = toPlainText(value) || value.replace(/\s+/g, ' ').trim();

  if (cleaned.length < MIN_SAMPLE_CHARS) {
    throw ApiError.unprocessable(
      `The writing sample is too short to analyse (${cleaned.length} characters, ${MIN_SAMPLE_CHARS} needed). ` +
        'Paste at least a few paragraphs of real published copy.',
      { code: 'SAMPLE_TOO_SHORT', details: { length: cleaned.length, minimum: MIN_SAMPLE_CHARS } }
    );
  }

  return cleaned;
}

/**
 * Pulls the prose out of an HTML document.
 * @param {string} html
 * @returns {string}
 */
function extractTextFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  $(CHROME_SELECTORS.join(',')).remove();

  let container = null;
  for (const selector of CONTENT_SELECTORS) {
    const found = $(selector).first();
    if (found.length && found.text().trim().length >= MIN_SAMPLE_CHARS) {
      container = found;
      break;
    }
  }
  const scope = container || $('body');

  // Join block-level text with newlines rather than taking `.text()` wholesale,
  // so paragraph boundaries survive and the model can see sentence rhythm —
  // which is a large part of what "voice" actually is.
  const parts = [];
  scope.find('h1,h2,h3,h4,p,li,blockquote,figcaption,dd,dt').each((_, el) => {
    const value = $(el).text().replace(/\s+/g, ' ').trim();
    if (value !== '') parts.push(value);
  });

  const joined = parts.length > 0 ? parts.join('\n') : scope.text().replace(/\s+/g, ' ').trim();
  return joined.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Fetches a page and extracts its prose, validating every redirect hop.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Function} [options.resolve] DNS resolver, for tests.
 * @param {Function} [options.request] axios-compatible request, for tests.
 * @returns {Promise<{sample: string, finalUrl: string}>}
 */
async function extractFromUrl(url, { resolve, request } = {}) {
  const get = request || axios.get;
  let current = (await assertSafeUrl(url, { resolve })).url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await get(current, {
        timeout: FETCH_TIMEOUT_MS,
        // Manual redirect handling is the whole point: axios following them
        // internally would bypass assertSafeUrl on every hop after the first.
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        responseType: 'text',
        decompress: true,
        validateStatus: () => true,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      });
    } catch (err) {
      logger.warn('Brand-voice scrape failed', { url: current, code: err.code, message: err.message });
      throw ApiError.upstream(`Could not fetch ${current}: ${err.message}`, {
        code: 'SCRAPE_FAILED',
        details: { url: current },
        cause: err,
      });
    }

    const status = Number(response.status);

    if (status >= 300 && status < 400) {
      const location = response.headers?.location || response.headers?.Location;
      if (!location) {
        throw ApiError.unprocessable(`${current} redirected without a destination.`, {
          code: 'SCRAPE_FAILED',
          details: { url: current, status },
        });
      }
      if (hop === MAX_REDIRECTS) {
        throw ApiError.unprocessable(
          `${url} redirected more than ${MAX_REDIRECTS} times. Paste the final URL instead.`,
          { code: 'TOO_MANY_REDIRECTS', details: { url: String(url), hops: hop + 1 } }
        );
      }
      // Resolve relative Location headers against the current URL, then re-run
      // the FULL guard. This is the step that stops a 302 to the metadata IP.
      const next = new URL(location, current).toString();
      current = (await assertSafeUrl(next, { resolve })).url;
      continue;
    }

    if (status >= 400) {
      throw ApiError.upstream(`${current} returned HTTP ${status}.`, {
        code: 'SCRAPE_FAILED',
        details: { url: current, status },
      });
    }

    const contentType = String(response.headers?.['content-type'] || '');
    if (contentType !== '' && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw ApiError.unprocessable(
        `${current} served "${contentType}", not a web page. Point at an article or a blog post.`,
        { code: 'UNSUPPORTED_CONTENT_TYPE', details: { url: current, contentType } }
      );
    }

    const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    const sample = /text\/plain/i.test(contentType)
      ? body.replace(/\s+/g, ' ').trim()
      : extractTextFromHtml(body);

    if (sample.length < MIN_SAMPLE_CHARS) {
      throw ApiError.unprocessable(
        `Only ${sample.length} characters of readable text were found at ${current}. ` +
          'Point at a full article rather than a landing or listing page.',
        { code: 'SAMPLE_TOO_SHORT', details: { url: current, length: sample.length } }
      );
    }

    return { sample, finalUrl: current };
  }

  /* istanbul ignore next -- the loop always returns or throws. */
  throw ApiError.unprocessable('The URL could not be fetched.', { code: 'SCRAPE_FAILED' });
}

/**
 * Extracts a writing sample from an uploaded file.
 *
 * Extension is checked here as well as in the route's multer filter, because
 * this function is also reachable from a script or a future job and a security
 * check that lives only in middleware is one refactor away from being gone.
 *
 * @param {Buffer} buffer File contents.
 * @param {string} filename Original filename, used for the extension.
 * @returns {Promise<string>} The extracted sample.
 */
async function extractFromFile(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.unprocessable('The uploaded file is empty.', { code: 'EMPTY_FILE' });
  }

  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
    throw ApiError.unprocessable(
      `Only ${ALLOWED_FILE_EXTENSIONS.join(' and ')} files can be analysed (got "${extension || 'no extension'}").`,
      { code: 'UNSUPPORTED_FILE_TYPE', details: { extension, allowed: ALLOWED_FILE_EXTENSIONS } }
    );
  }

  if (extension === '.txt') {
    return extractFromText(buffer.toString('utf8'));
  }

  let result;
  try {
    // Required lazily: mammoth pulls in a sizeable dependency tree and only the
    // .docx path needs it.
    const mammoth = require('mammoth');
    result = await mammoth.extractRawText({ buffer });
  } catch (err) {
    throw ApiError.unprocessable(
      'That .docx file could not be read. Re-save it from Word or export it as .txt.',
      { code: 'DOCX_PARSE_FAILED', cause: err }
    );
  }

  return extractFromText(result?.value || '');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Loose point-of-view spellings mapped onto the canonical enum.
 *
 * Models write "second person" or "you" far more readily than
 * "second_person", and rejecting those would throw away a perfectly good
 * analysis over formatting.
 */
const POV_ALIASES = Object.freeze({
  i: 'first_person_singular',
  me: 'first_person_singular',
  'first person': 'first_person_singular',
  'first person singular': 'first_person_singular',
  'first-person singular': 'first_person_singular',
  we: 'first_person_plural',
  us: 'first_person_plural',
  'first person plural': 'first_person_plural',
  'first-person plural': 'first_person_plural',
  you: 'second_person',
  your: 'second_person',
  'second person': 'second_person',
  'second-person': 'second_person',
  they: 'third_person',
  'third person': 'third_person',
  'third-person': 'third_person',
  neutral: 'third_person',
  impersonal: 'third_person',
});

/** Normalises a candidate point of view onto the enum, or null. */
function normalisePov(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cleaned === '') return null;
  if (POINTS_OF_VIEW.includes(cleaned.replace(/[\s-]+/g, '_'))) {
    return cleaned.replace(/[\s-]+/g, '_');
  }
  return POV_ALIASES[cleaned] || null;
}

/** Coerces whatever the model called "traits" into a clean string array. */
function normaliseTraits(value) {
  let list = [];

  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    // A model that ignored the array instruction usually returns a newline or
    // semicolon separated list, or markdown bullets.
    list = value.split(/\r?\n|;/);
  } else if (value && typeof value === 'object') {
    // `{ "1": "...", "2": "..." }` happens often enough to be worth handling.
    list = Object.values(value);
  }

  const cleaned = [];
  for (const entry of list) {
    const text =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? String(entry.trait ?? entry.text ?? entry.description ?? '')
          : '';
    const trimmed = text
      .replace(/^\s*[-*•]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (trimmed === '') continue;
    cleaned.push(trimmed.slice(0, MAX_TRAIT_CHARS));
    if (cleaned.length >= MAX_TRAITS) break;
  }

  return cleaned;
}

/**
 * Turns a model response into the four brand-voice fields.
 *
 * Every field degrades independently: a response with a good tone and a nonsense
 * `pov` yields the tone and a null pov, because a human confirms the result
 * before it can influence anything (Section 4 Step 2) and a partial answer is
 * far more useful to them than a hard failure.
 *
 * Accepts a raw string (fenced, prose-prefixed, or bare JSON), an
 * already-parsed object, or the `{ raw, parsed }` envelope the providers return.
 *
 * @param {string|object} raw
 * @returns {{tone: string|null, pov: string|null, traits: string[], summary: string|null}}
 */
function parseBrandVoiceResponse(raw) {
  const empty = { tone: null, pov: null, traits: [], summary: null };

  let source = raw;

  // Providers hand back `{ raw, parsed }`; accept either half.
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    if (source.parsed && typeof source.parsed === 'object') source = source.parsed;
    else if (typeof source.raw === 'string') source = source.raw;
  }

  if (typeof source === 'string') {
    // Required lazily to avoid a cycle: BaseProvider does not import this file
    // today, but keeping the dependency one-directional at load time is cheap
    // insurance.
    const { extractJson } = require('./ai/BaseProvider');
    try {
      source = extractJson(source, { provider: 'ai', operation: 'brand voice response' });
    } catch {
      // Unparseable output is not worth a 502 here: the caller gets empty fields
      // and the human filling in the form sees an unhelpful-but-editable result.
      logger.warn('Brand-voice response could not be parsed as JSON.');
      return empty;
    }
  }

  if (!source || typeof source !== 'object' || Array.isArray(source)) return empty;

  // Some responses nest everything under a wrapper key.
  const body =
    source.brand_voice && typeof source.brand_voice === 'object'
      ? source.brand_voice
      : source.voice && typeof source.voice === 'object'
        ? source.voice
        : source;

  const toneRaw = body.tone ?? body.tone_of_voice ?? body.toneOfVoice;
  const tone =
    typeof toneRaw === 'string' && toneRaw.trim() !== ''
      ? toneRaw.replace(/\s+/g, ' ').trim().slice(0, MAX_TONE_CHARS)
      : Array.isArray(toneRaw) && toneRaw.length
        ? toneRaw.filter((t) => typeof t === 'string').join(', ').slice(0, MAX_TONE_CHARS)
        : null;

  const summaryRaw = body.summary ?? body.description ?? body.overview;
  const summary =
    typeof summaryRaw === 'string' && summaryRaw.trim() !== ''
      ? summaryRaw.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS)
      : null;

  return {
    tone,
    pov: normalisePov(body.pov ?? body.point_of_view ?? body.pointOfView),
    traits: normaliseTraits(body.traits ?? body.style_rules ?? body.styleRules ?? body.characteristics),
    summary,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Runs the full analysis: extract a sample, ask the model, parse the answer.
 *
 * Returns `source_ref` alongside the analysis so the caller can persist
 * provenance on the blog row — for a scrape that is the final URL after
 * redirects (which is what was actually read, not what was typed), and for an
 * upload it is the original filename.
 *
 * Note what this function does NOT do: it never sets `brand_voice_confirmed`.
 * That flag means "a human looked at this", and only a human action may set it.
 *
 * @param {object} input
 * @param {string} input.sourceType One of constants.BRAND_VOICE_SOURCE_TYPES.
 * @param {string} [input.text] Required for sourceType 'text'.
 * @param {string} [input.url] Required for sourceType 'web_scrape'.
 * @param {{buffer: Buffer, originalname: string}} [input.file] Required for 'file_upload'.
 * @param {object} [options]
 * @param {object} [options.provider] Text provider override, for tests.
 * @param {Function} [options.resolve] DNS resolver override, for tests.
 * @param {Function} [options.request] HTTP getter override, for tests.
 * @returns {Promise<{source_type: string, source_ref: string|null, sample_length: number, tone: string|null, pov: string|null, traits: string[], summary: string|null, confirmed: false}>}
 */
async function analyzeBrandVoice({ sourceType, text, url, file } = {}, options = {}) {
  if (!BRAND_VOICE_SOURCE_TYPES.includes(sourceType)) {
    throw ApiError.unprocessable(
      `source_type must be one of ${BRAND_VOICE_SOURCE_TYPES.join(', ')}.`,
      { code: 'VALIDATION_ERROR', details: { sourceType } }
    );
  }
  if (sourceType === 'none') {
    throw ApiError.unprocessable(
      'source_type "none" means there is nothing to analyse. Choose text, web_scrape or file_upload.',
      { code: 'NOTHING_TO_ANALYSE' }
    );
  }

  let sample;
  let sourceRef = null;

  if (sourceType === 'text') {
    sample = extractFromText(text);
  } else if (sourceType === 'web_scrape') {
    const scraped = await extractFromUrl(url, options);
    sample = scraped.sample;
    sourceRef = scraped.finalUrl;
  } else {
    sample = await extractFromFile(file?.buffer, file?.originalname);
    sourceRef = String(file?.originalname || '').slice(0, 1000);
  }

  // Capped before the call, not after: the cap exists to bound token spend, and
  // truncating the response would not save anything.
  const capped = prompts.clamp(sample, prompts.BRAND_VOICE_SAMPLE_MAX_CHARS);

  const provider = options.provider || getTextProvider();
  const response = await provider.analyzeBrandVoice({ sample: capped });
  const parsed = parseBrandVoiceResponse(response);

  if (!parsed.tone && parsed.traits.length === 0) {
    throw ApiError.upstream(
      'The model returned no usable brand-voice description. Try a longer or more distinctive sample.',
      { code: 'UPSTREAM_BAD_RESPONSE', details: { provider: provider.name } }
    );
  }

  return {
    source_type: sourceType,
    source_ref: sourceRef,
    sample_length: capped.length,
    tone: parsed.tone,
    pov: parsed.pov,
    traits: parsed.traits,
    summary: parsed.summary,
    // Always false. Section 4 Step 2 requires an explicit human confirmation
    // step, and the generation pipeline enforces it — see services/generation.js.
    confirmed: false,
  };
}

module.exports = {
  analyzeBrandVoice,
  extractFromText,
  extractFromUrl,
  extractFromFile,
  extractTextFromHtml,
  parseBrandVoiceResponse,
  normalisePov,
  normaliseTraits,
  assertSafeUrl,
  isBlockedAddress,
  MIN_SAMPLE_CHARS,
  MAX_RESPONSE_BYTES,
  MAX_REDIRECTS,
  MAX_TRAITS,
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_PORTS,
  BLOCKED_IPV4,
  BLOCKED_HOSTNAMES,
  BLOCKED_HOSTNAME_SUFFIXES,
};
