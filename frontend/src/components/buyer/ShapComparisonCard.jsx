import { cn } from '@/lib/utils'
import { DRIVER_LABELS } from '@/lib/buyerExplain.js'

const fmtAbs = (n) =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0
  }).format(Math.abs(Number(n) || 0))

export default function ShapComparisonCard({ driver }) {
  const {
    feature,
    local_shap: localShap,
    global_shap: globalShap,
    difference,
    is_above_avg: isAboveAvg,
    icon,
    label,
    featureText
  } = driver

  const maxVal = Math.max(Math.abs(localShap), Math.abs(globalShap), 1)
  const globalPct = ((Math.abs(globalShap) / maxVal) * 100).toFixed(1)
  const localPct = ((Math.abs(localShap) / maxVal) * 100).toFixed(1)

  const dirHint = DRIVER_LABELS[feature]?.direction

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="text-lg shrink-0" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {featureText}
              {dirHint ? ` · ${dirHint}` : ''}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-medium text-muted-foreground">vs baseline</p>
          <p
            className={cn(
              'text-sm font-bold tabular-nums',
              isAboveAvg ? 'text-emerald-600' : 'text-foreground'
            )}
          >
            {difference >= 0 ? '+' : '−'}
            {fmtAbs(difference)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {isAboveAvg ? '↑ Above average' : '↓ Below average'}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-right text-[10px] text-muted-foreground">
            Avg HDB flat
          </span>
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-slate-200"
              style={{ width: `${globalPct}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-[10px] text-muted-foreground tabular-nums">
            +{fmtAbs(globalShap)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-right text-[10px] font-medium text-foreground">
            This flat
          </span>
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div
              className={cn(
                'h-1.5 rounded-full',
                isAboveAvg ? 'bg-emerald-400' : 'bg-slate-600'
              )}
              style={{ width: `${localPct}%` }}
            />
          </div>
          <span
            className={cn(
              'w-20 shrink-0 text-[10px] font-medium tabular-nums',
              isAboveAvg ? 'text-emerald-600' : 'text-muted-foreground'
            )}
          >
            {fmtAbs(localShap)}
          </span>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {isAboveAvg
          ? `This flat's ${label.toLowerCase()} contributes ${fmtAbs(localShap)} more than the typical HDB flat — a positive factor in this price.`
          : `This flat's ${label.toLowerCase()} contributes ${fmtAbs(localShap)} less than the typical HDB flat — reflected in the lower estimate.`}
      </p>
    </div>
  )
}
