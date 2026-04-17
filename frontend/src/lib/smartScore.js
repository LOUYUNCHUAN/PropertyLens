/**
 * Smart Score for shortlist rows — pure deal-quality, computed client-side from
 * the frozen wishlist snapshot + one POST /api/validate-listing per row.
 *
 * Three pillars: Price vs model (50) + Comp agreement (35) + Lease quality (15).
 * Apriori violations and wide confidence bands are surfaced as non-scored flags.
 */

const clamp = (lo, hi, x) => Math.max(lo, Math.min(hi, x))

function median(values) {
  const arr = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (arr.length === 0) return null
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

export function wishlistDetailToSnapshot(detail) {
  if (!detail) return null
  const shapArr = detail.shap_snapshot_json || []
  const shap_values = {}
  for (const row of shapArr) {
    if (row && row.feature != null) shap_values[row.feature] = row.shap_value
  }
  const cbr_matches = (detail.cbr_snapshot_json || []).map((c) => ({
    match_score: c.similarity_pct ?? c.match_score ?? 0,
    resale_price: c.resale_price ?? null
  }))
  const payload = detail.payload_json || {}
  return {
    listing_price: detail.listing_price,
    model_estimate: detail.predicted_price,
    confidence_low: detail.confidence_low ?? null,
    confidence_high: detail.confidence_high ?? null,
    remaining_lease_years:
      payload.remaining_lease_years != null ? Number(payload.remaining_lease_years) : null,
    shap_values,
    cbr_matches,
    payload_json: payload,
    nearby: detail.map_snapshot_json?.nearby || null
  }
}

/** Apriori violation count from /api/validate-listing response. Null if unavailable. */
export function aprioriViolationCount(data) {
  const a = data?.apriori
  if (!a) return null
  return Number(a.violation_count ?? 0)
}

export function buildValidateListingRequestBody(detail) {
  const p = detail?.payload_json
  if (!p || typeof p !== 'object') return null
  const ask = detail.listing_price ?? detail.predicted_price
  if (ask == null || !(Number(ask) > 0)) return null
  const asking_price = Number(ask)

  const floor_area_sqm = Number(p.floor_area_sqm)
  const storey_mid = Number(p.storey_mid)
  const remaining_lease_years = Number(p.remaining_lease_years)
  const dist_nearest_mrt_km = Number(p.dist_nearest_mrt_km)
  const scalarOk = [
    floor_area_sqm,
    storey_mid,
    remaining_lease_years,
    dist_nearest_mrt_km
  ].every((x) => Number.isFinite(x))

  if (scalarOk) {
    return {
      mode: 'scalar',
      body: {
        asking_price,
        flat_type: String(p.flat_type || '4 ROOM'),
        floor_area_sqm,
        storey_mid,
        remaining_lease_years,
        dist_nearest_mrt_km,
        is_mature_estate: Number(p.is_mature_estate ?? 0) !== 0
      }
    }
  }
  return { mode: 'flat', body: { asking_price, flat: p } }
}

// ---------- Pillar 1: Price vs model (max 50) ----------
// Peak (50) is reached at -5% below model and held to -15%. Above -5% the score
// falls roughly 2.5 points per percent until +15%, where it hits zero.
// Wide confidence bands shrink the whole component (we trust the model less).
export function priceVsModelScore(snap) {
  const listing = Number(snap?.listing_price)
  const predicted = Number(snap?.model_estimate)
  if (!(listing > 0) || !(predicted > 0)) {
    return { score: 0, present: false, gap: null, confTrust: 1 }
  }
  const gap = (listing - predicted) / predicted
  const lo = Number(snap?.confidence_low)
  const hi = Number(snap?.confidence_high)
  const bandWidth = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? (hi - lo) / predicted : 0
  const confTrust = clamp(0.5, 1.0, 1 - bandWidth)
  // gap = -0.05 → premium 0; gap = +0.15 → premium 0.20 → 50 - 0.20*100*2.5 = 0
  const premium = Math.max(0, gap + 0.05)
  const raw = 50 - premium * 100 * 2.5
  const score = clamp(0, 50, raw) * confTrust
  return { score, present: true, gap, confTrust }
}

// ---------- Pillar 2: Comp agreement (max 35) ----------
// Compare listing to median sale price of top-3 CBR comps. Reward listings at or
// below the comp median; penalise above. Falls back to 0 / "few comps" flag if
// fewer than 3 comps carry a resale_price.
export function compAgreementScore(snap) {
  const listing = Number(snap?.listing_price)
  const top = (snap?.cbr_matches || []).slice(0, 3)
  const prices = top.map((c) => Number(c.resale_price)).filter((p) => p > 0)
  if (!(listing > 0) || prices.length === 0) {
    return { score: 0, present: false, compGap: null, usableComps: prices.length }
  }
  const med = median(prices)
  if (!(med > 0)) {
    return { score: 0, present: false, compGap: null, usableComps: prices.length }
  }
  const compGap = (listing - med) / med
  const premium = Math.max(0, compGap)
  const raw = 35 - premium * 100 * 1.5
  let score = clamp(0, 35, raw)
  // Soft penalty when we have fewer than 3 comps to lean on
  if (prices.length < 3) score *= prices.length / 3
  return { score, present: true, compGap, usableComps: prices.length }
}

// ---------- Pillar 3: Lease quality (max 15) ----------
export function leaseQualityScore(snap) {
  const years = Number(snap?.remaining_lease_years)
  if (!Number.isFinite(years) || years <= 0) {
    return { score: 0, present: false, years: null }
  }
  let score
  if (years >= 90) score = 15
  else if (years >= 60) score = 10 + ((years - 60) / 30) * 5
  else if (years >= 40) score = 5 + ((years - 40) / 20) * 5
  else if (years >= 30) score = ((years - 30) / 10) * 5
  else score = 0
  return { score, present: true, years }
}

// ---------- Combined ----------
export function computeScoreComponents(snap, aprioriViolations = null) {
  const price = priceVsModelScore(snap)
  const comps = compAgreementScore(snap)
  const lease = leaseQualityScore(snap)

  const aprioriV =
    typeof aprioriViolations === 'number' && Number.isFinite(aprioriViolations)
      ? aprioriViolations
      : null

  const bandWidth =
    price.present && Number.isFinite(price.confTrust) ? 1 - price.confTrust : 0
  const flags = {
    apriori: aprioriV != null && aprioriV > 0 ? aprioriV : 0,
    aprioriAvailable: aprioriV != null,
    wideBand: bandWidth > 0.0001,
    fewComps: comps.present && comps.usableComps < 3
  }

  return {
    priceScore: price.score,
    compScore: comps.score,
    leaseScore: lease.score,
    gap: price.gap,
    compGap: comps.compGap,
    leaseYears: lease.years,
    confTrust: price.confTrust,
    flags,
    presence: {
      price: price.present,
      comps: comps.present,
      lease: lease.present
    }
  }
}

export function sumComponents(c) {
  return Math.round(
    clamp(0, 100, (c.priceScore || 0) + (c.compScore || 0) + (c.leaseScore || 0))
  )
}

export function smartScoreComplete(components) {
  const p = components?.presence
  if (!p) return true
  return !!(p.price && p.comps && p.lease)
}

export function getBadge(score, options = {}) {
  const complete = options.complete !== false
  if (!complete) {
    return { label: 'Incomplete', color: 'slate', emoji: '◽' }
  }
  if (score >= 75) return { label: 'Strong deal', color: 'green', emoji: '🟢' }
  if (score >= 50) return { label: 'Fair', color: 'amber', emoji: '🟡' }
  return { label: 'Overpriced', color: 'red', emoji: '🔴' }
}

export function smartScoreBreakdownTitle(components) {
  if (!components) return ''
  const p = components.presence || {}
  const seg = (ok, key) =>
    ok === false ? '—' : String(Math.round(components[key] ?? 0))
  const price = seg(p.price, 'priceScore')
  const comps = seg(p.comps, 'compScore')
  const lease = seg(p.lease, 'leaseScore')
  const parts = [`Price: ${price} · Comparable sales: ${comps} · Lease: ${lease}`]
  if (!smartScoreComplete(components)) {
    parts.unshift('Partial score — some inputs missing.')
  }
  const f = components.flags || {}
  const flagBits = []
  if (f.apriori > 0) flagBits.push(`${f.apriori} rule violation${f.apriori > 1 ? 's' : ''}`)
  if (f.wideBand) flagBits.push('wide confidence band')
  if (f.fewComps) flagBits.push('few comps')
  if (flagBits.length) parts.push(`Flags: ${flagBits.join(', ')}.`)
  return parts.join(' ')
}

export function generateReason(snap, scores) {
  const { gap, compGap, presence } = scores
  const pr = presence || { price: true, comps: true, lease: true }

  const gapPct = gap != null ? gap * 100 : null
  const gapSentence = !pr.price
    ? 'Listing vs model comparison unavailable.'
    : gapPct < -5
      ? `Listed ${Math.abs(gapPct).toFixed(1)}% below the model — looks like a real bargain.`
      : gapPct > 10
        ? `Listed ${gapPct.toFixed(1)}% above the model.`
        : `Listed close to model estimate.`

  const compPct = compGap != null ? compGap * 100 : null
  const compSentence = !pr.comps
    ? 'No comparable sales available.'
    : compPct < -3
      ? `Recent comps sold ~${Math.abs(compPct).toFixed(1)}% higher.`
      : compPct > 3
        ? `Recent comps sold ~${compPct.toFixed(1)}% lower — comps disagree.`
        : `Recent comps agree on the price.`

  const leaseYears = scores.leaseYears
  const leaseSentence = !pr.lease
    ? ''
    : leaseYears >= 80
      ? ''
      : leaseYears >= 50
        ? ` ${Math.round(leaseYears)} years lease left.`
        : ` Short lease (${Math.round(leaseYears)} yrs) — financing/CPF limits apply.`

  return `${gapSentence} ${compSentence}${leaseSentence}`
}
