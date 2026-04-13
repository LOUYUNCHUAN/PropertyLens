/**
 * Shortlist persona ranking + row tags (client-side, uses wishlist snapshot).
 */

import globalShapMeans from './globalShapMeans.json'

export const PERSONAS = [
  {
    id: 'family',
    label: 'Family',
    emoji: '👨‍👩‍👧',
    sortLabel: 'Ranked by school quality (SHAP-weighted)'
  },
  {
    id: 'commuter',
    label: 'Commuter',
    emoji: '💼',
    sortLabel: 'Ranked by MRT access (SHAP-weighted)'
  },
  {
    id: 'investor',
    label: 'Investor',
    emoji: '💰',
    sortLabel: 'Ranked by investment value (gap + CBR + fundamentals)'
  }
]

/** Stable fundamentals for investor ratio (model SHAP keys only — no dist_to_nearest_mall_m). */
export const INVESTOR_STABLE_FEATURES = [
  'primary_school_quality_1km_weighted',
  'dist_to_mrt_m',
  'floor_area_sqm',
  'lease_remaining_years',
  'mall_weighted_access_3km'
]

const INVESTOR_VOLATILE_FEATURES = ['transaction_year']

const SHAP_NORM_EPS = 1e-9
/** When a snapshot key is missing from globalShapMeans, scale by this so unknowns do not dominate. */
const UNKNOWN_SHAP_FEATURE_SCALE = 20000

function shapNormContrib(feature, raw, means) {
  const abs = Math.abs(Number(raw) || 0)
  if (abs === 0) return 0
  const mu = means[feature]
  const denom =
    mu != null && Number(mu) > SHAP_NORM_EPS
      ? Number(mu)
      : UNKNOWN_SHAP_FEATURE_SCALE
  return abs / Math.max(denom, SHAP_NORM_EPS)
}

function shapNormSignedContrib(feature, raw, means) {
  const v = Number(raw) || 0
  if (v === 0) return 0
  const abs = Math.abs(v)
  const mu = means[feature]
  const denom =
    mu != null && Number(mu) > SHAP_NORM_EPS
      ? Number(mu)
      : UNKNOWN_SHAP_FEATURE_SCALE
  const norm = abs / Math.max(denom, SHAP_NORM_EPS)
  return v < 0 ? -norm : norm
}

function totalNormalizedMass(shap, means) {
  let t = 0
  for (const [k, v] of Object.entries(shap)) {
    t += shapNormContrib(k, v, means)
  }
  return t
}

/**
 * Normalized stable vs timing SHAP balance for investor (0–1 scale, not raw fractions).
 */
export function investorFundamentalsSignal(snap, means = globalShapMeans) {
  const shap = snap?.shap_values
  if (!shap || typeof shap !== 'object') return 0

  const totalNorm = totalNormalizedMass(shap, means)
  if (totalNorm < 1e-12) return 0

  const stableNorm = INVESTOR_STABLE_FEATURES.reduce(
    (s, f) => s + shapNormContrib(f, shap[f], means),
    0
  )
  const volatileNorm = INVESTOR_VOLATILE_FEATURES.reduce(
    (s, f) => s + shapNormContrib(f, shap[f], means),
    0
  )

  const fundamentalsRatio = stableNorm / totalNorm
  const volatilityPenalty = volatileNorm / totalNorm
  return Math.max(0, fundamentalsRatio - volatilityPenalty)
}

/** transaction_year share of total normalized |SHAP| mass (for investor tag context). */
export function investorTxYearNormShare(snap, means = globalShapMeans) {
  const shap = snap?.shap_values
  if (!shap || typeof shap !== 'object') return 0
  const totalNorm = totalNormalizedMass(shap, means)
  if (totalNorm < 1e-12) return 0
  return shapNormContrib('transaction_year', shap.transaction_year, means) / totalNorm
}

/** @param {Record<string, unknown>|null|undefined} nearby */
function schoolsFromNearby(nearby) {
  if (!nearby || typeof nearby !== 'object') return []
  const raw = nearby.school
  const list = Array.isArray(raw) ? raw : []
  return [...list].sort(
    (a, b) => (Number(a.dist_m) || 0) - (Number(b.dist_m) || 0)
  )
}

/** @param {Record<string, unknown>|null|undefined} nearby */
function mrtsFromNearby(nearby) {
  if (!nearby || typeof nearby !== 'object') return []
  const out = []
  for (const key of ['mrt', 'lrt']) {
    const raw = nearby[key]
    if (Array.isArray(raw)) out.push(...raw)
  }
  return out.sort(
    (a, b) => (Number(a.dist_m) || 0) - (Number(b.dist_m) || 0)
  )
}

export function familyScore(snap) {
  if (!snap?.shap_values) return 0
  const shap = snap.shap_values
  const schoolQualitySHAP = Number(
    shap.primary_school_quality_1km_weighted ?? 0
  )
  const schoolCountSHAP = Number(shap.school_count_1km ?? 0)
  const primaryCountSHAP = Number(shap.primary_school_count_1km ?? 0)
  return (
    shapNormSignedContrib(
      'primary_school_quality_1km_weighted',
      schoolQualitySHAP,
      globalShapMeans
    ) *
      0.7 +
    shapNormSignedContrib('school_count_1km', schoolCountSHAP, globalShapMeans) *
      0.2 +
    shapNormSignedContrib(
      'primary_school_count_1km',
      primaryCountSHAP,
      globalShapMeans
    ) *
      0.1
  )
}

export function familyTag(snap) {
  const schools = schoolsFromNearby(snap?.nearby)
  const topSchool = schools[0]
  if (!topSchool) return 'No schools nearby'

  const name = String(topSchool.name || 'School')
  const dm = Math.round(Number(topSchool.dist_m) || 0)
  return `${name} · ${dm}m`
}

export function commuterScore(snap) {
  if (!snap?.shap_values) return 0
  const shap = snap.shap_values
  const mrt = shapNormSignedContrib(
    'dist_to_mrt_m',
    shap.dist_to_mrt_m ?? 0,
    globalShapMeans
  )
  const highwayRaw = Number(shap.dist_to_highway_m ?? 0)
  // Penalize only the sign case that indicates "highway proximity helps" (per terminal note),
  // and never penalize the common negative-noise case commuters tolerate.
  const highwayPenalty =
    highwayRaw > 0
      ? shapNormContrib('dist_to_highway_m', highwayRaw, globalShapMeans) * 0.2
      : 0
  return mrt - highwayPenalty
}

export function commuterTag(snap) {
  const mrts = mrtsFromNearby(snap?.nearby)
  const nearest = mrts[0]
  if (!nearest) return 'No MRT data'
  const dm = Math.round(Number(nearest.dist_m) || 0)
  const walkMin = Math.round(dm / 75)
  const name = String(nearest.name || 'MRT')
  return `${name} · ${dm}m · ~${walkMin} min walk`
}

export function investorScore(snap) {
  if (!snap) return 0
  const modelEst = Number(snap.model_estimate)
  const listing = snap.listing_price
  let gapSignal = 0.5
  if (listing != null && modelEst > 0) {
    const vsModel = (Number(listing) - modelEst) / modelEst
    gapSignal = Math.max(0, Math.min(1, 0.5 - vsModel * 2.5))
  }

  const cbr = (snap.cbr_matches || []).slice(0, 3)
  const avgCBR = cbr.length
    ? cbr.reduce((s, c) => s + (Number(c.match_score) || 0), 0) / cbr.length
    : 50
  const cbrSignal = avgCBR / 100

  const fundamentalsSignal = investorFundamentalsSignal(snap)

  return gapSignal * 0.4 + cbrSignal * 0.3 + fundamentalsSignal * 0.3
}

export function investorTag(snap) {
  const modelEst = Number(snap?.model_estimate)
  const listing = snap?.listing_price
  if (listing == null || !(modelEst > 0)) {
    return 'No listing price · compare to model in detail'
  }
  const vsModel =
    ((Number(listing) - modelEst) / modelEst) * 100

  const sig = investorFundamentalsSignal(snap)
  const txPct = Math.round(investorTxYearNormShare(snap) * 100)

  const gapStr =
    vsModel < 0
      ? `${Math.abs(vsModel).toFixed(1)}% below model`
      : `${vsModel.toFixed(1)}% above model`

  let driverStr
  if (sig > 0.3) {
    driverStr = '✓ fundamentals-driven'
  } else if (sig > 0.1) {
    driverStr = '~ mixed drivers'
  } else {
    driverStr = `⚠️ Market timing dominant (${txPct}% of normalized |SHAP| mass)`
  }

  return `${gapStr} · ${driverStr}`
}

export function getPersonaScore(persona, snap) {
  if (!snap) return 0
  if (persona === 'family') return familyScore(snap)
  if (persona === 'commuter') return commuterScore(snap)
  if (persona === 'investor') return investorScore(snap)
  return 0
}

export function getPersonaTag(persona, snap) {
  if (!snap) return null
  if (persona === 'family') return familyTag(snap)
  if (persona === 'commuter') return commuterTag(snap)
  if (persona === 'investor') return investorTag(snap)
  return null
}
