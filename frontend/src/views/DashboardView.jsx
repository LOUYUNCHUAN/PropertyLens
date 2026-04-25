import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { api } from '../api/client.js'
import MarketHeatMap from '../components/MarketHeatMap.jsx'
import ShortlistQuickGlance from '../components/ShortlistQuickGlance.jsx'
import RecentTransactionsFeed from '../components/RecentTransactionsFeed.jsx'

const toTitle = (str) =>
  str
    .split(' ')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')

const getTier = (price) => {
  if (price >= 750000) return { dot: '#ef4444' }
  if (price >= 550000) return { dot: '#f59e0b' }
  if (price >= 430000) return { dot: '#22c55e' }
  return { dot: '#3b82f6' }
}

function StatCard({ label, value, sub, loading }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        borderRadius: 12,
        padding: 14,
        border: '1px solid var(--border)'
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 6
        }}
      >
        {label}
      </div>
      {loading ? (
        <div
          style={{
            height: 22,
            background: 'var(--muted)',
            borderRadius: 6,
            marginBottom: 4
          }}
        />
      ) : (
        <div
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 18,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--foreground)',
            lineHeight: 1.2,
            marginBottom: 4,
            overflowWrap: 'anywhere'
          }}
        >
          {value ?? '—'}
        </div>
      )}
      {sub ? (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</div>
      ) : null}
    </div>
  )
}

function BannerBtn({ label, primary, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: primary
          ? hovered
            ? 'oklch(0.58 0.15 145 / 0.2)'
            : 'var(--card)'
          : hovered
          ? 'var(--muted)'
          : 'var(--card)',
        color: primary ? 'var(--primary)' : 'var(--foreground)',
        border: primary
          ? '1.5px solid var(--primary)'
          : '1px solid var(--border)',
        borderRadius: 10,
        padding: '11px 22px',
        fontWeight: 600,
        fontSize: 14,
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
        boxShadow: primary
          ? hovered
            ? '0 0 0 3px rgba(34, 197, 94, 0.15)'
            : 'none'
          : 'none',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </button>
  )
}

function TownRow({ t, i }) {
  const [hovered, setHovered] = useState(false)
  const tier = getTier(t.price_current)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 10px',
        borderRadius: '8px',
        marginBottom: '2px',
        background: hovered
          ? 'oklch(0.58 0.15 145 / 0.12)'
          : i % 2 === 0
          ? 'var(--muted)'
          : 'transparent',
        transition: 'background 0.14s',
        cursor: 'default'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--muted-foreground)',
            width: '18px',
            textAlign: 'right',
            fontWeight: 600
          }}
        >
          {i + 1}
        </span>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: tier.dot,
            flexShrink: 0
          }}
        />
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--foreground)'
          }}
        >
          {toTitle(t.town)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--foreground)'
          }}
        >
          S${(t.price_current / 1000).toFixed(0)}k
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            minWidth: '44px',
            textAlign: 'right',
            color: (t.yoy_pct ?? 0) >= 0 ? '#16a34a' : '#dc2626'
          }}
        >
          {(t.yoy_pct ?? 0) >= 0 ? '+' : ''}
          {t.yoy_pct ?? '—'}%
        </span>
      </div>
    </div>
  )
}

function MoverCard({ t, hot }) {
  const magnitude = Math.min(Math.abs(t.yoy_pct ?? 0) / 11, 1) * 100
  const accent = hot ? 'oklch(0.65 0.2 25)' : 'oklch(0.65 0.14 250)'
  const bgBar = hot ? 'oklch(0.65 0.2 25 / 0.2)' : 'oklch(0.65 0.14 250 / 0.2)'
  const pillBg = hot ? 'var(--red-100)' : 'var(--blue-100)'
  const pillColor = hot ? 'oklch(0.72 0.18 25)' : 'oklch(0.75 0.12 250)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)'
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '3px 8px',
              borderRadius: 999,
              background: pillBg,
              color: pillColor
            }}
          >
            {hot ? 'Heating' : 'Cooling'}
          </span>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              minWidth: 0,
              overflowWrap: 'anywhere',
              wordBreak: 'break-word'
            }}
          >
            {toTitle(t.town)}
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 6
          }}
        >
          S${(t.price_current / 1000).toFixed(0)}k ·{' '}
          {(t.txn_current || 0).toLocaleString()} txn
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div
          style={{
            width: 56,
            height: 5,
            background: bgBar,
            borderRadius: 999
          }}
        >
          <div
            style={{
              width: `${magnitude}%`,
              height: '100%',
              background: accent,
              borderRadius: 999
            }}
          />
        </div>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: accent,
            minWidth: 46,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {(t.yoy_pct ?? 0) >= 0 ? '+' : ''}
          {t.yoy_pct ?? '—'}%
        </span>
      </div>
    </div>
  )
}

function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--popover)',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 32px oklch(0 0 0 / 0.45)',
        border: '1px solid var(--border)',
        fontSize: '12px',
        color: 'var(--foreground)'
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: 'var(--foreground)',
          marginBottom: '4px'
        }}
      >
        {label}
      </div>
      <div style={{ color: 'var(--primary)', fontWeight: 600 }}>
        Median: S${Number(payload[0].value).toLocaleString()}
      </div>
    </div>
  )
}

function greetingName(displayName, username) {
  const d = (displayName || '').trim()
  if (d) return d
  const u = (username || '').trim()
  if (u) return u.charAt(0).toUpperCase() + u.slice(1)
  return 'there'
}

export default function DashboardView() {
  const navigate = useNavigate()
  const { displayName, username } = useAuth()

  const [trendData, setTrendData] = useState([])
  const [townStats, setTownStats] = useState([])
  const [summaryYear, setSummaryYear] = useState(null)
  const [totalTxns, setTotalTxns] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    ;(async () => {
      try {
        const [trendsRes, townsRes] = await Promise.all([
          api.get('/api/analytics/trends'),
          api.get('/api/analytics/town-summary')
        ])
        const raw = trendsRes.data?.trends || []
        const latestYearInTrends = raw.length
          ? Math.max(...raw.map((d) => Number(d.year)).filter((y) => Number.isFinite(y)))
          : null
        const yr = townsRes.data?.year ?? latestYearInTrends
        if (yr == null) {
          throw new Error('Backend returned no year data — check /api/analytics/town-summary')
        }
        setSummaryYear(yr)
        setTotalTxns(townsRes.data?.total_transactions || 0)
        setTrendData(
          raw.filter((d) => d.year >= yr - 4 && d.year <= yr + 1)
        )
        setTownStats(townsRes.data?.towns || [])
      } catch (err) {
        setError(
          'Could not load market data. Is the backend running on port 8000?'
        )
        // eslint-disable-next-line no-console
        console.error(err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Treat a year as partial/YTD when its transaction count is < 60% of the
  // prior year — comparing a YTD median against a full year is misleading, so
  // the headline KPI + YoY are computed off the last complete year.
  const partialYears = new Set()
  for (let i = 1; i < trendData.length; i++) {
    const cur = trendData[i]
    const prev = trendData[i - 1]
    if (
      cur?.transaction_count != null &&
      prev?.transaction_count > 0 &&
      cur.transaction_count < prev.transaction_count * 0.6
    ) {
      partialYears.add(cur.year)
    }
  }
  const latestCompleteYear = [...trendData]
    .map((d) => d.year)
    .filter((y) => !partialYears.has(y))
    .sort((a, b) => b - a)[0]
  const nationalCur = trendData.find((d) => d.year === latestCompleteYear)
  const nationalPrev = trendData.find((d) => d.year === latestCompleteYear - 1)
  const nationalMedian = nationalCur?.median_price
  const yoyGrowth =
    nationalCur && nationalPrev
      ? (
          ((nationalCur.median_price - nationalPrev.median_price) /
            nationalPrev.median_price) *
          100
        ).toFixed(1)
      : null
  const hottestTown = townStats.length
    ? townStats.reduce((a, b) => ((a.txn_current || 0) > (b.txn_current || 0) ? a : b))
    : null
  const bestValueTown = townStats.length
    ? townStats.reduce((a, b) => ((a.price_current || Infinity) < (b.price_current || Infinity) ? a : b))
    : null
  const risingTowns = [...townStats]
    .sort((a, b) => (b.yoy_pct ?? 0) - (a.yoy_pct ?? 0))
    .slice(0, 4)
  const coolingTowns = townStats
    .filter((t) => (t.yoy_pct ?? 0) < 0)
    .sort((a, b) => (a.yoy_pct ?? 0) - (b.yoy_pct ?? 0))
  const slowestTowns = [...townStats]
    .sort((a, b) => (a.yoy_pct ?? 0) - (b.yoy_pct ?? 0))
    .slice(0, 3)
  const coolingDisplay =
    coolingTowns.length > 0 ? coolingTowns : slowestTowns
  const coolingLabel =
    coolingTowns.length > 0 ? '❄️ Cooling Down' : '🐢 Slowest Growth'

  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const userLabel = greetingName(displayName, username)
  const dateStr = new Date().toLocaleDateString('en-SG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const cardShell = {
    background: 'var(--bg-card)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    boxShadow: '0 1px 0 oklch(1 0 0 / 0.06) inset, 0 4px 24px oklch(0 0 0 / 0.2)',
    overflow: 'hidden'
  }
  const cardHead = {
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)'
  }
  const cardBody = { padding: '20px' }

  if (error) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '80px 40px',
          color: 'var(--muted-foreground)'
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
        <div
          style={{
            fontSize: '16px',
            fontWeight: 600,
            marginBottom: '8px'
          }}
        >
          Data Unavailable
        </div>
        <div style={{ fontSize: '13px' }}>{error}</div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', padding: '0 4px' }}>
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          borderLeft: '4px solid var(--green-500)',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
          padding: '28px 32px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap'
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 10
            }}
          >
            {dateStr}
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              margin: '0 0 10px',
              lineHeight: 1.2,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}
          >
            {greeting}, {userLabel}
          </h1>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexShrink: 0
          }}
        >
          <BannerBtn
            label="I'm Buying"
            primary
            onClick={() => navigate('/buyer')}
          />
          <BannerBtn
            label="I'm Selling"
            onClick={() => navigate('/seller')}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '20px'
        }}
      >
        <StatCard
          loading={loading}
          label={`Median resale price · ${latestCompleteYear ?? summaryYear}`}
          value={
            nationalMedian ? `S$${(nationalMedian / 1000).toFixed(0)}k` : '—'
          }
          sub={
            yoyGrowth != null && latestCompleteYear
              ? `${Number(yoyGrowth) >= 0 ? '+' : ''}${yoyGrowth}% vs ${latestCompleteYear - 1}`
              : 'National median'
          }
        />
        <StatCard
          loading={loading}
          label={`Flats resold · ${summaryYear}${partialYears.has(summaryYear) ? ' (YTD)' : ''}`}
          value={totalTxns ? totalTxns.toLocaleString() : '—'}
          sub={
            partialYears.has(summaryYear)
              ? 'Year-to-date resale transactions'
              : 'Total resale transactions nationwide'
          }
        />
        <StatCard
          loading={loading}
          label="Busiest town"
          value={hottestTown ? toTitle(hottestTown.town) : '—'}
          sub={
            hottestTown
              ? `${(hottestTown.txn_current || 0).toLocaleString()} flats sold in ${summaryYear}`
              : '—'
          }
        />
        <StatCard
          loading={loading}
          label="Most affordable town"
          value={bestValueTown ? toTitle(bestValueTown.town) : '—'}
          sub={
            bestValueTown
              ? `S$${(bestValueTown.price_current / 1000).toFixed(0)}k median`
              : '—'
          }
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3fr 2fr',
          gap: '16px',
          marginBottom: '20px'
        }}
      >
        <div style={cardShell}>
          <div
            style={{
              ...cardHead,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12
            }}
          >
            <div>
              <h3
                style={{
                  margin: '0 0 4px',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em'
                }}
              >
                Price trend {summaryYear - 4} – {summaryYear + 1}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: 'var(--text-secondary)'
                }}
              >
                National median resale price · Yearly
                {partialYears.size > 0
                  ? ' · dashed marker = year-to-date (partial)'
                  : ''}
              </p>
            </div>
          </div>
          {loading ? (
            <div
              style={{
                ...cardBody,
                height: 230,
                background: 'var(--muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                boxSizing: 'border-box'
              }}
            >
              Loading market data...
            </div>
          ) : (
            <div style={{ padding: '12px 12px 20px' }}>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart
                data={trendData}
                margin={{ top: 5, right: 8, bottom: 0, left: 8 }}
              >
                <defs>
                  <linearGradient
                    id="priceGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="#22c55e"
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="95%"
                      stopColor="#22c55e"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 12, fill: 'oklch(0.55 0.02 260)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(y) =>
                    partialYears.has(y) ? `${y} YTD` : String(y)
                  }
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: 'oklch(0.55 0.02 260)' }}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                  width={52}
                />
                <Tooltip content={<PriceTooltip />} />
                <Area
                  type="monotone"
                  dataKey="median_price"
                  stroke="#16a34a"
                  strokeWidth={2.5}
                  fill="url(#priceGrad)"
                  dot={(props) => {
                    const { cx, cy, payload, key } = props
                    const ytd = partialYears.has(payload?.year)
                    return (
                      <circle
                        key={key}
                        cx={cx}
                        cy={cy}
                        r={4}
                        fill={ytd ? '#ffffff' : '#22c55e'}
                        stroke={ytd ? '#9ca3af' : '#16a34a'}
                        strokeWidth={2}
                        strokeDasharray={ytd ? '2 2' : undefined}
                      />
                    )
                  }}
                  activeDot={{
                    r: 6,
                    fill: 'oklch(0.75 0.16 145)',
                    stroke: 'var(--card)',
                    strokeWidth: 2
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={cardShell}>
          <div style={cardHead}>
            <h3
              style={{
                margin: '0 0 4px',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em'
              }}
            >
              All towns by price
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--text-secondary)'
              }}
            >
              {summaryYear} median · sorted highest first
            </p>
          </div>
          {loading ? (
            <div
              style={{
                ...cardBody,
                color: 'var(--text-muted)',
                fontSize: 13
              }}
            >
              Loading town data...
            </div>
          ) : (
            <div style={cardBody}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 10px 8px',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: 4
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase'
                  }}
                >
                  Town
                </span>
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center'
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase'
                    }}
                  >
                    Median Price
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      minWidth: 44,
                      textAlign: 'right'
                    }}
                  >
                    1yr Change
                  </span>
                </div>
              </div>

              <div
                style={{
                  maxHeight: '268px',
                  overflowY: 'auto',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'var(--border) transparent'
                }}
              >
                {townStats.map((t, i) => (
                  <TownRow key={t.town} t={t} i={i} />
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  flexWrap: 'wrap'
                }}
              >
                {[
                  { dot: '#ef4444', label: '≥ $750k' },
                  { dot: '#f59e0b', label: '$550–750k' },
                  { dot: '#22c55e', label: '$430–550k' },
                  { dot: '#3b82f6', label: '< $430k' }
                ].map((l) => (
                  <div
                    key={l.label}
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: l.dot
                      }}
                    />
                    <span
                      style={{ fontSize: 10, color: 'var(--text-muted)' }}
                    >
                      {l.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...cardShell, marginBottom: 20 }}>
        <div style={cardHead}>
          <h3
            style={{
              margin: '0 0 4px',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em'
            }}
          >
            Market movers — {summaryYear} YoY price change
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.45
            }}
          >
            Year-on-year price change per town — comparing {summaryYear} vs{' '}
            {summaryYear - 1} median resale prices
          </p>
        </div>
        <div style={cardBody}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Loading...
          </div>
        ) : (
          <>
            <div
              style={{
                maxHeight: 'min(520px, 58vh)',
                overflow: 'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--border) transparent',
                marginBottom: 16,
                paddingRight: 4
              }}
            >
              <div style={{ marginBottom: '20px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#dc2626',
                    letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '6px',
                    rowGap: '4px'
                  }}
                >
                  Heating up
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 400,
                      color: 'var(--muted-foreground)',
                      textTransform: 'none',
                      letterSpacing: 0
                    }}
                  >
                    — towns where prices rose the most vs last year
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: '10px'
                  }}
                >
                  {risingTowns.map((t) => (
                    <MoverCard key={t.town} t={t} hot />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 0 }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#2563eb',
                    letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '6px',
                    rowGap: '4px'
                  }}
                >
                  {coolingLabel}
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 400,
                      color: 'var(--muted-foreground)',
                      textTransform: 'none',
                      letterSpacing: 0
                    }}
                  >
                    — towns where prices fell or grew slowest
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: '10px'
                  }}
                >
                  {coolingDisplay.map((t) => (
                    <MoverCard key={t.town} t={t} hot={false} />
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 16,
                marginTop: 8
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
                Price map — bubble size = transaction volume · colour = price tier
              </div>
              <div
                style={{
                  width: '100%',
                  height: '460px',
                  borderRadius: '12px',
                  overflow: 'hidden'
                }}
              >
                <MarketHeatMap townStats={townStats} />
              </div>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 16,
                marginTop: 8,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 16
              }}
            >
              <ShortlistQuickGlance />
              <RecentTransactionsFeed />
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
