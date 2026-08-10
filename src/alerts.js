import { Resend } from 'resend';
import { supabase } from './supabase.js';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * Check if a lead matches an alert rule's criteria
 */
function matchesRule(lead, rule) {
  if (rule.platform && lead.platform !== rule.platform) return false;
  if (rule.min_score !== null && lead.qualityScore < rule.min_score) return false;
  if (rule.max_score !== null && lead.qualityScore > rule.max_score) return false;
  if (rule.has_contact && !lead.hasContact) return false;
  return true;
}

/**
 * Format lead details for email body
 */
function formatLeadEmail(lead) {
  return `
New lead matching your alert criteria:

Domain: ${lead.domain}
URL: ${lead.url}
Title: ${lead.title || 'N/A'}
Platform: ${lead.platform}
Quality Score: ${lead.qualityScore}
Contact Info: ${lead.hasContact ? 'Yes' : 'No'}
${lead.emails?.length > 0 ? `Emails: ${lead.emails.join(', ')}` : ''}
${lead.socials && Object.keys(lead.socials).length > 0 ? `Socials: ${JSON.stringify(lead.socials, null, 2)}` : ''}
First Seen: ${new Date(lead.firstSeenAt).toLocaleString()}

---
View in dashboard: [Your dashboard URL here]
`.trim();
}

/**
 * Check a newly upserted lead against all active alert rules and send notifications
 */
export async function checkAlerts(lead) {
  if (!resend) {
    console.warn('[alerts] Resend API key not configured — skipping alert check');
    return;
  }

  // Fetch all active alert rules
  const { data: rules, error } = await supabase
    .from('alert_rules')
    .select('*');

  if (error) {
    console.error('[alerts] Failed to fetch alert rules:', error.message);
    return;
  }

  if (!rules || rules.length === 0) return;

  // Check each rule
  for (const rule of rules) {
    if (!matchesRule(lead, rule)) continue;

    // Send email notification
    console.log(`[alerts] Sending notification to ${rule.email_to} for ${lead.domain}...`);
    try {
      // Resend resolves (does not throw) on API errors — the failure is carried
      // in the response's `error` field, so check it before claiming success.
      const { data, error: sendError } = await resend.emails.send({
        from: 'LeadWatch <onboarding@resend.dev>',  // You'll replace this with your verified domain
        to: rule.email_to,
        subject: `New Lead Alert: ${lead.domain}`,
        text: formatLeadEmail(lead),
      });

      if (sendError) {
        console.error(`[alerts] Failed to send email to ${rule.email_to}:`, sendError.message || sendError);
      } else {
        console.log(`[alerts] Sent notification to ${rule.email_to} for ${lead.domain} (id: ${data?.id})`);
      }
    } catch (err) {
      console.error(`[alerts] Failed to send email to ${rule.email_to}:`, err.message);
    }
  }
}
