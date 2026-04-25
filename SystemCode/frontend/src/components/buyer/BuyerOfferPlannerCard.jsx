/**
 * BuyerOfferPlannerCard — Step 5 of the Buyer flow ("Plan your offer")
 *
 * Replaces the old `buildNegotiationGuide()` 3-tile + boilerplate notes block.
 * Mirrors the seller's OfferHandlerCard shape, flipped for the buyer's
 * decision: how much should I OFFER for this listing?
 *
 * Bands (anchored to AI fair value + recent comps, NOT to asking — asking is
 *       only used as a soft cap on the walk-away):
 *   opening   = round100( min(predicted × 0.95, cbrMedian × 0.97, asking × 0.97) )
 *   target    = round100( min(predicted, cbrMedian + 5k, asking) )
 *   walkAway  = round100( min(asking, max(predicted × 1.03, cbrMedian × 1.05)) )
 *
 *   asking-cap on `walkAway` so we never tell the buyer to pay above the
 *   listed price. asking-cap on `target` so an undervalued listing collapses
 *   the bands cleanly into a "snap it up" recommendation.
 *
 * Live verdict semantics (the buyer types their PLANNED offer):
 *   < opening              → ⚠️ Too low — risk of seller dismissing.
 *   opening..target        → 🟢 Solid — at or below fair value.
 *   target..walkAway       → 🟡 Stretch — defensible but tight.
 *   ≥ walkAway             → 🔴 Stop — paying above the evidence.
 *
 * Plus an "Evidence pack" (citations the buyer can use in the conversation)
 * and "When the seller pushes back" objection cards.
 */

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  CircleAlert,
  CircleCheck,
  HandCoins,
  Info,
  ShieldAlert,
  Target,
  Trophy
} from 'lucide-react'

import { cn } from '@/lib/utils'

// ── Pure helpers ──────────────────────────────────────────────────────────

const round100 = (n) => Math.round(Number(n) / 100) * 100

const fmtFull = (n) =>
  Number.isFinite(Number(n))
    ? `S$${Math.round(Number(n)).toLocaleString('en-SG')}`
    : '—'

const fmtK = (n) => {
  if (!Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1_000_000) return `S$${(v / 1_000_000).toFixed(2)}M`
  return `S$${Math.round(v / 1000)}k`
}

const fmtPct = (a, b) => {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || b <= 0) return '—'
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`
}

function computeBands(asking, predicted, cbrMedian) {
  const ask = Number(asking)
  const ai = Number(predicted)
  if (!Number.isFinite(ask) || ask <= 0 || !Number.isFinite(ai) || ai <= 0) return null
  const cbr = Number.isFinite(Number(cbrMedian)) && cbrMedian > 0 ? Number(cbrMedian) : null

  // Anchor on the lowest defensible figure across the available evidence.
  const evidenceFloor = Math.min(ai * 0.95, (cbr ?? ai) * 0.97)
  const opening = round100(Math.min(evidenceFloor, ask * 0.97))
  // Target capped at asking so undervalued listings collapse cleanly.
  const target = round100(Math.min(ai, (cbr ?? ai) + 5000, ask))
  // Walk-away never exceeds the listed price (don't pay above ask).
  const walkAway = round100(Math.min(ask, Math.max(ai * 1.03, (cbr ?? ai) * 1.05)))

  return {
    asking: ask,
    predicted: ai,
    cbrMedian: cbr,
    opening,
    target,
    walkAway,
    rows: [
      {
        id: 'opening',
        Icon: HandCoins,
        tone: 'sky',
        title: 'Opening offer',
        valueText: fmtFull(opening),
        rationale: cbr
          ? `Anchored on AI fair value − 5% and the median of ${comparablesNoun(cbr)} recent comps.`
          : 'Anchored on AI fair value − 5%.',
        tail: 'Sellers typically counter +2-5% — leaves room.'
      },
      {
        id: 'target',
        Icon: Target,
        tone: 'emerald',
        title: 'Target close',
        valueText: fmtFull(target),
        rationale: cbr
          ? `AI fair value, capped at the comp band + asking.`
          : 'AI fair value — defensible by model.',
        tail: 'You\'d be happy to close here.'
      },
      {
        id: 'walkAway',
        Icon: ShieldAlert,
        tone: 'rose',
        title: 'Walk-away ceiling',
        valueText: fmtFull(walkAway),
        rationale: cbr
          ? 'Higher of AI × 1.03 and comps median × 1.05, capped at asking.'
          : 'AI × 1.03, capped at the listed price.',
        tail: 'Above this you\'re paying more than evidence supports.'
      }
    ]
  }
}

// Tiny grammar helper for the rationale.
function comparablesNoun(n) {
  const v = Number(n)
  return Number.isFinite(v) ? 'recent' : 'recent'
}

function classifyOffer(offer, bands) {
  if (!bands || !Number.isFinite(Number(offer))) return null
  const o = Number(offer)
  if (o < bands.opening) {
    return {
      id: 'tooLow',
      Icon: CircleAlert,
      tone: 'amber',
      title: 'Possibly too low',
      action:
        'Risk of being dismissed without counter. Consider opening at the recommended figure to keep the conversation alive.'
    }
  }
  if (o < bands.target) {
    return {
      id: 'solid',
      Icon: CircleCheck,
      tone: 'emerald',
      title: 'Solid offer',
      action:
        'At or below fair value. Anchor on the comps + AI estimate; stay calm if the seller counters.'
    }
  }
  if (o < bands.walkAway) {
    return {
      id: 'stretch',
      Icon: CircleAlert,
      tone: 'amberStrong',
      title: 'Stretch offer',
      action:
        'Defensible but tight — counter once first if you can. Lock in only if the listing is unique or you have time pressure.'
    }
  }
  return {
    id: 'stop',
    Icon: ShieldAlert,
    tone: 'rose',
    title: 'Above your walk-away — stop',
    action:
      'Paying more than the evidence (AI band + recent comps) supports. Consider walking away or returning to your target.'
  }
}

const TONE = {
  sky: {
    panel: 'border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30',
    chip: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
    accent: 'text-sky-700 dark:text-sky-300'
  },
  emerald: {
    panel: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30',
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
    accent: 'text-emerald-700 dark:text-emerald-400'
  },
  amber: {
    panel: 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30',
    chip: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
    accent: 'text-amber-700 dark:text-amber-300'
  },
  amberStrong: {
    panel: 'border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/40',
    chip: 'bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-800',
    accent: 'text-amber-800 dark:text-amber-200'
  },
  rose: {
    panel: 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30',
    chip: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
    accent: 'text-rose-700 dark:text-rose-300'
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function PriceContext({ asking, predicted }) {
  const delta = fmtPct(asking, predicted)
  const isOver = Number(asking) > Number(predicted) * 1.005
  const isUnder = Number(asking) < Number(predicted) * 0.995
  const verdict = isOver ? 'Above market' : isUnder ? 'Below market' : 'At market'
  const verdictTone = isOver
    ? 'text-amber-700 dark:text-amber-300'
    : isUnder
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-foreground'

  return (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-3 sm:grid-cols-3">
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
          Asking price
        </p>
        <p className="font-mono text-[18px] font-extrabold tabular-nums text-foreground">
          {fmtFull(asking)}
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
          Listing is
        </p>
        <p className={cn('font-mono text-[18px] font-extrabold tabular-nums', verdictTone)}>
          {delta}
        </p>
        <p className="text-[10px] text-slate-500 dark:text-muted-foreground">{verdict}</p>
      </div>
    </div>
  )
}

const OfferInput = forwardRef(function OfferInput({ value, onChange }, ref) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
        Your planned offer
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
          placeholder="What you intend to offer"
          className="w-full border-none bg-transparent pl-9 font-display text-[26px] font-extrabold tabular-nums tracking-tight text-foreground outline-none placeholder:font-sans placeholder:text-[14px] placeholder:font-medium placeholder:text-slate-400"
        />
      </div>
    </div>
  )
})

function LiveVerdict({ offer, verdict, bands }) {
  if (!verdict) return null
  const tone = TONE[verdict.tone] || TONE.emerald
  const Icon = verdict.Icon
  const deltaVsAsk = fmtPct(offer, bands.asking)
  const deltaVsAi = fmtPct(offer, bands.predicted)
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
              {verdict.title}
            </span>
            <span className="font-mono text-[15px] font-extrabold tabular-nums text-foreground">
              {fmtFull(offer)}
            </span>
            <span className="text-[11.5px] text-slate-600 dark:text-muted-foreground">
              {deltaVsAsk} vs ask · {deltaVsAi} vs AI
            </span>
          </div>
          <p className="mt-1 font-display text-[14px] font-semibold leading-snug text-foreground">
            {verdict.action}
          </p>
        </div>
      </div>
    </div>
  )
}

function ThreePlan({ bands, activeBandId }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
          Your three-number plan
        </p>
        <p className="text-[11px] text-slate-500 dark:text-muted-foreground">
          Anchored on AI fair value and recent comps. Asking caps the walk-away
          (you never pay above the listed price).
        </p>
      </div>
      <ul className="divide-y divide-border">
        {bands.rows.map((row) => {
          const tone = TONE[row.tone] || TONE.emerald
          const isActive = activeBandId === row.id
          const Icon = row.Icon
          return (
            <li
              key={row.id}
              className={cn(
                'grid grid-cols-[28px_minmax(0,0.9fr)_minmax(0,1.4fr)] items-start gap-3 px-4 py-2.5 transition-colors',
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
                      aria-label="matches your planned offer"
                    />
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[14px] font-extrabold tabular-nums text-foreground">
                  {row.valueText}
                </p>
              </div>
              <div className="text-[12px] leading-snug text-slate-700 dark:text-slate-200">
                <p>{row.rationale}</p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-muted-foreground">
                  {row.tail}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function EvidencePack({ asking, predicted, cbrMedian, comparables, driverCards }) {
  const items = useMemo(() => {
    const out = []

    // 1. AI fair value with what drives it
    const topDriver = (driverCards || []).find(
      (d) => Math.abs(Number(d.shap || d.local_shap || d.shap_value || 0)) > 0
    )
    const driverPhrase = topDriver
      ? ` Top driver: ${(topDriver.label || topDriver.feature || '').toLowerCase()}.`
      : ''
    if (Number.isFinite(Number(predicted))) {
      out.push(`AI fair value: ${fmtFull(predicted)}.${driverPhrase}`)
    }

    // 2. CBR median if present
    if (Number.isFinite(Number(cbrMedian)) && cbrMedian > 0 && Array.isArray(comparables)) {
      const tu = (
        comparables[0]?.town ||
        ''
      ).toString().toUpperCase()
      const sameTown = comparables.filter(
        (c) => String(c?.town || '').toUpperCase() === tu
      )
      const note = sameTown.length >= 2
        ? `Median of ${comparables.length} recent comparable sales is ${fmtFull(cbrMedian)} (${sameTown.length} in-town).`
        : `Median of ${comparables.length} recent comparable sales is ${fmtFull(cbrMedian)}.`
      out.push(note)
    }

    // 3. Most recent comp with price + when
    const sortedByYear = (comparables || [])
      .slice()
      .sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0))
    const recent = sortedByYear[0]
    if (recent && Number.isFinite(Number(recent.resale_price))) {
      const monthBit = recent.month
        ? ` (${String(recent.month).padStart(2, '0')}/${recent.year})`
        : recent.year
        ? ` (${recent.year})`
        : ''
      const addrBit = recent.address_short || recent.street_name || 'A nearby flat'
      out.push(`${addrBit} sold at ${fmtFull(recent.resale_price)}${monthBit}.`)
    }

    // 4. Listing premium / discount vs AI
    if (Number.isFinite(Number(asking)) && Number.isFinite(Number(predicted)) && predicted > 0) {
      const pct = ((asking - predicted) / predicted) * 100
      if (Math.abs(pct) >= 1) {
        const dir = pct > 0 ? 'above' : 'below'
        out.push(
          `Listing is ${Math.abs(pct).toFixed(1)}% ${dir} the AI band — useful to ${
            pct > 0 ? 'cite when negotiating down' : 'flag the deal'
          }.`
        )
      }
    }

    return out.slice(0, 4)
  }, [asking, predicted, cbrMedian, comparables, driverCards])

  if (items.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Info className="h-4 w-4 shrink-0 text-slate-500 dark:text-muted-foreground" aria-hidden />
        <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
          Evidence to anchor your offer
        </p>
      </div>
      <ul className="divide-y divide-border">
        {items.map((it, i) => (
          <li
            key={i}
            className="px-4 py-2 text-[12.5px] leading-snug text-slate-700 dark:text-slate-200"
          >
            • {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ObjectionHandlers({ asking, predicted, cbrMedian, comparables, bands, leaseYears }) {
  const items = useMemo(() => {
    const out = []

    // Above-AI listing: seller will defend the asking
    if (
      Number.isFinite(Number(asking)) &&
      Number.isFinite(Number(predicted)) &&
      asking > predicted * 1.01
    ) {
      const cite = Number.isFinite(Number(cbrMedian))
        ? ` recent comps median is ${fmtFull(cbrMedian)}`
        : ''
      out.push({
        objection: '"My asking is firm — that\'s what the market supports."',
        response: `The AI fair value is ${fmtFull(predicted)};${cite}. My offer reflects what comparable flats actually sold at.`
      })
    }

    // Multiple-bidders pressure
    out.push({
      objection: '"There are multiple interested buyers."',
      response: bands?.walkAway != null
        ? `That may be true, but my walk-away is ${fmtFull(bands.walkAway)}. Above that I'd be paying more than the evidence supports.`
        : `If true, fine — but I'm not chasing above the AI band. Happy to leave my offer on the table for 24 hours.`
    })

    // Renovation premium
    out.push({
      objection: '"It\'s newly renovated."',
      response:
        'I\'ll need to see the renovation receipts. Standard depreciation caps the recoverable premium at roughly 30% of cost — happy to revise if it checks out.'
    })

    // Short-lease objection (counter the seller's "lease is fine" angle)
    if (Number.isFinite(Number(leaseYears)) && Number(leaseYears) < 70) {
      out.push({
        objection: '"The lease isn\'t a problem."',
        response: `${Math.round(leaseYears)} years remaining is below the 70-year mark — bank LTV starts to taper, and the AI fair value already prices the lease decay in.`
      })
    } else {
      // Generic AI-backed comeback
      out.push({
        objection: '"Why not match the asking price?"',
        response: `Asking is ${fmtPct(asking, predicted)} vs the AI fair value. I'm willing to meet near the model midpoint, which is closer to what comparable flats actually sold at.`
      })
    }

    return out.slice(0, 4)
  }, [asking, predicted, cbrMedian, comparables, bands, leaseYears])

  if (items.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Info className="h-4 w-4 shrink-0 text-slate-500 dark:text-muted-foreground" aria-hidden />
        <p className="font-display text-[13px] font-bold tracking-tight text-foreground">
          When the seller pushes back
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

const BuyerOfferPlannerCard = forwardRef(function BuyerOfferPlannerCard(
  {
    asking,
    predicted,
    cbrMedian,
    comparables,
    driverCards,
    leaseYears
  },
  externalRef
) {
  const inputRef = useRef(null)
  useImperativeHandle(externalRef, () => ({
    focusInput() {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }))

  const [offer, setOffer] = useState(null)
  const bands = useMemo(
    () => computeBands(asking, predicted, cbrMedian),
    [asking, predicted, cbrMedian]
  )
  const verdict = useMemo(() => classifyOffer(offer, bands), [offer, bands])

  if (!bands) {
    return (
      <p className="text-xs text-muted-foreground">
        Add the seller&apos;s asking price above to unlock your offer plan.
      </p>
    )
  }

  // Map the verdict to one of the three plan rows so the trophy can land.
  const activeBandId =
    verdict?.id === 'solid'
      ? 'opening'
      : verdict?.id === 'stretch'
      ? 'target'
      : verdict?.id === 'stop'
      ? 'walkAway'
      : null

  return (
    <div className="space-y-3.5">
      <PriceContext asking={asking} predicted={predicted} />
      <OfferInput ref={inputRef} value={offer} onChange={setOffer} />
      {verdict && <LiveVerdict offer={offer} verdict={verdict} bands={bands} />}
      <ThreePlan bands={bands} activeBandId={activeBandId} />
      <EvidencePack
        asking={asking}
        predicted={predicted}
        cbrMedian={cbrMedian}
        comparables={comparables}
        driverCards={driverCards}
      />
      <ObjectionHandlers
        asking={asking}
        predicted={predicted}
        cbrMedian={cbrMedian}
        comparables={comparables}
        bands={bands}
        leaseYears={leaseYears}
      />
    </div>
  )
})

export default BuyerOfferPlannerCard

export {
  PriceContext,
  OfferInput,
  LiveVerdict,
  ThreePlan,
  EvidencePack,
  ObjectionHandlers,
  computeBands,
  classifyOffer
}
