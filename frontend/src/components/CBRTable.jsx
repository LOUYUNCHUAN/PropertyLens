const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

function formatSalePeriod(c) {
  const y = c.year
  if (y == null || y === 0) return '—'
  const m = c.month
  if (m != null && m >= 1 && m <= 12) {
    return `${MONTHS[m - 1]} ${y}`
  }
  return String(y)
}

function matchDisplayPct(c) {
  const v = c.similarity_display_pct ?? c.similarity_pct
  return Number.isFinite(v) ? v : 0
}

export default function CBRTable({ comparables }) {
  if (!comparables?.length) return null

  const fmt = (n) => `$${Math.round(n).toLocaleString()}`

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px'
        }}
      >
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            {[
              'Block',
              'Street',
              'Town',
              'Sold',
              'Type',
              'Area',
              'Storey',
              'Price',
              'Match'
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--ink-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap'
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparables.map((c, i) => {
            const mp = matchDisplayPct(c)
            return (
            <tr
              key={i}
              style={{
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.15s'
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'var(--sage-pale)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'transparent')
              }
            >
              <td
                style={{
                  padding: '10px 12px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px'
                }}
              >
                {c.block}
              </td>
              <td
                style={{
                  padding: '10px 12px',
                  maxWidth: '160px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {c.street_name}
              </td>
              <td style={{ padding: '10px 12px' }}>{c.town}</td>
              <td
                style={{
                  padding: '10px 12px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px',
                  color: 'var(--ink-muted)',
                  whiteSpace: 'nowrap'
                }}
              >
                {formatSalePeriod(c)}
              </td>
              <td style={{ padding: '10px 12px' }}>
                <span
                  style={{
                    background: 'var(--sage-light)',
                    color: 'var(--sage)',
                    padding: '2px 8px',
                    borderRadius: '20px',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  {c.flat_type}
                </span>
              </td>
              <td
                style={{
                  padding: '10px 12px',
                  fontFamily: 'JetBrains Mono, monospace'
                }}
              >
                {c.floor_area_sqm} m²
              </td>
              <td
                style={{
                  padding: '10px 12px',
                  fontFamily: 'JetBrains Mono, monospace'
                }}
              >
                #{c.storey_mid}
              </td>
              <td
                style={{
                  padding: '10px 12px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 600,
                  color: 'var(--ink)'
                }}
              >
                {fmt(c.resale_price)}
              </td>
              <td style={{ padding: '10px 12px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      height: '4px',
                      background: 'var(--border)',
                      borderRadius: '2px'
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, mp)}%`,
                        height: '100%',
                        background: 'var(--sage)',
                        borderRadius: '2px'
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--sage)',
                      fontWeight: 600
                    }}
                  >
                    {Math.round(mp)}%
                  </span>
                </div>
              </td>
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  )
}

