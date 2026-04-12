import { useEffect, useState } from 'react'
import { getTrends, getGlobalSHAP, getRules, getModelMeta } from '../api/client.js'
import IRSTag from '../components/IRSTag.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

function buildModelStats(meta) {
  if (!meta) return []
  return [
    { icon: '🗂️', label: 'Transactions Analysed', value: (meta.total_transactions || 0).toLocaleString(), delta: '1990 – 2026', sub: 'All HDB resale records' },
    { icon: '🎯', label: 'Model Accuracy (R²)',    value: meta.r2?.toFixed(4) ?? '—', delta: `${((meta.r2 || 0) * 100).toFixed(1)}% variance explained`, sub: `${meta.model_name || 'Hybrid'} on test set` },
    { icon: '💰', label: 'Typical Price Error',    value: `~$${(meta.rmse || 0).toLocaleString()}`, delta: 'RMSE on unseen data', sub: `MAPE ${meta.mape_pct ?? '—'}%` },
    { icon: '🔧', label: 'Features Used',          value: String(meta.n_features || 0), delta: 'engineered from raw data', sub: 'Location, time, size, amenities' },
  ]
}

import { TOWNS } from '../constants/towns.js'

const FEATURE_LABELS = {
  year:                                   'Sale Year',
  dist_to_cbd_km:                         'Distance to CBD',
  years_since_2000:                       'Years Since 2000',
  is_mature_estate:                       'Mature Estate',
  lat:                                    'Location (Latitude)',
  lng:                                    'Location (Longitude)',
  lon:                                    'Location (Longitude)',
  age_at_sale:                            'Flat Age at Sale',
  dist_nearest_mrt_km:                    'Distance to MRT',
  'flat_type_3 ROOM':                     '3-Room Flat Type',
  'flat_type_4 ROOM':                     '4-Room Flat Type',
  'flat_type_5 ROOM':                     '5-Room Flat Type',
  'flat_type_2 ROOM':                     '2-Room Flat Type',
  flat_type_EXECUTIVE:                    'Executive Flat Type',
  post_cooling_2022:                      'Post-2022 Cooling Period',
  post_cooling_2018:                      'Post-2018 Cooling Period',
  post_cooling_2013:                      'Post-2013 Cooling Period',
  transaction_count_block_2yr:            'Block Demand (2yr)',
  transaction_count_per_block_last_2yr:   'Block Demand (2yr)',
  floor_area_sqm:                         'Floor Area (sqm)',
  storey_mid:                             'Floor Level',
  remaining_lease_years:                  'Remaining Lease',
  hawker_count_1km:                       'Hawker Centres Nearby',
  dist_nearest_hawker_km:                 'Distance to Hawker',
  dist_nearest_top_school_km:             'Distance to Top School',
  dist_nearest_primary_school_km:         'Distance to Primary School',
  primary_schools_within_1km:             'Primary Schools (1km)',
  primary_schools_within_2km:             'Primary Schools (2km)',
  mrt_count_within_1km:                   'MRT Stations (1km)',
  month_num:                              'Month of Sale',
  quarter:                                'Quarter of Sale',
  interest_rate_proxy:                    'Interest Rate Proxy',
  lease_commence_date:                    'Lease Start Year',
  hawkers_within_500m:                    'Hawkers within 500m',
  top_school_within_1km:                  'Top School within 1km',
  top_school_within_2km:                  'Top School within 2km',
}

const CONDITION_MAP = {
  'mrt=walking(<0.5km)':    '🚇 Walking distance to MRT',
  'mrt=near(0.5-1km)':      '🚇 Near an MRT (0.5–1km)',
  'mrt=far(>1km)':          '🚇 Far from MRT (>1km)',
  'lease=long(>70yr)':      '📅 Long remaining lease (>70 yrs)',
  'lease=medium(50-70yr)':  '📅 Medium lease (50–70 yrs)',
  'lease=short(<50yr)':     '📅 Short lease (<50 yrs)',
  'area=small(<70sqm)':     '📐 Small flat (<70 sqm)',
  'area=medium(70-100sqm)': '📐 Medium flat (70–100 sqm)',
  'area=large(>100sqm)':    '📐 Large flat (>100 sqm)',
  'storey=low(1-5)':        '🏢 Low floor (1–5)',
  'storey=mid(6-12)':       '🏢 Mid floor (6–12)',
  'storey=high(>12)':       '🏢 High floor (>12)',
  'price=budget(<350k)':    '💚 Budget price range (<$350k)',
  'price=mid(350-550k)':    '💛 Mid price range ($350–550k)',
  'price=premium(>550k)':   '🔴 Premium price range (>$550k)',
  'mature_estate=yes':      '🏘️ Mature estate',
  'mature_estate=no':       '🌱 Non-mature estate',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const translateCondition = (cond) => CONDITION_MAP[cond] || cond

const confidenceLabel = (conf) => {
  if (conf >= 0.85) return { label: 'Very reliable', color: '#16a34a' }
  if (conf >= 0.70) return { label: 'Reliable',      color: '#22c55e' }
  if (conf >= 0.55) return { label: 'Moderate',      color: '#f59e0b' }
  return                    { label: 'Indicative',   color: '#9ca3af' }
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, delta, sub }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'white', borderRadius: '16px', padding: '22px 24px',
        borderTop: '3px solid #22c55e',
        boxShadow: hovered
          ? '0 8px 24px rgba(0,0,0,0.10)'
          : '0 1px 3px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'all 0.18s ease', cursor: 'default',
      }}
    >
      <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600,
        letterSpacing: '0.7px', textTransform: 'uppercase', marginBottom: '12px' }}>
        {icon}&nbsp;{label}
      </div>
      <div style={{ fontSize: '26px', fontWeight: 800, color: '#111827',
        lineHeight: 1, marginBottom: '8px' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#16a34a', marginBottom: '4px' }}>
        → {delta}
      </div>
      <div style={{ fontSize: '11px', color: '#b0b7c3' }}>{sub}</div>
    </div>
  )
}

function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '12px 16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: '1px solid #f0f0f0', fontSize: '12px',
    }}>
      <div style={{ fontWeight: 700, color: '#111827', marginBottom: '4px' }}>{label}</div>
      <div style={{ color: '#16a34a', fontWeight: 600 }}>
        Median: S${Number(payload[0].value).toLocaleString()}
      </div>
    </div>
  )
}

function ShapTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '10px 14px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: '1px solid #f0f0f0', fontSize: '12px',
    }}>
      <div style={{ fontWeight: 700, color: '#111827', marginBottom: '3px' }}>
        {payload[0].payload.label}
      </div>
      <div style={{ color: '#16a34a', fontWeight: 600 }}>
        Avg impact: S${Math.round(payload[0].value).toLocaleString()}
      </div>
    </div>
  )
}

function RuleCard({ rule }) {
  const conf = confidenceLabel(rule.confidence)

  // Apriori rule: has if_conditions + then (translateable condition strings)
  if (rule.source === 'apriori') {
    const ifParts   = rule.if_conditions.map(translateCondition)
    const thenParts = rule.then.map(translateCondition)
    return (
      <div style={{
        background: 'white', borderRadius: '14px', padding: '18px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)',
        borderLeft: '3px solid #22c55e', marginBottom: '12px',
      }}>
        <div style={{ marginBottom: '10px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.6px' }}>When a flat has</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {ifParts.map((p, i) => (
              <span key={i} style={{
                background: '#f0fdf4', color: '#166534', fontSize: '12px',
                fontWeight: 500, padding: '3px 10px', borderRadius: '999px',
                border: '1px solid #bbf7d0',
              }}>{p}</span>
            ))}
          </div>
        </div>
        <div style={{ fontSize: '16px', color: '#9ca3af', margin: '8px 0' }}>↓</div>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.6px' }}>It tends to be</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {thenParts.map((p, i) => (
              <span key={i} style={{
                background: '#fefce8', color: '#854d0e', fontSize: '12px',
                fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
                border: '1px solid #fde68a',
              }}>{p}</span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', paddingTop: '10px',
          borderTop: '1px solid #f3f4f6', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Reliability</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: conf.color }}>{conf.label}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Confidence</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#111827' }}>
              {Math.round(rule.confidence * 100)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Lift</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#111827' }}>
              {rule.lift?.toFixed(2)}×
            </div>
          </div>
          {rule.support && (
            <div>
              <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Coverage</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#111827' }}>
                {Math.round(rule.support * 100)}% of data
              </div>
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <span style={{
              fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px',
              background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
            }}>📊 Market Pattern</span>
          </div>
        </div>
      </div>
    )
  }

  // Surrogate rule: has conditions (raw numeric strings) + then_price + samples
  const cleanCond = (c) => c.replace(/_/g, ' ').replace(/\s+/g, ' ')
  return (
    <div style={{
      background: 'white', borderRadius: '14px', padding: '18px 20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)',
      borderLeft: '3px solid #a855f7', marginBottom: '12px',
    }}>
      <div style={{ marginBottom: '10px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
          textTransform: 'uppercase', letterSpacing: '0.6px' }}>When conditions match</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
          {rule.conditions.map((c, i) => (
            <span key={i} style={{
              background: '#fdf4ff', color: '#6b21a8', fontSize: '12px',
              fontWeight: 500, padding: '3px 10px', borderRadius: '999px',
              border: '1px solid #e9d5ff', fontFamily: 'monospace',
            }}>{cleanCond(c)}</span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: '16px', color: '#9ca3af', margin: '8px 0' }}>↓</div>
      <div style={{ marginBottom: '12px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
          textTransform: 'uppercase', letterSpacing: '0.6px' }}>Predicted price</span>
        <div style={{ marginTop: '6px' }}>
          <span style={{
            background: '#fefce8', color: '#854d0e', fontSize: '14px',
            fontWeight: 700, padding: '4px 14px', borderRadius: '999px',
            border: '1px solid #fde68a',
          }}>
            S${Math.round(rule.then_price).toLocaleString()}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px', paddingTop: '10px',
        borderTop: '1px solid #f3f4f6', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Reliability</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: conf.color }}>{conf.label}</div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Fidelity</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#111827' }}>
            {Math.round(rule.confidence * 100)}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>Samples</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#111827' }}>
            {rule.samples?.toLocaleString()}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span style={{
            fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px',
            background: '#fdf4ff', color: '#7e22ce', border: '1px solid #e9d5ff',
          }}>🌳 Decision Rule</span>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function AnalystView() {
  const [trends,     setTrends]     = useState(null)
  const [trendsTown, setTrendsTown] = useState('')
  const [shap,       setShap]       = useState(null)
  const [rules,      setRules]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('all')
  const [modelStats, setModelStats] = useState([])
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [t, s, r, m] = await Promise.all([getTrends(), getGlobalSHAP(), getRules(), getModelMeta()])
        setTrends(t)
        setShap(s)
        setRules(r)
        setModelStats(buildModelStats(m))
      } catch (err) {
        console.error('AnalystView fetch error:', err)
        setFetchError('Failed to load market data. Is the backend running?')
      }
    })()
  }, [])

  const trendData = (trends?.trends ?? []).filter((d) => d.year >= 2010)

  // Build top-12 SHAP bar data
  const shapData = shap
    ? Object.entries(shap.shap_importance)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 12)
        .map(([feature, value]) => ({
          feature,
          label: FEATURE_LABELS[feature] || feature,
          value: Math.round(value),
        }))
        .reverse()          // bottom-to-top so highest is at top of horizontal chart
    : []

  // Merge + tag rules
  const allRules = [
    ...(rules?.apriori   ?? []),
    ...(rules?.surrogate ?? []),
  ]
  const filteredRules =
    activeTab === 'all'
      ? allRules
      : allRules.filter((r) => r.source === activeTab)

  const cardBase = {
    background: 'white', borderRadius: '16px', padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)',
  }

  if (fetchError) {
    return (
      <div style={{ maxWidth: '1140px', margin: '40px auto', padding: '24px', textAlign: 'center' }}>
        <p style={{ color: '#ef4444', fontSize: '16px' }}>{fetchError}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: '12px', padding: '8px 20px', borderRadius: '8px', border: '1px solid #e5e7eb', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '0 4px' }}>

      {/* ══ SECTION 1 — STAT CARDS ══════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px', marginBottom: '20px' }}>
        {modelStats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* ══ SECTION 2 — TREND CHART ═════════════════════════════════════ */}
      <div style={{ ...cardBase, marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
              📊 Price Trend 2010 – 2025
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              National median resale price · Yearly · Filter by town below
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: '#fef3c7', color: '#92400e', fontSize: '11px',
              fontWeight: 600, padding: '5px 11px', borderRadius: '999px',
              border: '1px solid #fde68a', whiteSpace: 'nowrap',
            }}>⚡ 2022 Cooling Measures</div>
            <select
              style={{
                fontSize: '12px', padding: '6px 10px', borderRadius: '8px',
                border: '1px solid #e5e7eb', background: 'white',
                color: '#374151', fontFamily: 'Inter, sans-serif',
              }}
              value={trendsTown}
              onChange={async (e) => {
                const town = e.target.value || undefined
                setTrendsTown(e.target.value)
                const res = await getTrends(town)
                setTrends(res)
              }}
            >
              <option value="">All towns</option>
              {TOWNS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {!trendData.length ? (
          <div style={{ height: 260, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#9ca3af', fontSize: '13px',
            background: '#f9fafb', borderRadius: '8px' }}>
            Loading market data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#9ca3af' }}
                axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false} tickLine={false} domain={['auto', 'auto']} width={52} />
              <Tooltip content={<PriceTooltip />} />
              <ReferenceLine x={2022} stroke="#f59e0b" strokeDasharray="5 4" strokeWidth={1.8} />
              <Area type="monotone" dataKey="median_price"
                stroke="#16a34a" strokeWidth={2.5} fill="url(#trendGrad)"
                dot={{ fill: '#22c55e', stroke: '#16a34a', strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5, fill: '#14532d', stroke: 'white', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ══ SECTION 3 — GLOBAL SHAP ═════════════════════════════════════ */}
      <div style={{ ...cardBase, marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
              🔍 What Drives HDB Prices?
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              Features ranked by average impact on predicted price (SHAP values)
            </p>
          </div>
          <IRSTag type="Model-Based" />
        </div>
        {!shap ? (
          <LoadingSpinner label="Loading feature importance..." />
        ) : (
          <ResponsiveContainer width="100%" height={shapData.length * 34 + 20}>
            <BarChart data={shapData} layout="vertical"
              margin={{ top: 0, right: 60, bottom: 0, left: 140 }}>
              <XAxis type="number"
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={136}
                tick={{ fontSize: 12, fill: '#374151', fontWeight: 500 }}
                axisLine={false} tickLine={false} />
              <Tooltip content={<ShapTooltip />} />
              <Bar dataKey="value" fill="#22c55e" radius={[0, 4, 4, 0]}
                maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ══ SECTION 4 — RULES ═══════════════════════════════════════════ */}
      <div style={{ ...cardBase, marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
              📋 Market Insights & Decision Rules
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              Patterns discovered from {(rules?.apriori?.length ?? 0) + (rules?.surrogate?.length ?? 0)} rules ·
              showing top {Math.min(filteredRules.length, 10)}
            </p>
          </div>
          <IRSTag type="Rule-Based" />
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[
            { id: 'all',       label: 'All Rules' },
            { id: 'apriori',   label: '📊 Market Patterns' },
            { id: 'surrogate', label: '🌳 Decision Rules' },
          ].map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)}
              style={{
                padding: '6px 16px', borderRadius: '999px', fontSize: '12px',
                fontWeight: 600, cursor: 'pointer', border: 'none',
                background: activeTab === id ? '#22c55e' : '#f3f4f6',
                color:      activeTab === id ? 'white'   : '#6b7280',
                transition: 'all 0.15s',
              }}>
              {label}
            </button>
          ))}
        </div>

        {!rules ? (
          <LoadingSpinner label="Loading rules..." />
        ) : (
          filteredRules.slice(0, 10).map((rule, i) => (
            <RuleCard key={`${rule.source}-${i}`} rule={rule} />
          ))
        )}
      </div>

    </div>
  )
}
