import { useState } from 'react'
import { supabase } from '../supabase.js'

const STATUSES = ['new', 'contacted', 'replied', 'ignored']

const STATUS_COLORS = {
  new:       'bg-sky-700 text-sky-100',
  contacted: 'bg-violet-700 text-violet-100',
  replied:   'bg-green-700 text-green-100',
  ignored:   'bg-zinc-600 text-zinc-300',
}

function generatePitch(lead) {
  const { domain, title, platform, quality_score } = lead
  const siteName = title || domain

  if (quality_score < 50) {
    return `Hi,

I noticed ${siteName} recently launched on ${platform}. Congrats on getting live!

I took a quick look and saw a few areas where the site could really shine with some polish — things like mobile optimization, load speed, and moving beyond a generic template feel. These tweaks can make a big difference for conversions and first impressions.

Would you be open to a quick chat about how I could help level up the site?

Best,
[Your Name]`
  } else {
    return `Hi,

I saw ${siteName} just went live on ${platform} — looks sharp!

I work with growing brands on web development, design refreshes, and performance optimization. If you're ever looking to add features, scale up, or just want a fresh set of eyes on the site, I'd love to chat.

Let me know if that'd be helpful.

Best,
[Your Name]`
  }
}

export function StatusModal({ lead, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [pitch, setPitch]   = useState(null)
  const [copied, setCopied] = useState(false)

  async function handleSelect(status) {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('leads')
      .update({ status, contacted_at: status === 'contacted' ? new Date().toISOString() : undefined })
      .eq('domain', lead.domain)
    setSaving(false)
    if (err) { setError(err.message); return }
    onUpdated({ ...lead, status })
    onClose()
  }

  function handleGeneratePitch() {
    setPitch(generatePitch(lead))
    setCopied(false)
  }

  function handleCopy() {
    navigator.clipboard.writeText(pitch)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white font-semibold text-lg mb-1 truncate">{lead.domain}</h2>
        <p className="text-zinc-400 text-sm mb-1 truncate">{lead.title}</p>
        <p className="text-zinc-500 text-xs mb-5">
          {lead.platform} &middot; score {lead.quality_score} &middot; first seen {new Date(lead.first_seen_at).toLocaleDateString()}
        </p>

        {lead.emails?.length > 0 && (
          <p className="text-zinc-300 text-xs mb-2">
            ✉ {lead.emails.join(', ')}
          </p>
        )}

        <p className="text-zinc-400 text-xs uppercase tracking-widest mb-3">Update status</p>
        <div className="grid grid-cols-2 gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              disabled={saving}
              onClick={() => handleSelect(s)}
              className={`rounded-lg py-2 text-sm font-medium transition-opacity
                ${STATUS_COLORS[s]}
                ${lead.status === s ? 'ring-2 ring-white/50' : 'opacity-80 hover:opacity-100'}
                disabled:cursor-not-allowed`}
            >
              {s}
            </button>
          ))}
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        {/* Pitch generation */}
        <div className="mt-6 pt-6 border-t border-zinc-700">
          {!pitch ? (
            <button
              onClick={handleGeneratePitch}
              className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-zinc-200 transition-colors"
            >
              Generate pitch
            </button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-zinc-400 text-xs uppercase tracking-widest">Outreach draft</p>
                <button
                  onClick={handleCopy}
                  className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 font-mono leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-zinc-500"
                rows={12}
              />
              {lead.emails?.length > 0 && (
                <a
                  href={`mailto:${lead.emails[0]}?subject=Quick question about ${lead.domain}&body=${encodeURIComponent(pitch)}`}
                  className="mt-2 inline-block text-xs text-sky-400 hover:text-sky-300 hover:underline"
                >
                  → Open in email client ({lead.emails[0]})
                </a>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
