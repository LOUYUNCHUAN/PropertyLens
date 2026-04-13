import { useState, useEffect } from 'react'
import { getPolicyImpact } from '../api/client.js'

const IMPACT_STYLE = {
  positive: { dot: '🟢', border: '#22c55e', bg: '#f0fdf4' },
  negative: { dot: '🔴', border: '#ef4444', bg: '#fef2f2' },
  mixed:    { dot: '🟡', border: '#f59e0b', bg: '#fffbeb' },
}

const SENTIMENT_STYLE = {
  'cautiously positive':      { icon: '✅', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  'policy headwinds present': { icon: '⚠️', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  'mixed policy environment': { icon: '🔄', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

function SkeletonBar({ width = '100%' }) {
  return (
    <div style={{
      height: '14px', borderRadius: '6px',
      background: 'linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      width,
      marginBottom: '10px',
    }} />
  )
}

export default function PolicyKBCard({ town }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!town) return
    setLoading(true)
    setError(null)
    setData(null)
    setExpanded(false)
    getPolicyImpact(town)
      .then((res) => setData(res))
      .catch(() => setError('No policy history available for this town.'))
      .finally(() => setLoading(false))
  }, [town])

  const cardStyle = {
    background: 'white',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    marginTop: '16px',
  }

  // Skeleton state
  if (loading) {
    return (
      <div style={cardStyle}>
        <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <SkeletonBar width="40%" />
          <SkeletonBar width="80px" />
        </div>
        <SkeletonBar width="60%" />
        <SkeletonBar width="90%" />
        <SkeletonBar width="75%" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>
          {error || 'No policy history available for this town.'}
        </div>
      </div>
    )
  }

  const { policies, net_sentiment, kb_source } = data
  const sentStyle = SENTIMENT_STYLE[net_sentiment] || SENTIMENT_STYLE['mixed policy environment']

  // Show 4 most recent by default, rest behind "Show older"
  const recent = policies.slice(0, 4)
  const older  = policies.slice(4)

  return (
    <div style={cardStyle}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>
            📜 Policy History — {town.charAt(0) + town.slice(1).toLowerCase()}
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
            How government policies have shaped prices in this town
          </div>
        </div>
        <span style={{
          background: '#1a2e2a', color: '#e2ede9',
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.8px',
          padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap',
        }}>
          KB-BASED
        </span>
      </div>

      {/* Net sentiment bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: sentStyle.bg, border: `1px solid ${sentStyle.border}`,
        borderRadius: '10px', padding: '10px 14px', margin: '14px 0',
      }}>
        <span style={{ fontSize: '16px' }}>{sentStyle.icon}</span>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: sentStyle.color, textTransform: 'capitalize' }}>
            {net_sentiment}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>
            Based on {policies.length} policies tracked in the knowledge base
            {kb_source === 'neo4j' && <span style={{ marginLeft: '6px', opacity: 0.7 }}>· Neo4j</span>}
          </div>
        </div>
      </div>

      {/* Policy rows — recent */}
      {recent.map((p) => {
        const s = IMPACT_STYLE[p.impact] || IMPACT_STYLE.mixed
        return (
          <div key={p.name} style={{
            borderLeft: `3px solid ${s.border}`,
            padding: '12px 16px',
            margin: '8px 0',
            background: '#fafafa',
            borderRadius: '0 8px 8px 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#888' }}>{p.year}</span>
              <span style={{ fontSize: '13px' }}>{s.dot}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{p.name}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>
              {p.explanation}
            </div>
          </div>
        )
      })}

      {/* Older policies (collapsed) */}
      {older.length > 0 && (
        <>
          {expanded && older.map((p) => {
            const s = IMPACT_STYLE[p.impact] || IMPACT_STYLE.mixed
            return (
              <div key={p.name} style={{
                borderLeft: `3px solid ${s.border}`,
                padding: '12px 16px',
                margin: '8px 0',
                background: '#fafafa',
                borderRadius: '0 8px 8px 0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#888' }}>{p.year}</span>
                  <span style={{ fontSize: '13px' }}>{s.dot}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{p.name}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>
                  {p.explanation}
                </div>
              </div>
            )
          })}
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '12px', color: '#6b7280', fontWeight: 600,
              padding: '6px 0', marginTop: '4px',
            }}
          >
            {expanded ? 'Hide older policies ▲' : `Show older policies (${older.length}) ▼`}
          </button>
        </>
      )}
    </div>
  )
}
