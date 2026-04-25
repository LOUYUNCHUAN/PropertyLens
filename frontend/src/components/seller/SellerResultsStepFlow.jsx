import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import BuyerStepCard from '@/components/buyer/BuyerStepCard.jsx'
import BuyerStepProgressBar from '@/components/buyer/BuyerStepProgressBar.jsx'
import CbrDivergenceWarning from '@/components/CbrDivergenceWarning.jsx'
import { PriceRangeCard } from '@/components/price-range-card.jsx'
import ShapComparisonCard from '@/components/buyer/ShapComparisonCard.jsx'
import CompositeShapPanel from '@/components/buyer/CompositeShapPanel.jsx'
import SellerPriceRecommendationCard from '@/components/seller/SellerPriceRecommendationCard.jsx'
import AskingPriceTabbedCard from '@/components/seller/AskingPriceTabbedCard.jsx'
import OfferHandlerCard from '@/components/seller/OfferHandlerCard.jsx'
import { formatConfidenceBandK } from '@/lib/formatPrice.js'
import {
  buildComparisonDrivers,
  matchAprioriRules,
  pickBestSurrogateRule
} from '@/lib/buyerExplain.js'
import {
  buildSignalCards,
  confidenceBandTooltip,
  confidenceLevelFromBand,
  sellerAprioriViolated
} from '@/lib/sellerSignals.js'
import {
  buildNegotiationTactics,
  buildSuggestedListingNote,
  getBeforeYouListInsight
} from '@/lib/sellerNegotiation.js'
import {
  AskingPriceSummary,
  CSPBanner,
  NegotiationRange,
  RecentSalesTable,
  WhatIfSimulator
} from '@/components/seller/sellerResultsWidgets.jsx'
import PhotoRefineCard from '@/components/PhotoRefineCard.jsx'

const fmt = (n) => `$${Math.round(n).toLocaleString()}`

const SELLER_SEGMENT_LABELS = [
  'Signals',
  'Drivers',
  'Comps',
  'Asking',
  'What-if',
  'Strategy'
]

export default function SellerResultsStepFlow({
  resultsKey = 0,
  form,
  results,
  rules,
  globalShapImportance = {},
  askingPrice,
  setAskingPrice,
  cspResult,
  cspLoading,
  suggestedListingMultiplier,
  whatIfStorey,
  whatIfLease,
  whatIfArea,
  whatIfPrice,
  whatIfShap,
  whatIfLoading,
  handleWhatIfChange,
  onResetWhatIf,
  photoAdjustment,
  onPhotoAdjustmentChange,
  // Bumped by SellerView's floating "Got an offer?" CTA. Each tick opens
  // step 6 + scrolls + focuses the offer input.
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
  const [viewedSteps, setViewedSteps] = useState([
    false,
    false,
    false,
    false,
    false,
    false
  ])
  // Floating step nav removed (right-side dot navigator).

  const predicted = results?.predict?.predicted_price
  const low = results?.predict?.confidence_low
  const high = results?.predict?.confidence_high
  const comparables = results?.cbr?.comparables ?? []
  const baseFlat = results?.baseFlatPayload
  const queryFeatures = results?.cbr?.query_features

  const matchedApriori = useMemo(
    () => matchAprioriRules(baseFlat, rules?.apriori),
    [baseFlat, rules?.apriori]
  )
  const primaryApriori = matchedApriori[0]

  const surrogateRule = useMemo(
    () => pickBestSurrogateRule(baseFlat, rules?.surrogate, queryFeatures),
    [baseFlat, rules?.surrogate, queryFeatures]
  )

  const signalCards = useMemo(
    () =>
      buildSignalCards(
        primaryApriori,
        surrogateRule,
        predicted,
        askingPrice
      ),
    [primaryApriori, surrogateRule, predicted, askingPrice]
  )

  const { comparisonDrivers, marketTimingShap, saleYearNote } = useMemo(
    () =>
      buildComparisonDrivers(results?.shap, globalShapImportance, { topN: 4 }),
    [results?.shap, globalShapImportance]
  )
  const driverCards = comparisonDrivers

  const aprioriViolated = useMemo(
    () =>
      sellerAprioriViolated(
        primaryApriori,
        askingPrice,
        predicted,
        cspResult
      ),
    [primaryApriori, askingPrice, predicted, cspResult]
  )

  const suggestedNote = useMemo(
    () =>
      buildSuggestedListingNote({
        aprioriViolated,
        askingPrice,
        predictedPrice: predicted,
        listingMultiplier: suggestedListingMultiplier
      }),
    [aprioriViolated, askingPrice, predicted, suggestedListingMultiplier]
  )

  const tactics = useMemo(
    () =>
      buildNegotiationTactics({
        driverCards,
        town: form?.town,
        comparables
      }),
    [driverCards, form?.town, comparables]
  )

  const beforeYouList = useMemo(
    () => getBeforeYouListInsight(baseFlat, results?.shap?.shap_values),
    [baseFlat, results?.shap?.shap_values]
  )

  const confidenceLevel = useMemo(
    () => confidenceLevelFromBand(low, high),
    [low, high]
  )
  const confidenceTip = useMemo(
    () => confidenceBandTooltip(confidenceLevel, low, high),
    [confidenceLevel, low, high]
  )

  const showPoorCompDisclaimer =
    comparables.length > 0 &&
    comparables.every((c) => (c.similarity_pct ?? 0) <= 5)

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

  const scrollToAskingStep = useCallback(() => {
    setActiveStep(3)
    window.setTimeout(() => {
      stepRef3.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [])

  // Each tick of `offerFocusToken` (driven by SellerView's floating CTA)
  // opens step 6, scrolls it into view, and pulls focus into the
  // OfferHandlerCard's input.
  useEffect(() => {
    if (!offerFocusToken) return
    setActiveStep(5)
    window.setTimeout(() => {
      stepRef5.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.setTimeout(() => offerCardRef.current?.focusInput?.(), 250)
    }, 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerFocusToken])

  useEffect(() => {
    setActiveStep(0)
    setViewedSteps([false, false, false, false, false, false])
  }, [resultsKey])

  if (!predicted) return null

  const addressLine = [
    form?.block && `BLK ${form.block}`,
    form?.streetName,
    form?.town,
    form?.flatType,
    form?.floorArea && `${form.floorArea} sqm`
  ]
    .filter(Boolean)
    .join(' · ')

  const ceilingDisplay = high != null ? high : predicted * 1.08
  const quickPickAi = Math.round(predicted)
  const quickPickPlus3 = Math.round(Math.round(predicted * 1.03 / 1000) * 1000)
  const quickPickHigh = high != null ? Math.round(high) : quickPickAi
  const trendBufferPct = Math.round((suggestedListingMultiplier - 1) * 1000) / 10
  const quickPickTrend = Math.round(predicted * suggestedListingMultiplier)

  const recommendationProperty = {
    address:
      [form?.block && `BLK ${form.block}`, form?.streetName].filter(Boolean).join(' · ') ||
      'Your flat',
    area: form?.town,
    flatType: form?.flatType,
    sqm: form?.floorArea != null ? Number(form.floorArea) : null
  }

  return (
    <div className="space-y-5">
      <SellerPriceRecommendationCard
        property={recommendationProperty}
        aiEstimate={predicted}
        aiLow={low}
        aiHigh={high}
        townTrendPct={trendBufferPct}
        suggestedListPrice={quickPickTrend}
        pricePerSqm={results?.predict?.price_per_sqm}
        confidence={String(confidenceLevel || 'medium').toLowerCase()}
        onSeeFullAnalysis={scrollToFirstStep}
        onContinue={scrollToAskingStep}
        onSelectPrice={(price) => {
          if (typeof setAskingPrice === 'function') setAskingPrice(Math.round(Number(price) || 0))
          scrollToAskingStep()
        }}
      />

      <PhotoRefineCard
        basePrice={predicted}
        onResult={onPhotoAdjustmentChange}
      />

      <div className="relative mt-2 space-y-0">
        <BuyerStepProgressBar
          viewedSteps={viewedSteps}
          activeStep={activeStep}
          label="Seller analysis · 6 sections"
          segmentLabels={SELLER_SEGMENT_LABELS}
        />

        <div className="relative">
          <div
            className="absolute bottom-6 left-[15px] top-6 z-0 w-px bg-border/40 sm:left-[19px]"
            aria-hidden
          />

          <BuyerStepCard
            ref={stepRef0}
            stepIndex={0}
            title="Market signals for your flat"
            subtitle="How your unit lines up with learned market patterns"
            expanded={activeStep === 0}
            onToggle={onToggleStep}
            viewed={viewedSteps[0]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(0)}
            loading={false}
          >
            {!rules ? (
              <p className="text-xs text-muted-foreground">Loading patterns…</p>
            ) : (
              <div className="space-y-3">
                {signalCards.map((c, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg border p-3 text-sm',
                      c.type === 'warn' &&
                        'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
                      c.type === 'ok' &&
                        'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/25',
                      c.type === 'info' &&
                        'border-border bg-card dark:border-border'
                    )}
                  >
                    <p className="font-semibold text-foreground">
                      <span className="mr-1.5" aria-hidden>
                        {c.icon}
                      </span>
                      {c.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef1}
            stepIndex={1}
            title="What drives your valuation"
            subtitle="The 4 factors that most influence your flat's estimated value"
            expanded={activeStep === 1}
            onToggle={onToggleStep}
            viewed={viewedSteps[1]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(1)}
            loading={false}
          >
            {beforeYouList && (
              <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/30">
                <p className="text-xs leading-relaxed text-sky-900 dark:text-sky-100">
                  <span className="font-semibold">💡 Before you list: </span>
                  {beforeYouList}
                </p>
              </div>
            )}
            <CompositeShapPanel flat={baseFlat} />
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef2}
            stepIndex={2}
            title="What similar flats sold for"
            subtitle="Recent transactions versus your AI fair value"
            expanded={activeStep === 2}
            onToggle={onToggleStep}
            viewed={viewedSteps[2]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(2)}
            loading={false}
          >
            <p className="text-xs text-muted-foreground">
              Same-town matches are listed first when available, then wider market. Use as a benchmark,
              not a guarantee.
            </p>
            <div className="mt-3">
              <CbrDivergenceWarning
                cbrCheck={results.predict.cbr_check}
                predictedPrice={predicted}
              />
            </div>
            {showPoorCompDisclaimer && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                Similarity scores are very low across these comps — treat them as weak matches and rely
                more on your AI band and town-level context.
              </p>
            )}
            <div className="mt-4">
              <RecentSalesTable comparables={comparables} estimate={predicted} />
            </div>
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef3}
            stepIndex={3}
            title="Set your asking price"
            subtitle="Live checks against market rules"
            expanded={activeStep === 3}
            onToggle={onToggleStep}
            viewed={viewedSteps[3]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(3)}
            loading={false}
          >
            <AskingPriceTabbedCard
              property={recommendationProperty}
              aiEstimate={predicted}
              aiLow={low}
              aiHigh={ceilingDisplay}
              recentSalesMedian={results?.predict?.cbr_check?.cbr_median ?? predicted}
              recentSalesSampleSize={comparables?.length ?? 5}
              suggestedListPrice={quickPickTrend}
              townTrendPct={trendBufferPct}
              askingPrice={askingPrice}
              setAskingPrice={setAskingPrice}
              hideStepBanner
            />
            <CSPBanner
              cspResult={cspResult}
              askingPrice={askingPrice}
              predictedPrice={predicted}
              loading={cspLoading}
            />
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef4}
            stepIndex={4}
            title="What will buyers negotiate on?"
            subtitle="See how much each attribute is worth — so you know what to concede and what to defend"
            expanded={activeStep === 4}
            onToggle={onToggleStep}
            viewed={viewedSteps[4]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(4)}
            loading={false}
          >
            <p className="text-xs text-muted-foreground">
              Adjust each attribute to see the dollar value of common buyer objections. When a buyer says
              &quot;the lease is short&quot; or &quot;it&apos;s a low floor&quot;, you&apos;ll know exactly how much
              that&apos;s worth — and how much to concede.
            </p>
            <div className="mt-4">
              <WhatIfSimulator
                basePrice={predicted}
                whatIfPrice={whatIfPrice}
                whatIfShap={whatIfShap}
                baseShap={results.shap.shap_values}
                whatIfStorey={whatIfStorey}
                whatIfLease={whatIfLease}
                whatIfArea={whatIfArea}
                loading={whatIfLoading}
                onStoreyChange={(v) => handleWhatIfChange('storey', v)}
                onLeaseChange={(v) => handleWhatIfChange('lease', v)}
                onAreaChange={(v) => handleWhatIfChange('area', v)}
                onReset={onResetWhatIf}
                originalFlat={results.baseFlatPayload}
              />
            </div>
          </BuyerStepCard>

          <BuyerStepCard
            ref={stepRef5}
            stepIndex={5}
            title="Your negotiation strategy"
            subtitle="Your price range, suggested listing, and how to handle buyer pushback"
            expanded={activeStep === 5}
            onToggle={onToggleStep}
            viewed={viewedSteps[5]}
            onViewed={markViewed}
            isLast={true}
            onNext={() => handleStepComplete(5)}
            loading={false}
          >
            <OfferHandlerCard
              ref={offerCardRef}
              askingPrice={askingPrice}
              predicted={predicted}
              aiLow={low}
              aiHigh={high}
              cbrMedian={results?.predict?.cbr_check?.cbr_median}
              comparables={comparables}
              town={form?.town}
              townTrendPct={trendBufferPct}
              remainingLeaseYears={
                results?.baseFlatPayload?.remaining_lease_years ?? form?.remainingLease
              }
              driverCards={driverCards}
              aprioriViolated={aprioriViolated}
            />
          </BuyerStepCard>
        </div>
      </div>

    </div>
  )
}
