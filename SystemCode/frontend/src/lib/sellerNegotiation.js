import { DRIVER_LABELS } from '@/lib/buyerExplain.js'

/**
 * Short pre-listing insight from flat + SHAP (seller framing).
 */
export function getBeforeYouListInsight(baseFlatPayload, shapValues) {
  if (!baseFlatPayload || !Array.isArray(shapValues)) {
    return 'Review drivers below to decide what to emphasise in photos and copy before you list.'
  }
  const lease = shapValues.find((s) => s.feature === 'lease_remaining_years')
  const area = shapValues.find((s) => s.feature === 'floor_area_sqm')
  const mrt = shapValues.find((s) => s.feature === 'dist_to_mrt_m')
  const parts = []
  if (lease && lease.shap_value > 5000) {
    parts.push(
      `Strong remaining lease (${Math.round(baseFlatPayload.remaining_lease_years || lease.feature_value || 0)} yrs) is helping your estimate — say it clearly in the listing.`
    )
  }
  if (area && area.shap_value > 5000) {
    parts.push(
      `Floor area is a major positive — lead with sqm and layout in your title or first line.`
    )
  }
  if (mrt && mrt.shap_value > 3000) {
    parts.push(`MRT access is lifting value — mention walking time to the nearest station.`)
  }
  if (parts.length === 0) {
    return 'Use the driver cards below to spot what buyers will weight most; lead with your strongest positives in the listing.'
  }
  return parts.slice(0, 2).join(' ')
}

export function buildSuggestedListingNote({
  aprioriViolated,
  askingPrice,
  predictedPrice,
  listingMultiplier
}) {
  const suggested = predictedPrice
    ? Math.round(predictedPrice * (listingMultiplier || 1.03))
    : null
  const fmt = (n) => `$${Math.round(n).toLocaleString()}`
  if (aprioriViolated) {
    return `Your ask or checks suggest tension with typical patterns — consider ${suggested ? fmt(suggested) : 'the suggested figure'} as a starting anchor and be ready to justify premium with comps.`
  }
  if (suggested && askingPrice != null) {
    return `Suggested listing ${fmt(suggested)} (${((listingMultiplier || 1.03) - 1) * 100}% vs AI) aligns with common negotiation room when patterns and CSP look consistent.`
  }
  return suggested
    ? `Suggested listing ${fmt(suggested)} leaves typical headroom versus the AI fair value.`
    : null
}

/**
 * Numbered tactics for seller negotiation step (uses driver card semantics).
 */
export function buildNegotiationTactics({
  driverCards = [],
  town,
  comparables = []
}) {
  const tactics = []
  const top = driverCards[0]
  if (top) {
    const meta = DRIVER_LABELS[top.feature]
    const label = meta?.label || top.label
    tactics.push(
      `Lead with ${label.toLowerCase()}${top.featureText ? ` (${top.featureText})` : ''} — it is the largest swing factor in the model’s breakdown.`
    )
  }
  const tu = String(town || '').toUpperCase()
  const sameTown = comparables.filter((c) => String(c.town || '').toUpperCase() === tu)
  if (sameTown.length >= 2) {
    tactics.push(
      `Anchor buyers on ${sameTown.length} recent sales in ${town || 'your town'} — same-town comps feel most credible.`
    )
  } else if (comparables.length > 0) {
    tactics.push(
      `Comparables span a wider area — be transparent about distance and similarity so buyers trust your ask.`
    )
  }
  tactics.push(
    `Prepare a walk-away floor using the counterfactual band below, and treat the AI range as a sanity check, not a guarantee.`
  )
  tactics.push(
    `If objections cite lease or timing, counter with concrete years left and your sale month context from the market-timing note above.`
  )
  return tactics.slice(0, 5)
}
