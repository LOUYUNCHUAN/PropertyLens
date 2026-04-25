import { useEffect, useMemo, useState } from 'react'
import { getRecentTransactions } from '../api/client.js'

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

const money = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `S$${(n / 1_000_000).toFixed(2)}m`
  return `S$${Math.round(n / 1000)}k`
}

function fmtDate(row) {
  if (row.year == null) return '—'
  if (row.month != null) return `${MONTH_NAMES[(row.month - 1) % 12]} ${row.year}`
  return String(row.year)
}

function fmtAddress(row) {
  const bits = []
  if (row.block) bits.push(`Blk ${row.block}`)
  if (row.street_name) bits.push(row.street_name)
  if (!bits.length && row.town) bits.push(row.town)
  return bits.join(' ')
}

function fmtDetail(row) {
  const bits = []
  if (row.flat_type) bits.push(String(row.flat_type).toLowerCase().replace('room', '-rm'))
  if (row.floor_area_sqm) bits.push(`${Math.round(row.floor_area_sqm)} sqm`)
  return bits.join(' · ')
}

export default function RecentTransactionsFeed() {
  const [rows, setRows] = useState(null)
  const [townFilter, setTownFilter] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getRecentTransactions({ limit: 15, town: townFilter || undefined })
      .then((data) => {
        if (cancelled) return
        setRows(data?.rows || [])
        setAsOf(data?.as_of_year ?? null)
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load recent transactions')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [townFilter])

  const townOptions = useMemo(() => {
    if (!rows) return []
    return Array.from(new Set(rows.map((r) => r.town).filter(Boolean))).sort()
  }, [rows])

  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 8,
          flexWrap: 'wrap'
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase'
          }}
        >
          Recent transactions {asOf ? `· as of ${asOf}` : ''}
        </div>
        <select
          value={townFilter}
          onChange={(e) => setTownFilter(e.target.value)}
          style={{
            fontSize: 11,
            padding: '3px 6px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--background)',
            color: 'var(--text-primary)'
          }}
        >
          <option value="">All towns</option>
          {townOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>
      )}

      {loading && !rows && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
      )}

      {rows && rows.length === 0 && !error && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          No recent transactions for this filter.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div
          style={{
            maxHeight: 320,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 8
          }}
        >
          {rows.map((row, i) => (
            <div
              key={i}
              style={{
                padding: '8px 10px',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                alignItems: 'center',
                borderBottom:
                  i === rows.length - 1 ? 'none' : '1px solid var(--border)',
                fontSize: 12
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {fmtAddress(row) || '(address unavailable)'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)'
                  }}
                >
                  {[row.town, fmtDetail(row)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {money(row.resale_price)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {fmtDate(row)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
