/**
 * OfferHandlerCard — Step 6 of the Seller flow ("Got an offer?")
 *
 * Replaces the old NegotiationRange + tactics list. Reframed around the
 * seller's actual decision moment: a buyer just made an offer — what now?
 *
 * Direction 1 (offer-response cheat sheet) + Direction 3 (objection
 * handlers), anchored to the **asking price** the seller picked in step 4.
 *
 * Bands (computed from `askingPrice` + AI estimate `predicted`):
 *   walkAway       = max(predicted × 0.95, askingPrice × 0.92)
 *                    (hard floor — protects the seller in both directions)
 *   strongCutoff   = askingPrice × 0.95   (within 5% of ask)
 *   counterTarget  = round((asking + AI) / 2 to nearest $100)
 *
 * 4 bands, asking-anchored, always visible:
 *   ≥ asking            → Accept (verify financing)
 *   strongCutoff..ask   → Strong offer · counter once at counterTarget
 *   walkAway..strong    → Negotiating · counter at ~ask−2% · hold firm
 *   < walkAway          → Lowball · decline (below AI floor)
 *
 * Props
 *   askingPrice, predicted, aiLow, aiHigh   — pricing context
 *   cbrMedian, comparables                  — for objection handlers
 *   town, townTrendPct                      — for objection handlers
 *   driverCards                             — top SHAP drivers (Step 1 helper)
 *   aprioriViolated                         — for "why above AI?" objection
 *   inputRef                                — externally focusable; the
 *                                             floating CTA in SellerView
 *                                             auto-focuses this input.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  CircleAlert,
  CircleCheck,
  HandCoins,
  Info,
  ShieldAlert,
  Trophy
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/formatPrice.js'

// ── Pure helpers ──────────────────────────────────────────────────────────

const round100 = (n) => Math.round(Number(n) / 100) * 100

const fmtFull = (n) =>
  Number.isFinite(Number(n))
    ? `S$${Math.round(Number(n)).toLocaleString('en-SG')}`
    : '—'

const fmtPct = (a, b) => {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || b <= 0) return '—'
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`
}

/**
 * Counter for a Strong-band offer: midway between offer and ask, but bumped
 * up by ≥0.5% of asking so the seller is always asking for more, capped just
 * under ask so we don't suggest "match my asking" awkwardly.
 */
function strongCounterFor(offer, ask) {
  const minBump = ask * 0.005
  const midway = (offer + ask) / 2
  const ceiling = ask * 0.998
  return round100(Math.min(ceiling, Math.max(offer + minBump, midway)))
}

/**
 * Counter for a Negotiating-band offer: standard ~2% off ask, but never
 * below the offer itself.
 */
function negotiatingCounterFor(offer, ask) {
  const target = ask * 0.98
  return round100(Math.max(target, offer + ask * 0.005))
}

/**
 * Compute the 4 asking-anchored offer bands.
 * Returns null if either askingPrice or AI is missing.
 *
 * Counters are intentionally NOT baked into the cheat-sheet rows here —
 * they're computed at render-time from the actual offer (see LiveVerdict)
 * so we never recommend a counter ≤ the buyer's offer.
 */
function computeBands(askingPrice, predicted) {
  const ask = Number(askingPrice)
  const ai = Number(predicted)
  if (!Number.isFinite(ask) || ask <= 0 || !Number.isFinite(ai) || ai <= 0) return null

  // Within 1% of asking → treat as Accept; no counter needed.
  const acceptCutoff = round100(ask * 0.99)
  // Walk-away: protect the seller from caving below AI floor regardless of
  // how aggressively they listed. max() ensures whichever is higher is the floor.
  const walkAway = round100(Math.max(ai * 0.95, ask * 0.92))
  const strongCutoff = round100(ask * 0.95)

  return {
    askingPrice: ask,
    predicted: ai,
    acceptCutoff,
    walkAway,
    strongCutoff,
    rows: [
      {
        id: 'accept',
        Icon: CircleCheck,
        tone: 'emerald',
        title: 'Accept the offer',
        rangeText: `≥ ${fmtFull(acceptCutoff)}`,
        action: 'Accept · verify buyer financing & timeline before signing.'
      },
      {
        id: 'strong',
        Icon: HandCoins,
        tone: 'emeraldSoft',
        title: 'Strong offer',
        rangeText: `${fmtFull(strongCutoff)} – ${fmtFull(acceptCutoff - 1)}`,
        action:
          'Counter ONCE just above their offer, biased toward your ask; lock in if matched.'
      },
      {
        id: 'weak',
        Icon: CircleAlert,
        tone: 'amber',
        title: 'Negotiating range',
        rangeText: `${fmtFull(walkAway)} – ${fmtFull(strongCutoff - 1)}`,
        action: 'Counter near ~2% below your ask · hold firm and cite same-town comps.'
      },
      {
        id: 'decline',
        Icon: ShieldAlert,
        tone: 'rose',
        title: 'Lowball — decline',
        rangeText: `< ${fmtFull(walkAway)}`,
        action: 'Decline politely; this is below your AI floor and the typical safe walk-away.'
      }
    ]
  }
}

function bandFor(offer, bands) {
  if (!bands || !Number.isFinite(Number(offer))) return null
  const o = Number(offer)
  if (o >= bands.acceptCutoff) return bands.rows.find((r) => r.id === 'accept')
  if (o >= bands.strongCutoff) return bands.rows.find((r) => r.id === 'strong')
  if (o >= bands.walkAway) return bands.rows.find((r) => r.id === 'weak')
  return bands.rows.find((r) => r.id === 'decline')
}

/**
 * Per-offer counter recommendation. Returns null when no counter is
 * appropriate (Accept / Decline) or when the formulas can't beat the offer
 * (defensive — should never happen given strongCounterFor / negotiatingCounterFor).
 */
function counterFor(offer, band, bands) {
  if (!band || !bands || !Number.isFinite(Number(offer))) return null
  const o = Number(offer)
  const ask = bands.askingPrice
  if (band.id === 'strong') {
    const c = strongCounterFor(o, ask)
    return c > o ? c : null
  }
  if (band.id === 'weak') {
    const c = negotiatingCounterFor(o, ask)
    return c > o ? c : null
  }
  return null
}

const TONE_STYLES = {
  emerald: {
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
    panel: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30',
    accent: 'text-emerald-700 dark:text-emerald-400'
  },
  emeraldSoft: {
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900',
    panel: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20',
    accent: 'text-emerald-700 dark:text-emerald-400'
  },
  amber: {
    chip: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
    panel: 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30',
    accent: 'text-amber-700 dark:text-amber-300'
  },
  rose: {
    chip: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
    panel: 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30',
    accent: 'text-rose-700 dark:text-rose-300'
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function PriceContextHeader({ askingPrice, predicted }) {
  const deltaText = fmtPct(askingPrice, predicted)
  return (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-3 sm:grid-cols-3">
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
          Your asking price
        </p>
        <p className="font-mono text-[18px] font-extrabold tabular-nums text-foreground">
          {fmtFull(askingPrice)}
        </p>
      </div>
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
          AI fair value
        </p>
        <p className="font-mono text-[18px] font-extrabold tabular-nums text-foreground">
          {fmtFull(predicted)}
        </p>
      </div>
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
          You are
        </p>
        <p className="font-mono text-[18px] font-extrabold tabular-nums text-foreground">
          {deltaText}
        </p>
        <p className="text-[10px] text-slate-500 dark:text-muted-foreground">vs AI</p>
      </div>
    </div>
  )
}

const OfferInput = forwardRef(function OfferInput({ value, onChange }, ref) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
        Buyer's offer
      </label>
      <div className="relative rounded-2xl border-[1.5px] border-border bg-card px-4 py-3 transition-all focus-within:border-emerald-600 focus-within:shadow-[0_0_0_4px_theme(colors.emerald.500/0.12)]">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-[22px] font-bold text-slate-400 dark:text-muted-foreground">
          S$
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={value != null ? Number(value).toLocaleString('en-SG') : ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '')
            const n = parseInt(raw || '0', 10)
            onChange(Number.isFinite(n) && n > 0 ? n : null)
          }}
          placeholder="Type the amount the buyer offered"
          className="w-full border-none bg-transparent pl-9 font-display text-[26px] font-extrabold tabular-nums tracking-tight text-foreground outline-none placeholder:font-sans placeholder:text-[14px] placeholder:font-medium placeholder:text-slate-400"
        />
      </div>
    </div>
  )
})

function LiveVerdict({ offer, band, bands, drivers }) {
  if (!band) return null
  const tone = TONE_STYLES[band.tone] || TONE_STYLES.emerald
  const Icon = band.Icon
  const deltaVsAsk = fmtPct(offer, bands.askingPrice)
  const deltaVsAi = fmtPct(offer, bands.predicted)
  const counter = counterFor(offer, band, bands)
  const driverHint = useMemo(() => {
    const tops = (drivers || [])
      .filter((d) => Number(d.shap) > 0 || Number(d.local_shap) > 0)
      .slice(0, 2)
      .map((d) => (d.label || d.feature || '').toLowerCase())
      .filter(Boolean)
    if (!tops.length) return null
    return `Anchor on ${tops.join(' + ')}.`
  }, [drivers])

  // Resolve action text per-band so we can plug in the per-offer counter.
  let actionText = band.action
  if (band.id === 'accept') {
    actionText =
      'Accept · verify buyer financing & timeline before signing. No counter needed.'
  } else if (band.id === 'strong' && counter != null) {
    actionText = `Counter ONCE at ${fmtFull(counter)}; lock in if matched.`
  } else if (band.id === 'weak' && counter != null) {
    actionText = `Counter at ${fmtFull(counter)} · hold firm and cite same-town comps.`
  }

  return (
    <div className={cn('rounded-2xl border-[1.5px] px-4 py-3.5', tone.panel)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone.accent)} aria-hidden />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em]',
                tone.chip
              )}
            >
              {band.title}
            </span>
            <span className="font-mono text-[15px] font-extrabold tabular-nums text-foreground">
              {fmtFull(offer)}
            </span>
            <span className="text-[11.5px] text-slate-600 dark:text-muted-foreground">
              {deltaVsAsk} vs ask · {deltaVsAi} vs AI
            </span>
          </div>
          <p className="mt-1 font-display text-[14px] font-semibold leading-snug text-foreground">
            {actionText}
          </p>
          {(band.id === 'strong' || band.id === 'weak') && driverHint && (
            <p className="mt-0.5 text-[11.5px] text-slate-600 dark:text-muted-foreground">
              {driverHint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function CheatSheet({ bands, activeBandId }) {
  if (!bands) return null
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
          Cheat sheet
        </p>
        <p className="text-[11px] text-slate-500 dark:text-muted-foreground">
          Bands are anchored to your asking price. Walk-away is the higher of
          AI × 0.95 and ask × 0.92.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {bands.rows.map((row) => {
          const tone = TONE_STYLES[row.tone] || TONE_STYLES.emerald
          const isActive = activeBandId === row.id
          const Icon = row.Icon
          return (
            <li
              key={row.id}
              className={cn(
                'grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-3 px-4 py-2.5 transition-colors',
                isActive && 'bg-muted/30'
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.accent)} aria-hidden />
              <div className="min-w-0">
                <p
                  className={cn(
                    'font-display text-[12.5px] font-bold tracking-tight text-foreground',
                    isActive && tone.accent
                  )}
                >
                  {row.title}
                  {isActive && (
                    <Trophy
                      className="ml-1 inline h-3 w-3 text-amber-600"
                      aria-hidden
                      aria-label="matches the buyer's offer"
                    />
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[11.5px] tabular-nums text-slate-500 dark:text-muted-foreground">
                  {row.rangeText}
                </p>
              </div>
              <p className="text-[12px] leading-snug text-slate-700 dark:text-slate-200">
                {row.action}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ObjectionHandlers({
  askingPrice,
  predicted,
  comparables = [],
  town,
  townTrendPct,
  remainingLeaseYears,
  driverCards = []
}) {
  const items = useMemo(() => {
    const out = []

    // Objection 1 — "Why above AI?" (only fires if asking is meaningfully above AI)
    if (
      Number.isFinite(Number(askingPrice)) &&
      Number.isFinite(Number(predicted)) &&
      askingPrice > predicted * 1.005
    ) {
      const pct = ((askingPrice - predicted) / predicted) * 100
      const trendBit =
        townTrendPct != null && Math.abs(townTrendPct) >= 0.5
          ? ` and reflects ${town || 'this town'}'s recent ${townTrendPct >= 0 ? '+' : '−'}${Math.abs(townTrendPct).toFixed(1)}% trend`
          : ''
      out.push({
        objection: '"Why is it above the AI estimate?"',
        response: `It's a ${pct.toFixed(1)}% buffer for negotiation${trendBit}. The AI fair value (${fmtFull(predicted)}) is the model's midpoint; my ask leaves room to meet in the middle.`
      })
    } else if (
      Number.isFinite(Number(askingPrice)) &&
      Number.isFinite(Number(predicted))
    ) {
      out.push({
        objection: '"Is this in line with the market?"',
        response: `Yes — within ${Math.abs(((askingPrice - predicted) / predicted) * 100).toFixed(1)}% of the AI fair value (${fmtFull(predicted)}). Priced for a quick, fair sale rather than a lengthy negotiation.`
      })
    }

    // Objection 2 — "Lease is short"
    if (Number.isFinite(Number(remainingLeaseYears))) {
      const yrs = Math.round(Number(remainingLeaseYears))
      if (yrs < 60) {
        out.push({
          objection: '"The lease is short."',
          response: `${yrs} years remaining is in line with HDB resale norms; the AI fair value already accounts for it. Compare with the recent comps below — they share a similar lease band.`
        })
      } else {
        out.push({
          objection: '"What about the lease?"',
          response: `${yrs} years remaining — comfortably above the 60-year MOP threshold and well within bank loan limits.`
        })
      }
    }

    // Objection 3 — "Can comparables really support this price?"
    const tu = String(town || '').toUpperCase()
    const sameTown = comparables.filter(
      (c) => String(c.town || '').toUpperCase() === tu
    )
    if (sameTown.length >= 2) {
      out.push({
        objection: `"Are there really comparable sales nearby?"`,
        response: `${sameTown.length} same-town comps in the recent-sales table back this band. Happy to walk you through the price-per-sqm spread.`
      })
    } else if (comparables.length > 0) {
      out.push({
        objection: '"How do we know the price is fair?"',
        response: `${comparables.length} recent comparable sale${comparables.length === 1 ? '' : 's'} support the band — note the differences in floor area / storey before lowballing.`
      })
    }

    // Objection 4 — top SHAP driver framed as positive
    const topPositive = (driverCards || []).find(
      (d) => Number(d.shap || d.local_shap || d.shap_value || 0) > 0
    )
    if (topPositive) {
      const label = (topPositive.label || topPositive.feature || '').trim()
      const detail = topPositive.featureText ? ` (${topPositive.featureText})` : ''
      out.push({
        objection: `"What's special about this flat?"`,
        response: `${label}${detail} is the strongest driver in the model — adds the most value vs an average flat in this profile.`
      })
    }

    return out.slice(0, 4)
  }, [askingPrice, predicted, comparables, town, townTrendPct, remainingLeaseYears, driverCards])

  if (items.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Info className="h-4 w-4 shrink-0 text-slate-500 dark:text-muted-foreground" aria-hidden />
        <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
          When the buyer pushes back
        </p>
      </div>
      <ul className="divide-y divide-border">
        {items.map((it, i) => (
          <li key={i} className="px-4 py-2.5">
            <p className="text-[11.5px] font-semibold italic text-slate-600 dark:text-muted-foreground">
              {it.objection}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-foreground">
              → {it.response}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

const OfferHandlerCard = forwardRef(function OfferHandlerCard(
  {
    askingPrice,
    predicted,
    aiLow,
    aiHigh,
    cbrMedian,
    comparables,
    town,
    townTrendPct,
    remainingLeaseYears,
    driverCards,
    aprioriViolated
  },
  externalRef
) {
  const inputRef = useRef(null)

  // Expose `.focus()` so the floating CTA in SellerView can pull focus.
  useImperativeHandle(externalRef, () => ({
    focusInput() {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }))

  const [offer, setOffer] = useState(null)
  const bands = useMemo(() => computeBands(askingPrice, predicted), [askingPrice, predicted])
  const matchedBand = useMemo(() => bandFor(offer, bands), [offer, bands])

  if (!bands) {
    return (
      <p className="text-xs text-muted-foreground">
        Set an asking price in the previous step to unlock offer-handling guidance.
      </p>
    )
  }

  return (
    <div className="space-y-3.5">
      <PriceContextHeader askingPrice={askingPrice} predicted={predicted} />
      <OfferInput ref={inputRef} value={offer} onChange={setOffer} />
      {matchedBand && (
        <LiveVerdict offer={offer} band={matchedBand} bands={bands} drivers={driverCards} />
      )}
      <CheatSheet bands={bands} activeBandId={matchedBand?.id || null} />
      <ObjectionHandlers
        askingPrice={askingPrice}
        predicted={predicted}
        comparables={comparables}
        town={town}
        townTrendPct={townTrendPct}
        remainingLeaseYears={remainingLeaseYears}
        driverCards={driverCards}
      />
    </div>
  )
})

export default OfferHandlerCard

export {
  PriceContextHeader,
  OfferInput,
  LiveVerdict,
  CheatSheet,
  ObjectionHandlers,
  computeBands,
  bandFor
}
