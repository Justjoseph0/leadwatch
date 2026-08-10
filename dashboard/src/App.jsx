import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase.js'
import { ScoreBadge } from './components/ScoreBadge.jsx'
import { StatusModal } from './components/StatusModal.jsx'
import { AlertRulesModal } from './components/AlertRulesModal.jsx'

const PLATFORMS = ['All', 'Shopify', 'WooCommerce', 'WordPress', 'Wix', 'Squarespace', 'Webflow', 'BigCommerce', 'Framer', 'Custom/Unknown']
const STATUSES  = ['All', 'new', 'contacted', 'replied', 'ignored']
const SCORE_OPTIONS = [
  { label: 'Any score', value: null },
  { label: '50+',       value: 50,  color: 'text-yellow-400' },
  { label: '75+',       value: 75,  color: 'text-green-400'  },
  { label: '90+',       value: 90,  color: 'text-green-300'  },
]
const PAGE_SIZE = 50

const STATUS_PILL = {
  new:       'bg-sky-900 text-sky-300',
  contacted: 'bg-violet-900 text-violet-300',
  replied:   'bg-green-900 text-green-300',
  ignored:   'bg-zinc-700 text-zinc-400',
}

function Spinner({ size = 'md' }) {
  const cls = size === 'sm' ? 'w-4 h-4 border-2' : 'w-8 h-8 border-[3px]'
  return (
    <span className={`inline-block ${cls} border-zinc-600 border-t-zinc-300 rounded-full animate-spin`} />
  )
}

function SortHeader({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors"
      onClick={() => onSort(field)}
    >
      {label}
      <span className="ml-1 text-zinc-600">
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  )
}

export default function App() {
  const [leads, setLeads]           = useState([])
  const [total, setTotal]           = useState(null)   // exact count from Supabase
  const [page, setPage]             = useState(0)
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]           = useState(null)
  const [selected, setSelected]     = useState(null)
  const [showAlerts, setShowAlerts] = useState(false)

  // filters
  const [platform, setPlatform]     = useState('All')
  const [status, setStatus]         = useState('All')
  const [hasContact, setHasContact] = useState(false)
  const [minScore, setMinScore]     = useState(null)

  // sort
  const [sortField, setSortField]   = useState('first_seen_at')
  const [sortDir, setSortDir]       = useState('desc')

  // Build query with all server-side constraints applied
  function buildQuery(from, to) {
    let q = supabase
      .from('leads')
      .select('domain,url,title,platform,quality_score,emails,socials,has_contact,status,first_seen_at', { count: 'exact' })
      .order(sortField, { ascending: sortDir === 'asc' })
      .range(from, to)

    if (platform !== 'All') q = q.eq('platform', platform)
    if (status   !== 'All') q = q.eq('status',   status)
    if (hasContact)         q = q.eq('has_contact', true)
    if (minScore !== null)  q = q.gte('quality_score', minScore)

    return q
  }

  // Initial / filter-change fetch — resets list
  const fetchLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPage(0)

    const { data, count, error: err } = await buildQuery(0, PAGE_SIZE - 1)

    setLoading(false)
    if (err) { setError(err.message); return }
    setLeads(data ?? [])
    setTotal(count ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, status, hasContact, minScore, sortField, sortDir])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  // Load-more appends next page
  async function loadMore() {
    const nextPage = page + 1
    const from = nextPage * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    setLoadingMore(true)
    const { data, error: err } = await buildQuery(from, to)
    setLoadingMore(false)

    if (err) { setError(err.message); return }
    setLeads(prev => [...prev, ...(data ?? [])])
    setPage(nextPage)
  }

  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  function handleUpdated(updated) {
    setLeads(prev => prev.map(l => l.domain === updated.domain ? updated : l))
  }

  const shown     = leads.length
  const remaining = total !== null ? total - shown : null

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">LeadWatch</h1>
          <p className="text-zinc-500 text-xs mt-0.5">Real-time leads from certificate transparency</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAlerts(true)}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
          >
            🔔 Alerts
          </button>
          <button
            onClick={fetchLeads}
            disabled={loading}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-zinc-800 flex flex-wrap gap-3 items-center">
        <select
          value={platform}
          onChange={e => setPlatform(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-sm rounded-lg px-3 py-1.5 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        >
          {PLATFORMS.map(p => <option key={p}>{p}</option>)}
        </select>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-sm rounded-lg px-3 py-1.5 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        >
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>

        <select
          value={minScore ?? ''}
          onChange={e => setMinScore(e.target.value === '' ? null : Number(e.target.value))}
          className="bg-zinc-800 border border-zinc-700 text-sm rounded-lg px-3 py-1.5 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        >
          {SCORE_OPTIONS.map(opt => (
            <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-zinc-300">
          <span
            onClick={() => setHasContact(v => !v)}
            className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5
              ${hasContact ? 'bg-sky-600' : 'bg-zinc-700'}`}
          >
            <span className={`w-4 h-4 rounded-full bg-white shadow transition-transform
              ${hasContact ? 'translate-x-4' : 'translate-x-0'}`} />
          </span>
          Has contact
        </label>

        <span className="ml-auto text-zinc-500 text-xs tabular-nums">
          {loading
            ? <Spinner size="sm" />
            : total !== null
              ? `${shown} / ${total.toLocaleString()} leads`
              : `${shown} leads`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Full-page spinner on initial load */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Spinner />
        </div>
      )}

      {/* Table */}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 border-b border-zinc-800 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Domain</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Platform</th>
                <SortHeader label="Score"   field="quality_score" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Contact" field="has_contact"   sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">First seen</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Title</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {leads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-zinc-600">
                    No leads match the current filters.
                  </td>
                </tr>
              )}
              {leads.map(lead => (
                <tr
                  key={lead.domain}
                  onClick={() => setSelected(lead)}
                  className="hover:bg-zinc-800/50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-sky-400 whitespace-nowrap">
                    <a
                      href={lead.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {lead.domain}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-300 whitespace-nowrap">{lead.platform}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <ScoreBadge score={lead.quality_score} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {lead.has_contact ? (
                      <span title={lead.emails?.join(', ')}>✉</span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_PILL[lead.status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap text-xs tabular-nums">
                    {new Date(lead.first_seen_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-400 max-w-xs truncate">{lead.title}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Load more */}
          {remaining !== null && remaining > 0 && (
            <div className="flex justify-center py-6">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 px-5 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore
                  ? <><Spinner size="sm" /> Loading…</>
                  : `Load ${Math.min(remaining, PAGE_SIZE)} more  (${remaining.toLocaleString()} remaining)`}
              </button>
            </div>
          )}

          {remaining === 0 && leads.length > 0 && (
            <p className="text-center text-zinc-700 text-xs py-4">All {total?.toLocaleString()} leads loaded</p>
          )}
        </div>
      )}

      {/* Status modal */}
      {selected && (
        <StatusModal
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      )}

      {/* Alert rules modal */}
      {showAlerts && (
        <AlertRulesModal onClose={() => setShowAlerts(false)} />
      )}
    </div>
  )
}
