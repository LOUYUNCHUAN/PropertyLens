import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { listWishlistItems } from '../api/client.js'
import { priceVsModelScore } from '../lib/smartScore.js'

const money = (v) =>
  v == null || Number.isNaN(Number(v))
    ? '—'
    : `S$${Math.round(Number(v)).toLocaleString()}`

function summaryToSnap(s) {
  return {
    listing_price: s.listing_price,
    model_estimate: s.predicted_price,
    confidence_low: s.confidence_low,
    confidence_high: s.confidence_high
  }
}

function DealBadge({ score }) {
  const band =
    score >= 48
      ? { bg: '#dcfce7', fg: '#166534', label: 'Strong' }
      : score >= 30
        ? { bg: '#fef3c7', fg: '#92400e', label: 'Fair' }
        : { bg: '#fee2e2', fg: '#991b1b', label: 'Overpriced' }
  return (
    <span
      style={{
        background: band.bg,
        color: band.fg,
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 6,
        letterSpacing: '0.02em'
      }}
    >
      {band.label}
    </span>
  )
}

export default function ShortlistQuickGlance() {
  const { isLoggedIn, username } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isLoggedIn || !username) {
      setRows(null)
      return
    }
    let cancelled = false
    listWishlistItems(username, 40)
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : [])
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load shortlist')
      })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn, username])

  const top = useMemo(() => {
    if (!rows) return []
    const scored = rows
      .map((r) => {
        const { score, present, gap } = priceVsModelScore(summaryToSnap(r))
        return { row: r, score: present ? score : -1, gap }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    return scored
  }, [rows])

  if (!isLoggedIn) return null

  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--card)'
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-secondary)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 10
        }}
      >
        Your shortlist · top 3 by deal score
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>
      )}

      {!error && rows && rows.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          No saved listings yet.{' '}
          <Link to="/buyer" style={{ color: '#2563eb', fontWeight: 600 }}>
            Save from Buyer view →
          </Link>
        </div>
      )}

      {!error && rows && rows.length > 0 && top.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Saved listings need a listing price and estimate to score.{' '}
          <Link to="/shortlist" style={{ color: '#2563eb', fontWeight: 600 }}>
            Open shortlist →
          </Link>
        </div>
      )}

      {!error && top.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10
          }}
        >
          {top.map(({ row, score, gap }) => {
            const gapPct = gap == null ? null : (gap * 100).toFixed(1)
            const gapColor =
              gap == null ? '#6b7280' : gap < 0 ? '#16a34a' : '#b91c1c'
            return (
              <div
                key={row.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 8
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      minWidth: 0
                    }}
                    title={row.address_short || row.display_label}
                  >
                    {row.address_short || row.display_label || '(no address)'}
                  </div>
                  <DealBadge score={score} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {[row.town, row.payload_json?.flat_type].filter(Boolean).join(' · ') ||
                    '—'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 6
                  }}
                >
                  <span>List {money(row.listing_price)}</span>
                  <span>Model {money(row.predicted_price)}</span>
                </div>
                {gapPct != null && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: gapColor
                    }}
                  >
                    {gap < 0 ? '↓' : '↑'} {Math.abs(gapPct)}% vs model
                  </div>
                )}
                <Link
                  to={`/shortlist?highlight=${row.id}`}
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: '#2563eb',
                    fontWeight: 600,
                    textDecoration: 'none'
                  }}
                >
                  View →
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
