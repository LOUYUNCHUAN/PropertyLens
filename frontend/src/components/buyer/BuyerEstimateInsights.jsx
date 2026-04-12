import { useMemo } from 'react'
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
  buildDriverCards,
  computeLimeWhatIfs,
  buildNegotiationGuide,
  DRIVER_LABELS
} from '@/lib/buyerExplain.js'

const fmt = (n) => `$${Math.round(n).toLocaleString()}`

function toTitle(str) {
  return String(str || '')
    .split(' ')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')
}

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
  const listingTick = pct(listing)
  const bandLeft = pct(low)
  const bandWidth = Math.max(0.5, pct(high) - pct(low))

  return (
    <div className="mt-4 rounded-lg bg-muted/30 p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Price spectrum
      </p>
      <div className="relative h-2 rounded-full bg-border">
        <div
          className="absolute top-0 h-2 rounded-full bg-emerald-200/80"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-primary"
          style={{ left: `${pct(predicted)}%` }}
          title="AI estimate"
        />
        <div
          className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-foreground"
          style={{ left: `${listingTick}%` }}
          title="Asking"
        />
        {cbrMedian != null && (
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-sky-500"
            style={{ left: `${pct(cbrMedian)}%` }}
            title="CBR median"
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Floor {fmtK(low)}</span>
        {cbrMedian != null && <span className="text-sky-700">CBR median {fmtK(cbrMedian)}</span>}
        <span className="text-emerald-800">AI est. {fmtK(predicted)}</span>
        <span className="font-medium text-foreground">Asking {fmtK(listing)}</span>
      </div>
    </div>
  )
}

export default function BuyerEstimateInsights({
  prediction,
  shap,
  cbr,
  flatForm,
  savedFlatPayload,
  comparables = [],
  /** Parsed positive number or null */
  listingAmount,
  setListingAmount,
  listingInput,
  setListingInput,
  rules,
  lime,
  limeLoading,
  limeError,
  saleMonthLabel
}) {
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

  const { cards: driverCards, marketTimingShap, saleYearNote } = useMemo(
    () => buildDriverCards(shap?.shap_values, { topN: 4 }),
    [shap?.shap_values]
  )

  const limeScenarios = useMemo(
    () => computeLimeWhatIfs(lime?.lime_explanation, 3),
    [lime?.lime_explanation]
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

  if (!predictedPrice) return null

  return (
    <div className="space-y-5">
      {/* Verdict */}
      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start gap-2 text-sm font-semibold text-foreground">
          <span aria-hidden>🏠</span>
          <span>{addressLine || 'Your listing'}</span>
        </div>

        {!listingAmount && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-950">Enter the seller&apos;s asking price (SGD)</p>
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
          </div>
        )}

        {listingAmount != null && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  AI fair value
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                  {fmt(predictedPrice)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatConfidenceBandK(confidenceLow, confidenceHigh)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Asking price
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                  {fmt(listingAmount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {gPct != null && (
                    <>
                      {gPct >= 0 ? '+' : ''}
                      {fmt(listingAmount - predictedPrice)} ({gPct >= 0 ? '+' : ''}
                      {gPct.toFixed(1)}%)
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Verdict
                </p>
                <p className="mt-1 text-lg font-bold leading-snug">
                  <span className="mr-1">{verdict.emoji}</span>
                  {verdict.label}
                </p>
              </div>
            </div>

            <VerdictSpectrumBar
              listing={listingAmount}
              predicted={predictedPrice}
              low={confidenceLow}
              high={confidenceHigh}
              cbrMedian={cbrMedian}
            />

            {cbrCheck?.divergence_pct != null && cbrCheck.cbr_median != null && (
              <div className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Note: </span>
                Recent comparable sales suggest a median of {fmt(cbrCheck.cbr_median)} —{' '}
                {cbrCheck.divergence_pct > 0
                  ? `the model estimate is ${Math.abs(cbrCheck.divergence_pct).toFixed(1)}% below that median.`
                  : `the model estimate is ${Math.abs(cbrCheck.divergence_pct).toFixed(1)}% above that median.`}
              </div>
            )}

            <button
              type="button"
              className="mt-3 text-xs text-muted-foreground underline"
              onClick={() => {
                setListingAmount(null)
                setListingInput('')
              }}
            >
              Change asking price
            </button>
          </>
        )}
      </div>

      {/* What you're paying for */}
      {shap?.shap_values?.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">What you&apos;re paying for</h3>
          {shap?.explanation_type === 'global' && (
            <div className="mb-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                ⚠️ Showing average feature importance — per-prediction explanation unavailable for this
                flat.
                {shap?.fallback_reason ? (
                  <span className="block mt-1 text-[11px] opacity-90">{shap.fallback_reason}</span>
                ) : null}
              </p>
            </div>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Why the model priced this specific flat at {fmt(predictedPrice)} — each factor&apos;s dollar
            contribution.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {driverCards.map((driver) => (
              <div
                key={driver.feature}
                className="rounded-xl border border-border/60 bg-white p-4 dark:bg-background"
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
                <div className="mt-2 h-1.5 rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full bg-emerald-400"
                    style={{ width: `${Math.min(100, driver.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {Math.abs(marketTimingShap) > 0.01 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
              <p className="text-xs text-amber-900 dark:text-amber-100">
                <span className="font-semibold">
                  📈 Market timing adds ~{fmt(Math.abs(marketTimingShap))}
                  {marketTimingShap < 0 ? ' (downward)' : ''}
                </span>
                {' — '}
                reflects {saleMonthLabel || Math.round(saleYearNote || new Date().getFullYear())} market
                levels; applies broadly, not only to this unit.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pattern check */}
      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">🔍 Pattern check</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How this flat lines up with pricing patterns from historical resale transactions.
        </p>
        {!rules ? (
          <p className="mt-3 text-xs text-muted-foreground">Loading patterns…</p>
        ) : (
          <>
          {primaryApriori && (
            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
              <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                Market pattern match ({Math.round((primaryApriori.confidence || 0) * 100)}% confidence)
              </p>
              <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                Flats with {humanizeConditions(primaryApriori.if_conditions)} typically sell for{' '}
                <strong>{humanizeOutcome(primaryApriori.then)}</strong>.{' '}
                {listingAmount
                  ? assessMatch(listingAmount, predictedPrice, primaryApriori)
                  : 'Add an asking price to see how this listing compares.'}
              </p>
            </div>
          )}
          {surrogateRule && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Price bracket rule</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                Based on the decision tree, flats in a similar band (covering{' '}
                {(surrogateRule.samples || 0).toLocaleString()} similar transactions) have a typical
                price around <strong>{fmt(surrogateRule.then_price)}</strong>.
              </p>
            </div>
          )}
          {!primaryApriori && !surrogateRule && (
            <p className="mt-3 text-xs text-muted-foreground">
              No strong pattern match for this combination — rely on the AI estimate and comparables
              below.
            </p>
          )}
          </>
        )}
      </div>

      {/* LIME local pricing factors */}
      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">💡 Local pricing factors</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Key conditions the model identified in the local market around this flat.
        </p>
        {limeLoading && (
          <div className="mt-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        )}
        {!limeLoading && limeError && (
          <p className="mt-3 text-xs text-destructive">{limeError}</p>
        )}
        {!limeLoading && !limeError && limeScenarios.length > 0 && (
          <div className="mt-3 space-y-2">
            {limeScenarios.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3"
              >
                <div>
                  <p className="text-xs font-medium text-foreground">{s.label}</p>
                  <p className="text-xs text-muted-foreground">Local market pattern (LIME)</p>
                </div>
                <p
                  className={`text-sm font-bold tabular-nums ${
                    s.change >= 0 ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {s.change >= 0 ? '+' : ''}
                  {fmt(s.change)}
                </p>
              </div>
            ))}
          </div>
        )}
        {!limeLoading && !limeError && limeScenarios.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            No local pricing factors to show for this estimate (all rules were filtered or none returned).
          </p>
        )}
        <p className="mt-3 text-xs italic text-muted-foreground">
          Price impacts shown are for each condition being true vs false in the local neighbourhood — not
          marginal per-unit changes.
        </p>
      </div>

      {/* CBR table */}
      {comparables?.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">Similar past sales</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Comparable transactions used for context (not a guarantee of resale outcome).
          </p>
          {showPoorCompDisclaimer && (
            <div className="mb-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                ⚠️ Limited close matches found — comparables shown are from a broader search.
                Cross-check with recent sales in {toTitle(town) || 'this town'} for confirmation.
              </p>
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-border text-left">
                  {['Address', 'sqm', 'Floor', 'Price', 'Year', 'vs AI est.', ...(listingAmount ? ['vs Listing'] : [])].map(
                    (h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 font-bold uppercase text-muted-foreground">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {comparables.map((c, i) => {
                  const vsAI = (((c.resale_price - predictedPrice) / predictedPrice) * 100).toFixed(1)
                  const vsListing = listingAmount
                    ? (((c.resale_price - listingAmount) / listingAmount) * 100).toFixed(1)
                    : null
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
                          className={`font-semibold ${Number(vsAI) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}
                        >
                          {Number(vsAI) >= 0 ? '+' : ''}
                          {vsAI}%
                        </span>
                      </td>
                      {listingAmount && (
                        <td className="px-2 py-2">
                          <span
                            className={`font-semibold ${Number(vsListing) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}
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
        </div>
      )}

      {/* Negotiation */}
      {listingAmount && negotiation && (
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">🤝 Negotiation guide</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Combined view from model, comparables, and patterns — not financial advice.
          </p>
          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium text-muted-foreground">Suggested opening offer (anchor)</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {fmt(negotiation.openingOffer)}
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-muted-foreground">
              {negotiation.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
