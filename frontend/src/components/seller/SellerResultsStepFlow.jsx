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
import { formatConfidenceBandK } from '@/lib/formatPrice.js'
import {
  buildDriverCards,
  DRIVER_LABELS,
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
  onResetWhatIf
}) {
  const stepRef0 = useRef(null)
  const stepRef1 = useRef(null)
  const stepRef2 = useRef(null)
  const stepRef3 = useRef(null)
  const stepRef4 = useRef(null)
  const stepRef5 = useRef(null)
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

  const { cards: driverCards, marketTimingShap, saleYearNote } = useMemo(
    () => buildDriverCards(results?.shap?.shap_values, { topN: 4 }),
    [results?.shap?.shap_values]
  )

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

  return (
    <div className="space-y-5">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden>🏠</span>
            <span>{addressLine || 'Your flat'}</span>
          </div>
          <CardDescription className="pt-1">
            AI fair value, confidence band, and price per sqm for your listing context.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Our model estimates this flat is worth around{' '}
            <span className="font-semibold text-foreground">{fmt(predicted)}</span> in{' '}
            {form?.sale_month || 'the chosen month'}. With your town&apos;s recent {trendBufferPct >= 0 ? '+' : ''}
            {trendBufferPct}% trend, a typical listing price would be{' '}
            <span className="font-semibold text-foreground">{fmt(quickPickTrend)}</span>. The
            sections below show what drives this number, comparable sales, and how to position
            your asking price.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                AI fair value
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {fmt(predicted)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatConfidenceBandK(low, high)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Confidence
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                {confidenceLevel}
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] text-muted-foreground hover:bg-muted/60"
                  title={confidenceTip}
                  aria-label={confidenceTip}
                >
                  ⓘ
                </button>
              </p>
              <p className="text-xs text-muted-foreground">
                Band width indicates how tight the model&apos;s range is for similar flats.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                $/sqm
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                ${results?.predict?.price_per_sqm?.toLocaleString() ?? '—'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 border-t border-border/40 pt-4 text-sm text-muted-foreground">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide">Floor</p>
              <p className="mt-0.5 font-semibold tabular-nums text-muted-foreground">
                {low != null ? fmt(low) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide">Ceiling</p>
              <p className="mt-0.5 font-semibold tabular-nums text-muted-foreground">
                {fmt(ceilingDisplay)}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              onClick={scrollToFirstStep}
            >
              See full analysis
              <ChevronDown className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          </div>
        </CardContent>
      </Card>

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
            subtitle="Largest dollar contributions in the hybrid model (excl. pure timing in the grid)"
            expanded={activeStep === 1}
            onToggle={onToggleStep}
            viewed={viewedSteps[1]}
            onViewed={markViewed}
            isLast={false}
            onNext={() => handleStepComplete(1)}
            loading={false}
          >
            <p className="text-xs text-muted-foreground">{beforeYouList}</p>
            {results?.shap?.shap_values?.length > 0 ? (
              <>
                {results?.shap?.explanation_type === 'global' && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      ⚠️ Showing average feature importance — per-prediction explanation unavailable
                      for this flat.
                      {results?.shap?.fallback_reason ? (
                        <span className="mt-1 block text-[11px] opacity-90">
                          {results.shap.fallback_reason}
                        </span>
                      ) : null}
                    </p>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {driverCards.map((driver) => (
                    <div
                      key={driver.feature}
                      className="rounded-xl border border-border/60 bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xl">{driver.icon}</span>
                          <p className="mt-1 text-sm font-semibold text-foreground">{driver.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {driver.featureText}
                            {DRIVER_LABELS[driver.feature]?.direction
                              ? ` · ${DRIVER_LABELS[driver.feature].direction}`
                              : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-sm font-bold tabular-nums ${
                              driver.shap > 0 ? 'text-emerald-600' : 'text-red-500'
                            }`}
                          >
                            {driver.shap > 0 ? '+' : ''}
                            {fmt(driver.shap)}
                          </p>
                          <p className="text-xs text-muted-foreground">to price</p>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-emerald-400"
                          style={{ width: `${Math.min(100, driver.pct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {Math.abs(marketTimingShap) > 0.01 && (
                  <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950/30">
                    <p className="text-xs text-sky-900 dark:text-sky-100">
                      <span className="font-semibold">
                        📈 Market tailwind {marketTimingShap >= 0 ? '+' : '−'}
                        {fmt(Math.abs(marketTimingShap))}
                      </span>
                      {' — '}
                      the broader {saleYearNote || new Date().getFullYear()} market{' '}
                      {marketTimingShap >= 0 ? 'is lifting' : 'is pulling down'} prices for all flats
                      like yours, not just this one. Already baked into your fair value.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No per-factor breakdown available — the fair value above still reflects the full model.
              </p>
            )}
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
            <p className="text-xs text-muted-foreground">
              The input below is anchored at the <strong>fair market estimate</strong> from the model.
              Use the quick picks to explore wider bands — each label explains where the number comes
              from. We validate against Apriori and surrogate rules as you type.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAskingPrice(quickPickAi)}
                title="Reset to the model's fair market estimate"
              >
                Fair estimate ({fmt(quickPickAi)})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAskingPrice(quickPickPlus3)}
              >
                +3% buffer ({fmt(quickPickPlus3)})
              </Button>
              {Math.abs(trendBufferPct) >= 0.5 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAskingPrice(quickPickTrend)}
                  title={`Based on recent town-level YoY trend (${trendBufferPct >= 0 ? '+' : ''}${trendBufferPct}%)`}
                >
                  Town trend ({trendBufferPct >= 0 ? '+' : ''}{trendBufferPct}% · {fmt(quickPickTrend)})
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAskingPrice(quickPickHigh)}
              >
                Confidence high ({fmt(quickPickHigh)})
              </Button>
            </div>
            <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)]">
              <div>
                <FormField label="Your asking price (SGD)">
                  <Input
                    id="seller-asking-price"
                    type="number"
                    min={0}
                    value={askingPrice ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setAskingPrice(v === '' ? null : Number(v))
                    }}
                    className="h-9 max-w-xs"
                  />
                </FormField>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                    Below floor — risk underpricing
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    Fair zone
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    Above ceiling — may deter buyers
                  </span>
                </div>
              </div>
              <div>
                {askingPrice ? (
                  <AskingPriceSummary
                    askingPrice={askingPrice}
                    predicted={predicted}
                    low={low}
                    high={ceilingDisplay}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Enter a price to see the summary.</p>
                )}
                {cspLoading && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Checking your asking price against market rules…
                  </p>
                )}
              </div>
            </div>
            <CSPBanner
              cspResult={cspResult}
              askingPrice={askingPrice}
              predictedPrice={predicted}
              loading={cspLoading}
            />
            {askingPrice && predicted != null && (
              <div className="mt-6">
                <PriceRangeCard
                  aiEstimate={predicted}
                  cbrMedian={results?.predict?.cbr_check?.cbr_median ?? predicted}
                  listingPrice={askingPrice}
                  confidenceLow={low ?? predicted * 0.92}
                  confidenceHigh={ceilingDisplay}
                  cbrSampleSize={comparables?.length ?? 5}
                  onEditListing={() => setAskingPrice(null)}
                />
              </div>
            )}
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
            <div className="mt-2 text-[11px] text-muted-foreground">
              Sliders send debounced requests to the same predict/SHAP path as your main analysis.
            </div>
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
            subtitle="Range from counterfactuals plus listing anchor"
            expanded={activeStep === 5}
            onToggle={onToggleStep}
            viewed={viewedSteps[5]}
            onViewed={markViewed}
            isLast={true}
            onNext={() => handleStepComplete(5)}
            loading={false}
          >
            {results.cf ? (
              <NegotiationRange
                cf={results.cf}
                predicted={predicted}
                listingMultiplier={suggestedListingMultiplier}
                suggestedListingNote={suggestedNote}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Negotiation data unavailable.</p>
            )}
            {tactics.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold text-foreground">Tactics to prepare</p>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs text-muted-foreground">
                  {tactics.map((t, i) => (
                    <li key={i} className="leading-relaxed">
                      {t}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </BuyerStepCard>
        </div>
      </div>

    </div>
  )
}
