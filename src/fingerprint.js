import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 6000;

// Hostname suffixes that are never real business leads
const SKIP_HOSTNAME_SUFFIXES = [
  '.zendesk.com',
];

// Terms in title or body text that indicate gambling/betting sites
const GAMBLING_TERMS = [
  'slot', 'slots', 'casino', 'betting odds', 'sportsbook',
  'online betting', 'sports betting', 'ipl bet', 'cricket bet',
];

// Phrases that indicate the page is parked / not a real business site
const PARKED_PHRASES = [
  'domain is for sale',
  'this domain is for sale',
  'buy this domain',
  'coming soon',
  'under construction',
  'index of /',
  'parked at',
  'for sale',
  'default page',
  'apache2 debian default page',
  'welcome to nginx',
  'this domain has expired',
];

// Platform detection: ordered from most-specific to least
const PLATFORM_SIGNATURES = [
  { name: 'Shopify',      pattern: /shopify/i },
  { name: 'WooCommerce',  pattern: /woocommerce/i },
  { name: 'WordPress',    pattern: /wp-content|wp-includes/i },
  { name: 'Wix',          pattern: /wix\.com|wixsite/i },
  { name: 'Squarespace',  pattern: /squarespace/i },
  { name: 'Webflow',      pattern: /webflow/i },
  { name: 'BigCommerce',  pattern: /bigcommerce/i },
  { name: 'Framer',       pattern: /framer\.com/i },
];

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const SOCIAL_PATTERNS = [
  { key: 'instagram', re: /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+\/?/ },
  { key: 'twitter',   re: /https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_]+\/?/ },
  { key: 'linkedin',  re: /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9\-_%]+\/?/ },
  { key: 'facebook',  re: /https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9.]+\/?/ },
];

/** Fetch with an AbortController timeout. */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/** Try https first, fall back to http. Returns { res, url } or null. */
async function fetchDomain(domain) {
  for (const scheme of ['https', 'http']) {
    const url = `${scheme}://${domain}`;
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      return { res, url };
    } catch {
      // try next scheme
    }
  }
  return null;
}

/**
 * Fingerprint a domain: fetch its home page, detect platform, extract
 * contact signals, and compute a quality score.
 *
 * @param {string} domain
 * @returns {Promise<object|null>} lead object, or null if not a viable lead
 */
export async function fingerprintDomain(domain) {
  // Reject known noise hostnames before making any network request
  const lowerDomain = domain.toLowerCase();
  if (SKIP_HOSTNAME_SUFFIXES.some((s) => lowerDomain.endsWith(s))) return null;

  const fetched = await fetchDomain(domain);
  if (!fetched) return null;

  const { res, url } = fetched;

  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return null;

  let html;
  try {
    html = await res.text();
  } catch {
    return null;
  }

  // Reject very thin pages — likely parked
  const rawText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (rawText.length < 80) return null;

  const lowerHtml = html.toLowerCase();
  const lowerText = rawText.toLowerCase();

  if (PARKED_PHRASES.some((p) => lowerText.includes(p))) return null;

  const $ = cheerio.load(html);

  // ── Platform ────────────────────────────────────────────────────────────
  const platform =
    PLATFORM_SIGNATURES.find(({ pattern }) => pattern.test(html))?.name ?? 'Custom/Unknown';

  // ── Title ───────────────────────────────────────────────────────────────
  const title = $('title').first().text().trim() || '';

  // Reject router/device admin panels and generic server pages — not businesses
  const DEVICE_TITLE_PATTERNS = [
    'web panel', 'router login', 'admin login', 'keeneticos',
    'router admin', 'device admin', 'gateway login',
  ];
  const lowerTitle = title.toLowerCase();
  if (DEVICE_TITLE_PATTERNS.some((p) => lowerTitle.includes(p))) return null;

  // Reject gambling / betting sites — not a target vertical
  if (GAMBLING_TERMS.some((t) => lowerTitle.includes(t) || lowerText.includes(t))) return null;

  // ── Emails (up to 5 unique) ──────────────────────────────────────────────
  const emailMatches = [...new Set(html.match(EMAIL_RE) ?? [])].slice(0, 5);

  // ── Socials ─────────────────────────────────────────────────────────────
  const socials = {};
  for (const { key, re } of SOCIAL_PATTERNS) {
    const m = html.match(re);
    if (m) socials[key] = m[0];
  }

  // ── Quality score (0–100) ───────────────────────────────────────────────
  let score = 0;

  // viewport meta tag (+20)
  if (lowerHtml.includes('name="viewport"') || lowerHtml.includes("name='viewport'")) score += 20;

  // non-empty <title> (+20)
  if (title.length > 0) score += 20;

  // favicon (+15)
  if (
    lowerHtml.includes('rel="icon"') ||
    lowerHtml.includes("rel='icon'") ||
    lowerHtml.includes('rel="shortcut icon"') ||
    lowerHtml.includes("rel='shortcut icon'")
  ) score += 15;

  // 3+ nav links (+25)
  const navLinks = $('nav a, header a').length;
  if (navLinks >= 3) score += 25;

  // schema.org JSON-LD present (+20)
  if (lowerHtml.includes('application/ld+json')) score += 20;

  score = Math.min(score, 100);

  return {
    domain,
    url,
    title,
    platform,
    emails: emailMatches,
    socials,
    qualityScore: score,
    hasContact: emailMatches.length > 0 || Object.keys(socials).length > 0,
    firstSeenAt: new Date().toISOString(),
  };
}
