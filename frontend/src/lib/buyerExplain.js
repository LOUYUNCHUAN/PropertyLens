/**
 * Pure helpers for Buyer layered XAI UI — verdict, SHAP drivers, Apriori/surrogate, LIME, negotiation.
 */

const HIDDEN_SHAP = ['lat', 'lng', 'lon', 'latitude', 'longitude', 'years_since_2000']

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
 * Discretize flat for Apriori if_conditions (strings in rules.json).
 * @param {object} flat - API payload (floor_area_sqm, remaining_lease_years, dist_nearest_mrt_km km, flat_type)
 */
export function bucketizeFlat(flat) {
  const sqm = Number(flat?.floor_area_sqm) || 0
  const lease = Number(flat?.remaining_lease_years) || 0
  const mrtKm = Number(flat?.dist_nearest_mrt_km) ?? 0.5
  const area =
    sqm < 70 ? 'small(<70sqm)' : sqm < 90 ? 'medium(70-90sqm)' : 'large(>90sqm)'
  const leaseB =
    lease < 55 ? 'short(<55yr)' : lease < 70 ? 'medium(55-70yr)' : 'long(>70yr)'
  const mrt =
    mrtKm < 0.5 ? 'close(<500m)' : mrtKm < 0.8 ? 'medium(500-800m)' : 'far(>800m)'
  const rooms = String(roomCountFromFlatType(flat?.flat_type))
  const levelMid = Number(flat?.storey_mid) || 8
  const storey =
    levelMid <= 5 ? 'low(1-5)' : levelMid <= 12 ? 'mid(6-12)' : 'high(>12)'
  return { area, lease: leaseB, mrt, rooms, storey }
}

function condMatchesBucket(cond, buckets) {
  const c = String(cond)
  if (c.includes('area=')) return c.includes(buckets.area)
  if (c.includes('lease=')) return c.includes(buckets.lease)
  if (c.includes('mrt=')) return c.includes(buckets.mrt)
  if (c.includes('rooms=')) {
    const want = c.match(/rooms=(\d)/)
    return want && buckets.rooms === want[1]
  }
  if (c.includes('storey=')) return c.includes(buckets.storey)
  return true
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
      if (s.includes('area=small')) return 'small floor area (under 70sqm)'
      if (s.includes('area=medium')) return 'medium floor area (70–90sqm)'
      if (s.includes('area=large')) return 'large floor area (over 90sqm)'
      if (s.includes('lease=short')) return 'short remaining lease (under 55 years)'
      if (s.includes('lease=medium')) return 'medium lease (55–70 years)'
      if (s.includes('lease=long')) return 'long lease (over 70 years)'
      if (s.includes('mrt=far')) return 'MRT station far away (over 800m)'
      if (s.includes('mrt=medium')) return 'MRT station at medium distance (500–800m)'
      if (s.includes('mrt=close')) return 'MRT station nearby (under 500m)'
      if (s.includes('rooms=3')) return '3-room layout'
      if (s.includes('rooms=4')) return '4-room layout'
      if (s.includes('rooms=5')) return '5-room layout'
      if (s.includes('storey=low')) return 'low floor (1–5)'
      return s
    })
    .join(', ')
}

export function humanizeOutcome(thenArr) {
  if (!Array.isArray(thenArr)) return 'a typical market price'
  const priceOutcome = thenArr.find((t) => String(t).includes('price='))
  if (!priceOutcome) return 'a typical market price'
  const t = String(priceOutcome)
  if (t.includes('budget')) return 'a budget price range (under $350k)'
  if (t.includes('mid')) return 'a mid-range price ($350k–$500k)'
  if (t.includes('premium')) return 'a premium price (above $550k)'
  return t
}

export function assessMatch(askingPrice, predictedPrice, rule) {
  const thenStr = (rule?.then || []).join(' ')
  if (thenStr.includes('budget') && askingPrice > 400000)
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
    format: () => '',
    direction: 'more malls = higher price'
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
    ? shapValues.filter((v) => v && !HIDDEN_SHAP.includes(v.feature))
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

  const notes = buildNotes({
    gapSig,
    marketDriven,
    rulesViolated,
    cbrDivergence: cbrDiv,
    askingPrice,
    predicted
  })

  return {
    verdict: gapSig,
    openingOffer,
    marketDriven,
    rulesViolated,
    cbrBelow: cbrDiv != null && cbrDiv < -8,
    notes,
    marketTimingPct: Math.round(marketTimingPct)
  }
}

function buildNotes({ gapSig, marketDriven, rulesViolated, cbrDivergence, askingPrice, predicted }) {
  const notes = []
  if (gapSig === 'overpriced' || gapSig === 'slightly_high')
    notes.push('The AI model suggests the listing is at a premium versus its fair value estimate.')
  if (cbrDivergence != null && cbrDivergence < -8)
    notes.push(
      `Recent comparable sales averaged about ${Math.abs(Math.round(cbrDivergence))}% ${cbrDivergence < 0 ? 'below' : 'above'} the AI estimate — use comparables as a negotiation anchor.`
    )
  if (marketDriven)
    notes.push(
      'A large share of this price reflects current market timing, not only this flat’s features — that is common across listings right now.'
    )
  if (rulesViolated)
    notes.push('Pattern analysis suggests this flat type often trades in a lower price band than this asking price.')
  if (notes.length === 0)
    notes.push('No major red flags from the model — focus on timeline, inclusions, and any defects.')
  return notes
}
