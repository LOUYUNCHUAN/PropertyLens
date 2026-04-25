/**
 * SellerPriceRecommendationCard — Variation 2: Scenario strategies.
 *
 * Recommendation card shown after the seller has entered property features.
 * It surfaces PropertyLens' AI fair value and three pricing strategies for the
 * seller to choose between. The seller does NOT set an asking price here —
 * that happens in a downstream card.
 *
 * Props
 * ─────
 *   property              { address, area, flatType, sqm, floor?, lease? }
 *   aiEstimate            number
 *   aiLow, aiHigh         number — confidence band endpoints
 *   townTrendPct          number — e.g. 3 → "Tampines trending +3%"
 *   suggestedListPrice    number — anchor for the "Balance" strategy
 *   pricePerSqm           number
 *   confidence            'low' | 'medium' | 'high'
 *   onSeeFullAnalysis     () => void — footer link
 *   onContinue            () => void — "Continue to set asking price"
 *
 * Strategy derivation (pure function of the props above):
 *   conservative : price = round(aiEstimate * 0.99),  ~2–4 weeks
 *   recommended  : price = suggestedListPrice,        ~4–8 weeks
 *   ambitious    : price = round(aiHigh * 0.99),      ~2–4 months
 *
 * Icon mapping (inline SVG <use> in the handoff HTML → lucide-react here)
 *   i-home        → Home
 *   i-sparkles    → Sparkles
 *   i-trending-up → TrendingUp
 *   i-gauge       → Gauge
 *   i-ruler       → Ruler
 *   i-cpu         → Cpu
 *   i-arrow-right → ArrowRight
 *   i-arrow-down  → ArrowDown
 *   i-zap         → Zap
 */

import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowRight,
  Cpu,
  Gauge,
  Home,
  Ruler,
  Sparkles,
  TrendingUp,
  Zap
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/formatPrice.js'

const sgdK = (n) => `S$${Math.round(Number(n) / 1000)}k`

const CONFIDENCE_STYLES = {
  low: {
    valueColor: 'text-rose-700 dark:text-rose-300',
    label: 'Low',
    sub: 'Model range is wide — cross-check comparables'
  },
  medium: {
    valueColor: 'text-amber-700 dark:text-amber-300',
    label: 'Medium',
    sub: 'Model range is typical'
  },
  high: {
    valueColor: 'text-emerald-700 dark:text-emerald-400',
    label: 'High',
    sub: 'Narrow model range — tight comparables'
  }
}

const STRATEGY_STYLES = {
  conservative: {
    iconBg: 'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-950/30 dark:border-sky-900 dark:text-sky-300',
    Icon: Zap
  },
  recommended: {
    iconBg:
      'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-400',
    Icon: Sparkles
  },
  ambitious: {
    iconBg:
      'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300',
    Icon: TrendingUp
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function SellerCardHeader({ property }) {
  const subline = [property?.area, property?.flatType, property?.sqm && `${property.sqm} sqm`]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
          <Home className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="font-display truncate text-base font-bold tracking-tight">
            {property?.address || 'Your flat'}
          </div>
          <div className="truncate text-[12.5px] font-medium text-slate-500 dark:text-muted-foreground">
            {subline}
          </div>
        </div>
      </div>
      <div className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-muted dark:text-muted-foreground">
        <Sparkles className="h-3 w-3" aria-hidden />
        <span>AI estimate ready</span>
      </div>
    </div>
  )
}

function RecommendationIntro({ aiEstimate, area, townTrendPct }) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-slate-100/70 px-4 py-3.5 dark:bg-muted/40">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
        <Sparkles className="h-4 w-4" aria-hidden />
      </div>
      <p className="font-display text-[14.5px] font-medium leading-snug text-slate-700 dark:text-slate-200">
        Our model estimates your flat is worth{' '}
        <strong className="font-bold text-foreground">{formatPrice(aiEstimate)}</strong>.{' '}
        {area && townTrendPct != null && (
          <>
            {area} is trending{' '}
            <strong className="font-bold text-foreground">
              {townTrendPct >= 0 ? '+' : ''}
              {townTrendPct}%
            </strong>{' '}
            in recent sales.{' '}
          </>
        )}
        Pick a pricing strategy that fits your timeline — we&apos;ll help you set an asking
        price next.
      </p>
    </div>
  )
}

function StatsStrip({ aiEstimate, aiLow, aiHigh, pricePerSqm, sqm, confidence }) {
  const conf = CONFIDENCE_STYLES[confidence] || CONFIDENCE_STYLES.medium
  return (
    <div className="mb-5 grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div className="px-4 py-3">
        <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
          <Cpu className="h-2.5 w-2.5" aria-hidden />
          <span>AI fair value</span>
        </div>
        <div className="font-mono text-[17px] font-bold tabular-nums tracking-tight text-foreground">
          {formatPrice(aiEstimate)}
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-muted-foreground">
          Range {sgdK(aiLow)} – {sgdK(aiHigh)}
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
          <Ruler className="h-2.5 w-2.5" aria-hidden />
          <span>Price per sqm</span>
        </div>
        <div className="font-mono text-[17px] font-bold tabular-nums tracking-tight text-foreground">
          ${Math.round(Number(pricePerSqm) || 0).toLocaleString('en-SG')}
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-muted-foreground">
          Based on {sqm} sqm
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
          <Gauge className="h-2.5 w-2.5" aria-hidden />
          <span>Confidence</span>
        </div>
        <div
          className={cn(
            'font-mono text-[17px] font-bold tabular-nums tracking-tight',
            conf.valueColor
          )}
        >
          {conf.label}
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-muted-foreground">
          {conf.sub}
        </div>
      </div>
    </div>
  )
}

function PricingStrategy({ strategy, aiEstimate, onSelectPrice }) {
  const { id, title, desc, price, timeframe, recommended } = strategy
  const styles = STRATEGY_STYLES[id] || STRATEGY_STYLES.conservative
  const Icon = styles.Icon

  const deltaPct = aiEstimate
    ? ((Number(price) - Number(aiEstimate)) / Number(aiEstimate)) * 100
    : 0
  const deltaText =
    Math.abs(deltaPct) < 0.5
      ? 'At fair value'
      : `${deltaPct > 0 ? '+' : '−'}${Math.abs(deltaPct).toFixed(1)}% vs fair value`

  const clickable = typeof onSelectPrice === 'function'
  const Wrapper = clickable ? 'button' : 'div'

  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={clickable ? () => onSelectPrice(price, strategy) : undefined}
      aria-label={clickable ? `Use ${title}: ${formatPrice(price)}` : undefined}
      className={cn(
        'group grid w-full grid-cols-[38px_1fr_auto] items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors sm:gap-4',
        clickable &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
        recommended
          ? 'border-[1.5px] border-emerald-600 bg-gradient-to-b from-emerald-50/70 to-card shadow-[0_0_0_4px_theme(colors.emerald.500/0.08)] hover:from-emerald-50 dark:border-emerald-500 dark:from-emerald-950/30'
          : 'border-border bg-card hover:bg-muted/40'
      )}
    >
      <div
        className={cn(
          'flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border',
          styles.iconBg
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-[14.5px] font-bold tracking-tight text-foreground">
            {title}
          </span>
          {recommended && (
            <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Recommended
            </span>
          )}
        </div>
        <p className="mt-0.5 max-w-[460px] text-[12px] font-medium leading-snug text-slate-500 dark:text-muted-foreground">
          {desc}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right">
        <div>
          <div
            className={cn(
              'font-mono text-[19px] font-extrabold tabular-nums tracking-tight',
              recommended ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'
            )}
          >
            {formatPrice(price)}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-muted-foreground">
            {deltaText} · {timeframe}
          </div>
        </div>
        {clickable && (
          <ArrowRight
            className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        )}
      </div>
    </Wrapper>
  )
}

function CardFooter({ onSeeFullAnalysis, onContinue }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-border pt-5">
      {typeof onSeeFullAnalysis === 'function' ? (
        <button
          type="button"
          onClick={onSeeFullAnalysis}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 underline underline-offset-4 transition-colors hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          <span>See what drives this number</span>
        </button>
      ) : (
        <span />
      )}
      {typeof onContinue === 'function' && (
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-1.5 rounded-[0.625rem] bg-emerald-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          <span>Continue to set asking price</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function SellerPriceRecommendationCard({
  property,
  aiEstimate,
  aiLow,
  aiHigh,
  townTrendPct,
  suggestedListPrice,
  pricePerSqm,
  confidence = 'medium',
  onSeeFullAnalysis,
  onContinue,
  onSelectPrice
}) {
  const strategies = useMemo(() => {
    const trendPhrase =
      townTrendPct != null && property?.area
        ? `Fair value + ${property.area} ${townTrendPct >= 0 ? '+' : ''}${townTrendPct}% trend.`
        : 'Anchored to fair value with a modest premium.'
    return [
      {
        id: 'conservative',
        title: 'Price to sell fast',
        desc:
          'List at or slightly below fair value. Attracts strong interest and typically sells quickest.',
        price: Math.round(Number(aiEstimate) * 0.99),
        timeframe: '~2–4 weeks'
      },
      {
        id: 'recommended',
        title: 'Balance price and time',
        desc: `${trendPhrase} Strong price with reasonable room to negotiate.`,
        price: Number(suggestedListPrice) || Math.round(Number(aiEstimate) * 1.03),
        timeframe: '~4–8 weeks',
        recommended: true
      },
      {
        id: 'ambitious',
        title: 'Hold out for more',
        desc:
          'Price near the top of the confidence band. May take longer to attract a buyer willing to match.',
        price: Math.round(Number(aiHigh) * 0.99),
        timeframe: '~2–4 months'
      }
    ]
  }, [aiEstimate, aiHigh, suggestedListPrice, property?.area, townTrendPct])

  if (!aiEstimate) return null

  return (
    <div className="w-full rounded-2xl border border-border bg-card p-5 text-foreground shadow-sm sm:p-6">
      <SellerCardHeader property={property} />

      <RecommendationIntro
        aiEstimate={aiEstimate}
        area={property?.area}
        townTrendPct={townTrendPct}
      />

      <StatsStrip
        aiEstimate={aiEstimate}
        aiLow={aiLow}
        aiHigh={aiHigh}
        pricePerSqm={pricePerSqm}
        sqm={property?.sqm}
        confidence={confidence}
      />

      <div className="mb-4 flex flex-col gap-2.5">
        {strategies.map((s) => (
          <PricingStrategy
            key={s.id}
            strategy={s}
            aiEstimate={aiEstimate}
            onSelectPrice={onSelectPrice}
          />
        ))}
      </div>

      <CardFooter onSeeFullAnalysis={onSeeFullAnalysis} onContinue={onContinue} />
    </div>
  )
}

// Named exports so the card's pieces can be re-used elsewhere if needed.
export {
  SellerCardHeader,
  RecommendationIntro,
  StatsStrip,
  PricingStrategy,
  CardFooter
}
