/**
 * AskingPriceTabbedCard — Step 4 "Set your asking price"
 *
 * Two approaches in one card, switched via a tablist:
 *   A. Input-driven   — type a price, get live feedback + strategy chips
 *   B. Strategy-first — pick a strategy, then fine-tune ±10% with a slider
 *
 * Both approaches share:
 *   • a live feedback panel (tone-coloured verdict)
 *   • a position chart showing floor/ceiling band, AI marker, similar-sales
 *     marker, and the "Your price" marker
 *   • plain-English listing checks (no ML jargon)
 *
 * Props
 * ─────
 *   property                 { address, area, flatType, sqm }
 *   aiEstimate               number
 *   aiLow, aiHigh            number — confidence band
 *   recentSalesMedian        number
 *   recentSalesSampleSize    number (for the "N sales" label)
 *   suggestedListPrice       number — anchor for "Balance" strategy
 *   townTrendPct             number — e.g. 3 → "Tampines +3%"
 *   askingPrice              number | null
 *   setAskingPrice           (n) => void
 *   hideStepBanner           boolean — we ARE inside a BuyerStepCard already
 *
 * Icon mapping (inline svg <use> → lucide-react):
 *   i-home ↔ Home · i-sparkles ↔ Sparkles · i-zap ↔ Zap
 *   i-trending-up ↔ TrendingUp · i-trending-down ↔ TrendingDown
 *   i-check-circle ↔ CheckCircle2 · i-triangle-alert ↔ TriangleAlert
 *   i-info ↔ Info · i-arrow-right ↔ ArrowRight · i-arrow-down ↔ ArrowDown
 *   i-arrow-left ↔ ArrowLeft · i-cpu ↔ Cpu · i-tag ↔ Tag
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Home,
  Info,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Zap
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/formatPrice.js'

const sgdK = (n) => `S$${Math.round(Number(n) / 1000)}k`

// ── Tone palette ──────────────────────────────────────────────────────────
const TONE = {
  emerald: {
    panel: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-400',
    pill: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-900',
    markerChip: 'text-emerald-700 border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-500',
    markerPin: 'bg-emerald-600',
    icon: CheckCircle2
  },
  amber: {
    panel: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300',
    pill: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-900',
    markerChip: 'text-amber-700 border-amber-500 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-500',
    markerPin: 'bg-amber-500',
    icon: TrendingUp
  },
  rose: {
    panel: 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300',
    pill: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-900',
    markerChip: 'text-rose-700 border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
    markerPin: 'bg-rose-600',
    icon: TrendingDown
  }
}

const STRATEGY_COLORS = {
  fast: { chip: 'bg-sky-50 border-sky-100 text-sky-700 dark:bg-sky-950/30 dark:border-sky-900 dark:text-sky-300', Icon: Zap },
  balance: { chip: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300', Icon: Sparkles },
  hold: { chip: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300', Icon: TrendingUp }
}

// ── Pure helpers ─────────────────────────────────────────────────────────
function deriveStrategies({ aiEstimate, aiHigh, suggestedListPrice, townTrendPct, area }) {
  const trendLabel =
    townTrendPct != null && area
      ? `Fair value + ${area} ${townTrendPct >= 0 ? '+' : ''}${townTrendPct}% trend.`
      : 'Fair value + modest premium.'
  return [
    {
      id: 'fast',
      title: 'Sell fast',
      desc: 'At or just below fair value.',
      price: Math.round(Number(aiEstimate) * 0.99),
      time: '~2–4 weeks'
    },
    {
      id: 'balance',
      title: 'Balance price & time',
      desc: trendLabel,
      price: Number(suggestedListPrice) || Math.round(Number(aiEstimate) * 1.03),
      time: '~4–8 weeks'
    },
    {
      id: 'hold',
      title: 'Hold for more',
      desc: 'Near the top of the fair range.',
      price: Math.round(Number(aiHigh) * 0.99),
      time: '~2–4 months'
    }
  ]
}

function assess({ asking, aiEstimate, aiLow, aiHigh }) {
  const a = Number(asking)
  if (!Number.isFinite(a) || !aiEstimate) {
    return {
      tone: 'emerald',
      short: 'Awaiting price',
      verdict: 'Enter an asking price to see live feedback.',
      sub: '',
      delta: 0,
      deltaLabel: ''
    }
  }
  const delta = ((a - aiEstimate) / aiEstimate) * 100
  const absPct = Math.abs(delta).toFixed(1)
  const absAmt = Math.abs(a - aiEstimate)
  if (a < aiLow) {
    return {
      tone: 'rose',
      short: 'Below fair range',
      verdict: `Listed ${formatPrice(absAmt)} below our fair value.`,
      sub: 'You may attract lots of interest but could be leaving money on the table.',
      delta,
      deltaLabel: `−${absPct}% vs fair value`
    }
  }
  if (a > aiHigh) {
    return {
      tone: 'amber',
      short: 'Above fair range',
      verdict: `Listed ${formatPrice(absAmt)} above our fair value.`,
      sub: 'Buyers may hesitate — expect fewer viewings and a longer time on market.',
      delta,
      deltaLabel: `+${absPct}% vs fair value`
    }
  }
  if (Math.abs(delta) < 1.5) {
    return {
      tone: 'emerald',
      short: 'At fair value',
      verdict: 'Right on target — listed near our fair value.',
      sub: 'Competitive price for current market conditions.',
      delta,
      deltaLabel: `${delta >= 0 ? '+' : '−'}${absPct}% vs fair value`
    }
  }
  return {
    tone: 'emerald',
    short: 'Within fair range',
    verdict: `Within the fair range — ${delta > 0 ? 'above' : 'below'} our estimate by ${formatPrice(absAmt)}.`,
    sub: 'Competitive price for current market conditions.',
    delta,
    deltaLabel: `${delta >= 0 ? '+' : '−'}${absPct}% vs fair value`
  }
}

function runChecks({ asking, aiLow, aiHigh, recentSalesMedian, recentSalesSampleSize, area }) {
  if (!Number.isFinite(Number(asking))) return []
  const a = Number(asking)
  const checks = []

  // 1. Within fair range
  if (a >= aiLow && a <= aiHigh) {
    checks.push({
      tone: 'emerald',
      title: 'Within fair range',
      desc: `Between floor ${sgdK(aiLow)} and ceiling ${sgdK(aiHigh)}.`,
      value: 'Pass'
    })
  } else if (a < aiLow) {
    checks.push({
      tone: 'rose',
      title: 'Below floor — risk underpricing',
      desc: `The fair range floor is ${sgdK(aiLow)}.`,
      value: `−${sgdK(aiLow - a)}`
    })
  } else {
    checks.push({
      tone: 'amber',
      title: 'Above ceiling — may deter buyers',
      desc: `The fair range ceiling is ${sgdK(aiHigh)}.`,
      value: `+${sgdK(a - aiHigh)}`
    })
  }

  // 2. vs similar recent sales
  if (Number.isFinite(Number(recentSalesMedian)) && recentSalesMedian > 0) {
    const vsCbr = ((a - recentSalesMedian) / recentSalesMedian) * 100
    const cbrTone = vsCbr > 7 ? 'amber' : vsCbr < -7 ? 'rose' : 'emerald'
    checks.push({
      tone: cbrTone,
      title: 'Similar recent sales',
      desc: `Median of ${recentSalesSampleSize || 'recent'} comparable sales${area ? ` in ${area}` : ''} is ${sgdK(recentSalesMedian)}.`,
      value: `${vsCbr >= 0 ? '+' : '−'}${Math.abs(vsCbr).toFixed(1)}%`
    })
  }

  return checks
}

// ── Sub-components ────────────────────────────────────────────────────────

function StepTabs({ active, onChange }) {
  const tabs = [
    { id: 'input', num: 'A', title: 'Input-driven', sub: 'Type a price, get live feedback' },
    { id: 'strategy', num: 'B', title: 'Strategy-first', sub: 'Pick a strategy, then fine-tune' }
  ]
  return (
    <div
      role="tablist"
      aria-label="Asking price approach"
      className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-slate-100/70 p-1.5 dark:bg-muted/30"
    >
      {tabs.map((t) => {
        const selected = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
              selected
                ? 'border-border bg-card shadow-sm'
                : 'border-transparent hover:bg-card/50'
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-display text-[13px] font-extrabold',
                selected
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 text-slate-600 dark:bg-muted dark:text-muted-foreground'
              )}
            >
              {t.num}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  'block font-display text-[13.5px] font-bold leading-tight',
                  selected ? 'text-foreground' : 'text-slate-600 dark:text-muted-foreground'
                )}
              >
                {t.title}
              </span>
              <span className="mt-0.5 block text-[11.5px] font-medium text-slate-500 dark:text-muted-foreground">
                {t.sub}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PriceInput({ value, onChange }) {
  return (
    <>
      <div className="mb-2 flex items-center gap-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground">
        <Tag className="h-2.5 w-2.5" aria-hidden />
        <span>Your asking price (SGD)</span>
      </div>
      <div className="relative rounded-2xl border-[1.5px] border-border bg-card px-4 py-3.5 transition-all focus-within:border-emerald-600 focus-within:shadow-[0_0_0_4px_theme(colors.emerald.500/0.12)]">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-[24px] font-bold text-slate-400 dark:text-muted-foreground">
          S$
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={value != null ? Number(value).toLocaleString('en-SG') : ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '')
            const n = parseInt(raw || '0', 10)
            onChange(Number.isFinite(n) && n > 0 ? n : null)
          }}
          placeholder="Enter price"
          className="font-display w-full border-none bg-transparent pl-8 text-[32px] font-extrabold tabular-nums tracking-tight text-foreground outline-none placeholder:font-normal placeholder:text-slate-300"
        />
      </div>
    </>
  )
}

function StrategyChips({ strategies, activeId, onPick }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {strategies.map((s) => {
        const c = STRATEGY_COLORS[s.id] || STRATEGY_COLORS.balance
        const active = activeId === s.id
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              'rounded-xl border px-2.5 py-2.5 text-left transition-all',
              active
                ? 'border-[1.5px] border-emerald-600 bg-emerald-50/60 shadow-[0_0_0_3px_theme(colors.emerald.500/0.1)] dark:bg-emerald-950/20'
                : 'border-border bg-card hover:border-slate-300 dark:hover:border-muted-foreground/30'
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border',
                  c.chip
                )}
              >
                <c.Icon className="h-3 w-3" aria-hidden />
              </span>
              <span className="font-display truncate text-[12px] font-bold tracking-tight text-foreground">
                {s.title}
              </span>
            </div>
            <div
              className={cn(
                'mt-1.5 font-mono text-[13px] font-extrabold tabular-nums tracking-tight',
                active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'
              )}
            >
              {formatPrice(s.price)}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function FeedbackPanel({ verdict }) {
  const tone = TONE[verdict.tone] || TONE.emerald
  const VerdictIcon = tone.icon
  return (
    <div
      className={cn(
        'flex h-full min-h-[140px] flex-col justify-center rounded-2xl border px-5 py-4',
        tone.panel
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-bold tracking-[0.02em]">
        <VerdictIcon className="h-3.5 w-3.5" aria-hidden />
        <span>{verdict.short}</span>
      </div>
      <p className="font-display mb-1 text-[19px] font-extrabold leading-tight tracking-tight text-foreground">
        {verdict.verdict}
      </p>
      {verdict.sub && (
        <p className="text-[12.5px] font-medium leading-snug text-slate-600 dark:text-muted-foreground">
          {verdict.sub}
        </p>
      )}
      {verdict.deltaLabel && (
        <span
          className={cn(
            'mt-2.5 inline-flex self-start items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[13px] font-extrabold tabular-nums',
            tone.pill
          )}
        >
          {verdict.deltaLabel}
        </span>
      )}
    </div>
  )
}

function PositionChart({ asking, aiEstimate, aiLow, aiHigh, recentSalesMedian, verdict }) {
  const haveAsk = Number.isFinite(Number(asking))
  const range = Math.max(1, Number(aiHigh) - Number(aiLow))
  const padding = range * 0.25
  const scaleMin = Number(aiLow) - padding
  const scaleMax = Number(aiHigh) + padding
  const span = Math.max(1, scaleMax - scaleMin)
  const toPct = (v) => ((Number(v) - scaleMin) / span) * 100
  const clamp = (n) => Math.max(4, Math.min(96, n))

  const bandL = toPct(aiLow)
  const bandR = toPct(aiHigh)
  const aiPct = toPct(aiEstimate)
  const cbrPct = toPct(recentSalesMedian)
  const askPct = toPct(asking)

  // Collision avoidance: when a reference marker is within 8% of the asking
  // price on the chart axis, flip it BELOW the bar so the two chips don't
  // stack. Asking is always on top; refs get displaced.
  const OVERLAP_PX = 8
  const refsBelow = haveAsk
    ? {
        ai: Math.abs(aiPct - askPct) < OVERLAP_PX,
        cbr: Math.abs(cbrPct - askPct) < OVERLAP_PX
      }
    : { ai: false, cbr: false }
  // Layout offsets — consistent for top vs below placement.
  const BAR_TOP = 54
  const ABOVE_LABEL_TOP = 18
  const BELOW_BASE_TOP = BAR_TOP + 16 // just under the 14px-tall bar
  const askTone = TONE[verdict.tone] || TONE.emerald

  const ReferenceMarker = ({ pct, label, value, color, below }) => (
    <div
      className={cn(
        'absolute flex -translate-x-1/2 flex-col items-center font-mono tabular-nums',
        below && 'z-[2]'
      )}
      style={{ left: `${clamp(pct)}%`, top: below ? `${BELOW_BASE_TOP}px` : `${ABOVE_LABEL_TOP}px` }}
    >
      {/* above-bar order: label · chip · pin */}
      {/* below-bar order: pin · chip · label (mirrored) */}
      {below && <span className={cn('mb-0.5 h-4 w-[2px]', color.pin)} />}
      {!below && (
        <span className="mb-1 whitespace-nowrap font-sans text-[9.5px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-muted-foreground">
          {label}
        </span>
      )}
      <span className={cn('rounded-md border px-2 py-0.5 text-[12px] font-bold tracking-tight', color.chip)}>
        {value}
      </span>
      {!below && <span className={cn('mt-0.5 h-4 w-[2px]', color.pin)} />}
      {below && (
        <span className="mt-1 whitespace-nowrap font-sans text-[9.5px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  )

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-[13.5px] font-bold tracking-tight text-foreground">
          Where your price sits vs the market
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] font-medium text-slate-600 dark:text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Fair range
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-600" /> AI estimate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-600" /> Similar sales
          </span>
        </div>
      </div>
      <div className="relative mx-2 h-[150px]">
        <div className="absolute inset-x-0 h-[14px] rounded-full bg-slate-100 dark:bg-muted" style={{ top: `${BAR_TOP}px` }} />
        <div
          className="absolute h-[14px] rounded-full border border-emerald-200 bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40"
          style={{ top: `${BAR_TOP}px`, left: `${bandL}%`, width: `${Math.max(0, bandR - bandL)}%` }}
        />
        <div
          className="absolute h-[6px] rounded-full bg-emerald-300 dark:bg-emerald-700"
          style={{ top: `${BAR_TOP + 4}px`, left: `${bandL}%`, width: `${Math.max(0, bandR - bandL)}%` }}
        />

        <ReferenceMarker
          pct={aiPct}
          label="AI estimate"
          value={sgdK(aiEstimate)}
          color={{
            chip: 'text-blue-600 border-blue-100 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300',
            pin: 'bg-blue-600'
          }}
          below={refsBelow.ai}
        />

        <ReferenceMarker
          pct={cbrPct}
          label="Similar sales"
          value={sgdK(recentSalesMedian)}
          color={{
            chip: 'text-slate-700 border-slate-200 bg-card dark:border-muted dark:text-slate-200',
            pin: 'bg-slate-600'
          }}
          below={refsBelow.cbr}
        />

        {/* Asking marker — always on top, primary */}
        {haveAsk && (
          <div
            className="absolute top-0 z-[3] flex -translate-x-1/2 flex-col items-center font-mono tabular-nums"
            style={{ left: `${clamp(askPct)}%` }}
          >
            <span className="mb-1 whitespace-nowrap font-sans text-[9.5px] font-bold uppercase tracking-[0.08em]">
              Your price
            </span>
            <span
              className={cn(
                'rounded-md border px-2.5 py-1 text-[13px] font-extrabold tracking-tight shadow-sm',
                askTone.markerChip
              )}
            >
              {formatPrice(asking)}
            </span>
            <span className={cn('mt-0.5 h-5 w-[3px]', askTone.markerPin)} />
          </div>
        )}

        <div className="absolute inset-x-0 top-[120px] flex justify-between font-mono text-[10.5px] font-semibold text-slate-500 dark:text-muted-foreground">
          <span>
            FLOOR
            <b className="mt-0.5 block font-bold text-slate-700 dark:text-slate-200 text-[11.5px]">
              {sgdK(aiLow)}
            </b>
          </span>
          <span className="text-right">
            CEILING
            <b className="mt-0.5 block font-bold text-slate-700 dark:text-slate-200 text-[11.5px]">
              {sgdK(aiHigh)}
            </b>
          </span>
        </div>
      </div>
    </div>
  )
}

function ListingChecks({ checks }) {
  if (!checks.length) return null
  const issueCount = checks.filter((c) => c.tone !== 'emerald').length
  return (
    <div className="mb-4 rounded-2xl border border-border bg-background px-4 py-4 dark:bg-muted/10">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display flex items-center gap-2 text-[13.5px] font-bold tracking-tight text-foreground">
          <span
            className={cn(
              'inline-flex',
              issueCount ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'
            )}
          >
            {issueCount ? (
              <TriangleAlert className="h-4 w-4" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
          </span>
          Listing checks
        </p>
        <span className="text-[11.5px] font-semibold text-slate-500 dark:text-muted-foreground">
          {issueCount ? `${issueCount} thing${issueCount > 1 ? 's' : ''} to review` : 'All checks passed'}
        </span>
      </div>
      <div>
        {checks.map((c, i) => {
          const t = TONE[c.tone] || TONE.emerald
          const RowIcon = c.tone === 'emerald' ? CheckCircle2 : c.tone === 'rose' ? TriangleAlert : Info
          return (
            <div
              key={c.title}
              className={cn(
                'grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 py-2.5',
                i > 0 && 'border-t border-dashed border-border'
              )}
            >
              <span className={cn('inline-flex', c.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : c.tone === 'rose' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300')}>
                <RowIcon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
                  {c.title}
                </p>
                <p className="mt-0.5 text-[11.5px] font-medium leading-snug text-slate-500 dark:text-muted-foreground">
                  {c.desc}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-bold tabular-nums',
                  t.pill
                )}
              >
                {c.value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StrategyCards({ strategies, activeId, onPick }) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {strategies.map((s) => {
        const c = STRATEGY_COLORS[s.id] || STRATEGY_COLORS.balance
        const active = activeId === s.id
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              'relative rounded-2xl border px-3.5 py-3.5 text-left transition-all',
              active
                ? 'border-[1.5px] border-emerald-600 bg-gradient-to-b from-emerald-50/70 to-card shadow-[0_0_0_4px_theme(colors.emerald.500/0.08)] dark:from-emerald-950/30'
                : 'border-border bg-card hover:border-slate-300 dark:hover:border-muted-foreground/30'
            )}
          >
            <div
              className={cn(
                'mb-2.5 flex h-8 w-8 items-center justify-center rounded-[10px] border',
                c.chip
              )}
            >
              <c.Icon className="h-4 w-4" aria-hidden />
            </div>
            <p className="font-display text-[13.5px] font-bold tracking-tight text-foreground">
              {s.title}
            </p>
            <p className="mt-1 min-h-[32px] text-[11.5px] font-medium leading-snug text-slate-500 dark:text-muted-foreground">
              {s.desc}
            </p>
            <p
              className={cn(
                'mt-2.5 font-mono text-[18px] font-extrabold tabular-nums tracking-tight',
                active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'
              )}
            >
              {formatPrice(s.price)}
            </p>
            <p className="mt-0.5 text-[10.5px] font-semibold text-slate-500 dark:text-muted-foreground">
              {s.time}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function FineTuneSlider({ anchorPrice, slider, onSlider, asking }) {
  const deltaVsAnchor = Number(asking) - Number(anchorPrice)
  const deltaPctAnchor = anchorPrice
    ? ((deltaVsAnchor / Number(anchorPrice)) * 100).toFixed(1)
    : '0.0'
  return (
    <div className="mb-4 rounded-2xl border border-border bg-background px-5 py-4 dark:bg-muted/10">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <div>
          <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
            Fine-tune your price
          </p>
          <p className="mt-0.5 text-[11.5px] font-medium text-slate-500 dark:text-muted-foreground">
            Drag to adjust ±10% from the strategy anchor
          </p>
        </div>
        <p className="font-mono text-[22px] font-extrabold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
          {formatPrice(asking)}
        </p>
      </div>
      <input
        type="range"
        min={-10}
        max={10}
        step={0.5}
        value={slider}
        onChange={(e) => onSlider(parseFloat(e.target.value))}
        className="w-full cursor-pointer accent-emerald-600"
      />
      <div className="mt-2 flex justify-between font-mono text-[10.5px] font-semibold text-slate-500 dark:text-muted-foreground">
        <span>−10%</span>
        <span>Anchor</span>
        <span>+10%</span>
      </div>
      <p className="mt-2 text-center text-[11.5px] font-semibold text-slate-500 dark:text-muted-foreground">
        {deltaVsAnchor === 0 ? (
          <>At strategy anchor <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatPrice(anchorPrice)}</span></>
        ) : (
          <>
            <span className="font-bold text-emerald-700 dark:text-emerald-400">
              {deltaVsAnchor > 0 ? '+' : '−'}
              {formatPrice(Math.abs(deltaVsAnchor))}
            </span>{' '}
            ({deltaVsAnchor > 0 ? '+' : ''}{deltaPctAnchor}%) vs anchor {formatPrice(anchorPrice)}
          </>
        )}
      </p>
    </div>
  )
}

function StepBanner({ property }) {
  const sub = [property?.address, property?.flatType, property?.sqm && `${property.sqm} sqm`]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-gradient-to-b from-emerald-50/70 to-card px-5 py-3.5 dark:border-emerald-900/60 dark:from-emerald-950/30">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div>
          <div className="flex items-baseline gap-2.5">
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              Step 4 of 5
            </span>
            <span className="font-display text-[17px] font-bold tracking-tight">
              Set your asking price
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-muted-foreground">
            We&apos;ll check it against market rules and similar sales as you go.
          </p>
        </div>
      </div>
      {sub && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-slate-600 dark:text-muted-foreground">
          <Home className="h-3 w-3" aria-hidden />
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function AskingPriceTabbedCard({
  property,
  aiEstimate,
  aiLow,
  aiHigh,
  recentSalesMedian,
  recentSalesSampleSize,
  suggestedListPrice,
  townTrendPct,
  askingPrice,
  setAskingPrice,
  hideStepBanner = false
}) {
  const strategies = useMemo(
    () =>
      deriveStrategies({
        aiEstimate,
        aiHigh,
        suggestedListPrice,
        townTrendPct,
        area: property?.area
      }),
    [aiEstimate, aiHigh, suggestedListPrice, townTrendPct, property?.area]
  )

  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === 'undefined') return 'input'
    const v = window.sessionStorage.getItem('propertylens.askingPriceTab')
    return v === 'strategy' ? 'strategy' : 'input'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem('propertylens.askingPriceTab', activeTab)
  }, [activeTab])

  // Strategy-first state
  const [strategyId, setStrategyId] = useState('balance')
  const [slider, setSlider] = useState(0)
  const anchorPrice = useMemo(() => {
    const s = strategies.find((x) => x.id === strategyId)
    return s ? s.price : strategies[1]?.price || aiEstimate
  }, [strategyId, strategies, aiEstimate])
  const strategyAsking = useMemo(
    () => Math.round(Number(anchorPrice) * (1 + slider / 100)),
    [anchorPrice, slider]
  )

  // Keep parent askingPrice in sync with whichever tab is active.
  useEffect(() => {
    if (activeTab !== 'strategy') return
    if (typeof setAskingPrice !== 'function') return
    setAskingPrice(strategyAsking)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyAsking, activeTab])

  const asking =
    activeTab === 'strategy' ? strategyAsking : askingPrice

  const verdict = useMemo(
    () => assess({ asking, aiEstimate, aiLow, aiHigh }),
    [asking, aiEstimate, aiLow, aiHigh]
  )
  const checks = useMemo(
    () =>
      runChecks({
        asking,
        aiLow,
        aiHigh,
        recentSalesMedian,
        recentSalesSampleSize,
        area: property?.area
      }),
    [asking, aiLow, aiHigh, recentSalesMedian, recentSalesSampleSize, property?.area]
  )

  // Which chip appears active on the input-driven tab.
  const matchedStrategyId = useMemo(() => {
    const n = Number(asking)
    if (!Number.isFinite(n)) return null
    const hit = strategies.find((s) => Math.abs(s.price - n) < 500)
    return hit ? hit.id : null
  }, [asking, strategies])

  if (!Number.isFinite(Number(aiEstimate)) || !Number.isFinite(Number(aiLow)) || !Number.isFinite(Number(aiHigh))) {
    return null
  }

  return (
    <div className="space-y-4">
      {!hideStepBanner && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <StepBanner property={property} />
        </div>
      )}

      <StepTabs active={activeTab} onChange={setActiveTab} />

      {/* ── Input-driven ── */}
      {activeTab === 'input' && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div>
              <PriceInput value={askingPrice} onChange={setAskingPrice} />
              <StrategyChips
                strategies={strategies}
                activeId={matchedStrategyId}
                onPick={(s) => setAskingPrice(s.price)}
              />
            </div>
            <FeedbackPanel verdict={verdict} />
          </div>

          <PositionChart
            asking={asking}
            aiEstimate={aiEstimate}
            aiLow={aiLow}
            aiHigh={aiHigh}
            recentSalesMedian={recentSalesMedian}
            verdict={verdict}
          />

          <ListingChecks checks={checks} />
        </div>
      )}

      {/* ── Strategy-first ── */}
      {activeTab === 'strategy' && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground">
            <Sparkles className="h-2.5 w-2.5" aria-hidden />
            <span>Pick a pricing strategy</span>
          </div>
          <StrategyCards
            strategies={strategies}
            activeId={strategyId}
            onPick={(s) => {
              setStrategyId(s.id)
              setSlider(0)
            }}
          />

          <FineTuneSlider
            anchorPrice={anchorPrice}
            slider={slider}
            onSlider={setSlider}
            asking={strategyAsking}
          />

          <FeedbackPanel verdict={verdict} />

          <div className="h-4" />

          <PositionChart
            asking={asking}
            aiEstimate={aiEstimate}
            aiLow={aiLow}
            aiHigh={aiHigh}
            recentSalesMedian={recentSalesMedian}
            verdict={verdict}
          />

          <ListingChecks checks={checks} />
        </div>
      )}
    </div>
  )
}

export {
  StepTabs,
  PriceInput,
  StrategyChips,
  FeedbackPanel,
  PositionChart,
  ListingChecks,
  StrategyCards,
  FineTuneSlider
}
