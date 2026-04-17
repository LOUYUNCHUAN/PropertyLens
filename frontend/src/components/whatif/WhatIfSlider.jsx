import { cn } from '@/lib/utils'

export function WhatIfSlider({
  icon,
  label,
  value,
  min,
  max,
  step,
  originalValue,
  onChange,
  formatValue,
  hint
}) {
  const hasChanged = value !== originalValue
  const baselinePct =
    max > min ? ((Number(originalValue) - min) / (max - min)) * 100 : 0
  const baselineLeft = Math.max(0, Math.min(100, baselinePct))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden>
            {icon}
          </span>
          <p className="text-xs font-medium text-foreground">{label}</p>
        </div>
        <p
          className={cn(
            'text-xs font-semibold tabular-nums',
            hasChanged ? 'text-emerald-600' : 'text-muted-foreground'
          )}
        >
          {formatValue(value)}
          {hasChanged ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              (was {formatValue(originalValue)})
            </span>
          ) : null}
        </p>
      </div>

      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
        <div
          className="pointer-events-none absolute -top-1 h-3.5 w-px bg-foreground/60"
          style={{ left: `calc(${baselineLeft}% - 0.5px)` }}
          aria-hidden
          title={`Baseline: ${formatValue(originalValue)}`}
        />
      </div>

      <div className="flex justify-between">
        <span className="text-[10px] text-muted-foreground">{formatValue(min)}</span>
        <span className="text-[10px] text-muted-foreground">{formatValue(max)}</span>
      </div>

      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

