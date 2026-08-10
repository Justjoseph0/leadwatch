import fs from 'fs';
import path from 'path';
import { startCertListener } from './certListener.js';
import { fingerprintDomain } from './fingerprint.js';
import { supabase } from './supabase.js';
import { checkAlerts } from './alerts.js';

const LEADS_FILE = path.resolve('leads.jsonl');
const MAX_CONCURRENCY = 8;

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

  await appendLead(lead);

  // One-line console summary
  const contact = lead.hasContact ? '✉' : ' ';
  console.log(
    `[${lead.qualityScore.toString().padStart(3)}] ${contact} ${lead.platform.padEnd(18)} ${lead.domain.padEnd(40)} ${lead.title.slice(0, 60)}`
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

console.log('LeadWatch starting…');
console.log(`Concurrency: ${MAX_CONCURRENCY}  |  Output: ${LEADS_FILE}`);
console.log('─'.repeat(80));

startCertListener((domain) => {
  queue.push(() => processDomain(domain));
});
