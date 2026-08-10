import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

const FETCH_TIMEOUT_MS = 6000;

// Subpages we probe to verify a domain is a real, multi-page business site.
const VERIFY_PATHS = ['/contact', '/about'];

// Penalty applied to the quality score when no real /contact or /about page
// could be verified (feeds the MIN_QUALITY_TO_LOG threshold downstream).
const UNVERIFIED_SCORE_PENALTY = 15;

// Specific soft-404 markers: a page that returns HTTP 200 but is really a
// "not found" page. Kept narrow so legitimate copy (addresses, years) doesn't
// trip it.
const SOFT_404_MARKERS = [
  'page not found', 'error 404', '404 not found',
  "page doesn't exist", 'page does not exist', 'page no longer exists',
];

// Hostname suffixes that are never real business leads
const SKIP_HOSTNAME_SUFFIXES = [
  '.zendesk.com',
];

/**
 * Reject preview/staging deploy hostnames from hosting platforms. These serve
 * real, non-parked content that passes every content check, but they are never
 * the actual business site — the live site lives on a custom domain. Rejected
 * outright regardless of page content.
 */
function isPreviewHostname(hostname) {
  const h = hostname.toLowerCase();

  // Webflow's default staging domain, used until a custom domain is connected.
  // Once the site is live it is served from the custom domain, so every
  // *.webflow.io host is staging.
  if (h.endsWith('.webflow.io')) return true;

  // Vercel preview deploys: <project>-git-<branch>-<scope>.vercel.app or
  // <project>-<hash>-<scope>.vercel.app. The bare <project>.vercel.app
  // production alias has no such preview marker, so keep it.
  if (h.endsWith('.vercel.app')) {
    const segments = h.slice(0, -'.vercel.app'.length).split('-');
    if (segments.includes('git')) return true; // git branch preview
    // Auto-generated deploy hash: an 8+ char alphanumeric segment with a digit.
    if (segments.some((s) => s.length >= 8 && /[0-9]/.test(s) && /^[a-z0-9]+$/.test(s))) return true;
  }

  // Netlify deploy/branch/preview deploys separate the deploy context
  // (deploy-preview-N, a branch name, or a permalink hash) from the site name
  // with a `--`: e.g. deploy-preview-12--site, staging--site, 5f3a2b1c--site.
  // Production is just <site>.netlify.app with no `--`.
  if (h.endsWith('.netlify.app') && h.includes('--')) return true;

  return false;
}

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

/** Strip scripts/styles/tags and collapse whitespace to get visible page text. */
function visibleText(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether two blocks of visible text are essentially the same page — used to
 * catch SPA/catch-all handlers that re-serve the homepage for every path.
 */
function isSameContent(a, b) {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen === 0) return false;
  // Near-identical length + identical long prefix ⇒ same underlying page.
  const lenRatio = minLen / Math.max(na.length, nb.length);
  if (lenRatio > 0.95) {
    const prefixLen = Math.min(300, minLen);
    if (na.slice(0, prefixLen) === nb.slice(0, prefixLen)) return true;
  }
  return false;
}

/**
 * Fetch a same-domain subpage and decide whether it is a real, distinct page.
 * True only for a 200 text/html response whose visible text is over ~100 chars,
 * is not a soft-404, is not a redirect back to the homepage, and is meaningfully
 * different from the homepage.
 *
 * @param {string} baseUrl   scheme://domain that worked for the homepage
 * @param {string} pathname  e.g. '/contact'
 * @param {string} homeText  homepage visible text, for catch-all comparison
 */
async function isRealSubpage(baseUrl, pathname, homeText) {
  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl}${pathname}`, FETCH_TIMEOUT_MS);
  } catch {
    return false;
  }

  if (!res.ok) return false; // 404 / 5xx / etc.

  // A redirect whose final path is the site root is a "redirect back to homepage".
  try {
    const finalPath = new URL(res.url).pathname.replace(/\/+$/, '');
    if (res.redirected && (finalPath === '' || finalPath === '/')) return false;
  } catch {
    // ignore URL parse issues — fall through to content checks
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return false;

  let html;
  try {
    html = await res.text();
  } catch {
    return false;
  }

  const text = visibleText(html);
  if (text.length < 100) return false; // thin page

  const lowerText = text.toLowerCase();
  if (SOFT_404_MARKERS.some((m) => lowerText.includes(m))) return false;

  // Catch-all handlers serve the homepage for unknown paths — if the visible
  // text is essentially the homepage, this is not a distinct subpage.
  if (isSameContent(text, homeText)) return false;

  return true;
}

/**
 * Extract the main body text with nav/header/footer boilerplate removed, so the
 * content hash reflects a page's unique content rather than shared chrome.
 */
function extractMainText($) {
  const $body = $('body').clone();
  $body.find('nav, header, footer, script, style, noscript').remove();
  return $body.text().replace(/\s+/g, ' ').trim();
}

/**
 * Content fingerprint for duplicate-site detection: normalize whitespace,
 * lowercase, and SHA-256 the first 500 chars of boilerplate-stripped text.
 * Returns null when there is too little unique content to fingerprint safely
 * (avoids mass-rejecting thin pages that merely share a few words).
 */
function computeContentHash(mainText) {
  const normalized = mainText.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.length < 50) return null;
  return createHash('sha256').update(normalized.slice(0, 500)).digest('hex');
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
  if (isPreviewHostname(lowerDomain)) return null;

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

  // ── Multi-page verification ──────────────────────────────────────────────
  // A real business almost always has a working /contact or /about page. Probe
  // both; a single verified subpage is enough. If neither verifies, don't reject
  // outright — mark unverified and dock the score so the threshold can decide.
  const homeText = visibleText(html);
  let verified = false;
  for (const pathname of VERIFY_PATHS) {
    if (await isRealSubpage(url, pathname, homeText)) {
      verified = true;
      break;
    }
  }
  if (!verified) {
    score = Math.max(0, score - UNVERIFIED_SCORE_PENALTY);
  }

  // ── Content fingerprint (duplicate-site detection) ───────────────────────
  const contentHash = computeContentHash(extractMainText($));

  return {
    domain,
    url,
    title,
    platform,
    emails: emailMatches,
    socials,
    qualityScore: score,
    hasContact: emailMatches.length > 0 || Object.keys(socials).length > 0,
    verified,
    contentHash,
    firstSeenAt: new Date().toISOString(),
  };
}
