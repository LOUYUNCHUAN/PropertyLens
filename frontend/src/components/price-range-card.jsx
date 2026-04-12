import { Info } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatConfidenceBandK } from '@/lib/formatPrice.js'

const fmt = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-SG') : '—'

/** Singapore dollar display */
const s = (n) => `S$${fmt(n)}`

export function PriceRangeCard({
  aiEstimate,
  cbrMedian,
  listingPrice,
  confidenceLow,
  confidenceHigh,
  cbrSampleSize = 5,
  onEditListing
}) {
  const difference = listingPrice - aiEstimate
  const percentDiff = aiEstimate ? ((difference / aiEstimate) * 100).toFixed(1) : '0'
  const vsCbrDiff = listingPrice - cbrMedian
  const vsCbrPercent = cbrMedian ? ((vsCbrDiff / cbrMedian) * 100).toFixed(1) : '0'

  const isOverpriced = listingPrice > confidenceHigh
  const isUnderpriced = listingPrice < confidenceLow
  const priceStatus = isOverpriced ? 'Slightly High' : isUnderpriced ? 'Below Market' : 'Fair'

  const range = confidenceHigh - confidenceLow || 1
  const clampPct = (v) => Math.min(Math.max(v, 0), 100)
  const aiPosition = clampPct(((aiEstimate - confidenceLow) / range) * 100)
  const listingPosition = clampPct(((listingPrice - confidenceLow) / range) * 100)
  const cbrPosition = clampPct(((cbrMedian - confidenceLow) / range) * 100)

  const fairZoneStart = 30
  const fairZoneEnd = 70

  /** Keep callout boxes from sitting on top of each other (percent of bar width). */
  const LABEL_GAP_PCT = 13
  const cbrAiSep = Math.abs(aiPosition - cbrPosition)
  const stackCbrAi = cbrAiSep < LABEL_GAP_PCT
  const cbrRowFirst = cbrPosition <= aiPosition
  const listingAiSep = Math.abs(listingPosition - aiPosition)
  const nudgeListingAi = listingAiSep < 9
  const listingNudgeX = nudgeListingAi ? (listingPosition >= aiPosition ? -38 : 38) : 0
  const aiLabelNudgeX = nudgeListingAi ? (listingPosition >= aiPosition ? 38 : -38) : 0

  const labelAnchorStyle = (pct) => {
    if (pct <= 6) {
      return { left: '0%', transform: 'translateX(0)' }
    }
    if (pct >= 94) {
      return { left: '100%', transform: 'translateX(-100%)' }
    }
    return { left: `${pct}%`, transform: 'translateX(-50%)' }
  }

  const summaryTone = isOverpriced
    ? {
        border: 'border-l-amber-500 border-amber-200 bg-amber-50',
        iconBg: 'bg-amber-500',
        title: 'Price alert',
        icon: '!'
      }
    : isUnderpriced
      ? {
          border: 'border-l-sky-500 border-sky-200 bg-sky-50',
          iconBg: 'bg-sky-500',
          title: 'Below model band',
          icon: '↓'
        }
      : {
          border: 'border-l-emerald-500 border-emerald-200 bg-emerald-50',
          iconBg: 'bg-emerald-500',
          title: 'Price assessment',
          icon: '✓'
        }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border/80 border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50 to-card p-5 shadow-sm dark:from-emerald-950/30 dark:to-card">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            AI estimate
          </p>
          <p className="text-2xl font-bold text-emerald-600">{s(aiEstimate)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatConfidenceBandK(confidenceLow, confidenceHigh)}
          </p>
          <span className="mt-2 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-slate-800">
            MODEL-BASED
          </span>
        </div>

        <div className="rounded-xl border border-border/80 border-l-4 border-l-blue-400 bg-gradient-to-br from-blue-50 to-card p-5 shadow-sm dark:from-blue-950/25 dark:to-card">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            CBR median
          </p>
          <p className="text-2xl font-bold text-blue-600">{s(cbrMedian)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {cbrSampleSize} recent comparable sales
          </p>
          <span className="mt-2 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-slate-800">
            CBR
          </span>
        </div>

        <div className="rounded-xl border border-border/80 border-l-4 border-l-amber-500 bg-gradient-to-br from-amber-50 to-card p-5 shadow-sm dark:from-amber-950/25 dark:to-card">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Listing price
          </p>
          <p className="text-2xl font-bold text-foreground">{s(listingPrice)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Seller&apos;s asking price</p>
          <span
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium',
              isOverpriced && 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
              isUnderpriced && 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
              !isOverpriced && !isUnderpriced && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                isOverpriced && 'bg-amber-500',
                isUnderpriced && 'bg-sky-500',
                !isOverpriced && !isUnderpriced && 'bg-emerald-500'
              )}
            />
            {priceStatus}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-card p-5 shadow-sm dark:border-border">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            vs CBR median
          </p>
          <p
            className={cn(
              'text-2xl font-bold',
              vsCbrDiff >= 0 ? 'text-amber-600' : 'text-emerald-600'
            )}
          >
            {vsCbrDiff >= 0 ? '+' : '-'}
            {s(Math.abs(vsCbrDiff))}
          </p>
          <p
            className={cn(
              'mt-1 text-xs font-medium',
              vsCbrDiff >= 0 ? 'text-amber-600' : 'text-emerald-600'
            )}
          >
            {vsCbrDiff >= 0 ? '+' : ''}
            {vsCbrPercent}%
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {vsCbrDiff >= 0 ? 'Above' : 'Below'} recent sales
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-card p-6 shadow-sm dark:border-border">
        <div className="mb-6 flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">Price position visualization</h4>
          <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>

        <div className="relative">
          <div className="mb-3 flex justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Underpriced</span>
            <span>Fair value</span>
            <span>Overpriced</span>
          </div>

          {/* Grid: side columns for floor/ceiling so they never cover CBR; track only in center */}
          <div className="mt-1 grid grid-cols-[minmax(4.5rem,5.5rem)_1fr_minmax(4.5rem,5.5rem)] gap-x-2 sm:gap-x-3">
            <div className="pointer-events-none select-none pt-[2.75rem] text-left sm:pt-12">
              <div className="flex flex-col items-start">
                <div className="h-3 w-0.5 shrink-0 rounded-full bg-slate-400" />
                <div className="mt-1 max-w-[5.5rem]">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Floor
                  </p>
                  <p className="text-xs font-semibold leading-tight text-slate-600 dark:text-slate-300">
                    S${(confidenceLow / 1000).toFixed(0)}k
                  </p>
                </div>
              </div>
            </div>

            <div className="relative min-w-0 overflow-visible pt-10 sm:pt-11">
              <div className="relative overflow-visible">
                {/* Listing — above bar; horizontal nudge when aligned with AI */}
                <div
                  className="pointer-events-none absolute z-30 flex max-w-[110px] flex-col items-center"
                  style={{
                    left: `${listingPosition}%`,
                    transform: `translateX(calc(-50% + ${listingNudgeX}px))`,
                    bottom: 'calc(100% + 8px)'
                  }}
                >
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      Listing
                    </p>
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                      S${(listingPrice / 1000).toFixed(0)}k
                    </p>
                  </div>
                  <div className="h-2 w-px bg-amber-400/80" aria-hidden />
                </div>

                <div className="relative h-4 w-full overflow-visible rounded-full bg-slate-100 dark:bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-200/70 dark:bg-emerald-900/40"
                    style={{ width: `${fairZoneStart}%` }}
                  />
                  <div
                    className="absolute inset-y-0 bg-emerald-100/90 dark:bg-emerald-900/25"
                    style={{
                      left: `${fairZoneStart}%`,
                      width: `${fairZoneEnd - fairZoneStart}%`
                    }}
                  />
                  <div
                    className="absolute inset-y-0 right-0 bg-amber-200/70 dark:bg-amber-900/35"
                    style={{ width: `${100 - fairZoneEnd}%` }}
                  />

                  <div className="pointer-events-none absolute inset-0 z-10">
                    <div
                      className="absolute bottom-0 -translate-x-1/2 translate-y-1/2"
                      style={{ left: `${cbrPosition}%` }}
                    >
                      <div className="h-0 w-0 border-x-[7px] border-t-[9px] border-x-transparent border-t-blue-500 drop-shadow-sm" />
                    </div>
                    <div
                      className="absolute top-1/2 flex h-5 w-5 items-center justify-center rounded-full border-[3px] border-white bg-emerald-500 text-[8px] font-bold text-white shadow-md dark:border-card"
                      style={{
                        left: `${aiPosition}%`,
                        transform: nudgeListingAi
                          ? `translate(calc(-50% + ${-listingNudgeX}px), -50%)`
                          : 'translate(-50%, -50%)'
                      }}
                    >
                      AI
                    </div>
                    <div
                      className="absolute top-1/2 flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-white bg-amber-500 text-[7px] font-bold text-white shadow-md dark:border-card"
                      style={{
                        left: `${listingPosition}%`,
                        transform: `translate(calc(-50% + ${listingNudgeX}px), -50%)`
                      }}
                    >
                      $
                    </div>
                  </div>
                </div>
              </div>

              {/* CBR + AI callouts: stack vertically when too close; edge-aware anchor */}
              <div
                className={cn(
                  'relative mt-2 w-full',
                  stackCbrAi ? 'min-h-[7.25rem]' : 'min-h-[3.35rem]'
                )}
              >
                <div
                  className={cn(
                    'absolute z-10 flex flex-col',
                    cbrPosition <= 6 && 'items-start',
                    cbrPosition >= 94 && 'items-end',
                    cbrPosition > 6 && cbrPosition < 94 && 'items-center'
                  )}
                  style={{
                    ...labelAnchorStyle(cbrPosition),
                    top: stackCbrAi ? (cbrRowFirst ? 0 : '4.65rem') : 0
                  }}
                >
                  <div className="max-w-[6.5rem] rounded-md border border-blue-100 bg-card px-2 py-1 text-center shadow-sm dark:border-blue-900/50">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-blue-600">CBR</p>
                    <p className="text-xs font-bold leading-tight text-blue-600">
                      S${(cbrMedian / 1000).toFixed(0)}k
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    'absolute z-10 flex flex-col',
                    aiPosition <= 6 && 'items-start',
                    aiPosition >= 94 && 'items-end',
                    aiPosition > 6 && aiPosition < 94 && 'items-center'
                  )}
                  style={{
                    left:
                      aiPosition <= 6
                        ? '0%'
                        : aiPosition >= 94
                          ? '100%'
                          : `${aiPosition}%`,
                    transform:
                      aiPosition <= 6
                        ? `translateX(${aiLabelNudgeX}px)`
                        : aiPosition >= 94
                          ? `translateX(calc(-100% + ${aiLabelNudgeX}px))`
                          : `translateX(calc(-50% + ${aiLabelNudgeX}px))`,
                    top: stackCbrAi ? (cbrRowFirst ? '4.65rem' : 0) : 0
                  }}
                >
                  <div className="max-w-[6.5rem] rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-center shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/40">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      AI est.
                    </p>
                    <p className="text-xs font-bold leading-tight text-emerald-700 dark:text-emerald-400">
                      S${(aiEstimate / 1000).toFixed(0)}k
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none select-none pt-[2.75rem] text-right sm:pt-12">
              <div className="flex flex-col items-end">
                <div className="h-3 w-0.5 shrink-0 rounded-full bg-slate-400" />
                <div className="mt-1 max-w-[5.5rem]">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Ceiling
                  </p>
                  <p className="text-xs font-semibold leading-tight text-slate-600 dark:text-slate-300">
                    S${(confidenceHigh / 1000).toFixed(0)}k
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 border-t border-slate-100 pt-4 dark:border-border">
            <div className="flex items-center gap-2">
              <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-[6px] font-bold text-white shadow dark:border-card">
                AI
              </div>
              <span className="text-xs text-muted-foreground">AI estimate</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-0 w-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-blue-500" />
              <span className="text-xs text-muted-foreground">CBR median</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[6px] font-bold text-white shadow dark:border-card">
                $
              </div>
              <span className="text-xs text-muted-foreground">Listing price</span>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'rounded-xl border border-l-4 p-5',
          summaryTone.border
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
              summaryTone.iconBg
            )}
          >
            {summaryTone.icon}
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">{summaryTone.title}</p>
            <p className="text-sm text-muted-foreground">
              This listing is{' '}
              <span className="font-semibold text-foreground">
                {s(Math.abs(difference))} ({Math.abs(Number(percentDiff))}%)
              </span>{' '}
              {difference >= 0 ? 'above' : 'below'} the AI estimate
              {!isOverpriced && !isUnderpriced && ' but within the fair confidence range.'}
              {isOverpriced && '. Consider negotiating toward the model range.'}
              {isUnderpriced && !isOverpriced && ' — below the model floor; you may be leaving value on the table.'}
            </p>
          </div>
        </div>
      </div>

      {typeof onEditListing === 'function' && (
        <button
          type="button"
          onClick={onEditListing}
          className="text-sm font-medium text-emerald-600 underline-offset-2 transition-colors hover:text-emerald-700 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          Change asking price
        </button>
      )}
    </div>
  )
}
