/**
 * Shared hybrid /api/predict payload builder (block + street + eight fields).
 * Used by Buyer and Seller so CBR/SHAP use the same feature-table path as training.
 */

export const MATURE_ESTATES_LIST = [
  'ANG MO KIO',
  'BEDOK',
  'BISHAN',
  'BUKIT MERAH',
  'BUKIT TIMAH',
  'CENTRAL AREA',
  'CLEMENTI',
  'GEYLANG',
  'KALLANG/WHAMPOA',
  'MARINE PARADE',
  'PASIR RIS',
  'QUEENSTOWN',
  'SERANGOON',
  'TAMPINES',
  'TOA PAYOH'
]

/** YYYY-MM for hybrid model sale_month (training pipeline parity). */
export function defaultSaleMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function parseStoreyMid(storeyRange) {
  const s = String(storeyRange || '')
    .trim()
    .toUpperCase()
  if (s.includes(' TO ')) {
    const parts = s.replace(/\s+TO\s+/i, ' ').split(/\s+/)
    const a = parseInt(parts[0], 10)
    const b = parseInt(parts[1], 10)
    if (!Number.isNaN(a) && !Number.isNaN(b)) return (a + b) / 2
  }
  const n = parseFloat(s)
  return Number.isNaN(n) ? 8 : n
}

/** Remaining lease at sale_month from lease commence year. */
export function remainingLeaseApprox(leaseCommenceYear, saleMonthStr) {
  const parts = String(saleMonthStr || '').split('-')
  const y = parseInt(parts[0], 10)
  if (Number.isNaN(y)) return 70
  const raw = 99 - (y - Number(leaseCommenceYear))
  return Math.max(1, Math.min(99, Math.round(raw)))
}

/**
 * Apply what-if overrides to a base /api/predict payload WITHOUT stripping
 * the address fields. Keeps the backend on the address-builder path so the
 * feature-table POI values stay consistent with the main prediction — only
 * storey, lease, and floor area change.
 *
 * The three derived fields are:
 *   - storey_range    : narrow band around the override mid ("08 TO 08")
 *   - lease_commence_date : back-computed from saleYear + newLease − 99,
 *                           clamped to the backend's [1960, 2035] range
 *   - remaining_lease_years : echoed for downstream code that still reads it
 */
export function applyWhatIfOverrides(baseFlat, overrides) {
  if (!baseFlat || typeof baseFlat !== 'object') return null
  const {
    storey_mid,
    remaining_lease_years,
    floor_area_sqm
  } = overrides || {}

  const saleMonth = baseFlat.sale_month || defaultSaleMonth()
  const saleYear =
    parseInt(String(saleMonth).slice(0, 4), 10) || new Date().getFullYear()

  const mid = Math.max(1, Math.round(Number(storey_mid) || baseFlat.storey_mid || 8))
  const storey_range = `${String(mid).padStart(2, '0')} TO ${String(mid).padStart(2, '0')}`

  const leaseRaw =
    Number(remaining_lease_years) || Number(baseFlat.remaining_lease_years) || 70
  const lease = Math.max(1, Math.min(99, Math.round(leaseRaw)))
  const leaseCommenceRaw = saleYear + lease - 99
  const lease_commence_date = Math.max(1960, Math.min(2035, leaseCommenceRaw))

  const area =
    Number(floor_area_sqm) || Number(baseFlat.floor_area_sqm) || 90

  return {
    ...baseFlat,
    storey_range,
    storey_mid: mid,
    remaining_lease_years: lease,
    floor_area_sqm: area,
    lease_commence_date,
    year: saleYear,
    month_num: parseInt(String(saleMonth).slice(5, 7), 10) || baseFlat.month_num
  }
}

/**
 * @param {object} f - block, street_name, town, flat_type, floor_area_sqm, storey_range, lease_commence_date, sale_month
 */
export function buildHybridFlatPayload(f) {
  const sale_month = f.sale_month || defaultSaleMonth()
  const parts = sale_month.split('-')
  const yr = parseInt(parts[0], 10) || new Date().getFullYear()
  const mo = parseInt(parts[1], 10) || 1
  const storey_mid = parseStoreyMid(f.storey_range)
  const remaining_lease_years = remainingLeaseApprox(
    Number(f.lease_commence_date),
    sale_month
  )
  const town = f.town || 'SERANGOON'
  return {
    block: String(f.block || '').trim(),
    street_name: String(f.street_name || '').trim(),
    town,
    flat_type: f.flat_type || '4 ROOM',
    floor_area_sqm: Number(f.floor_area_sqm),
    storey_range: String(f.storey_range || '').trim(),
    lease_commence_date: Number(f.lease_commence_date),
    sale_month,
    storey_mid,
    remaining_lease_years,
    year: yr,
    month_num: mo,
    dist_nearest_mrt_km: 0.5,
    is_mature_estate: MATURE_ESTATES_LIST.includes(town) ? 1 : 0,
    dist_nearest_primary_school_km: 0.5,
    dist_nearest_top_school_km: 1.5,
    dist_nearest_hawker_km: 0.3,
    dist_nearest_market_km: 0.5,
    mrt_count_within_1km: 1,
    primary_schools_within_1km: 2,
    primary_schools_within_2km: 5,
    top_school_within_1km: 0,
    top_school_within_2km: 0,
    hawkers_within_500m: 1
  }
}

/**
 * Refine POI-ish fields from /api/nearby (used when geocode succeeds; complements feature-table lookup).
 */
export function applyNearbyToFlatPayload(flat, nearby) {
  if (!nearby || typeof nearby !== 'object') return { ...flat }
  const next = { ...flat }
  const mrts = [...(nearby.mrt || []), ...(nearby.lrt || [])].sort(
    (a, b) => a.dist_m - b.dist_m
  )
  if (mrts.length) {
    next.dist_nearest_mrt_km =
      Math.round((mrts[0].dist_m / 1000) * 100) / 100
    next.mrt_count_within_1km = Math.max(
      1,
      mrts.filter((m) => m.dist_m <= 1000).length
    )
  }
  const schools = Array.isArray(nearby.school) ? nearby.school : []
  if (schools.length) {
    const primary = schools.filter(
      (s) => String(s.type || '').toUpperCase() === 'PRIMARY'
    )
    const base = primary.length ? primary : schools
    const sorted = [...base].sort((a, b) => a.dist_m - b.dist_m)
    next.dist_nearest_primary_school_km =
      Math.round((sorted[0].dist_m / 1000) * 100) / 100
    next.primary_schools_within_1km = Math.max(
      1,
      sorted.filter((s) => s.dist_m <= 1000).length
    )
    next.primary_schools_within_2km = Math.max(
      next.primary_schools_within_2km,
      sorted.filter((s) => s.dist_m <= 2000).length
    )
    // NOTE: /api/nearby has no "top school" flag (MOE autonomous/gifted/SAP).
    // Do NOT infer top_school_* from proximity to any school — that inflates
    // predictions. The backend feature-table lookup supplies these for matched
    // addresses; unmatched addresses fall back to defaults (0).
  }
  const hawkers = Array.isArray(nearby.hawker) ? nearby.hawker : []
  if (hawkers.length) {
    const sortedH = [...hawkers].sort((a, b) => a.dist_m - b.dist_m)
    next.hawkers_within_500m = hawkers.filter((h) => h.dist_m <= 500).length
    next.dist_nearest_hawker_km =
      Math.round((sortedH[0].dist_m / 1000) * 100) / 100
  }
  const malls = Array.isArray(nearby.mall) ? nearby.mall : []
  if (malls.length) {
    const sortedM = [...malls].sort((a, b) => a.dist_m - b.dist_m)
    next.dist_nearest_market_km =
      Math.round((sortedM[0].dist_m / 1000) * 100) / 100
  }
  return next
}
