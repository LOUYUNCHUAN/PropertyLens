import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { getModelMeta } from '@/api/client.js'
import LocationMap from '@/components/LocationMap.jsx'
import BuyerStepCard from '@/components/buyer/BuyerStepCard.jsx'
import BuyerStepProgressBar from '@/components/buyer/BuyerStepProgressBar.jsx'
import ShapComparisonCard from '@/components/buyer/ShapComparisonCard.jsx'
import BuyerEstimateInsightsV2 from '@/components/buyer/BuyerEstimateInsightsV2.jsx'
import CompositeShapPanel from '@/components/buyer/CompositeShapPanel.jsx'
import { PriceRangeCard } from '@/components/price-range-card.jsx'
import PricingCardB from '@/components/buyer/PricingCardB.jsx'
import BuyerOfferPlannerCard from '@/components/buyer/BuyerOfferPlannerCard.jsx'
import { WhatIfSlider } from '@/components/whatif/WhatIfSlider.jsx'
import {
  applyWhatIfOverrides,
  defaultSaleMonth,
  parseStoreyMid,
  remainingLeaseApprox
} from '@/lib/hybridFlatPayload.js'
import {
  formatConfidenceBandK
} from '@/lib/formatPrice.js'
import {
  verdictFromGapPct,
  gapPct,
  matchAprioriRules,
  pickBestSurrogateRule,
  humanizeConditions,
  humanizeOutcome,
  assessMatch,
  buildComparisonDrivers,
  buildNegotiationGuide
} from '@/lib/buyerExplain.js'

const fmt = (n) => `$${Math.round(n).toLocaleString()}`

/** Phrase for how close the rule-of-thumb price is to the AI estimate. */
function agreementPhrase(gapPct) {
  const g = Math.abs(Number(gapPct) || 0)
  if (g < 3) return 'in tight agreement'
  if (g <= 10) return 'broadly consistent'
  if (g <= 20) return 'noticeably different — worth a closer look'
  return 'big gap — check the driver breakdown above'
}

function getBaselineLabel(baseValue) {
  const v = Number(baseValue) || 0
  return v > 480000 ? 'Average price for similar flats' : 'Average HDB flat price'
}

function getBaselineSubLabel(baseValue) {
  const v = Number(baseValue) || 0
  return v > 480000 ? 'similar profile' : 'island-wide'
}

function getFooterText() {
  return 'Below: the 4 biggest reasons this flat costs more or less than average.'
}

function BaselineContextPanel({ baseValue, predictedPrice }) {
  const base = Number(baseValue)
  const pred = Number(predictedPrice)
  if (!Number.isFinite(base) || !Number.isFinite(pred)) return null

  const gap = pred - base
  const isAbove = gap >= 0
  const baselineLabel = getBaselineLabel(base)
  const baselineSubLabel = getBaselineSubLabel(base)
  const footerText = getFooterText()
  const formatSGD = (val) =>
    new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
      maximumFractionDigits: 0
    }).format(Math.abs(Number(val) || 0))

  return (
    <div className="mb-4 rounded-lg border border-border/40 bg-gray-50 px-4 py-3 dark:bg-muted/30">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{baselineLabel}</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {formatSGD(base)}
          </p>
          <p className="text-[10px] text-muted-foreground">{baselineSubLabel}</p>
        </div>

        <div className="flex flex-col items-center px-2">
          <p className="text-[10px] text-muted-foreground">gap</p>
          <p
            className={cn(
              'text-xs font-semibold tabular-nums',
              isAbove ? 'text-emerald-600' : 'text-foreground'
            )}
          >
            {isAbove ? '+' : '−'}
            {formatSGD(gap)}
          </p>
          <p className="text-sm text-muted-foreground">→</p>
        </div>

        <div className="text-right">
          <p className="text-xs text-muted-foreground">This flat&apos;s estimate</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {formatSGD(pred)}
          </p>
          <p
            className={cn(
              'text-[10px] font-medium',
              isAbove ? 'text-emerald-600' : 'text-muted-foreground'
            )}
          >
            {isAbove ? '↑ Above average' : '↓ Below average'}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {footerText}
      </p>
    </div>
  )
}

/**
 * Base payload for what-if. We INTENTIONALLY keep block/street/sale_month so
 * the backend stays on the feature-table path — that guarantees POI features
 * (highway dist, mall access, school quality, …) match the main prediction.
 * locationContext is no longer needed for the what-if path, but we leave it
 * as an accepted arg for API parity with previous callers.
 */
function buildWhatIfBase(fullFlatPayload /*, locationContext */) {
  if (!fullFlatPayload || typeof fullFlatPayload !== 'object') return null
  return fullFlatPayload
}

function WhatIfTool({ originalFlat, originalPrediction, locationContext }) {
  const whatIfBase = useMemo(
    () => buildWhatIfBase(originalFlat, locationContext),
    [originalFlat, locationContext]
  )

  const origArea = Number(originalFlat?.floor_area_sqm)
  const origLease = Number(originalFlat?.remaining_lease_years)
  const origFloor = Number(originalFlat?.storey_mid)

  const [floorArea, setFloorArea] = useState(origArea)
  const [lease, setLease] = useState(origLease)
  const [floorLevel, setFloorLevel] = useState(origFloor)

  const [modifiedPrice, setModifiedPrice] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const debounceRef = useRef(null)

  useEffect(() => {
    setFloorArea(origArea)
    setLease(origLease)
    setFloorLevel(origFloor)
    setModifiedPrice(null)
    setIsLoading(false)
  }, [origArea, origLease, origFloor])

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const runWhatIf = useCallback(
    (area, leaseYrs, floor) => {
      if (!whatIfBase) return
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(async () => {
        setIsLoading(true)
        try {
          const payload = applyWhatIfOverrides(whatIfBase, {
            storey_mid: floor,
            remaining_lease_years: leaseYrs,
            floor_area_sqm: area
          })
          if (!payload) return
          const r = await fetch('/api/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          const d = await r.json()
          setModifiedPrice(d?.predicted_price ?? null)
        } catch (e) {
          console.error('What-if prediction failed:', e)
        } finally {
          setIsLoading(false)
        }
      }, 400)
    },
    [whatIfBase]
  )

  const basePred = Number(originalPrediction)
  if (!whatIfBase || !Number.isFinite(basePred)) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        What-if tool unavailable for this estimate.
      </p>
    )
  }

  const isModified =
    floorArea !== origArea || lease !== origLease || floorLevel !== origFloor
  const displayPrice = modifiedPrice ?? basePred
  const delta = modifiedPrice != null ? Math.round(Number(modifiedPrice) - basePred) : 0

  const formatSGD = (v) =>
    new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
      maximumFractionDigits: 0
    }).format(Math.abs(Number(v) || 0))

  const handleReset = () => {
    setFloorArea(origArea)
    setLease(origLease)
    setFloorLevel(origFloor)
    setModifiedPrice(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-gray-50 px-4 py-3 dark:bg-muted/30">
        <div className="min-w-[110px]">
          <p className="text-xs text-muted-foreground">Base estimate</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {formatSGD(basePred)}
          </p>
        </div>

        <div className="min-w-[110px] px-2 text-center">
          <p className="text-xs text-muted-foreground">difference</p>
          {isLoading ? (
            <p className="text-sm font-bold tabular-nums text-muted-foreground animate-pulse">
              …
            </p>
          ) : isModified ? (
            <p
              className={cn(
                'text-sm font-bold tabular-nums',
                delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {delta > 0 ? '+' : delta < 0 ? '−' : ''}
              {formatSGD(delta)}
            </p>
          ) : (
            <p className="text-sm font-bold tabular-nums text-muted-foreground/60">—</p>
          )}
        </div>

        <div className="min-w-[110px] text-right">
          <p className="text-xs text-muted-foreground">Modified estimate</p>
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              isLoading ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {formatSGD(displayPrice)}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Drag any slider to see how the estimate would change.
      </p>

      <WhatIfSlider
        icon="📐"
        label="Floor area"
        value={floorArea}
        min={Math.max(40, origArea - 20)}
        max={Math.min(200, origArea + 40)}
        step={5}
        originalValue={origArea}
        hint="What if I found a bigger unit nearby?"
        onChange={(val) => {
          setFloorArea(val)
          runWhatIf(val, lease, floorLevel)
        }}
        formatValue={(v) => `${Math.round(v)} sqm`}
      />

      <WhatIfSlider
        icon="📅"
        label="Remaining lease"
        value={lease}
        min={Math.max(30, origLease - 15)}
        max={Math.min(99, origLease + 20)}
        step={1}
        originalValue={origLease}
        hint="What if the lease were longer?"
        onChange={(val) => {
          setLease(val)
          runWhatIf(floorArea, val, floorLevel)
        }}
        formatValue={(v) => `${Math.round(v)} yrs`}
      />

      <WhatIfSlider
        icon="🏢"
        label="Floor level"
        value={floorLevel}
        min={2}
        max={25}
        step={1}
        originalValue={origFloor}
        hint="What if I went for a higher floor?"
        onChange={(val) => {
          setFloorLevel(val)
          runWhatIf(floorArea, lease, val)
        }}
        formatValue={(v) => `Floor ${Math.round(v)}`}
      />

      <button
        type="button"
        onClick={handleReset}
        aria-hidden={!isModified}
        tabIndex={isModified ? 0 : -1}
        className={cn(
          'text-left text-xs text-emerald-600 hover:underline transition-opacity',
          isModified ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        ↩ Reset to your flat&apos;s values
      </button>

      <div
        className={cn(
          'rounded-lg border border-border/40 bg-gray-50 px-4 py-3 transition-opacity dark:bg-muted/30',
          isModified ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden={!isModified}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">💡 </span>A flat with {Math.round(floorArea)} sqm,{' '}
          {Math.round(lease)}-year lease on floor {Math.round(floorLevel)} in this area would
          cost roughly{' '}
          <span className="font-semibold text-foreground tabular-nums">
            {formatSGD(modifiedPrice ?? basePred)}
          </span>
          {' — '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              delta > 0 ? 'text-emerald-600' : 'text-foreground'
            )}
          >
            {delta > 0
              ? `+${formatSGD(delta)} more`
              : delta < 0
                ? `${formatSGD(Math.abs(delta))} less`
                : 'the same'}
          </span>{' '}
          than this listing.
        </p>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Estimates use the same AI model as the main prediction. Location and amenity data remain
        fixed — only the attributes you adjust are changed.
      </p>
    </div>
  )
}

function toTitle(str) {
  return String(str || '')
    .split(' ')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')
}

function nearbyAmenitySummary(nearby) {
  if (!nearby || typeof nearby !== 'object') return 'Map loads after estimate'
  const mrt =
    (Array.isArray(nearby.mrt) ? nearby.mrt.length : 0) +
    (Array.isArray(nearby.lrt) ? nearby.lrt.length : 0)
  const schools = Array.isArray(nearby.school) ? nearby.school.length : 0
  const hawker = Array.isArray(nearby.hawker) ? nearby.hawker.length : 0
  const mall = Array.isArray(nearby.mall) ? nearby.mall.length : 0
  if (mrt + schools + hawker + mall === 0) return 'No POIs in range yet'
  const parts = []
  if (mrt) parts.push(`${mrt} MRT/LRT`)
  if (schools) parts.push(`${schools} schools`)
  if (hawker) parts.push(`${hawker} hawkers`)
  if (mall) parts.push(`${mall} malls`)
  return parts.join(' · ')
}

const spectrumTip =
  'pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[min(240px,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2 text-left text-[10px] leading-snug text-popover-foreground shadow-md opacity-0 ring-1 ring-border/50 transition-opacity duration-150 dark:bg-popover'

function VerdictSpectrumBar({
  listing,
  predicted,
  low,
  high,
  cbrMedian
}) {
  const allPrices = [low, predicted, high, listing, cbrMedian].filter(
    (x) => x != null && Number.isFinite(x)
  )
  const rangeMin = Math.min(...allPrices) * 0.92
  const rangeMax = Math.max(...allPrices) * 1.08
  const span = rangeMax - rangeMin || 1
  const pct = (p) => Math.max(0, Math.min(100, ((p - rangeMin) / span) * 100))
  const fmtK = (n) => `S$${Math.round(Number(n) / 1000)}k`
  const fmtFull = (n) => `$${Math.round(Number(n)).toLocaleString()}`
  const listingTick = pct(listing)
  const bandLeft = pct(low)
  const bandWidth = Math.max(0.5, pct(high) - pct(low))

  const markerWrap =
    'absolute top-1/2 z-20 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-default items-center justify-center rounded-md outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  return (
    <div className="mt-4 rounded-lg bg-muted/30 p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Price spectrum
      </p>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-2 border-b border-border/60 pb-3 text-[10px] text-muted-foreground dark:border-border">
        <li className="flex min-w-0 max-w-full items-start gap-1.5">
          <span
            className="mt-0.5 h-2 w-0.5 shrink-0 rounded-sm bg-primary"
            aria-hidden
          />
          <span>
            <span className="font-semibold text-foreground">AI</span> — Hybrid
            model fair value estimate.
          </span>
        </li>
        <li className="flex min-w-0 max-w-full items-start gap-1.5">
          <span
            className="mt-0.5 h-2 w-1 shrink-0 rounded-sm bg-foreground"
            aria-hidden
          />
          <span>
            <span className="font-semibold text-foreground">AP</span> — Listing
            asking price.
          </span>
        </li>
        {cbrMedian != null && (
          <li className="flex min-w-0 max-w-full items-start gap-1.5">
            <span
              className="mt-0.5 h-2 w-0.5 shrink-0 rounded-sm bg-sky-500"
              aria-hidden
            />
            <span>
              <span className="font-semibold text-sky-600 dark:text-sky-400">
                CBR
              </span>{' '}
              — Median from recent comparable sales.
            </span>
          </li>
        )}
        <li className="flex min-w-0 max-w-full items-start gap-1.5">
          <span
            className="mt-0.5 h-2 w-4 shrink-0 rounded-sm bg-emerald-200/90 dark:bg-emerald-500/45"
            aria-hidden
          />
          <span>
            <span className="font-semibold text-foreground">Band</span> — AI
            confidence interval (floor to ceiling).
          </span>
        </li>
      </ul>

      <div className="relative px-1 pb-1 pt-8">
        <div className="relative h-2 rounded-full bg-border">
          <div
            className="group/band absolute top-1/2 z-10 flex h-9 -translate-y-1/2 cursor-default items-center rounded-sm outline-none focus-within:ring-2 focus-within:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
            tabIndex={0}
            role="img"
            aria-label={`AI confidence band from ${fmtFull(low)} to ${fmtFull(high)}`}
          >
            <div className="h-2 w-full rounded-full bg-emerald-200/80 transition-[filter] group-hover/band:brightness-95 dark:bg-emerald-500/35 dark:group-hover/band:brightness-110" />
            <span
              className={cn(
                spectrumTip,
                'group-hover/band:opacity-100 group-focus-within/band:opacity-100'
              )}
            >
              <span className="font-semibold text-foreground">Band</span>
              <br />
              AI confidence range (floor–ceiling).
              <br />
              <span className="tabular-nums text-muted-foreground">
                {fmtFull(low)} – {fmtFull(high)}
              </span>
            </span>
          </div>

          {cbrMedian != null && (
            <div
              className={cn(markerWrap, 'group/cbr')}
              style={{ left: `${pct(cbrMedian)}%` }}
              tabIndex={0}
              role="img"
              aria-label={`CBR median ${fmtFull(cbrMedian)}`}
            >
              <span
                className={cn(
                  spectrumTip,
                  'group-hover/cbr:opacity-100 group-focus-within/cbr:opacity-100'
                )}
              >
                <span className="font-semibold text-sky-600 dark:text-sky-400">
                  CBR
                </span>
                <br />
                Median of comparable sales.
                <br />
                <span className="tabular-nums text-muted-foreground">
                  {fmtFull(cbrMedian)}
                </span>
              </span>
              <div className="h-3 w-0.5 rounded-sm bg-sky-500" />
            </div>
          )}

          <div
            className={cn(markerWrap, 'group/ai')}
            style={{ left: `${pct(predicted)}%` }}
            tabIndex={0}
            role="img"
            aria-label={`AI estimate ${fmtFull(predicted)}`}
          >
            <span
              className={cn(
                spectrumTip,
                'group-hover/ai:opacity-100 group-focus-within/ai:opacity-100'
              )}
            >
              <span className="font-semibold text-primary">AI</span>
              <br />
              Hybrid model fair value.
              <br />
              <span className="tabular-nums text-muted-foreground">
                {fmtFull(predicted)}
              </span>
            </span>
            <div className="h-4 w-0.5 rounded-sm bg-primary" />
          </div>

          <div
            className={cn(markerWrap, 'group/ap')}
            style={{ left: `${listingTick}%` }}
            tabIndex={0}
            role="img"
            aria-label={`Asking price ${fmtFull(listing)}`}
          >
            <span
              className={cn(
                spectrumTip,
                'group-hover/ap:opacity-100 group-focus-within/ap:opacity-100'
              )}
            >
              <span className="font-semibold text-foreground">AP</span>
              <br />
              Listing asking price.
              <br />
              <span className="tabular-nums text-muted-foreground">
                {fmtFull(listing)}
              </span>
            </span>
            <div className="h-4 w-1 rounded-sm bg-foreground" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Floor {fmtK(low)}</span>
        {cbrMedian != null && (
          <span className="text-sky-600 dark:text-sky-400">
            CBR {fmtK(cbrMedian)}
          </span>
        )}
        <span className="text-emerald-800 dark:text-emerald-400">
          AI {fmtK(predicted)}
        </span>
        <span className="font-medium text-foreground">AP {fmtK(listing)}</span>
      </div>
    </div>
  )
}

export default function BuyerEstimateInsights({
  resultsKey = 0,
  prediction,
  shap,
  globalShapImportance = {},
  cbr,
  flatForm,
  savedFlatPayload,
  comparables = [],
  listingAmount,
  setListingAmount,
  listingInput,
  setListingInput,
  rules,
  saleMonthLabel,
  geocodeResult,
  nearbyResult,
  mapTown,
  mapFlatType,
  mapFloorArea,
  mapStoreyRange,
  mapLeaseCommence,
  mapSaleMonth,
  // Bumped by BuyerView's floating "Plan your offer" CTA. Each tick opens
  // step 5 (negotiation) + scrolls + focuses the planned-offer input.
  offerFocusToken = 0
}) {
  const stepRef0 = useRef(null)
  const stepRef1 = useRef(null)
  const stepRef2 = useRef(null)
  const stepRef3 = useRef(null)
  const stepRef4 = useRef(null)
  const stepRef5 = useRef(null)
  const offerCardRef = useRef(null)
  const stepRefs = useMemo(
    () => [stepRef0, stepRef1, stepRef2, stepRef3, stepRef4, stepRef5],
    []
  )

  const [activeStep, setActiveStep] = useState(0)
  const [totalTransactions, setTotalTransactions] = useState(null)
  useEffect(() => {
    let alive = true
    getModelMeta()
      .then((m) => {
        if (alive && m?.total_transactions) setTotalTransactions(m.total_transactions)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const [viewedSteps, setViewedSteps] = useState([
    false,
    false,
    false,
    false,
    false,
    false
  ])
  // Floating step nav removed (was right-side dot navigator).

  const predictedPrice = prediction?.predicted_price
  const confidenceLow = prediction?.confidence_low
  const confidenceHigh = prediction?.confidence_high
  const cbrCheck = prediction?.cbr_check

  const cbrMedian = useMemo(() => {
    if (cbrCheck?.cbr_median != null) return cbrCheck.cbr_median
    if (!comparables?.length) return null
    const prices = [...comparables].map((c) => c.resale_price).sort((a, b) => a - b)
    return prices[Math.floor(prices.length / 2)]
  }, [cbrCheck, comparables])

  const gPct = useMemo(
    () => gapPct(listingAmount, predictedPrice),
    [listingAmount, predictedPrice]
  )

  const verdict = useMemo(() => verdictFromGapPct(gPct), [gPct])

  const matchedApriori = useMemo(
    () => matchAprioriRules(savedFlatPayload, rules?.apriori),
    [savedFlatPayload, rules?.apriori]
  )
  const primaryApriori = matchedApriori[0]

  const surrogateRule = useMemo(
    () => pickBestSurrogateRule(savedFlatPayload, rules?.surrogate, cbr?.query_features),
    [savedFlatPayload, rules?.surrogate, cbr?.query_features]
  )

  const { comparisonDrivers, marketTimingShap, saleYearNote } = useMemo(
    () => buildComparisonDrivers(shap, globalShapImportance, { topN: 4 }),
    [shap, globalShapImportance]
  )

  const negotiation = useMemo(() => {
    if (!listingAmount || !predictedPrice) return null
    return buildNegotiationGuide({
      prediction,
      shapValues: shap?.shap_values,
      matchedAprioriRule: primaryApriori,
      cbrCheck,
      askingPrice: listingAmount
    })
  }, [listingAmount, predictedPrice, prediction, shap?.shap_values, primaryApriori, cbrCheck])

  const town = flatForm?.town || savedFlatPayload?.town || ''
  const addressLine = [
    savedFlatPayload?.block && `BLK ${savedFlatPayload.block}`,
    savedFlatPayload?.street_name,
    town && toTitle(town),
    flatForm?.flat_type,
    flatForm?.storey_mid != null && `Floor ${Math.round(flatForm.storey_mid)}`,
    flatForm?.remaining_lease_years != null && `${Math.round(flatForm.remaining_lease_years)} yr lease`
  ]
    .filter(Boolean)
    .join(' · ')

  const showPoorCompDisclaimer =
    comparables?.length > 0 && comparables[0]?.similarity_pct != null && comparables[0].similarity_pct <= 5

  const cbrRecency = useMemo(() => {
    if (!comparables?.length) return null
    const years = comparables.map((c) => Number(c.year)).filter(Number.isFinite)
    if (!years.length) return null
    return { latest: Math.max(...years), earliest: Math.min(...years) }
  }, [comparables])

  const markViewed = useCallback((i) => {
    setViewedSteps((prev) => {
      if (prev[i]) return prev
      const next = [...prev]
      next[i] = true
      return next
    })
  }, [])

  const handleStepComplete = useCallback(
    (stepIndex) => {
      markViewed(stepIndex)
      const next = stepIndex + 1
      if (next < 6) {
        // Single open step: advance active step only (accordion — previous index !== next)
        setActiveStep(next)
        window.setTimeout(() => {
          stepRefs[next]?.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          })
        }, 250)
      }
    },
    [markViewed, stepRefs]
  )

  const onToggleStep = useCallback((i) => {
    setActiveStep((prev) => (prev === i ? -1 : i))
  }, [])

  const scrollToFirstStep = useCallback(() => {
    setActiveStep(0)
    window.setTimeout(() => {
      stepRef0.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [])

  useEffect(() => {
    setActiveStep(0)
    setViewedSteps([false, false, false, false, false, false])
  }, [resultsKey])

  // Each tick of `offerFocusToken` (driven by BuyerView's floating CTA)
  // opens step 5 (negotiation) + scrolls into view + focuses the offer input.
  useEffect(() => {
    if (!offerFocusToken) return
    setActiveStep(4) // step 5 in the UI is index 4 (0-based)
    window.setTimeout(() => {
      stepRef4.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.setTimeout(() => offerCardRef.current?.focusInput?.(), 250)
    }, 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerFocusToken])

  const timingYearLabel =
    saleMonthLabel && /^\d{4}/.test(String(saleMonthLabel))
      ? String(saleMonthLabel).slice(0, 4)
      : String(Math.round(saleYearNote || new Date().getFullYear()))

  if (!predictedPrice) return null

  const seeAnalysisFooter = (
    <div className="mt-4 flex flex-col gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        onClick={scrollToFirstStep}
      >
        See full analysis
        <ArrowDown className="ml-2 h-4 w-4" aria-hidden />
      </Button>
    </div>
  )

  const pricingCardProperty = {
    address:
      [
        savedFlatPayload?.block && `BLK ${savedFlatPayload.block}`,
        savedFlatPayload?.street_name
      ]
        .filter(Boolean)
        .join(' · ') || 'This flat',
    area: town ? toTitle(town) : '',
    flatType: flatForm?.flat_type,
    floor:
      flatForm?.storey_mid != null ? `Floor ${Math.round(flatForm.storey_mid)}` : null,
    lease:
      flatForm?.remaining_lease_years != null
        ? `${Math.round(flatForm.remaining_lease_years)} yr lease`
        : null,
    aiEstimate: predictedPrice,
    aiLow: confidenceLow ?? (predictedPrice ? predictedPrice * 0.92 : null),
    aiHigh: confidenceHigh ?? (predictedPrice ? predictedPrice * 1.08 : null),
    recentSalesMedian: cbrMedian ?? predictedPrice,
    cbrSampleSize: comparables?.length ?? 5
  }

  return (
    <div className="space-y-5">
      {!listingAmount && (
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden>🏠</span>
            <span>{addressLine || 'Your listing'}</span>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
              Enter the seller&apos;s asking price (SGD)
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="number"
                placeholder="e.g. 520000"
                value={listingInput}
                onChange={(e) => setListingInput(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                onClick={() => {
                  const v = Number(listingInput)
                  if (v > 0) setListingAmount(v)
                }}
              >
                Compare
              </button>
            </div>
            {seeAnalysisFooter}
          </div>
        </div>
      )}

      {listingAmount != null && (
        <PricingCardB
          property={pricingCardProperty}
          askingPrice={listingAmount}
          onChangeAskingPrice={() => {
            setListingAmount(null)
            setListingInput('')
          }}
          onSeeFullAnalysis={scrollToFirstStep}
        />
      )}

      {predictedPrice != null && listingAmount == null && (
        <PriceRangeCard
          aiEstimate={predictedPrice}
          cbrMedian={cbrMedian ?? predictedPrice}
          listingPrice={listingAmount ?? predictedPrice}
          confidenceLow={confidenceLow ?? predictedPrice * 0.92}
          confidenceHigh={confidenceHigh ?? predictedPrice * 1.08}
          cbrSampleSize={comparables?.length ?? 5}
          onEditListing={
            listingAmount != null
              ? () => {
                  setListingAmount(null)
                  setListingInput('')
                }
              : undefined
          }
        />
      )}

      <div className="relative mt-4 space-y-0">
        <BuyerStepProgressBar viewedSteps={viewedSteps} activeStep={activeStep} />

        <div className="relative">
          <div
            className="absolute bottom-6 left-[15px] top-6 z-0 w-px bg-border/40 sm:left-[19px]"
            aria-hidden
          />

          <BuyerStepCard
            ref={stepRef0}
            stepIndex={0}
            title="What drives this price"
            subtitle="How this flat compares to the average HDB flat on the 4 biggest price drivers"
            expanded={activeStep === 0}
            onToggle={onToggleStep}
            viewed={viewedSteps[0]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(0)}
            loading={false}
          >
            <CompositeShapPanel
              flat={savedFlatPayload ?? flatForm}
              hideStackBreakdown
            />
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef1}
            stepIndex={1}
            title="How it fits market patterns"
            subtitle="Compared to pricing patterns across historical resale transactions"
            expanded={activeStep === 1}
            onToggle={onToggleStep}
            viewed={viewedSteps[1]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(1)}
            loading={false}
          >
            <p className="text-xs text-muted-foreground">
              How this flat lines up with pricing patterns from historical resale transactions.
            </p>
            {!rules ? (
              <p className="mt-3 text-xs text-muted-foreground">Loading patterns…</p>
            ) : (
              <>
                {primaryApriori && (
                  <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
                    <p className="text-xs font-semibold text-foreground">
                      Common market pattern for flats like this
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      In <strong className="text-foreground">{Math.round((primaryApriori.confidence || 0) * 100)}%</strong> of past transactions,
                      flats with {humanizeConditions(primaryApriori.if_conditions)} sold for{' '}
                      <strong className="text-foreground">{humanizeOutcome(primaryApriori.then)}</strong>.{' '}
                      {listingAmount
                        ? <>This flat&apos;s asking price {assessMatch(listingAmount, predictedPrice, primaryApriori)}.</>
                        : 'Add an asking price above to see how this listing compares.'}
                    </p>
                    {(primaryApriori.support || 0) > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground opacity-80">
                        This pattern shows up in ~{Math.max(1, Math.round((primaryApriori.support || 0) * 100))}% of past sales.
                      </p>
                    )}
                  </div>
                )}
                {surrogateRule && (() => {
                  const rtPrice = Number(surrogateRule.then_price)
                  const aiPrice = Number(predictedPrice)
                  const haveBoth = Number.isFinite(rtPrice) && Number.isFinite(aiPrice) && aiPrice > 0
                  const gapPct = haveBoth
                    ? Math.round((Math.abs(rtPrice - aiPrice) / aiPrice) * 100)
                    : null
                  return (
                    <div className="mt-2 rounded-lg border border-border bg-muted/50 p-3">
                      <p className="text-xs font-semibold text-foreground">
                        A simple rule-of-thumb check
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        A simple rule of thumb built from past transactions — useful as a sanity
                        check, less precise than the AI estimate. For flats in the same bracket
                        ({' '}
                        <strong className="text-foreground">
                          {(surrogateRule.samples || 0).toLocaleString()} past sales
                        </strong>
                        ), the typical price is around{' '}
                        <strong className="text-foreground">{fmt(surrogateRule.then_price)}</strong>.
                      </p>
                      {haveBoth && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          AI estimate: <strong className="text-foreground">{fmt(aiPrice)}</strong>
                          {' · '}
                          <strong className="text-foreground">{gapPct}%</strong> apart,{' '}
                          <span className="italic">{agreementPhrase(gapPct)}</span>.
                        </p>
                      )}
                    </div>
                  )
                })()}
                {primaryApriori && surrogateRule && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    The AI estimate factors in 30+ details specific to this flat (floor, lease,
                    location). The patterns above use broader groupings. When both numbers agree,
                    confidence is high; when they diverge, scroll up to the driver breakdown to see
                    which feature explains the gap.
                  </p>
                )}
                {!primaryApriori && !surrogateRule && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No strong pattern match for this combination — rely on the AI estimate and comparables
                    below.
                  </p>
                )}
              </>
            )}
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef2}
            stepIndex={2}
            title="What would a similar flat cost?"
            subtitle="Adjust attributes to explore how price changes"
            expanded={activeStep === 2}
            onToggle={onToggleStep}
            viewed={viewedSteps[2]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(2)}
            loading={false}
          >
            <p className="text-xs text-muted-foreground">
              Adjust attributes to explore how price changes for a similar flat.
            </p>
            <div className="mt-3">
              <WhatIfTool
                originalFlat={savedFlatPayload}
                originalPrediction={predictedPrice}
                locationContext={prediction?.location_context}
              />
            </div>
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef3}
            stepIndex={3}
            title="What similar flats sold for"
            subtitle="Comparable past transactions for context"
            expanded={activeStep === 3}
            onToggle={onToggleStep}
            viewed={viewedSteps[3]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(3)}
            loading={false}
          >
            <p className="text-xs text-muted-foreground">
              Comparable transactions used for context (not a guarantee of resale outcome).
            </p>
            {comparables?.length > 0 ? (
              <>
                {cbrRecency && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Based on comparable transactions from{' '}
                    {cbrRecency.earliest === cbrRecency.latest
                      ? cbrRecency.latest
                      : `${cbrRecency.earliest}–${cbrRecency.latest}`}
                    .
                  </p>
                )}
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b-2 border-border text-left">
                        {[
                          'Address',
                          'sqm',
                          'Floor',
                          'Price',
                          'Year',
                          'vs AI est.',
                          ...(listingAmount ? ['vs Listing'] : [])
                        ].map((h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-2 py-2 font-bold uppercase text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparables.map((c, i) => {
                        const vsAI = (((c.resale_price - predictedPrice) / predictedPrice) * 100).toFixed(
                          1
                        )
                        const vsListing = listingAmount
                          ? (((c.resale_price - listingAmount) / listingAmount) * 100).toFixed(1)
                          : null
                        const vsAIStrong = Math.abs(Number(vsAI)) > 10
                        const vsListStrong =
                          vsListing != null && Math.abs(Number(vsListing)) > 10
                        return (
                          <tr key={i} className="border-b border-border/60">
                            <td className="px-2 py-2 font-medium text-foreground">
                              {c.block} {c.street_name}
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">{c.floor_area_sqm}</td>
                            <td className="px-2 py-2 text-muted-foreground">{c.storey_mid}</td>
                            <td className="px-2 py-2 font-semibold tabular-nums">{fmt(c.resale_price)}</td>
                            <td className="px-2 py-2 text-muted-foreground">{c.year}</td>
                            <td className="px-2 py-2">
                              <span
                                className={cn(
                                  'tabular-nums text-muted-foreground',
                                  vsAIStrong && 'font-semibold text-foreground'
                                )}
                              >
                                {Number(vsAI) >= 0 ? '+' : ''}
                                {vsAI}%
                              </span>
                            </td>
                            {listingAmount && (
                              <td className="px-2 py-2">
                                <span
                                  className={cn(
                                    'tabular-nums text-muted-foreground',
                                    vsListStrong && 'font-semibold text-foreground'
                                  )}
                                >
                                  {Number(vsListing) >= 0 ? '+' : ''}
                                  {vsListing}%
                                </span>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {cbrMedian && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Median of comparables: <strong className="text-foreground">{fmt(cbrMedian)}</strong>
                  </p>
                )}
                {showPoorCompDisclaimer && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Note: limited close matches for this profile — the rows above come from a broader
                    search. Cross-check with recent sales in {toTitle(town) || 'this town'} for confirmation.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                No comparable sales returned for this query — use the AI estimate and local patterns
                above.
              </p>
            )}
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef4}
            stepIndex={4}
            title="Your negotiation strategy"
            subtitle="Combined view from model, comparables, and patterns"
            expanded={activeStep === 4}
            onToggle={onToggleStep}
            viewed={viewedSteps[4]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(4)}
            loading={false}
          >
            {!listingAmount ? (
              <p className="text-xs text-muted-foreground">
                Add the seller&apos;s asking price in the verdict card above to unlock your offer
                plan, evidence pack, and seller-objection scripts.
              </p>
            ) : (
              <BuyerOfferPlannerCard
                ref={offerCardRef}
                asking={listingAmount}
                predicted={predictedPrice}
                cbrMedian={cbrMedian}
                comparables={comparables}
                driverCards={comparisonDrivers}
                leaseYears={
                  flatForm?.remaining_lease_years ??
                  savedFlatPayload?.remaining_lease_years
                }
              />
            )}
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef5}
            stepIndex={5}
            title="Location and amenities"
            subtitle={"What's within walking distance"}
            expanded={activeStep === 5}
            onToggle={onToggleStep}
            viewed={viewedSteps[5]}
            onViewed={markViewed}
            isLast
            loading={false}
          >
            <p className="text-xs text-muted-foreground">{nearbyAmenitySummary(nearbyResult)}</p>
            {geocodeResult && geocodeResult.found === false && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                ⚠️ Address not found — showing town centroid. Distance-based features may be approximate.
              </div>
            )}
            {geocodeResult && geocodeResult.found !== false ? (
              <div className="mt-4">
                <LocationMap
                  geocode={geocodeResult}
                  nearby={nearbyResult}
                  locationContext={prediction?.location_context}
                  town={mapTown}
                  flatType={mapFlatType}
                  floorArea={mapFloorArea}
                  storeyMid={parseStoreyMid(mapStoreyRange)}
                  remainingLease={remainingLeaseApprox(
                    Number(mapLeaseCommence),
                    mapSaleMonth || defaultSaleMonth()
                  )}
                />
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Map and POIs load after the address is geocoded. If this persists, check the API
                connection.
              </p>
            )}
          </BuyerStepCard>
        </div>
      </div>

    </div>
  )
}
