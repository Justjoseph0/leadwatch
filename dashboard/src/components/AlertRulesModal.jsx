import { useState, useEffect } from 'react'
import { supabase } from '../supabase.js'

const PLATFORMS = ['Shopify', 'WooCommerce', 'WordPress', 'Wix', 'Squarespace', 'Webflow', 'BigCommerce', 'Framer', 'Custom/Unknown']

export function AlertRulesModal({ onClose }) {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // New rule form
  const [platform, setPlatform] = useState('')
  const [minScore, setMinScore] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [hasContact, setHasContact] = useState(false)
  const [emailTo, setEmailTo] = useState('')

  useEffect(() => {
    fetchRules()
  }, [])

  async function fetchRules() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('alert_rules')
      .select('*')
      .order('created_at', { ascending: false })
    setLoading(false)
    if (err) { setError(err.message); return }
    setRules(data ?? [])
  }

  async function handleCreate() {
    if (!emailTo.trim()) {
      setError('Email address is required')
      return
    }

    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('alert_rules').insert({
      platform: platform || null,
      min_score: minScore ? Number(minScore) : null,
      max_score: maxScore ? Number(maxScore) : null,
      has_contact: hasContact || null,
      email_to: emailTo.trim(),
    })
    setSaving(false)

    if (err) { setError(err.message); return }

    // Reset form
    setPlatform('')
    setMinScore('')
    setMaxScore('')
    setHasContact(false)
    setEmailTo('')
    fetchRules()
  }

  async function handleDelete(id) {
    const { error: err } = await supabase.from('alert_rules').delete().eq('id', id)
    if (err) { setError(err.message); return }
    fetchRules()
  }

  function formatRule(rule) {
    const parts = []
    if (rule.platform) parts.push(`platform = ${rule.platform}`)
    if (rule.min_score !== null) parts.push(`score ≥ ${rule.min_score}`)
    if (rule.max_score !== null) parts.push(`score ≤ ${rule.max_score}`)
    if (rule.has_contact) parts.push(`has contact`)
    return parts.length > 0 ? parts.join(' AND ') : 'All leads'
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white font-semibold text-lg mb-1">Alert Rules</h2>
        <p className="text-zinc-400 text-sm mb-5">Get notified when new leads match your criteria</p>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Create new rule */}
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 mb-6">
          <p className="text-zinc-300 text-sm font-medium mb-3">Create new alert</p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1">Platform (optional)</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-600 text-sm rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              >
                <option value="">Any</option>
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">Min score (optional)</label>
              <input
                type="number"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                placeholder="e.g. 50"
                className="w-full bg-zinc-900 border border-zinc-600 text-sm rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">Max score (optional)</label>
              <input
                type="number"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                placeholder="e.g. 100"
                className="w-full bg-zinc-900 border border-zinc-600 text-sm rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">Email address</label>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-zinc-900 border border-zinc-600 text-sm rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-zinc-300 mb-3">
            <input
              type="checkbox"
              checked={hasContact}
              onChange={(e) => setHasContact(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-sky-600 focus:ring-1 focus:ring-zinc-500"
            />
            Only leads with contact info
          </label>

          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full py-2 bg-sky-700 hover:bg-sky-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating…' : 'Create alert'}
          </button>
        </div>

        {/* Existing rules */}
        <div>
          <p className="text-zinc-400 text-xs uppercase tracking-widest mb-3">Active alerts</p>
          {loading ? (
            <p className="text-zinc-500 text-sm text-center py-4">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-4">No alert rules yet</p>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <div
                  key={rule.id}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex items-start justify-between"
                >
                  <div className="flex-1">
                    <p className="text-zinc-200 text-sm font-mono">{formatRule(rule)}</p>
                    <p className="text-zinc-500 text-xs mt-1">→ {rule.email_to}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="text-zinc-500 hover:text-red-400 text-xs ml-3 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
