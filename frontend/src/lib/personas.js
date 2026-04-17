/**
 * Shortlist persona ranking + row tags (client-side, uses wishlist snapshot).
 */

import {
  computeScoreComponents,
  sumComponents
} from './smartScore.js'

export const PERSONAS = [
  {
    id: 'family',
    label: 'Family',
    emoji: '👨‍👩‍👧',
    sortLabel: 'Ranked by nearest school + schools within 1km',
    sortLegend:
      '70% how close the nearest school is (up to 1.5 km), 30% how many schools are within 1 km (cap 5). Higher score = better for families.'
  },
  {
    id: 'commuter',
    label: 'Commuter',
    emoji: '💼',
    sortLabel: 'Ranked by MRT proximity',
    sortLegend:
      '70% how close the nearest MRT/LRT is (up to 1.2 km), 30% how many stations are within 1 km (cap 3). Higher score = better for commuting.'
  },
  {
    id: 'investor',
    label: 'Investor',
    emoji: '💰',
    sortLabel: 'Ranked by Smart Score (60% price vs model, 20% comps, 20% lease)',
    sortLegend:
      'Smart Score 0–100: 60% listing vs model, 20% vs comparable sales, 20% remaining lease. Higher = stronger deal signal.'
  }
]

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

// Family persona: rank by real schools from the frozen amenities snapshot,
// not by SHAP. Distance to nearest school + count within 1km, blended 70/30.
const FAMILY_NEAR_THRESHOLD_M = 1500 // distance at which the proximity term hits zero
const FAMILY_COUNT_TARGET = 5 // count at which the choice term saturates

export function familyScore(snap) {
  const schools = schoolsFromNearby(snap?.nearby)
  if (schools.length === 0) return 0
  const nearestM = Number(schools[0].dist_m) || 0
  const proximity = Math.max(0, 1 - nearestM / FAMILY_NEAR_THRESHOLD_M)
  const countWithin1km = schools.filter((s) => (Number(s.dist_m) || 0) <= 1000).length
  const choice = Math.min(1, countWithin1km / FAMILY_COUNT_TARGET)
  return proximity * 0.7 + choice * 0.3
}

export function familyTag(snap) {
  const schools = schoolsFromNearby(snap?.nearby)
  const topSchool = schools[0]
  if (!topSchool) return 'No schools nearby'

  const name = String(topSchool.name || 'School')
  const dm = Math.round(Number(topSchool.dist_m) || 0)
  return `${name} · ${dm}m`
}

// Commuter persona: rank by real MRT/LRT stations from the frozen amenities snapshot,
// not by SHAP. Distance to nearest station + count within 1km, blended 70/30.
const COMMUTER_NEAR_THRESHOLD_M = 1200
const COMMUTER_COUNT_TARGET = 3

export function commuterScore(snap) {
  const stations = mrtsFromNearby(snap?.nearby)
  if (stations.length === 0) return 0
  const nearestM = Number(stations[0].dist_m) || 0
  const proximity = Math.max(0, 1 - nearestM / COMMUTER_NEAR_THRESHOLD_M)
  const countWithin1km = stations.filter((s) => (Number(s.dist_m) || 0) <= 1000).length
  const choice = Math.min(1, countWithin1km / COMMUTER_COUNT_TARGET)
  return proximity * 0.7 + choice * 0.3
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
  // Investor cares about deal quality, which is exactly what Smart Score now is.
  const components = computeScoreComponents(snap, null)
  return sumComponents(components)
}

export function investorTag(snap) {
  const modelEst = Number(snap?.model_estimate)
  const listing = snap?.listing_price
  if (listing == null || !(modelEst > 0)) {
    return 'No listing price · compare to model in detail'
  }
  const vsModel = ((Number(listing) - modelEst) / modelEst) * 100
  const gapStr =
    vsModel < 0
      ? `${Math.abs(vsModel).toFixed(1)}% below model`
      : `${vsModel.toFixed(1)}% above model`

  const top = (snap.cbr_matches || []).slice(0, 3)
  const prices = top.map((c) => Number(c.resale_price)).filter((p) => p > 0)
  if (prices.length === 0) return `${gapStr} · no comp prices`
  const med = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
  const compGap = ((Number(listing) - med) / med) * 100
  const compStr =
    Math.abs(compGap) <= 3
      ? 'comps agree'
      : compGap < 0
        ? `${Math.abs(compGap).toFixed(1)}% under comps`
        : `${compGap.toFixed(1)}% over comps`
  return `${gapStr} · ${compStr}`
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
