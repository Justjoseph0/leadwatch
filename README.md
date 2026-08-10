# LeadWatch

Real-time business lead discovery powered by certificate transparency logs.

LeadWatch listens to the [certstream](https://certstream.calidog.io/) WebSocket feed, which surfaces every new TLS certificate issued globally. Most new certificates correspond to real domain registrations and launches. LeadWatch filters out infrastructure noise, fetches each surviving domain, detects the platform, extracts contact signals (emails + social profiles), scores page quality, and writes the results to `leads.jsonl`.

## How it works

```
certstream feed  →  noise filter  →  concurrency queue (×8)
                                          ↓
                                   fingerprintDomain()
                                          ↓
                             leads.jsonl  +  console summary
```

1. **certListener.js** — connects to `wss://certstream.calidog.io/`, extracts domains from `certificate_update` events, drops CDN/infra domains, wildcards, deep subdomains, and common infra prefixes; deduplicates within the session; auto-reconnects every 5 s on disconnect.

2. **fingerprint.js** — fetches the domain over HTTPS (falls back to HTTP), rejects non-HTML or parked pages, then detects platform (Shopify, WooCommerce, WordPress, Wix, Squarespace, Webflow, BigCommerce, Framer, or Custom/Unknown), extracts up to 5 emails and Instagram/Twitter/LinkedIn/Facebook links, and computes a 0–100 quality score based on viewport meta, title, favicon, nav links, and schema.org JSON-LD.

3. **index.js** — orchestrator: runs a max-8-concurrency queue over incoming candidates and appends each non-null result to `leads.jsonl`.

## Requirements

- Node.js 18+
- **Must run outside any sandboxed or restricted network environment.** LeadWatch opens an outbound WebSocket connection to `wss://certstream.calidog.io/` and makes HTTPS/HTTP requests to arbitrary domains. Corporate proxies, CI runners, or container environments that block outbound connections will prevent it from working.

## Usage

```bash
npm install
npm start
```

Console output format:
```
[score] ✉ Platform           domain                                   Page title
[ 80] ✉ Shopify           acme-store.com                           Acme — Premium Widgets
[ 60]   WordPress          blog.example.org                         Hello World – Example
```

## Output — leads.jsonl

Each line is a JSON object:

```jsonc
{
  "domain": "acme-store.com",
  "url": "https://acme-store.com",
  "title": "Acme — Premium Widgets",
  "platform": "Shopify",
  "emails": ["hello@acme-store.com"],
  "socials": { "instagram": "https://instagram.com/acmestore" },
  "qualityScore": 80,
  "hasContact": true,
  "firstSeenAt": "2026-08-06T12:00:00.000Z"
}
```

## Supabase integration

`supabase/schema.sql` defines a `leads` table ready to import into your Supabase project. Run it in the **SQL Editor** inside your Supabase dashboard. The schema includes:

- `has_contact` — generated column, true when `emails` is non-empty or `socials` is non-empty
- `status` — workflow field: `new` → `contacted` → `replied` / `ignored`
- Indexes on `status`, `platform`, `quality_score`, `first_seen_at`
- Row Level Security enabled with a permissive allow-all policy (tighten before production)

## Notes

- The `seen` dedup set is in-memory; it resets on process restart, so you may revisit domains across runs. Add a Redis or SQLite check against `leads.jsonl` if you need cross-run dedup.
- Quality scores favour completeness signals (structured markup, nav, favicon) — a high score does not guarantee a good lead, it means the site is well-formed.
- Certstream surfaces ~100–300 domains/minute during business hours; the queue handles bursts gracefully by buffering.
