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
  BarChart,
  Bar,
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
  year: 'Sale Year',
  dist_to_cbd_km: 'Distance to CBD',
  years_since_2000: 'Years Since 2000',
  is_mature_estate: 'Mature Estate',
  lat: 'Location (Latitude)',
  lng: 'Location (Longitude)',
  lon: 'Location (Longitude)',
  age_at_sale: 'Flat Age at Sale',
  dist_nearest_mrt_km: 'Distance to MRT',
  'flat_type_3 ROOM': '3-Room Flat Type',
  'flat_type_4 ROOM': '4-Room Flat Type',
  'flat_type_5 ROOM': '5-Room Flat Type',
  'flat_type_2 ROOM': '2-Room Flat Type',
  flat_type_EXECUTIVE: 'Executive Flat Type',
  post_cooling_2022: 'Post-2022 Cooling Period',
  post_cooling_2018: 'Post-2018 Cooling Period',
  post_cooling_2013: 'Post-2013 Cooling Period',
  transaction_count_block_2yr: 'Block Demand (2yr)',
  transaction_count_per_block_last_2yr: 'Block Demand (2yr)',
  floor_area_sqm: 'Floor Area (sqm)',
  storey_mid: 'Floor Level',
  remaining_lease_years: 'Remaining Lease',
  hawker_count_1km: 'Hawker Centres Nearby',
  dist_nearest_hawker_km: 'Distance to Hawker',
  dist_nearest_top_school_km: 'Distance to Top School',
  dist_nearest_primary_school_km: 'Distance to Primary School',
  primary_schools_within_1km: 'Primary Schools (1km)',
  primary_schools_within_2km: 'Primary Schools (2km)',
  mrt_count_within_1km: 'MRT Stations (1km)',
  month_num: 'Month of Sale',
  quarter: 'Quarter of Sale',
  interest_rate_proxy: 'Interest Rate Proxy',
  lease_commence_date: 'Lease Start Year',
  hawkers_within_500m: 'Hawkers within 500m',
  top_school_within_1km: 'Top School within 1km',
  top_school_within_2km: 'Top School within 2km'
}

// Plain-English explanations for the SHAP top-N panel (replaces the duplicate
// ranked list — BUG-015). Each entry covers what the feature means for a typical
// buyer/seller and roughly how the model uses it.
const FEATURE_DESCRIPTIONS = {
  year: 'Time trend: later years generally command higher prices due to market appreciation.',
  floor_area_sqm: 'Larger flats carry a higher price, but the premium-per-sqm tapers past ~100 sqm.',
  remaining_lease_years: 'Shorter leases depress price sharply once below ~60 years remaining.',
  age_at_sale: 'Flat age at the time of sale; correlated with remaining lease.',
  storey_mid: 'Higher floors attract a premium for view and quietness.',
  dist_nearest_mrt_km: 'Walking distance to the nearest MRT station; closer is pricier.',
  mrt_count_within_1km: 'More MRT stations within 1km increases connectivity value.',
  dist_nearest_top_school_km: 'Distance to a MOE autonomous/SAP primary school.',
  top_school_within_1km: 'Being within 1km of a top primary school is a strong positive driver.',
  is_mature_estate: 'Mature estates have more amenities and historically trade at a premium.',
  post_cooling_2022: 'Captures price dampening after the 2022 cooling measures.',
  post_cooling_2018: 'Captures price dampening after the 2018 cooling measures.',
  hawker_count_1km: 'Count of nearby hawker centres (proxy for neighbourhood amenities).',
  primary_schools_within_1km: 'Number of primary schools within 1km.',
  dist_nearest_primary_school_km: 'Distance to the nearest primary school.',
  interest_rate_proxy: 'Macro borrowing cost proxy affecting buyer affordability.'
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

function ShapTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-bold">{payload[0].payload.label}</div>
      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
        Avg impact: S${Math.round(payload[0].value).toLocaleString()}
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
        .slice(0, 12)
        .map(([feature, value]) => ({
          feature,
          label: FEATURE_LABELS[feature] || feature,
          value: Math.round(value)
        }))
        .reverse()
    : []

  const shapTopForDescriptions = shap
    ? Object.entries(shap.shap_importance)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
        .map(([feature]) => feature)
    : []

  const availableClusters = shap?.available_clusters ?? []

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
    <div className="mx-auto max-w-6xl space-y-5 px-1">
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={shapCluster || 'OVERALL'}
              onValueChange={(v) => handleClusterChange(v === 'OVERALL' ? '' : v)}
              disabled={!shap || !availableClusters.length}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OVERALL">Overall</SelectItem>
                {availableClusters.map((k) => (
                  <SelectItem key={k} value={String(k)}>
                    Cluster {k}
                  </SelectItem>
                ))}
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
            <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
              {shapLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/60 backdrop-blur-sm">
                  <LoadingSpinner label="Updating cluster..." />
                </div>
              )}
              <div>
                <ResponsiveContainer width="100%" height={shapData.length * 34 + 20}>
                  <BarChart
                    data={shapData}
                    layout="vertical"
                    margin={{ top: 0, right: 60, bottom: 0, left: 140 }}
                  >
                    <XAxis
                      type="number"
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={136}
                      tick={{ fontSize: 12, fill: 'var(--foreground)', fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ShapTooltip />} />
                    <Bar dataKey="value" fill="#22c55e" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-sm font-bold text-foreground">What these features mean</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Plain-English reading of the top drivers above.
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {shapTopForDescriptions.map((feat, i) => (
                    <div key={feat} className="flex gap-2">
                      <div className="w-5 shrink-0 text-xs font-bold text-muted-foreground">{i + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-foreground">
                          {FEATURE_LABELS[feat] || feat}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {FEATURE_DESCRIPTIONS[feat] ||
                            'A numeric feature used by the model; see the chart for its average impact.'}
                        </div>
                      </div>
                    </div>
                  ))}
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
