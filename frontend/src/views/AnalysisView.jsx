import { useEffect, useState } from 'react'
import { getTrends, getGlobalSHAP, getRules, getModelMeta } from '../api/client.js'
import IRSTag from '../components/IRSTag.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { TOWNS } from '../constants/towns.js'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'

function buildModelStats(meta) {
  if (!meta) return []
  return [
    {
      icon: '🗂️',
      label: 'Transactions Analysed',
      value: (meta.total_transactions || 0).toLocaleString(),
      delta: '1990 – 2026',
      sub: 'All HDB resale records'
    },
    {
      icon: '🎯',
      label: 'Model Accuracy (R²)',
      value: meta.r2?.toFixed(4) ?? '—',
      delta: `${((meta.r2 || 0) * 100).toFixed(1)}% variance explained`,
      sub: `${meta.model_name || 'Hybrid'} on test set`
    },
    {
      icon: '💰',
      label: 'Typical Price Error',
      value: `~$${(meta.rmse || 0).toLocaleString()}`,
      delta: 'RMSE on unseen data',
      sub: `MAPE ${meta.mape_pct ?? '—'}%`
    },
    {
      icon: '🔧',
      label: 'Features Used',
      value: String(meta.n_features || 0),
      delta: 'engineered from raw data',
      sub: 'Location, time, size, amenities'
    }
  ]
}

const FEATURE_LABELS = {
  // Time
  transaction_year: 'Year of transaction',
  year: 'Year of transaction',
  years_since_2000: 'Years since 2000',
  month_num: 'Month of sale',
  quarter: 'Quarter of sale',

  // Flat physicals
  floor_area_sqm: 'Floor area (sqm)',
  level_mid: 'Floor level (storey)',
  storey_mid: 'Floor level (storey)',
  room_count: 'Number of rooms',
  lease_remaining_years: 'Remaining lease (years)',
  remaining_lease_years: 'Remaining lease (years)',
  age_at_sale: 'Flat age at sale',
  lease_commence_date: 'Lease start year',
  orientation_score: 'Unit orientation score',

  // Flat type / model
  'flat_type_2 ROOM': '2-room flat',
  'flat_type_3 ROOM': '3-room flat',
  'flat_type_4 ROOM': '4-room flat',
  'flat_type_5 ROOM': '5-room flat',
  flat_type_EXECUTIVE: 'Executive flat',
  'flat_model_Model A': 'Flat model — Model A',
  flat_model_Improved: 'Flat model — Improved',
  'flat_model_Premium Apartment': 'Flat model — Premium Apartment',
  flat_model_Standard: 'Flat model — Standard',
  flat_model_Maisonette: 'Flat model — Maisonette',

  // Location / amenities
  dist_to_cbd_km: 'Distance to CBD',
  dist_to_mrt_m: 'Distance to MRT',
  dist_nearest_mrt_km: 'Distance to MRT',
  mrt_count_within_1km: 'MRT stations within 1km',
  dist_to_highway_m: 'Distance to highway',
  dist_to_nearest_mall_m: 'Distance to nearest mall',
  mall_count_3km: 'Malls within 3km',
  mall_weighted_access_3km: 'Mall accessibility (3km, weighted)',
  dist_to_foodcourt_m: 'Distance to foodcourt',
  dist_to_nearest_school_m: 'Distance to nearest school',
  school_count_1km: 'Schools within 1km',
  primary_school_quality_1km_weighted: 'Top schools nearby (quality-weighted)',
  primary_school_count_1km: 'Primary schools within 1km',
  dist_nearest_top_school_km: 'Distance to top primary school',
  dist_nearest_primary_school_km: 'Distance to nearest primary school',
  primary_schools_within_1km: 'Primary schools within 1km',
  primary_schools_within_2km: 'Primary schools within 2km',
  top_school_within_1km: 'Top school within 1km',
  top_school_within_2km: 'Top school within 2km',
  hawker_count_1km: 'Hawker centres within 1km',
  hawkers_within_500m: 'Hawkers within 500m',
  dist_nearest_hawker_km: 'Distance to hawker centre',

  // Macro / context
  is_mature_estate: 'Is mature estate',
  post_cooling_2022: 'After 2022 cooling measures',
  post_cooling_2018: 'After 2018 cooling measures',
  post_cooling_2013: 'After 2013 cooling measures',
  interest_rate_proxy: 'Interest rate (proxy)',
  transaction_count_block_2yr: 'Recent demand at block (2yr)',
  transaction_count_per_block_last_2yr: 'Recent demand at block (2yr)',
  lat: 'Location (latitude)',
  lng: 'Location (longitude)',
  lon: 'Location (longitude)'
}

// Friendlier label for town one-hots that we don't list explicitly.
const prettifyFeatureLabel = (raw) => {
  if (!raw) return raw
  if (FEATURE_LABELS[raw]) return FEATURE_LABELS[raw]
  if (raw.startsWith('town_')) {
    const name = raw.slice('town_'.length).replace(/_/g, ' ').toLowerCase()
    return `Town: ${name.replace(/\b\w/g, (c) => c.toUpperCase())}`
  }
  if (raw.startsWith('flat_type_')) {
    return `Flat type — ${raw.slice('flat_type_'.length)}`
  }
  if (raw.startsWith('flat_model_')) {
    return `Flat model — ${raw.slice('flat_model_'.length)}`
  }
  // Fallback: turn snake_case into Sentence case.
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c, i) => (i === 0 ? c.toUpperCase() : c.toLowerCase()))
}

const translateCondition = (cond, labels) => (labels && labels[cond]) || cond

const confidenceLabel = (conf) => {
  if (conf >= 0.85) return { label: 'Very reliable', className: 'text-emerald-600 dark:text-emerald-400' }
  if (conf >= 0.7) return { label: 'Reliable', className: 'text-emerald-500 dark:text-emerald-400' }
  if (conf >= 0.55) return { label: 'Moderate', className: 'text-amber-600 dark:text-amber-400' }
  return { label: 'Indicative', className: 'text-muted-foreground' }
}

function StatCard({ icon, label, value, delta, sub }) {
  return (
    <Card className="border-t-[3px] border-t-emerald-500 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="pt-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}&nbsp;{label}
        </div>
        <div className="mb-2 text-2xl font-extrabold leading-none text-foreground">{value}</div>
        <div className="mb-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">→ {delta}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
}

function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-popover px-4 py-3 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-bold">{label}</div>
      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
        Median: S${Number(payload[0].value).toLocaleString()}
      </div>
    </div>
  )
}

function Chip({ tone = 'neutral', className = '', children }) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground border-border',
    green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30'
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

function RuleCard({ rule, conditionLabels }) {
  const conf = confidenceLabel(rule.confidence)

  if (rule.source === 'apriori') {
    const ifParts = rule.if_conditions.map((c) => translateCondition(c, conditionLabels))
    const thenParts = rule.then.map((c) => translateCondition(c, conditionLabels))
    return (
      <Card className="mb-3 border-l-4 border-l-emerald-500 shadow-sm">
        <CardContent className="pt-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            When a flat has
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {ifParts.map((p, i) => (
              <Chip key={i} tone="green">
                {p}
              </Chip>
            ))}
          </div>
          <div className="my-2 text-base text-muted-foreground">↓</div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            It tends to be
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {thenParts.map((p, i) => (
              <Chip key={i} tone="amber">
                {p}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
            <div>
              <div className="text-[10px] text-muted-foreground">Reliability</div>
              <div className={`text-xs font-bold ${conf.className}`}>{conf.label}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Confidence</div>
              <div className="text-xs font-bold text-foreground">{Math.round(rule.confidence * 100)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Lift</div>
              <div className="text-xs font-bold text-foreground">{rule.lift?.toFixed(2)}×</div>
            </div>
            {rule.support && (
              <div>
                <div className="text-[10px] text-muted-foreground">Coverage</div>
                <div className="text-xs font-bold text-foreground">
                  {Math.round(rule.support * 100)}% of data
                </div>
              </div>
            )}
            <div className="ml-auto">
              <Chip tone="blue">📊 Market Pattern</Chip>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const cleanCond = (c) => c.replace(/_/g, ' ').replace(/\s+/g, ' ')
  return (
    <Card className="mb-3 border-l-4 border-l-purple-500 shadow-sm">
      <CardContent className="pt-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          When conditions match
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {rule.conditions.map((c, i) => (
            <Chip key={i} tone="purple" className="font-mono">
              {cleanCond(c)}
            </Chip>
          ))}
        </div>
        <div className="my-2 text-base text-muted-foreground">↓</div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Predicted price
        </div>
        <div className="mb-3">
          <Chip tone="amber" className="text-sm font-bold">
            S${Math.round(rule.then_price).toLocaleString()}
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <div>
            <div className="text-[10px] text-muted-foreground">Reliability</div>
            <div className={`text-xs font-bold ${conf.className}`}>{conf.label}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Fidelity</div>
            <div className="text-xs font-bold text-foreground">{Math.round(rule.confidence * 100)}%</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Samples</div>
            <div className="text-xs font-bold text-foreground">{rule.samples?.toLocaleString()}</div>
          </div>
          <div className="ml-auto">
            <Chip tone="purple">🌳 Decision Rule</Chip>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const TREND_RANGES = [
  { id: '5y', label: '5y', years: 5 },
  { id: '10y', label: '10y', years: 10 },
  { id: 'all', label: 'All', years: null }
]

export default function AnalysisView() {
  const [trends, setTrends] = useState(null)
  const [trendsTown, setTrendsTown] = useState('')
  const [trendRange, setTrendRange] = useState('10y')
  const [shap, setShap] = useState(null)
  const [shapCluster, setShapCluster] = useState('')
  const [shapLoading, setShapLoading] = useState(false)
  const [rules, setRules] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [modelStats, setModelStats] = useState([])
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [t, s, r, m] = await Promise.all([
          getTrends(),
          getGlobalSHAP(),
          getRules(),
          getModelMeta()
        ])
        setTrends(t)
        setShap(s)
        setRules(r)
        setModelStats(buildModelStats(m))
      } catch (err) {
        console.error('AnalysisView fetch error:', err)
        setFetchError('Failed to load market data. Is the backend running?')
      }
    })()
  }, [])

  const rawTrends = trends?.trends ?? []
  const rangeCfg = TREND_RANGES.find((r) => r.id === trendRange) ?? TREND_RANGES[1]
  const trendData = (() => {
    if (!rawTrends.length) return []
    const sorted = [...rawTrends].sort((a, b) => a.year - b.year)
    if (rangeCfg.years == null) return sorted
    const latest = sorted[sorted.length - 1]?.year
    if (latest == null) return sorted
    return sorted.filter((d) => d.year > latest - rangeCfg.years)
  })()
  const trendMinYear = trendData[0]?.year
  const trendMaxYear = trendData[trendData.length - 1]?.year

  const shapData = shap
    ? Object.entries(shap.shap_importance)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([feature, value]) => ({
          feature,
          label: prettifyFeatureLabel(feature),
          value: Math.round(value)
        }))
    : []

  const shapTotal = shapData.reduce((s, d) => s + d.value, 0)
  const shapMax = shapData[0]?.value || 1

  const availableClusters = shap?.available_clusters ?? []
  const clusterProfiles = shap?.cluster_profiles || {}
  const activeProfile =
    shap?.active_cluster_profile ||
    (shapCluster ? clusterProfiles[String(shapCluster)] : null)

  const formatSGDCompact = (v) => {
    const n = Number(v) || 0
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
    return `$${Math.round(n).toLocaleString()}`
  }

  const allRules = [...(rules?.apriori ?? []), ...(rules?.surrogate ?? [])]
  const filteredRules =
    activeTab === 'all' ? allRules : allRules.filter((r) => r.source === activeTab)

  const conditionLabels = rules?.metadata?.condition_labels || null

  const ruleTokens = rules
    ? [
        ...(rules?.apriori ?? []).flatMap((r) => [
          ...(r.if_conditions ?? []),
          ...(r.then ?? [])
        ]),
        ...(rules?.surrogate ?? []).flatMap((r) => r.conditions ?? [])
      ]
    : []

  const unknownRuleTokens = conditionLabels
    ? Array.from(new Set(ruleTokens.filter((t) => t && !conditionLabels[t])))
    : []

  async function handleTownChange(town) {
    setTrendsTown(town)
    const res = await getTrends(town || undefined)
    setTrends(res)
  }

  async function handleClusterChange(v) {
    setShapCluster(v)
    setShapLoading(true)
    try {
      const cid = v === '' ? null : Number(v)
      const res = await getGlobalSHAP(cid)
      setShap(res)
    } finally {
      setShapLoading(false)
    }
  }

  if (fetchError) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-center">
        <p className="text-destructive">{fetchError}</p>
        <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    )
  }

  const trendTitle =
    trendMinYear && trendMaxYear
      ? `📊 Price Trend ${trendMinYear} – ${trendMaxYear}`
      : '📊 Price Trend'

  return (
    <div className="w-full space-y-5 px-1">
      {/* ══ SECTION 1 — STAT CARDS ══════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {modelStats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* ══ SECTION 2 — TREND CHART ═════════════════════════════════════ */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{trendTitle}</CardTitle>
            <CardDescription>
              National median resale price · Yearly · Filter by town or range
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="amber">⚡ 2022 Cooling Measures</Chip>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {TREND_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setTrendRange(r.id)}
                  className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                    trendRange === r.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Select value={trendsTown || 'ALL'} onValueChange={(v) => handleTownChange(v === 'ALL' ? '' : v)}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All towns</SelectItem>
                {TOWNS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {!trendData.length ? (
            <div className="flex h-64 items-center justify-center rounded-md bg-muted/30 text-sm text-muted-foreground">
              Loading market data...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                  width={52}
                />
                <Tooltip content={<PriceTooltip />} />
                <ReferenceLine x={2022} stroke="#f59e0b" strokeDasharray="5 4" strokeWidth={1.8} />
                <Area
                  type="monotone"
                  dataKey="median_price"
                  stroke="#16a34a"
                  strokeWidth={2.5}
                  fill="url(#trendGrad)"
                  dot={{ fill: '#22c55e', stroke: '#16a34a', strokeWidth: 2, r: 3 }}
                  activeDot={{ r: 5, fill: '#14532d', stroke: 'var(--background)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ══ SECTION 3 — GLOBAL SHAP ═════════════════════════════════════ */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">🔍 What Drives HDB Prices?</CardTitle>
            <CardDescription>
              Features ranked by average impact on predicted price (SHAP values)
            </CardDescription>
            {activeProfile && (
              <div className="mt-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-foreground/90">
                <span className="font-semibold">
                  Cluster {shapCluster}: {activeProfile.label}
                </span>{' '}
                <span className="text-muted-foreground">— {activeProfile.summary}</span>
                {activeProfile.top_towns?.length > 0 && (
                  <span className="text-muted-foreground">
                    {' '}
                    · top towns: {activeProfile.top_towns.slice(0, 3).join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={shapCluster || 'OVERALL'}
              onValueChange={(v) => handleClusterChange(v === 'OVERALL' ? '' : v)}
              disabled={!shap || !availableClusters.length}
            >
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-[420px]">
                <SelectItem value="OVERALL">
                  <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-xs font-semibold">Overall (all flats)</span>
                    <span className="text-[11px] text-muted-foreground">
                      Combined SHAP across every cluster
                    </span>
                  </div>
                </SelectItem>
                {availableClusters.map((k) => {
                  const p = clusterProfiles[String(k)]
                  return (
                    <SelectItem key={k} value={String(k)}>
                      <div className="flex flex-col gap-0.5 py-0.5">
                        <span className="text-xs font-semibold">
                          Cluster {k}
                          {p?.label ? ` — ${p.label}` : ''}
                        </span>
                        {p?.summary && (
                          <span className="text-[11px] text-muted-foreground">
                            {p.summary}
                          </span>
                        )}
                        {p?.top_towns?.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            Top towns: {p.top_towns.slice(0, 3).join(', ')}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {shap?.base_value != null && (
              <Chip tone="neutral">Baseline: {formatSGDCompact(shap.base_value)}</Chip>
            )}
            <IRSTag type="Model-Based" />
          </div>
        </CardHeader>
        <CardContent>
          {!shap ? (
            <LoadingSpinner label="Loading feature importance..." />
          ) : (
            <div className="relative">
              {shapLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/60 backdrop-blur-sm">
                  <LoadingSpinner label="Updating cluster..." />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {shapData.map((d, i) => {
                  const pct = (d.value / shapMax) * 100
                  const share = shapTotal ? (d.value / shapTotal) * 100 : 0
                  const isTop = i < 3
                  return (
                    <div
                      key={d.feature}
                      className="group flex items-center gap-3 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/40"
                    >
                      <div className="w-6 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                        {i + 1}
                      </div>
                      <div
                        className="w-36 shrink-0 truncate text-[12px] font-medium text-foreground"
                        title={d.label}
                      >
                        {d.label}
                      </div>
                      <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted/30 ring-1 ring-inset ring-border/40">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-md shadow-sm transition-all ${
                            isTop
                              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600'
                              : 'bg-gradient-to-r from-emerald-300 to-emerald-500 dark:from-emerald-500/70 dark:to-emerald-600/80'
                          }`}
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                        <div className="relative flex h-full items-center justify-between px-2">
                          <span className="text-[10.5px] font-semibold text-white drop-shadow-sm">
                            {pct >= 18 ? formatSGDCompact(d.value) : ''}
                          </span>
                          <span className="text-[10.5px] font-semibold text-foreground/80">
                            {pct < 18 ? formatSGDCompact(d.value) : `${share.toFixed(1)}%`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div className="mt-2 flex flex-col gap-0.5 border-t border-border/60 pt-2 text-[10.5px] text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Avg |SHAP| · top {shapData.length} features</span>
                    <span className="tabular-nums">
                      Combined ≈ {formatSGDCompact(shapTotal)}
                    </span>
                  </div>
                  {shap?.method?.includes('Composite') && (
                    <div className="text-[10px] italic text-muted-foreground/80">
                      Tree-only attribution; Ridge component
                      {shap.ridge_gap_pct_of_pred != null
                        ? ` (~${(shap.ridge_gap_pct_of_pred * 100).toFixed(1)}% of signal)`
                        : ' (~5–7% of signal)'}{' '}
                      is not shown.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ SECTION 4 — RULES ═══════════════════════════════════════════ */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">📋 Market Insights & Decision Rules</CardTitle>
            <CardDescription>
              Patterns discovered from {(rules?.apriori?.length ?? 0) + (rules?.surrogate?.length ?? 0)}{' '}
              rules · showing top {Math.min(filteredRules.length, 10)}
            </CardDescription>
          </div>
          <IRSTag type="Rule-Based" />
        </CardHeader>
        <CardContent>
          {rules && (
            <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-sm font-bold text-foreground">Rules health</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {conditionLabels
                  ? `All rule tokens are labeled (unknown: ${unknownRuleTokens.length}).`
                  : 'Condition labels unavailable; showing raw tokens.'}
              </div>
              {!!unknownRuleTokens.length && (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Unmapped tokens (sample):{' '}
                  <span className="font-mono">
                    {unknownRuleTokens.slice(0, 6).join(', ')}
                    {unknownRuleTokens.length > 6 ? '…' : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mb-5 flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'All Rules' },
              { id: 'apriori', label: '📊 Market Patterns' },
              { id: 'surrogate', label: '🌳 Decision Rules' }
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!rules ? (
            <LoadingSpinner label="Loading rules..." />
          ) : (
            filteredRules
              .slice(0, 10)
              .map((rule, i) => (
                <RuleCard key={`${rule.source}-${i}`} rule={rule} conditionLabels={conditionLabels} />
              ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
