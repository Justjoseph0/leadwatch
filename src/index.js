import fs from 'fs';
import path from 'path';
import { startCertListener } from './certListener.js';
import { fingerprintDomain } from './fingerprint.js';
import { supabase } from './supabase.js';
import { checkAlerts } from './alerts.js';

const LEADS_FILE = path.resolve('leads.jsonl');
const MAX_CONCURRENCY = 8;

// Drop near-empty junk pages below this score. Legitimate (if basic)
// businesses usually score 35+; sub-35 is mostly placeholder or thin sites.
const MIN_QUALITY_TO_LOG = 35;

// Simple concurrency-limited queue
class Queue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.pending = [];
  }

  push(task) {
    this.pending.push(task);
    this._drain();
  }

  _drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      this.running++;
      task().finally(() => {
        this.running--;
        this._drain();
      });
    }
  }
}

const queue = new Queue(MAX_CONCURRENCY);

const UPSERT_RETRIES = 3;
const UPSERT_BACKOFF_MS = [0, 500, 2000]; // delay before each attempt

/** Upsert a single lead row with exponential backoff. Returns true on success. */
async function upsertWithRetry(lead) {
  for (let attempt = 0; attempt < UPSERT_RETRIES; attempt++) {
    if (UPSERT_BACKOFF_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, UPSERT_BACKOFF_MS[attempt]));
    }

    const { error } = await supabase.from('leads').upsert(
      {
        domain:        lead.domain,
        url:           lead.url,
        title:         lead.title,
        platform:      lead.platform,
        quality_score: lead.qualityScore,
        emails:        lead.emails,
        socials:       lead.socials,
        content_hash:  lead.contentHash,
        first_seen_at: lead.firstSeenAt,
      },
      { onConflict: 'domain', ignoreDuplicates: true }
    );

    if (!error) return true;

    const isLast = attempt === UPSERT_RETRIES - 1;
    if (isLast) {
      console.error(
        `[supabase] all ${UPSERT_RETRIES} upsert attempts failed for ${lead.domain} — lead kept in ${LEADS_FILE} only. Last error: ${error.message}`
      );
    } else {
      console.warn(
        `[supabase] upsert attempt ${attempt + 1} failed for ${lead.domain} (${error.message}), retrying…`
      );
    }
  }
  return false;
}

/**
 * Content hashes accepted during this process's lifetime. This is the fast,
 * synchronous half of duplicate detection: it closes the same-burst race that
 * the DB SELECT cannot, because two concurrent workers processing templated
 * sites in one firehose burst both query the DB before either has committed a
 * row. It does NOT survive restarts — the DB SELECT is the cross-session half.
 */
const seenContentHashes = new Set();

/**
 * Look for an existing lead on a *different* domain that shares this content
 * hash — i.e. a templated/duplicate site. Returns the matching domain, or null
 * if none (or if the hash is absent).
 *
 * Fails open: on a lookup error we return null so a transient DB blip never
 * causes us to silently drop a legitimate lead.
 */
async function findDuplicateContentDomain(lead) {
  if (!lead.contentHash) return null;

  const { data, error } = await supabase
    .from('leads')
    .select('domain')
    .eq('content_hash', lead.contentHash)
    .neq('domain', lead.domain)
    .limit(1);

  if (error) {
    console.warn(`[dedup] content-hash lookup failed for ${lead.domain} (${error.message}) — allowing lead through`);
    return null;
  }

  return data && data.length > 0 ? data[0].domain : null;
}

/** Persist a lead to Supabase (upsert on domain) and also to the local JSONL fallback. */
async function appendLead(lead) {
  // Local fallback — always written first so we never lose a lead even if Supabase is down
  fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n', 'utf8');
  const success = await upsertWithRetry(lead);

  // Check alert rules only if upsert succeeded
  if (success) {
    await checkAlerts(lead);
  }
}

/** Process one candidate domain through fingerprinting + persistence */
async function processDomain(domain) {
  let lead;
  try {
    lead = await fingerprintDomain(domain);
  } catch (err) {
    // Silent: network errors, timeouts, etc. are expected at scale
    return;
  }

  if (!lead) return;

  // Drop low-quality junk before it reaches the DB / JSONL / alerts.
  if (lead.qualityScore < MIN_QUALITY_TO_LOG) return;

  // Reject templated/duplicate sites. First the in-process Set: check + add run
  // back-to-back with no await between them, so a second worker processing the
  // same template in the same burst can never pass the check before the first
  // has added its hash. The DB SELECT below then catches duplicates from prior
  // runs (the Set is empty after a restart).
  if (lead.contentHash && seenContentHashes.has(lead.contentHash)) {
    console.log(`[dedup] skipping ${lead.domain} — duplicate content seen earlier in this run`);
    return;
  }
  if (lead.contentHash) seenContentHashes.add(lead.contentHash);

  const duplicateOf = await findDuplicateContentDomain(lead);
  if (duplicateOf) {
    console.log(`[dedup] skipping ${lead.domain} — duplicate content of ${duplicateOf}`);
    return;
  }

  await appendLead(lead);

  // One-line console summary
  const contact = lead.hasContact ? '✉' : ' ';
  const check = lead.verified ? '✓' : ' ';
  console.log(
    `[${lead.qualityScore.toString().padStart(3)}] ${check}${contact} ${lead.platform.padEnd(18)} ${lead.domain.padEnd(40)} ${lead.title.slice(0, 60)}`
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

console.log('LeadWatch starting…');
console.log(`Concurrency: ${MAX_CONCURRENCY}  |  Output: ${LEADS_FILE}`);
console.log('─'.repeat(80));

startCertListener((domain) => {
  queue.push(() => processDomain(domain));
});
