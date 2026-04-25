import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CircleDot,
  Cpu,
  Flag,
  Home,
  Pencil,
  Sparkles,
  Tag,
  ThumbsUp,
  TrendingDown,
  TrendingUp
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatConfidenceBandK, formatPrice } from '@/lib/formatPrice.js'
import { pickVerdict } from '@/lib/verdict.js'

const ICON_MAP = {
  sparkles: Sparkles,
  'trending-down': TrendingDown,
  'thumbs-up': ThumbsUp,
  'circle-dot': CircleDot,
  'trending-up': TrendingUp,
  flag: Flag
}

function VerdictIcon({ name, className }) {
  const Icon = ICON_MAP[name] || CircleDot
  return <Icon className={className} aria-hidden />
}

function VerdictBanner({ verdict, narrative }) {
  const { styles, label, icon } = verdict
  return (
    <div
      className={cn(
        'mb-5 rounded-2xl border border-l-4 px-4 py-4 sm:px-5',
        styles.banner,
        styles.accent
      )}
    >
      <span
        className={cn(
          'mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-tight',
          styles.pillBg
        )}
      >
        <VerdictIcon name={icon} className="h-3.5 w-3.5" />
        <span>{label}</span>
      </span>
      <p className="font-display text-[17px] font-semibold leading-snug tracking-tight text-foreground">
        {narrative}
      </p>
    </div>
  )
}

function BarRow({ row, maxValue }) {
  const width = Math.max((Number(row.value) / maxValue) * 100, 4)
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex shrink-0', row.iconFg)} aria-hidden>
            <row.Icon className="h-[15px] w-[15px]" />
          </span>
          <span
            className={cn(
              'font-display truncate text-[13.5px] font-bold tracking-tight',
              row.emphasis ? 'text-foreground' : 'text-slate-700 dark:text-slate-200'
            )}
          >
            {row.label}
          </span>
        </div>
        <p className="ml-[23px] mt-0.5 text-[11.5px] font-medium leading-snug text-slate-500 dark:text-muted-foreground">
          {row.sublabel}
        </p>
      </div>
      <div className="group relative min-w-0">
        <div className="relative h-[34px] overflow-hidden rounded-[10px] bg-slate-100 dark:bg-muted">
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-[10px] border-[1.5px] border-l-[3px] transition-[width] duration-300',
              row.barBg,
              row.barBorder,
              row.barBorderLeft
            )}
            style={{ width: `${Math.min(width, 100)}%` }}
          />
        </div>
        {row.tooltip && (
          <div
            className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 max-w-[320px] rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium leading-snug text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
            role="tooltip"
          >
            {row.tooltip}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end whitespace-nowrap">
        <span
          className={cn(
            'font-mono text-[14px] font-bold tabular-nums tracking-tight',
            row.valueColor,
            row.emphasis && 'font-extrabold'
          )}
        >
          {formatPrice(row.value)}
        </span>
      </div>
    </div>
  )
}

function QuickCompare({ fromLabel, toLabel, fromVal, toVal }) {
  const diff = Number(fromVal) - Number(toVal)
  const pct = toVal ? (diff / Number(toVal)) * 100 : 0
  const up = diff > 0
  const equal = Math.abs(pct) < 0.1
  const fg = up
    ? 'text-orange-700 dark:text-orange-300'
    : 'text-emerald-700 dark:text-emerald-400'
  return (
    <div className="flex items-center justify-between gap-2 rounded-[10px] bg-slate-100/80 px-3 py-2.5 dark:bg-muted/50">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
        {fromLabel} vs {toLabel}
      </span>
      <div className="flex items-center gap-2">
        {equal ? (
          <span className="font-mono text-[14px] font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
            Same
          </span>
        ) : (
          <>
            <span
              className={cn('inline-flex items-center gap-1 font-mono text-[14px] font-extrabold tabular-nums', fg)}
            >
              {up ? (
                <ArrowUp className="h-3 w-3" aria-hidden />
              ) : (
                <ArrowDown className="h-3 w-3" aria-hidden />
              )}
              {formatPrice(Math.abs(diff))}
            </span>
            <span className="font-mono text-[11px] font-bold tabular-nums text-slate-500 dark:text-muted-foreground">
              {up ? '+' : '−'}
              {Math.abs(pct).toFixed(1)}%
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Buyer pricing comparison card — Direction B (conversational bars).
 *
 * Data contract (property):
 *   { address, area, flatType, floor, lease,
 *     aiEstimate, aiLow, aiHigh, recentSalesMedian, cbrSampleSize }
 */
export default function PricingCardB({
  property,
  askingPrice,
  onChangeAskingPrice,
  onSeeFullAnalysis
}) {
  const verdict = useMemo(
    () => pickVerdict(askingPrice, property?.aiEstimate),
    [askingPrice, property?.aiEstimate]
  )

  const narrative = useMemo(() => {
    const diff = Math.abs(Number(askingPrice) - Number(property?.aiEstimate || 0))
    const pct = Math.abs(verdict.delta).toFixed(1)
    if (verdict.delta >= 2) {
      return `The seller is asking ${formatPrice(diff)} more than we'd estimate — that's ${pct}% above our fair value.`
    }
    if (verdict.delta <= -2) {
      return `The seller is asking ${formatPrice(diff)} less than we'd estimate — that's ${pct}% below our fair value.`
    }
    return `The seller's asking price is right in line with our estimate — within ${pct}% of fair value.`
  }, [askingPrice, property?.aiEstimate, verdict.delta])

  const rows = useMemo(() => {
    const p = property || {}
    return [
      {
        label: 'Asking price',
        sublabel: "What the seller wants",
        value: askingPrice,
        Icon: Tag,
        iconFg: 'text-orange-600 dark:text-orange-400',
        valueColor: 'text-orange-700 dark:text-orange-300',
        barBg: 'bg-orange-50 dark:bg-orange-950/30',
        barBorder: 'border-orange-200 dark:border-orange-900',
        barBorderLeft: 'border-l-orange-500',
        tooltip: 'The price currently listed by the seller.',
        emphasis: true
      },
      {
        label: 'AI estimate',
        sublabel:
          p.aiLow != null && p.aiHigh != null
            ? `Fair value range ${formatConfidenceBandK(p.aiLow, p.aiHigh)}`
            : 'Hybrid ML model',
        value: p.aiEstimate,
        Icon: Cpu,
        iconFg: 'text-emerald-600 dark:text-emerald-400',
        valueColor: 'text-emerald-700 dark:text-emerald-400',
        barBg: 'bg-emerald-50 dark:bg-emerald-950/30',
        barBorder: 'border-emerald-200 dark:border-emerald-900',
        barBorderLeft: 'border-l-emerald-500',
        tooltip:
          "Our predicted fair value from the hybrid ML model — based on this flat's attributes and recent market data."
      },
      {
        label: 'Recent sales',
        sublabel: p.cbrSampleSize
          ? `Median of ${p.cbrSampleSize} comparable sales nearby`
          : 'Median of recent comparable sales',
        value: p.recentSalesMedian,
        Icon: BarChart3,
        iconFg: 'text-blue-600 dark:text-blue-400',
        valueColor: 'text-blue-700 dark:text-blue-400',
        barBg: 'bg-blue-50 dark:bg-blue-950/30',
        barBorder: 'border-blue-200 dark:border-blue-900',
        barBorderLeft: 'border-l-blue-500',
        tooltip: 'Middle price from actual recent transactions of similar homes in this area.'
      }
    ]
  }, [property, askingPrice])

  const maxValue = useMemo(() => {
    const p = property || {}
    const values = [askingPrice, p.aiEstimate, p.recentSalesMedian, p.aiHigh]
      .map(Number)
      .filter((v) => Number.isFinite(v) && v > 0)
    return values.length ? Math.max(...values) : Math.max(askingPrice, p.aiEstimate) || 1
  }, [askingPrice, property])

  if (!property || !Number.isFinite(Number(askingPrice)) || !Number.isFinite(Number(property.aiEstimate))) {
    return null
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-foreground shadow-sm sm:p-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
            <Home className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="font-display truncate text-base font-bold tracking-tight">
              {property.address}
            </div>
            <div className="truncate text-[12.5px] font-medium text-slate-500 dark:text-muted-foreground">
              {[property.area, property.flatType, property.floor, property.lease]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
        {typeof onChangeAskingPrice === 'function' && (
          <button
            type="button"
            onClick={onChangeAskingPrice}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[0.625rem] border border-border bg-card px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-slate-200 dark:hover:bg-muted"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            <span>Change price</span>
          </button>
        )}
      </div>

      {/* Verdict banner */}
      <VerdictBanner verdict={verdict} narrative={narrative} />

      {/* Bars */}
      <div className="mb-4 flex flex-col gap-3.5">
        {rows.map((row) => (
          <BarRow key={row.label} row={row} maxValue={maxValue} />
        ))}
      </div>

      {/* Quick compare */}
      <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <QuickCompare
          fromLabel="Asking"
          toLabel="AI estimate"
          fromVal={askingPrice}
          toVal={property.aiEstimate}
        />
        <QuickCompare
          fromLabel="Asking"
          toLabel="Recent sales"
          fromVal={askingPrice}
          toVal={property.recentSalesMedian}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-dashed border-border pt-3">
        {typeof onSeeFullAnalysis === 'function' ? (
          <button
            type="button"
            onClick={onSeeFullAnalysis}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-600 underline underline-offset-4 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <span>See full analysis</span>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : (
          <span />
        )}
        <span className="text-[11.5px] font-medium text-slate-400 dark:text-muted-foreground">
          Hover any bar for details
        </span>
      </div>
    </div>
  )
}
