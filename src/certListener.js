import WebSocket from "ws";

// The original public certstream.calidog.io demo is unreliable (frequent
// disconnects/SSL errors - it was only ever meant as a demo). Point this at
// a self-hosted certstream-server-go instance instead:
//   docker run -d -p 8080:8080 0rickyy0/certstream-server-go
//
// The default "/" endpoint (lite stream) keeps the same certificate_update /
// leaf_cert.all_domains shape this file already parses below, so no other
// changes are needed.
const CERTSTREAM_URL = process.env.CERTSTREAM_URL || "ws://localhost:8080/";

// Infra / CDN / platform-internal domains we never want to treat as "a business".
const SKIP_SUFFIXES = [
  "cloudfront.net", "amazonaws.com", "azurewebsites.net", "googleapis.com",
  "githubusercontent.com", "github.io", "vercel.app", "netlify.app",
  "pages.dev", "herokuapp.com", "myshopify.com", "cloudflaressl.com",
  "letsencrypt.org", "digicert.com", "sectigo.com", "in-addr.arpa",
  "googleusercontent.com", "workers.dev", "firebaseapp.com", "cdn.com"
];

// Very common wildcard/internal subdomain prefixes to drop.
const SKIP_PREFIXES = ["mail.", "webmail.", "autodiscover.", "ns1.", "ns2.", "mta-sts.", "smtp.", "cpanel.", "webdisk."];

function isLikelyNoise(domain) {
  const d = domain.toLowerCase();
  if (SKIP_SUFFIXES.some((s) => d.endsWith(s))) return true;
  if (SKIP_PREFIXES.some((p) => d.startsWith(p))) return true;
  if (d.startsWith("*.")) return true; // wildcard certs, not a specific launch
  if (d.split(".").length > 3) return true; // deep subdomains are usually infra
  return false;
}

/**
 * Connects to the certstream firehose and calls onCandidate(domain)
 * for every domain that survives basic noise filtering.
 *
 * This is intentionally loose — the fingerprinting step does the real
 * "is this a business" decision. This step just cuts obvious junk so
 * we don't fetch millions of URLs.
 */
export function startCertListener(onCandidate) {
  const seen = new Set(); // dedupe within a short window

  const ws = new WebSocket(CERTSTREAM_URL);

  ws.on("open", () => {
    console.log("[certListener] connected to certstream");
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.message_type !== "certificate_update") return;

    const leaf = msg.data?.leaf_cert;
    if (!leaf) return;

    const domains = leaf.all_domains || [];
    for (const rawDomain of domains) {
      if (!rawDomain) continue;
      // Strip leading www. so www.example.com and example.com count as one lead
      const domain = rawDomain.replace(/^www\./i, '');
      if (isLikelyNoise(domain)) continue;
      if (seen.has(domain)) continue;
      seen.add(domain);
      onCandidate(domain);
    }

    // Keep the dedupe set from growing forever
    if (seen.size > 50000) seen.clear();
  });

  ws.on("close", () => {
    console.log("[certListener] connection closed, reconnecting in 5s...");
    setTimeout(() => startCertListener(onCandidate), 5000);
  });

  ws.on("error", (err) => {
    console.error("[certListener] error:", err.message);
  });

  return ws;
}
