import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { DRIVER_LABELS } from '@/lib/buyerExplain.js'
import { getCompositeSHAP } from '@/api/client.js'

const fmtSgd = (n) =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0
  }).format(Math.abs(Number(n) || 0))

// Intentionally uses a minus sign + emerald for positive, slate (not rose!) for
// negative. Red reads as "bad / broken". For SHAP, negative means "below the
// typical flat on this factor" — factual, not a defect. Slate keeps the chart
// neutral.
const signed = (n) => `${Number(n) >= 0 ? '+' : '−'}${fmtSgd(n)}`

const TOP_N = 5 // how many drivers are visible by default

function featureMeta(feature) {
  return (
    DRIVER_LABELS[feature] || {
      icon: '📊',
      label: String(feature).replace(/_/g, ' '),
      format: (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 100) / 100) : String(v))
    }
  )
}

function formatValue(feature, value) {
  const m = featureMeta(feature)
  if (typeof m.format === 'function') {
    try {
      const out = m.format(value)
      return String(out).trim()
    } catch {
      // fall through
    }
  }
  if (Number.isFinite(Number(value))) return String(Math.round(Number(value) * 100) / 100)
  return String(value ?? '')
}

function isEncodedFeature(feature) {
  return /^(town_|flat_type_|flat_model_|storey_range_)/.test(String(feature || ''))
}

function isMarketFeature(feature) {
  return feature === 'transaction_year' || feature === 'years_since_2000'
}

function humanizeEncoded(feature) {
  if (!isEncodedFeature(feature)) return null
  const m = String(feature).match(/^(town|flat_type|flat_model|storey_range)_(.+)$/)
  if (!m) return null
  const [, kind, rest] = m
  const pretty = rest.replace(/_/g, ' ').replace(/\//g, ' / ').trim()
  const label = {
    town: 'Town',
    flat_type: 'Flat type',
    flat_model: 'Flat model',
    storey_range: 'Storey range'
  }[kind]
  return `${label} · ${pretty}`
}

function friendlyLabel(feature) {
  const encoded = humanizeEncoded(feature)
  if (encoded) return encoded
  return featureMeta(feature).label
}

// ── Preamble ──────────────────────────────────────────────────────────────
function NegativeDisclaimer() {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/30">
      <p className="text-[11px] leading-relaxed text-sky-900 dark:text-sky-100">
        <span className="font-semibold">How to read this chart:</span>{' '}
        <span className="font-medium text-emerald-700 dark:text-emerald-400">Green</span>{' '}
        = this flat is{' '}
        <span className="font-medium">stronger than the typical flat</span> on that
        factor.{' '}
        <span className="font-medium text-slate-700 dark:text-slate-300">Slate</span> ={' '}
        <span className="font-medium">weaker than typical</span> — not a defect. A
        smaller flat naturally costs less; the model just reflects that.
      </p>
    </div>
  )
}

// ── Summary header (estimate + biggest lift) ───────────────────────────────
function SummaryHeader({ estimate, topPositive, typicals }) {
  const fmtWithCompare = (r) => {
    if (!r) return null
    const val = r.feature_value
    const typ = typicals?.[r.feature]
    const valStr = formatValue(r.feature, val)
    const typStr = typ != null ? formatValue(r.feature, typ) : null
    const suffix = typStr ? ` · typical ${typStr}` : ''
    return `${friendlyLabel(r.feature)} (${valStr}${suffix})`
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Model estimate for this flat
      </p>
      <p className="text-2xl font-bold tabular-nums text-foreground">{fmtSgd(estimate)}</p>
      {topPositive && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-foreground">
          <span className="text-emerald-600" aria-hidden>
            ↑
          </span>
          <span>
            <span className="text-muted-foreground">Biggest lift:</span>{' '}
            <span className="font-medium">{fmtWithCompare(topPositive)}</span>
            <span className="ml-1 tabular-nums text-emerald-700">
              {signed(topPositive.shap_value)}
            </span>
            {isMarketFeature(topPositive.feature) && (
              <span className="ml-1 text-[10px] italic text-muted-foreground">
                (market-wide, not flat-specific)
              </span>
            )}
          </span>
        </p>
      )}
    </div>
  )
}

// ── One driver row (list mode) ────────────────────────────────────────────
function DriverRow({ row, typical, maxAbs, isRollup = false }) {
  const positive = row.shap_value >= 0
  const pct = Math.min(100, (Math.abs(row.shap_value) / (maxAbs || 1)) * 100)
  const label = isRollup ? row.label : friendlyLabel(row.feature)
  const icon = isRollup ? '∑' : featureMeta(row.feature).icon

  const valueText = isRollup
    ? row.sub
    : isEncodedFeature(row.feature)
    ? null
    : (() => {
        const val = formatValue(row.feature, row.feature_value)
        const typ = typical != null ? formatValue(row.feature, typical) : null
        return typ ? `${val} · typical ${typ}` : val
      })()

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              'truncate text-xs font-medium',
              isRollup ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {label}
          </p>
          {valueText && (
            <p className="truncate text-[10px] text-muted-foreground">{valueText}</p>
          )}
        </div>
      </div>
      <div className="flex w-40 items-center gap-2 sm:w-56">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'absolute top-0 h-1.5 rounded-full',
              positive ? 'bg-emerald-500/80' : 'bg-slate-500/70',
              positive ? 'left-1/2' : 'right-1/2'
            )}
            style={{ width: `${pct / 2}%` }}
          />
          <div className="absolute left-1/2 top-0 h-1.5 w-px bg-border" />
        </div>
        <span
          className={cn(
            'w-20 shrink-0 text-right text-[11px] font-medium tabular-nums',
            positive
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-slate-700 dark:text-slate-300'
          )}
        >
          {signed(row.shap_value)}
        </span>
      </div>
    </div>
  )
}

// ── Waterfall ─────────────────────────────────────────────────────────────
function Waterfall({ rows, baseValue, finalValue, typicals }) {
  const running = useMemo(() => {
    const acc = [baseValue]
    for (const r of rows) acc.push(acc[acc.length - 1] + Number(r.shap_value || 0))
    return acc
  }, [rows, baseValue])

  const { domainMin, domainMax } = useMemo(() => {
    const points = [...running, finalValue, baseValue]
    return { domainMin: Math.min(...points), domainMax: Math.max(...points) }
  }, [running, finalValue, baseValue])

  const range = Math.max(1, domainMax - domainMin)
  const pctOf = (v) => ((v - domainMin) / range) * 100

  return (
    <div className="space-y-1 py-1">
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <div className="w-36 shrink-0 truncate pr-2 text-right">Starting point</div>
        <div className="relative h-5 flex-1">
          <div
            className="absolute top-0 h-5 w-[2px] bg-slate-400"
            style={{ left: `${pctOf(baseValue)}%` }}
            aria-hidden
          />
        </div>
        <div className="w-24 shrink-0 text-right tabular-nums">{fmtSgd(baseValue)}</div>
      </div>

      {rows.map((r, i) => {
        const start = running[i]
        const end = running[i + 1]
        const positive = end >= start
        const left = Math.min(start, end)
        const width = Math.abs(end - start)
        const isRollup = r.isRollup
        const label = isRollup ? r.label : friendlyLabel(r.feature)
        const icon = isRollup ? '∑' : featureMeta(r.feature).icon
        const sub = isRollup
          ? null
          : isEncodedFeature(r.feature)
          ? null
          : (() => {
              const typ = typicals?.[r.feature]
              const val = formatValue(r.feature, r.feature_value)
              return typ != null ? `${val} · typical ${formatValue(r.feature, typ)}` : val
            })()
        return (
          <div key={r.feature || `rollup-${i}`} className="flex items-center gap-3">
            <div className="flex w-36 shrink-0 items-center justify-end gap-1 pr-2">
              <span className="shrink-0 text-xs" aria-hidden>
                {icon}
              </span>
              <div className="min-w-0 text-right">
                <span
                  className={cn(
                    'block truncate text-[11px] font-medium',
                    isRollup ? 'text-muted-foreground' : 'text-foreground'
                  )}
                  title={label}
                >
                  {label}
                </span>
                {sub && (
                  <span className="block truncate text-[9px] text-muted-foreground">{sub}</span>
                )}
              </div>
            </div>
            <div className="relative h-5 flex-1 rounded bg-muted/20">
              <div
                className={cn(
                  'absolute top-0.5 h-4 rounded-sm',
                  isRollup
                    ? 'bg-slate-400/70'
                    : positive
                    ? 'bg-emerald-500/85'
                    : 'bg-slate-500/75'
                )}
                style={{
                  left: `${pctOf(left)}%`,
                  width: `${(width / range) * 100}%`,
                  minWidth: '2px'
                }}
                title={`${label} ${signed(r.shap_value)}`}
              />
            </div>
            <div
              className={cn(
                'w-24 shrink-0 text-right text-[11px] font-medium tabular-nums',
                isRollup
                  ? 'text-muted-foreground'
                  : positive
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-700 dark:text-slate-300'
              )}
            >
              {signed(r.shap_value)}
            </div>
          </div>
        )
      })}

      <div className="flex items-center gap-3 text-[10px] font-medium text-foreground">
        <div className="w-36 shrink-0 truncate pr-2 text-right">Composite prediction</div>
        <div className="relative h-5 flex-1">
          <div
            className="absolute top-0 h-5 w-[2px] bg-slate-900 dark:bg-slate-100"
            style={{ left: `${pctOf(finalValue)}%` }}
            aria-hidden
          />
        </div>
        <div className="w-24 shrink-0 text-right tabular-nums">{fmtSgd(finalValue)}</div>
      </div>
    </div>
  )
}

// ── Math-check table ──────────────────────────────────────────────────────
function MathCheck({ baseValue, visibleSum, rolledSum, composite, predicted, ridge, rolledCount }) {
  const rows = [
    {
      label: 'Starting point (average flat in this cluster)',
      value: baseValue,
      kind: 'base'
    },
    {
      label: `+ Visible drivers (${TOP_N})`,
      value: visibleSum,
      kind: 'add'
    }
  ]
  if (rolledCount > 0) {
    rows.push({
      label: `+ Other ${rolledCount} factors (collapsed above)`,
      value: rolledSum,
      kind: 'add'
    })
  }
  rows.push({
    label: '= Composite prediction (tree stack)',
    value: composite,
    kind: 'subtotal'
  })
  rows.push({
    label: `± Ridge linear term (not shown in chart)`,
    value: Number(ridge || 0),
    kind: 'add'
  })
  rows.push({
    label: '= Hybrid model estimate',
    value: predicted,
    kind: 'total'
  })

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Where the estimate comes from
      </p>
      <dl className="text-[11px]">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              'flex items-baseline justify-between gap-3 py-0.5',
              r.kind === 'subtotal' && 'border-t border-border/40 pt-1',
              r.kind === 'total' && 'border-t border-border/40 pt-1 font-semibold text-foreground'
            )}
          >
            <dt
              className={cn(
                r.kind === 'total' ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {r.label}
            </dt>
            <dd
              className={cn(
                'tabular-nums',
                r.kind === 'total' && 'font-semibold text-foreground',
                r.kind === 'subtotal' && 'font-medium text-foreground'
              )}
            >
              {r.kind === 'base' || r.kind === 'subtotal' || r.kind === 'total'
                ? fmtSgd(r.value)
                : signed(r.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground opacity-90">
        The chart's 70 factors sum exactly to the composite prediction. The hybrid
        model adds a small Ridge (linear) correction on top, which the tree-based
        chart can't represent — that's the last line.
      </p>
    </div>
  )
}

function PerModelBreakdown({ totals }) {
  if (!totals) return null
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Weighted stack contribution
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
        {['xgb', 'lgb', 'rf'].map((k) => (
          <span key={k}>
            <span className="text-muted-foreground">{k.toUpperCase()}</span>{' '}
            <span
              className={cn(
                'font-medium',
                totals[k] >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-700 dark:text-slate-300'
              )}
            >
              {signed(totals[k])}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function MetaWeightsRow({ meta }) {
  if (!meta) return null
  const fmt = (n) => Number(n).toFixed(3)
  return (
    <details className="inline-block">
      <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
        How this was computed
      </summary>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {['xgb', 'lgb', 'rf'].map((k) => (
          <span
            key={k}
            className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {k.toUpperCase()} · {fmt(meta[k])}
          </span>
        ))}
        <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground opacity-70">
          Ridge · {fmt(meta.ridge)} (excluded from chart)
        </span>
      </div>
    </details>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────
export default function CompositeShapPanel({ flat, visible = true, hideStackBreakdown = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [renderMode, setRenderMode] = useState(() => {
    if (typeof window === 'undefined') return 'waterfall'
    const v = window.sessionStorage.getItem('propertylens.compositeRenderMode')
    return v === 'list' ? 'list' : 'waterfall'
  })
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem('propertylens.compositeRenderMode', renderMode)
  }, [renderMode])

  const flatKey = useMemo(() => (flat ? JSON.stringify(flat) : null), [flat])

  useEffect(() => {
    if (!visible || !flatKey) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    getCompositeSHAP(flat)
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((e) => {
        if (cancelled) return
        const msg =
          e?.response?.data?.detail || e?.message || 'Failed to compute Composite SHAP'
        setError(String(msg))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, flatKey])

  // Sort ALL features by |shap|; pick top 6; roll the rest up.
  const { topRows, rollupRow, rowsForChart, rowsForFullList, topPositive } = useMemo(() => {
    const all = Array.isArray(data?.shap_values) ? data.shap_values : []
    const sorted = [...all].sort(
      (a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)
    )
    const top = sorted.slice(0, TOP_N)
    const rest = sorted.slice(TOP_N)
    const restSum = rest.reduce((s, r) => s + Number(r.shap_value || 0), 0)
    const rollup = rest.length
      ? {
          feature: '__other__',
          label: `Other ${rest.length} factors`,
          sub: `Net across ${rest.length} smaller features`,
          shap_value: restSum,
          isRollup: true
        }
      : null

    const pos = sorted.find((r) => r.shap_value > 0) || null

    return {
      topRows: top,
      rollupRow: rollup,
      rowsForChart: rollup ? [...top, rollup] : top,
      rowsForFullList: sorted,
      topPositive: pos
    }
  }, [data])

  const visibleSum = useMemo(
    () => topRows.reduce((s, r) => s + Number(r.shap_value || 0), 0),
    [topRows]
  )
  const rolledSum = rollupRow ? Number(rollupRow.shap_value || 0) : 0
  const maxAbsFull = useMemo(
    () =>
      rowsForFullList.reduce((m, r) => Math.max(m, Math.abs(r.shap_value)), 0) || 1,
    [rowsForFullList]
  )
  const maxAbsTop = useMemo(
    () => rowsForChart.reduce((m, r) => Math.max(m, Math.abs(r.shap_value)), 0) || 1,
    [rowsForChart]
  )

  if (loading) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-6 text-center text-xs text-muted-foreground">
        Computing Composite TreeSHAP over XGB + LightGBM + RandomForest…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
        Composite SHAP failed: {error}
      </div>
    )
  }

  if (!data) return null

  const typicals = data.typical_values || {}
  const finalForWaterfall = data.base_value + visibleSum + rolledSum // == composite_prediction

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          <span className="rounded-md border border-border/60 bg-background px-2 py-0.5 font-medium text-foreground">
            Cluster {data.cluster_id}
          </span>
          <span className="ml-2">
            {data.explainer_source === 'global'
              ? 'global fallback models'
              : 'per-cluster models'}
          </span>
        </span>
        <MetaWeightsRow meta={data.meta_weights} />
      </div>

      <NegativeDisclaimer />

      <SummaryHeader
        estimate={data.predicted_price}
        topPositive={topPositive}
        typicals={typicals}
      />

      <div className="rounded-lg border border-border/60 bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Top {Math.min(TOP_N, topRows.length)} drivers
            {rollupRow && ` + 1 rollup`}
          </span>
          <div
            role="tablist"
            aria-label="Chart style"
            className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={renderMode === 'waterfall'}
              onClick={() => setRenderMode('waterfall')}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                renderMode === 'waterfall'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Waterfall — follow the running total from start to estimate"
            >
              Waterfall
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={renderMode === 'list'}
              onClick={() => setRenderMode('list')}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                renderMode === 'list'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Bar list — compare magnitudes"
            >
              Bar list
            </button>
          </div>
        </div>
        <div className="px-3 py-1">
          {rowsForChart.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              No non-trivial contributions.
            </p>
          ) : renderMode === 'waterfall' ? (
            <Waterfall
              rows={rowsForChart}
              baseValue={data.base_value}
              finalValue={finalForWaterfall}
              typicals={typicals}
            />
          ) : (
            <div className="divide-y divide-border/30">
              {rowsForChart.map((r) => (
                <DriverRow
                  key={r.feature}
                  row={r}
                  typical={r.isRollup ? undefined : typicals[r.feature]}
                  maxAbs={maxAbsTop}
                  isRollup={!!r.isRollup}
                />
              ))}
            </div>
          )}
        </div>
        {rollupRow && (
          <div className="border-t border-border/40 px-3 py-1.5">
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={showAll}
            >
              {showAll
                ? '▴ Hide collapsed factors'
                : `▾ Show all ${rowsForFullList.length} drivers`}
            </button>
            {showAll && (
              <div className="mt-2 divide-y divide-border/30">
                {rowsForFullList.map((r) => (
                  <DriverRow
                    key={r.feature}
                    row={r}
                    typical={typicals[r.feature]}
                    maxAbs={maxAbsFull}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <MathCheck
        baseValue={data.base_value}
        visibleSum={visibleSum}
        rolledSum={rolledSum}
        composite={data.composite_prediction}
        predicted={data.predicted_price}
        ridge={data.approximation_error}
        rolledCount={rollupRow ? rowsForFullList.length - topRows.length : 0}
      />

      {!hideStackBreakdown && <PerModelBreakdown totals={data.per_model_totals} />}
    </div>
  )
}
