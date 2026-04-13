/**
 * Smart Score for shortlist rows — computed client-side + POST /api/validate-listing.
 * Maps backend wishlist detail + validate response shapes.
 */

import globalShapMeans from './globalShapMeans.json'

const SHAP_MEAN_EPS = 1e-9
/** When school+MRT |SHAP| are each near their global means (ratio ~1), avgNorm ~1 => ~10/20 fundamentals. */
const FUNDAMENTALS_SCALE = 10

/**
 * Fundamentals subscore (0–20) from SHAP: school + MRT drivers normalized by global mean |SHAP|
 * so huge features (e.g. transaction_year) do not shrink the share to zero.
 */
export function fundamentalsScoreFromShap(shap, means = globalShapMeans) {
  const m = means || globalShapMeans
  const meanWeighted = Number(m.primary_school_quality_1km_weighted) || SHAP_MEAN_EPS
  const meanMrt = Number(m.dist_to_mrt_m) || SHAP_MEAN_EPS
  const meanDistSchool = Number(m.dist_to_nearest_school_m) || SHAP_MEAN_EPS

  let schoolVal = 0
  let schoolDenom = meanWeighted
  const w = shap?.primary_school_quality_1km_weighted
  const t = shap?.primary_school_top_quality_1km
  const d = shap?.dist_to_nearest_school_m
  if (w != null) {
    schoolVal = Math.abs(Number(w) || 0)
    schoolDenom = meanWeighted
  } else if (t != null) {
    schoolVal = Math.abs(Number(t) || 0)
    schoolDenom = meanWeighted
  } else if (d != null) {
    schoolVal = Math.abs(Number(d) || 0)
    schoolDenom = meanDistSchool
  }

  const normSchool = schoolVal / Math.max(schoolDenom, SHAP_MEAN_EPS)
  const mrtRaw = shap?.dist_to_mrt_m
  const mrtVal = mrtRaw != null ? Math.abs(Number(mrtRaw) || 0) : 0
  const normMrt = mrtVal / Math.max(meanMrt, SHAP_MEAN_EPS)

  const avgNorm = (normSchool + normMrt) / 2
  return Math.min(20, FUNDAMENTALS_SCALE * avgNorm)
}

export function wishlistDetailToSnapshot(detail) {
  if (!detail) return null
  const listing_price = detail.listing_price
  const model_estimate = detail.predicted_price
  const shapArr = detail.shap_snapshot_json || []
  const shap_values = {}
  for (const row of shapArr) {
    if (row && row.feature != null) shap_values[row.feature] = row.shap_value
  }
  const cbr_matches = (detail.cbr_snapshot_json || []).map((c) => ({
    match_score: c.similarity_pct ?? c.match_score ?? 0
  }))
  return {
    listing_price,
    model_estimate,
    shap_values,
    cbr_matches,
    payload_json: detail.payload_json || {},
    /** Frozen map snapshot: { mrt, school, hawker, mall } arrays with dist_m */
    nearby: detail.map_snapshot_json?.nearby || null
  }
}

/** Map ValidateResponse to 0–25 from apriori subsystem only. Null if unavailable. */
export function aprioriPointsFromValidate(data) {
  const a = data?.apriori
  if (!a) return null
  const v = a.violation_count ?? 0
  if (v === 0) return 25
  return Math.max(0, Math.min(25, 25 - v * 5))
}

/**
 * POST /api/validate-listing body: either top-level scalars (no `flat`) or `{ asking_price, flat }`.
 * Apriori only needs scalars; nested `flat` must satisfy full PredictRequest and often 422s on partial extension payloads.
 */
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

export function computeScoreComponents(snap, aprioriScore) {
  const modelEst = snap?.model_estimate
  let valueGapScore = 0
  let vsModel = 0
  let hasValueGap = false
  if (
    snap?.listing_price != null &&
    modelEst != null &&
    Number(modelEst) > 0
  ) {
    hasValueGap = true
    vsModel = (snap.listing_price - modelEst) / modelEst
    valueGapScore = Math.max(
      0,
      Math.min(30, 30 - vsModel * 100 * 1.5)
    )
  }

  const topCBR = (snap.cbr_matches || []).slice(0, 3)
  const hasCbr = topCBR.length > 0
  const avgCBR = hasCbr
    ? topCBR.reduce((s, c) => s + (Number(c.match_score) || 0), 0) /
      topCBR.length
    : null
  const cbrScore = hasCbr ? (avgCBR / 100) * 25 : 0

  const shap = snap.shap_values || {}
  const fundamentalsScore = fundamentalsScoreFromShap(shap)

  const hasApriori =
    aprioriScore != null &&
    typeof aprioriScore === 'number' &&
    Number.isFinite(aprioriScore)
  const apriori = hasApriori ? aprioriScore : 0

  return {
    valueGapScore,
    cbrScore,
    aprioriScore: apriori,
    fundamentalsScore,
    vsModel,
    avgCBR,
    presence: {
      valueGap: hasValueGap,
      cbr: hasCbr,
      apriori: hasApriori
    }
  }
}

export function sumComponents(c) {
  return Math.round(
    Math.min(
      100,
      Math.max(
        0,
        c.valueGapScore +
          c.cbrScore +
          c.aprioriScore +
          c.fundamentalsScore
      )
    )
  )
}

export function smartScoreComplete(components) {
  const p = components?.presence
  if (!p) return true
  return !!(p.valueGap && p.cbr && p.apriori)
}

export function getBadge(score, options = {}) {
  const complete = options.complete !== false
  if (!complete) {
    return { label: 'Incomplete', color: 'slate', emoji: '◽' }
  }
  if (score >= 70)
    return { label: 'Strong', color: 'green', emoji: '🟢' }
  if (score >= 45)
    return { label: 'Fair', color: 'amber', emoji: '🟡' }
  return { label: 'Overpriced', color: 'red', emoji: '🔴' }
}

/** Tooltip line for shortlist Smart Score chip. */
export function smartScoreBreakdownTitle(components) {
  if (!components) return ''
  const p = components.presence || {}
  const seg = (ok, ptsKey) =>
    ok === false ? '—' : String(Math.round(components[ptsKey] ?? 0))
  const v = seg(p.valueGap, 'valueGapScore')
  const c = seg(p.cbr, 'cbrScore')
  const r = seg(p.apriori, 'aprioriScore')
  const f = String(Math.round(components.fundamentalsScore ?? 0))
  const parts = [`Value gap: ${v} · CBR: ${c} · Rules: ${r} · Fundamentals: ${f}`]
  if (!smartScoreComplete(components)) {
    parts.unshift('Partial score — some inputs missing.')
  }
  return parts.join(' ')
}

const DRIVER_LABELS = {
  floor_area_sqm: 'large floor area',
  primary_school_quality_1km_weighted: 'strong school proximity',
  primary_school_top_quality_1km: 'school proximity',
  dist_to_nearest_school_m: 'school distance',
  dist_to_mrt_m: 'MRT distance',
  lease_remaining_years: 'lease remaining',
  level_mid: 'floor level',
  transaction_year: 'market timing',
  dist_to_highway_m: 'highway proximity',
  dist_to_foodcourt_m: 'hawker access',
  mall_weighted_access_3km: 'mall access'
}

export function generateReason(snap, scores) {
  const { vsModel, avgCBR, presence } = scores
  const pr = presence || {
    valueGap: true,
    cbr: true,
    apriori: true
  }
  const shap = snap.shap_values || {}
  const topDriver = Object.entries(shap).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  )[0]

  const driverLabel =
    DRIVER_LABELS[topDriver?.[0]] ?? topDriver?.[0]?.replace(/_/g, ' ') ?? 'features'
  const driverEffect = (topDriver?.[1] ?? 0) > 0 ? 'supports' : 'drags'

  const vsPct = vsModel * 100
  const gapSentence = !pr.valueGap
    ? 'Listing vs model comparison unavailable.'
    : vsPct < -5
      ? `Listed ${Math.abs(vsPct).toFixed(1)}% below model estimate.`
      : vsPct > 10
        ? `Listed ${vsPct.toFixed(1)}% above model estimate.`
        : `Listed close to model estimate.`

  const cbrSentence = !pr.cbr
    ? 'Comparable data unavailable.'
    : avgCBR >= 80
      ? `Comparables strongly support the price.`
      : avgCBR >= 60
        ? `Comparables partially support the price.`
        : `Limited comparable support.`

  const ruleBit = !pr.apriori ? 'Rule validation unavailable. ' : ''

  return `${ruleBit}${gapSentence} ${driverLabel} ${driverEffect} value. ${cbrSentence}`
}
