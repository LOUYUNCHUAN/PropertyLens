import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronUp, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { explainBuyerView } from '@/api/client.js'
import BuyerStepCardSkeleton from '@/components/buyer/BuyerStepCardSkeleton.jsx'

const ABSORBED_DISPLAY_NAMES = {
  town: 'Town',
  flat_model: 'Flat model',
  flat_type: 'Flat type',
  storey_range: 'Storey range',
  floor_area_sqm: 'Floor area',
  level_mid: 'Floor level',
  lease_remaining_years: 'Remaining lease',
  room_count: 'Room count',
  dist_to_mrt_m: 'MRT proximity',
  dist_to_nearest_mall_m: 'Mall proximity',
  dist_to_nearest_school_m: 'School proximity',
  dist_to_foodcourt_m: 'Hawker / foodcourt proximity',
  dist_to_highway_m: 'Highway proximity',
  mall_count_3km: 'Mall access',
  mall_weighted_access_3km: 'Mall access (weighted)',
  school_count_1km: 'Schools within 1km',
  primary_school_count_1km: 'Primary schools nearby',
  primary_school_top_quality_1km: 'Top school access',
  primary_school_quality_1km_weighted: 'School quality (weighted)',
  orientation_score: 'Orientation',
  market_activity_score: 'Market activity',
  recency_normalized: 'Recency',
  transaction_year: 'Transaction recency',
  sale_month: 'Sale month',
  market_flats_sold_national: 'Market demand (national)',
  market_flats_rented_national: 'Rental demand (national)'
}

const prettifyKey = (key) => {
  if (ABSORBED_DISPLAY_NAMES[key]) return ABSORBED_DISPLAY_NAMES[key]
  const s = String(key || '').replace(/_/g, ' ').trim()
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : key
}

const fmtSGD = (n) =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0
  }).format(Math.round(Number(n) || 0))

const fmtDelta = (n) => {
  const v = Math.round(Number(n) || 0)
  const abs = Math.abs(v).toLocaleString('en-SG')
  return v >= 0 ? `+$${abs}` : `−$${abs}`
}

function VerdictPill({ verdict }) {
  if (!verdict) return null
  const pct = Number(verdict.pct_diff_vs_baseline) || 0
  const pctLabel = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`

  let pillClass
  let dotClass
  switch (verdict.tone) {
    case 'warning':
      pillClass =
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900'
      dotClass = 'h-1.5 w-1.5 rounded-full bg-amber-500'
      break
    case 'info':
      pillClass =
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-900'
      dotClass = 'h-1.5 w-1.5 rounded-full bg-sky-500'
      break
    case 'neutral':
    default:
      pillClass =
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900'
      dotClass = 'h-1.5 w-1.5 rounded-full bg-emerald-500'
      break
  }

  return (
    <span className={pillClass}>
      <span className={dotClass} aria-hidden />
      {verdict.label}
      <span className="opacity-70">({pctLabel} vs cohort)</span>
    </span>
  )
}

function PriceRangeBar({ range, estimate }) {
  if (!range) return null
  const min = Number(range.min) || 0
  const max = Number(range.max) || 0
  if (max <= min) return null
  const est = Number(estimate) || 0
  const pct = Math.max(0, Math.min(100, ((est - min) / (max - min)) * 100))
  const pctileLabel = `${Math.round(Number(range.estimate_percentile) || 0)}th`
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Cohort range</span>
        <span>
          {pctileLabel} percentile
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${pct}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{fmtSGD(min)}</span>
        <span>{fmtSGD(max)}</span>
      </div>
    </div>
  )
}

function HowWeGotThere({ cohortBaseline, strengths, tradeoffs, marketContext, estimate }) {
  const baseline = Number(cohortBaseline) || 0
  const est = Number(estimate) || 0
  const strengthRows = (strengths || []).map((d) => ({
    key: `s-${d.feature_group}`,
    label: d.display_name || prettifyKey(d.feature_group),
    delta: Number(d.delta) || 0,
    sign: 'positive'
  }))
  const tradeoffRows = (tradeoffs || []).map((d) => ({
    key: `t-${d.feature_group}`,
    label: d.display_name || prettifyKey(d.feature_group),
    delta: Number(d.delta) || 0,
    sign: 'negative'
  }))
  const marketDelta = Number(marketContext?.delta) || 0
  const driverSum =
    strengthRows.reduce((a, r) => a + r.delta, 0) +
    tradeoffRows.reduce((a, r) => a + r.delta, 0)
  const calibration = est - (baseline + driverSum + marketDelta)

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
      <p className="text-xs font-medium text-foreground">How we got there</p>
      <div className="mt-2 flex flex-col text-xs">
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">Cohort baseline</span>
          <span className="font-medium tabular-nums text-foreground">{fmtSGD(baseline)}</span>
        </div>

        {strengthRows.map((r) => (
          <div key={r.key} className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">
              <span className="mr-1 text-emerald-600 dark:text-emerald-400" aria-hidden>+</span>
              {r.label}
            </span>
            <span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
              {fmtDelta(r.delta)}
            </span>
          </div>
        ))}

        {tradeoffRows.map((r) => (
          <div key={r.key} className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">
              <span className="mr-1 text-muted-foreground" aria-hidden>−</span>
              {r.label}
            </span>
            <span className="tabular-nums font-medium text-muted-foreground">
              {fmtDelta(r.delta)}
            </span>
          </div>
        ))}

        {marketContext ? (
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">Market context</span>
            <span className="tabular-nums font-medium text-muted-foreground">
              {fmtDelta(marketDelta)}
            </span>
          </div>
        ) : null}

        {Math.abs(calibration) >= 1 ? (
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">Model calibration</span>
            <span className="tabular-nums font-medium text-muted-foreground">
              {fmtDelta(calibration)}
            </span>
          </div>
        ) : null}

        <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-2">
          <span className="font-medium text-foreground">Estimate</span>
          <span className="tabular-nums font-medium text-foreground">{fmtSGD(est)}</span>
        </div>
      </div>
    </div>
  )
}

function FactorCard({ driver, sign }) {
  const isStrength = sign === 'positive'
  const Icon = isStrength ? TrendingUp : TrendingDown
  const iconClass = isStrength
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400'
  const delta = Number(driver.delta) || 0
  const percentile = Number(driver.cohort_percentile)
  const showBar = Number.isFinite(percentile) && driver.percentile_label != null
  const pctClamped = Math.max(0, Math.min(100, percentile))
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Icon className={cn('h-3.5 w-3.5', iconClass)} aria-hidden />
            <p className="text-sm font-semibold text-foreground">{driver.display_name}</p>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{driver.raw_value_descriptor}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
            isStrength
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
          )}
        >
          {fmtDelta(delta)}
        </span>
      </div>
      {showBar ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>vs cohort</span>
            <span>{driver.percentile_label}</span>
          </div>
          <div className="relative h-1.5 w-full rounded-full bg-muted">
            <div
              className={cn(
                'absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
                isStrength ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
              )}
              style={{ left: `${pctClamped}%` }}
              aria-hidden
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MarketContextFooter({ marketContext }) {
  if (!marketContext) return null
  const delta = Number(marketContext.delta) || 0
  const dir = marketContext.direction || 'flat'
  const Arrow = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : ArrowRight
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/30">
      <Arrow className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" aria-hidden />
      <p className="text-xs text-sky-900 dark:text-sky-100">
        Market context: <span className="font-semibold tabular-nums">{fmtDelta(delta)}</span>
        <span className="opacity-80"> — {marketContext.descriptor}</span>
      </p>
    </div>
  )
}

function AbsorbedNote({ absorbed }) {
  const [open, setOpen] = useState(false)
  if (!absorbed?.length) return null
  return (
    <div className="mt-3 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-1 underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="font-semibold text-foreground">{absorbed.length}</span>
        <span>factor{absorbed.length === 1 ? ' is' : 's are'} already typical for this cohort</span>
        {open ? (
          <ChevronUp className="h-3 w-3" aria-hidden />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden />
        )}
      </button>
      {open ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {absorbed.map((k) => (
            <li
              key={k}
              className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px]"
            >
              {prettifyKey(k)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default function BuyerEstimateInsightsV2({ flat, prediction }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  const fetchIt = useCallback(async () => {
    if (!flat) return
    setLoading(true)
    setError(null)
    try {
      const res = await explainBuyerView(flat, 30)
      setData(res)
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        'Could not load cohort view.'
      setError(typeof msg === 'string' ? msg : 'Could not load cohort view.')
    } finally {
      setLoading(false)
    }
  }, [flat])

  useEffect(() => {
    fetchIt()
  }, [fetchIt, attempt])

  if (loading && !data) {
    return <BuyerStepCardSkeleton stepNumber={0} />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-900 dark:bg-rose-950/30">
        <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
          Could not load cohort view
        </p>
        <p className="mt-1 text-xs text-rose-800 dark:text-rose-200">{error}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setAttempt((a) => a + 1)}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return null

  const estimate = Number(data.estimate) || Number(prediction?.predicted_price) || 0
  const strengths = (data.strengths ?? []).slice(0, 2)
  const tradeoffs = (data.tradeoffs ?? []).slice(0, 2)
  const showRange = data.confidence !== 'low' && data.cohort_price_range

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{data.cohort_descriptor}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
              {fmtSGD(estimate)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Cohort of {data.cohort_size} similar flat{data.cohort_size === 1 ? '' : 's'} · baseline{' '}
              {fmtSGD(data.cohort_baseline)}
            </p>
          </div>
          <VerdictPill verdict={data.verdict} />
        </div>
        {showRange ? (
          <PriceRangeBar range={data.cohort_price_range} estimate={estimate} />
        ) : null}
      </div>

      <HowWeGotThere
        cohortBaseline={data.cohort_baseline}
        strengths={strengths}
        tradeoffs={tradeoffs}
        marketContext={data.market_context}
        estimate={estimate}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {strengths.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Strengths
            </p>
            <div className="space-y-2">
              {strengths.map((d) => (
                <FactorCard key={`s-${d.feature_group}`} driver={d} sign="positive" />
              ))}
            </div>
          </div>
        ) : null}
        {tradeoffs.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              Trade-offs
            </p>
            <div className="space-y-2">
              {tradeoffs.map((d) => (
                <FactorCard key={`t-${d.feature_group}`} driver={d} sign="negative" />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <MarketContextFooter marketContext={data.market_context} />
      <AbsorbedNote absorbed={data.absorbed_factors} />

      <p className="text-[10px] text-muted-foreground">
        Cohort-relative explanation against the cluster-XGB component. Hybrid ensemble may differ slightly.
      </p>
    </div>
  )
}
