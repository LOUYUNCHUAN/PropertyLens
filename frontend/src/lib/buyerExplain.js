/**
 * Pure helpers for Buyer layered XAI UI — verdict, SHAP drivers, Apriori/surrogate, LIME, negotiation.
 */

const HIDDEN_SHAP = ['lat', 'lng', 'lon', 'latitude', 'longitude', 'years_since_2000']

/** One-hot / encoded features — hide from top driver cards (Buyer Step 1). */
export const EXCLUDE_PREFIXES = [
  'town_',
  'flat_type_',
  'flat_model_',
  'storey_range_'
]

function _featureExcludedFromDrivers(feature) {
  const f = String(feature || '')
  return EXCLUDE_PREFIXES.some((p) => f.startsWith(p))
}

/** Verdict from (asking - predicted) / predicted * 100 */
export function verdictFromGapPct(gapPct) {
  const g = Number(gapPct)
  if (!Number.isFinite(g)) {
    return {
      label: 'Enter asking price',
      shortLabel: '—',
      emoji: '⚪',
      tone: 'muted'
    }
  }
  if (g < -10)
    return { label: 'Good deal — below market', shortLabel: 'Below market', emoji: '🟢', tone: 'good' }
  if (g < -3)
    return {
      label: 'Fairly priced — slightly below estimate',
      shortLabel: 'Slightly below estimate',
      emoji: '🟢',
      tone: 'good'
    }
  if (g <= 5)
    return { label: 'Close to market value', shortLabel: 'Close to value', emoji: '🟡', tone: 'fair' }
  if (g <= 15)
    return {
      label: 'Slightly above market value',
      shortLabel: 'Slightly above',
      emoji: '🟡',
      tone: 'warn'
    }
  if (g <= 30)
    return { label: 'Significantly overpriced', shortLabel: 'Overpriced', emoji: '🔴', tone: 'bad' }
  return {
    label: 'Far above market — investigate',
    shortLabel: 'Far above market',
    emoji: '🔴',
    tone: 'bad'
  }
}

export function gapPct(asking, predicted) {
  if (asking == null || predicted == null || predicted <= 0) return null
  return ((asking - predicted) / predicted) * 100
}

/** Parse "3 ROOM" -> 3 */
export function roomCountFromFlatType(flatType) {
  const m = String(flatType || '').match(/(\d+)/)
  return m ? Math.min(5, Math.max(1, parseInt(m[1], 10))) : 3
}

/**
 * Discretize flat for Apriori if_conditions in rules.json. Token format MUST
 * stay aligned with `scripts/regenerate_rules.py::discretise()` and the
 * `data/artifacts/hybrid_xai/rules.json` metadata — if either side changes
 * its bin boundaries, both sides must be updated together.
 *
 * @param {object} flat - PredictRequest-shaped payload (floor_area_sqm,
 *   remaining_lease_years, dist_nearest_mrt_km, flat_type, storey_mid,
 *   is_mature_estate)
 */
export function bucketizeFlat(flat) {
  const sqm = Number(flat?.floor_area_sqm) || 0
  const lease = Number(flat?.remaining_lease_years) || 0
  const mrtKm = Number(flat?.dist_nearest_mrt_km ?? 0.5)
  const rooms = roomCountFromFlatType(flat?.flat_type)
  const levelMid = Number(flat?.storey_mid) || 8
  const isMature = Number(flat?.is_mature_estate ?? 0) === 1

  const area =
    sqm < 70 ? 'small(<70sqm)'
    : sqm < 100 ? 'medium(70-100sqm)'
    : 'large(>=100sqm)'
  const leaseB =
    lease < 55 ? 'short(<55yr)'
    : lease < 80 ? 'medium(55-80yr)'
    : 'long(>=80yr)'
  const mrt =
    mrtKm < 0.5 ? 'walking(<0.5km)'
    : mrtKm < 0.8 ? 'near(0.5-0.8km)'
    : 'far(>0.8km)'
  const roomsB = rooms <= 3 ? '2-3' : rooms === 4 ? '4' : '5+'
  const storey =
    levelMid <= 5 ? 'low(1-5)'
    : levelMid <= 12 ? 'mid(6-12)'
    : 'high(>12)'
  const mature = isMature ? 'yes' : 'no'

  return { area, lease: leaseB, mrt, rooms: roomsB, storey, mature }
}

function condMatchesBucket(cond, buckets) {
  const c = String(cond)
  if (c.startsWith('area=')) return c === `area=${buckets.area}`
  if (c.startsWith('lease=')) return c === `lease=${buckets.lease}`
  if (c.startsWith('mrt=')) return c === `mrt=${buckets.mrt}`
  if (c.startsWith('rooms=')) return c === `rooms=${buckets.rooms}`
  if (c.startsWith('storey=')) return c === `storey=${buckets.storey}`
  if (c.startsWith('mature_estate=')) return c === `mature_estate=${buckets.mature}`
  return true   // unknown dimension — don't reject the rule on its account
}

export function matchAprioriRules(flat, aprioriRules) {
  if (!Array.isArray(aprioriRules)) return []
  const buckets = bucketizeFlat(flat)
  return aprioriRules
    .filter((rule) => {
      const conds = rule?.if_conditions
      if (!Array.isArray(conds)) return false
      return conds.every((cond) => condMatchesBucket(cond, buckets))
    })
    .slice(0, 2)
}

const INEQ_RE = /^([\w.]+)\s*([<>]=?)\s*([\d.]+)\s*$/

function evalOneCondition(condStr, flatVals) {
  const s = String(condStr).trim()
  const m = s.match(INEQ_RE)
  if (!m) return { ok: true, score: 1 }
  const [, feat, op, valStr] = m
  const numVal = parseFloat(valStr)
  let flatVal = flatVals[feat]
  if (flatVal === undefined || flatVal === null) {
    const alt = feat.replace(/_/g, '')
    flatVal = flatVals[alt]
  }
  if (flatVal === undefined || flatVal === null) return { ok: true, score: 0.5 }

  let ok = true
  if (op === '<=') ok = flatVal <= numVal
  else if (op === '>') ok = flatVal > numVal
  else if (op === '<') ok = flatVal < numVal
  else if (op === '>=') ok = flatVal >= numVal
  return { ok, score: ok ? 1 : 0 }
}

/** Build numeric feature map from flat payload + optional SHAP/query_features for missing. */
export function flatToFeatureValues(flat, queryFeatures = {}) {
  const merged = { ...(queryFeatures || {}), ...(flat || {}) }
  const pick = (k, fallback = 0) => {
    const v = merged[k]
    if (v === undefined || v === null) return fallback
    return typeof v === 'number' ? v : parseFloat(v) || fallback
  }
  return {
    floor_area_sqm: pick('floor_area_sqm'),
    lease_remaining_years: pick('remaining_lease_years'),
    room_count: pick('room_count', roomCountFromFlatType(merged.flat_type)),
    level_mid: pick('storey_mid'),
    dist_to_mrt_m: pick('dist_to_mrt_m', pick('dist_nearest_mrt_km', 0.5) * 1000),
    dist_to_highway_m: pick('dist_to_highway_m'),
    dist_to_foodcourt_m: pick('dist_to_foodcourt_m'),
    mall_count_3km: pick('mall_count_3km'),
    mall_weighted_access_3km: pick('mall_weighted_access_3km'),
    transaction_year: pick('year', new Date().getFullYear()),
    dist_to_nearest_mall_m: pick('dist_to_nearest_mall_m'),
    school_count_1km: pick('school_count_1km'),
    primary_school_quality_1km_weighted: pick('primary_school_quality_1km_weighted')
  }
}

export function pickBestSurrogateRule(flat, surrogateRules, queryFeatures) {
  if (!Array.isArray(surrogateRules) || surrogateRules.length === 0) return null
  const flatVals = flatToFeatureValues(flat, queryFeatures)
  let best = null
  let bestScore = -1
  for (const rule of surrogateRules) {
    const conds = rule?.conditions
    if (!Array.isArray(conds) || !conds.length) continue
    let satisfied = 0
    let total = 0
    for (const cond of conds) {
      const r = evalOneCondition(cond, flatVals)
      total += 1
      if (r.ok) satisfied += 1
    }
    const score = satisfied / Math.max(1, total)
    if (score > bestScore) {
      bestScore = score
      best = { rule, score, satisfied, total }
    }
  }
  if (!best || best.score < 0.4) return null
  return best.rule
}

export function humanizeConditions(conditions) {
  if (!Array.isArray(conditions)) return ''
  return conditions
    .map((c) => {
      const s = String(c)
      if (s.includes('area=small')) return 'small floor area (under 70 sqm)'
      if (s.includes('area=medium')) return 'medium floor area (70–100 sqm)'
      if (s.includes('area=large')) return 'large floor area (100+ sqm)'
      if (s.includes('lease=short')) return 'short remaining lease (under 55 years)'
      if (s.includes('lease=medium')) return 'medium lease (55–80 years)'
      if (s.includes('lease=long')) return 'long lease (80+ years)'
      if (s.includes('mrt=walking')) return 'MRT walking distance (under 500 m)'
      if (s.includes('mrt=near')) return 'MRT nearby (500–800 m)'
      if (s.includes('mrt=far')) return 'MRT far (over 800 m)'
      if (s.includes('rooms=2-3')) return '2–3 room layout'
      if (s.includes('rooms=4')) return '4-room layout'
      if (s.includes('rooms=5+')) return '5+ room layout'
      if (s.includes('storey=low')) return 'low floor (1–5)'
      if (s.includes('storey=mid')) return 'mid floor (6–12)'
      if (s.includes('storey=high')) return 'high floor (above 12)'
      if (s.includes('mature_estate=yes')) return 'mature estate'
      if (s.includes('mature_estate=no')) return 'non-mature estate'
      return s
    })
    .join(', ')
}

export function humanizeOutcome(thenArr) {
  if (!Array.isArray(thenArr)) return 'a typical market price'
  const priceOutcome = thenArr.find((t) => String(t).includes('price='))
  if (!priceOutcome) return 'a typical market price'
  const t = String(priceOutcome)
  // Thresholds mirror rules.json metadata.price_thresholds (budget_upper=500k, premium_lower=650k).
  if (t.includes('budget')) return 'a budget price range (under $500k)'
  if (t.includes('mid')) return 'a mid-range price ($500k–$650k)'
  if (t.includes('premium')) return 'a premium price (≥$650k)'
  return t
}

export function assessMatch(askingPrice, predictedPrice, rule) {
  const thenStr = (rule?.then || []).join(' ')
  // Boundaries follow rules.json price_thresholds: budget<500k, premium>=650k.
  if (thenStr.includes('budget') && askingPrice > 500000)
    return 'is listed above what this pattern usually suggests'
  if (thenStr.includes('premium') && askingPrice < predictedPrice * 0.95)
    return 'is listed below the premium range this pattern often sees'
  return 'fits the broad pattern for flats like this'
}

/** SHAP driver label + formatting — keys match hybrid model feature names */
export const DRIVER_LABELS = {
  floor_area_sqm: {
    icon: '📐',
    label: 'Floor size',
    format: (v) => `${Math.round(v)} sqm`,
    direction: 'bigger = higher price'
  },
  lease_remaining_years: {
    icon: '📅',
    label: 'Remaining lease',
    format: (v) => `${Math.round(v)} yrs left`,
    direction: 'longer = higher price'
  },
  room_count: {
    icon: '🛏️',
    label: 'Number of rooms',
    format: (v) => `${Math.round(v)}-room flat`
  },
  level_mid: {
    icon: '🏢',
    label: 'Floor level',
    format: (v) => `Floor ${Math.round(v)}`,
    direction: 'higher floor = higher price'
  },
  dist_to_mrt_m: {
    icon: '🚇',
    label: 'MRT distance',
    format: (v) => `${Math.round(v)}m to MRT`,
    direction: 'closer = higher price'
  },
  dist_to_highway_m: {
    icon: '🛣️',
    label: 'Highway distance',
    format: (v) => `${Math.round(v)}m from highway`,
    direction: 'further = often less noise premium'
  },
  mall_weighted_access_3km: {
    icon: '🛍️',
    label: 'Mall access',
    format: () => 'malls within 3km',
    direction: 'more = higher price'
  },
  dist_to_foodcourt_m: {
    icon: '🍜',
    label: 'Hawker distance',
    format: (v) => `${Math.round(v)}m to nearest hawker`
  },
  primary_school_quality_1km_weighted: {
    icon: '🎓',
    label: 'School quality',
    format: () => '',
    direction: 'better schools = higher price'
  },
  school_count_1km: {
    icon: '🎓',
    label: 'Schools nearby',
    format: (v) => `${Math.round(v)} schools within 1km`
  },
  transaction_year: {
    icon: '📈',
    label: 'Market timing',
    isMarket: true
  },
  orientation_score: { icon: '🧭', label: 'Orientation', format: (v) => String(v) },
  dist_to_nearest_mall_m: { icon: '🏬', label: 'Nearest mall', format: (v) => `${Math.round(v)}m` },
  dist_to_nearest_school_m: { icon: '🎓', label: 'School distance', format: (v) => `${Math.round(v)}m` }
}

export function buildDriverCards(shapValues, { topN = 4 } = {}) {
  const arr = Array.isArray(shapValues)
    ? shapValues.filter(
        (v) =>
          v &&
          !HIDDEN_SHAP.includes(v.feature) &&
          !_featureExcludedFromDrivers(v.feature)
      )
    : []
  const sorted = [...arr].sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
  const timing = sorted.find((x) => x.feature === 'transaction_year')
  const nonTiming = sorted.filter((x) => x.feature !== 'transaction_year')
  const top = nonTiming.slice(0, topN)
  const denom = top.reduce((s, x) => s + Math.abs(x.shap_value), 0) || 1
  const cards = top.map((x) => {
    const meta = DRIVER_LABELS[x.feature] || {
      icon: '📊',
      label: x.feature.replace(/_/g, ' '),
      format: (v) => String(v)
    }
    const fv = x.feature_value
    const featureText = meta.format ? meta.format(fv) : String(fv)
    return {
      feature: x.feature,
      icon: meta.icon,
      label: meta.label,
      featureText: featureText || meta.direction || '',
      shap: x.shap_value,
      pct: (Math.abs(x.shap_value) / denom) * 100
    }
  })
  return { cards, marketTimingShap: timing?.shap_value ?? 0, saleYearNote: timing?.feature_value }
}

/**
 * Top-N SHAP drivers vs global mean |SHAP| (training average magnitude per feature).
 * Excludes transaction_year (shown separately) and one-hot prefixes in EXCLUDE_PREFIXES.
 */
export function buildComparisonDrivers(
  localShapResponse,
  globalImportance = {},
  { topN = 4 } = {}
) {
  const arr = Array.isArray(localShapResponse?.shap_values)
    ? localShapResponse.shap_values.filter((v) => v && !HIDDEN_SHAP.includes(v.feature))
    : []
  const timing = arr.find((x) => x.feature === 'transaction_year')
  const pool = arr.filter(
    (x) => x.feature !== 'transaction_year' && !_featureExcludedFromDrivers(x.feature)
  )
  const sorted = [...pool].sort(
    (a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)
  )
  const top = sorted.slice(0, topN)
  const gi =
    globalImportance && typeof globalImportance === 'object' ? globalImportance : {}

  const comparisonDrivers = top.map((x) => {
    const globalMeanAbs = Number(gi[x.feature]) || 0
    const localSigned = Number(x.shap_value) || 0
    const difference = localSigned
    const meta = DRIVER_LABELS[x.feature] || {
      icon: '📊',
      label: x.feature.replace(/_/g, ' '),
      format: (v) => String(v)
    }
    const fv = x.feature_value
    const featureText = meta.format ? meta.format(fv) : String(fv)
    return {
      feature: x.feature,
      feature_value: fv,
      icon: meta.icon,
      label: meta.label,
      featureText: featureText || meta.direction || '',
      local_shap: localSigned,
      global_shap: globalMeanAbs,
      difference,
      is_above_avg: difference > 0
    }
  })

  return {
    comparisonDrivers,
    marketTimingShap: timing?.shap_value ?? 0,
    saleYearNote: timing?.feature_value
  }
}

/** Hide one-hot and internal dummy features from buyer-facing LIME list */
export function isInterpretableLimeCondition(condition) {
  const s = String(condition)
  if (s.includes('town_')) return false
  if (s.includes('flat_model_')) return false
  if (s.includes('flat_type_')) return false
  return true
}

const _norm = (c) => String(c).trim().replace(/\s+/g, ' ')

/** Exact LIME condition strings → plain-English (coefficient is boolean rule weight, not per-unit). */
const LIME_LABEL_EXACT = {
  'transaction_year > 2022.00': 'Post-2022 market timing',
  'transaction_year <= 2022.00': 'Pre-2022 market conditions',
  'floor_area_sqm > 82.00': 'Larger floor area (above 82 sqm)',
  'floor_area_sqm <= 82.00': 'Compact floor area (82 sqm or under)',
  'floor_area_sqm > 113.00': 'Very large floor area (above 113 sqm)',
  'floor_area_sqm <= 113.00': 'Standard floor area (113 sqm or under)',
  'room_count <= 3.00': '3-room or smaller flat',
  'room_count > 3.00': '4-room or larger flat',
  'lease_remaining_years <= 64.00': 'Shorter remaining lease (under 64 years)',
  'lease_remaining_years > 64.00': 'Longer remaining lease (above 64 years)',
  'lease_remaining_years <= 77.50': 'Remaining lease under ~78 years',
  'dist_to_mrt_m <= 500': 'Close MRT access (under 500m)',
  'dist_to_mrt_m > 500': 'MRT further away (over 500m)',
  'dist_to_highway_m <= 2046.58': 'Near major highway',
  'dist_to_highway_m > 2046.58': 'Farther from major highway',
  'primary_school_top_quality_1km <= 14.13':
    'Primary school quality score in 1km band (model feature)',
  'primary_school_top_quality_1km > 14.13':
    'Higher primary school quality within 1km (model feature)',
  'mall_weighted_access_3km <= 3.50': 'Limited mall access nearby',
  'mall_weighted_access_3km > 3.50': 'Good mall access nearby',
  'dist_to_foodcourt_m <= 400': 'Hawker centre very close (under 400m)',
  'dist_to_foodcourt_m > 400': 'Hawker centre further away'
}

/**
 * Map LIME boolean rule text to a buyer-safe label (never raw `feature <= n` as primary UX).
 */
export function humanizeLimeCondition(condition) {
  const key = _norm(condition)
  if (LIME_LABEL_EXACT[key]) return LIME_LABEL_EXACT[key]

  const rules = [
    [/^transaction_year\s*>\s*2022/i, 'Post-2022 market timing'],
    [/^transaction_year\s*<=\s*2022/i, 'Pre-2022 market conditions'],
    [/^floor_area_sqm\s*>\s*82(\.0+)?$/i, 'Larger floor area (above 82 sqm)'],
    [/^floor_area_sqm\s*<=\s*82(\.0+)?$/i, 'Compact floor area (82 sqm or under)'],
    [/^floor_area_sqm\s*>\s*113/i, 'Very large floor area (above 113 sqm)'],
    [/^floor_area_sqm\s*<=\s*113/i, 'Standard floor area (113 sqm or under)'],
    [/^room_count\s*<=\s*3/i, '3-room or smaller flat'],
    [/^room_count\s*>\s*3/i, '4-room or larger flat'],
    [/^lease_remaining_years\s*<=\s*64/i, 'Shorter remaining lease (under 64 years)'],
    [/^lease_remaining_years\s*>\s*64/i, 'Longer remaining lease (above 64 years)'],
    [/^lease_remaining_years\s*<=\s*77/i, 'Remaining lease under ~78 years'],
    [/^dist_to_mrt_m\s*<=\s*500/i, 'Close MRT access (under 500m)'],
    [/^dist_to_mrt_m\s*>\s*500/i, 'MRT further away (over 500m)'],
    [/^dist_to_highway_m\s*<=\s*2046/i, 'Near major highway'],
    [/^dist_to_highway_m\s*>\s*2046/i, 'Farther from major highway'],
    [/^primary_school_top_quality_1km\s*<=\s*14/i, 'Primary school quality in 1km (model feature)'],
    [/^primary_school_top_quality_1km\s*>\s*14/i, 'Primary school quality in 1km (model feature)'],
    [/^mall_weighted_access_3km\s*<=\s*3/i, 'Limited mall access nearby'],
    [/^mall_weighted_access_3km\s*>\s*3/i, 'Good mall access nearby'],
    [/^dist_to_foodcourt_m\s*<=\s*400/i, 'Hawker centre very close (under 400m)'],
    [/^dist_to_foodcourt_m\s*>\s*400/i, 'Hawker centre further away'],
    [/^level_mid\s*[<>]=?/i, 'Storey level (model rule)']
  ]
  for (const [re, lab] of rules) {
    if (re.test(key)) return lab
  }

  const townM = key.match(/^town_([A-Z0-9_/]+)\s*>\s*0/i)
  if (townM) {
    const town = townM[1].replace(/_/g, ' ').trim()
    return `${town} location factor`
  }

  const feat = key.match(/^([\w.]+)\s*[<>]=?/)
  if (feat) {
    const name = feat[1].replace(/_/g, ' ')
    return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} (local model rule)` : 'Local market factor'
  }
  return 'Local market factor'
}

/**
 * LIME coefficients are dollar impacts of each boolean rule in the local linear model — not per-unit rates.
 */
export function computeLimeWhatIfs(limeExplanation, maxItems = 3) {
  if (!Array.isArray(limeExplanation)) return []
  const sorted = [...limeExplanation].sort(
    (a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient)
  )
  const filtered = sorted.filter((row) => isInterpretableLimeCondition(row.condition))
  return filtered.slice(0, maxItems).map((row) => ({
    label: humanizeLimeCondition(row.condition),
    change: Math.round(Number(row.coefficient)),
    direction: row.direction
  }))
}

function gapSignalFromPct(gapPct) {
  const g = Number(gapPct)
  if (!Number.isFinite(g)) return 'fair'
  if (g > 10) return 'overpriced'
  if (g > 3) return 'slightly_high'
  if (g > -3) return 'fair'
  return 'good_deal'
}

export function buildNegotiationGuide({
  prediction,
  shapValues,
  matchedAprioriRule,
  cbrCheck,
  askingPrice
}) {
  const predicted = prediction?.predicted_price
  const confidenceHigh = prediction?.confidence_high
  const gap = gapPct(askingPrice, predicted)
  const gapSig = gapSignalFromPct(gap)
  const cbrDiv = cbrCheck?.divergence_pct
  const arr = Array.isArray(shapValues) ? shapValues : []
  const totalShap = arr.reduce((s, v) => s + Math.abs(v?.shap_value || 0), 0) || 1
  const ty = arr.find((s) => s.feature === 'transaction_year')
  const marketTimingPct = (Math.abs(ty?.shap_value || 0) / totalShap) * 100
  const marketDriven = marketTimingPct > 35

  const thenArr = matchedAprioriRule?.then
  const rulesViolated =
    Array.isArray(thenArr) &&
    thenArr.some((t) => String(t).includes('budget') || String(t).includes('mid')) &&
    askingPrice > 500000

  let openingOffer =
    askingPrice * (gap > 10 ? 0.9 : gap > 5 ? 0.95 : gap > 3 ? 0.97 : 0.97)
  if (cbrDiv != null && cbrDiv < -8) openingOffer = Math.min(openingOffer, predicted * 0.92)
  openingOffer = Math.round(openingOffer / 1000) * 1000

  const targetPrice = predicted ? Math.round(predicted / 1000) * 1000 : null
  const walkAway =
    Number.isFinite(Number(confidenceHigh))
      ? Math.round(Number(confidenceHigh) / 1000) * 1000
      : null

  const topDrivers = [...arr]
    .filter((v) => v && v.feature !== 'transaction_year')
    .sort((a, b) => Math.abs(b.shap_value || 0) - Math.abs(a.shap_value || 0))
    .slice(0, 2)

  const tactics = buildNotes({
    gapSig,
    gap,
    marketDriven,
    rulesViolated,
    cbrDivergence: cbrDiv,
    topDrivers,
    openingOffer,
    targetPrice,
    walkAway
  })

  return {
    verdict: gapSig,
    openingOffer,
    targetPrice,
    walkAway,
    marketDriven,
    rulesViolated,
    cbrBelow: cbrDiv != null && cbrDiv < -8,
    notes: tactics,
    topDrivers,
    marketTimingPct: Math.round(marketTimingPct)
  }
}

function driverHumanName(driver) {
  if (!driver) return null
  const meta = DRIVER_LABELS[driver.feature]
  return meta?.label ? meta.label.toLowerCase() : String(driver.feature).replace(/_/g, ' ')
}

function buildNotes({
  gapSig,
  gap,
  marketDriven,
  rulesViolated,
  cbrDivergence,
  topDrivers,
  openingOffer,
  targetPrice,
  walkAway
}) {
  const notes = []
  const fmtK = (v) =>
    Number.isFinite(Number(v)) ? `S$${Math.round(Number(v) / 1000)}k` : null

  if (gapSig === 'overpriced' && Number.isFinite(gap))
    notes.push(
      `Asking is about ${Math.round(gap)}% above the model estimate — lead with data and cite 2–3 close comps from the table above.`
    )
  else if (gapSig === 'slightly_high')
    notes.push(
      'Asking is slightly above the model estimate — a modest counter backed by comparables is reasonable.'
    )

  if (cbrDivergence != null && cbrDivergence < -5)
    notes.push(
      `Recent comparables sold about ${Math.abs(Math.round(cbrDivergence))}% below the AI estimate — use the lowest comp as your anchor.`
    )

  const negDriver = (topDrivers || []).find((d) => (d?.shap_value || 0) < 0)
  if (negDriver) {
    const name = driverHumanName(negDriver)
    if (name)
      notes.push(
        `Mention ${name} as a value-reducing factor — the model already flags it.`
      )
  }

  if (marketDriven)
    notes.push(
      'A large share of this price reflects current market timing, not only this flat’s features — common across listings right now.'
    )
  if (rulesViolated)
    notes.push(
      'Pattern analysis suggests this flat type often trades in a lower price band than this asking price.'
    )

  const openK = fmtK(openingOffer)
  const targetK = fmtK(targetPrice)
  const walkK = fmtK(walkAway)
  if (openK && targetK && walkK)
    notes.push(`Start at ${openK}, target ${targetK}, walk away above ${walkK}.`)

  if (notes.length === 0)
    notes.push('No major red flags from the model — focus on timeline, inclusions, and any defects.')
  return notes
}
