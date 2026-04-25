import L from 'leaflet'

export const MAP_AMENITY_CATEGORIES = [
  { key: 'all', label: 'All', icon: '📍' },
  { key: 'mrt', label: 'MRT/LRT', icon: '🚇' },
  { key: 'school', label: 'Schools', icon: '🎓' },
  { key: 'hawker', label: 'Hawker', icon: '🍜' },
  { key: 'mall', label: 'Shopping', icon: '🛍️' },
  { key: 'highway', label: 'Major roads', icon: '🛣️' }
]

export const MAP_CATEGORY_STYLES = {
  mrt: { bg: '#e8f2fa', border: '#1a5f9a', icon: '🚇' },
  lrt: { bg: '#e8f2fa', border: '#1a5f9a', icon: '🚇' },
  school: { bg: '#fef3e2', border: '#c8791a', icon: '🎓' },
  hawker: { bg: '#faf8f4', border: '#9a9590', icon: '🍜' },
  mall: { bg: '#f3e8f9', border: '#7c3aed', icon: '🛍️' },
  // Higher-contrast so the polyline stands out on light basemaps.
  highway: { bg: '#fee2e2', border: '#dc2626', icon: '🛣️' }
}

/** Visual category for amenity layer (LRT uses MRT styling). */
export function mapStyleCategory(cat) {
  if (cat === 'lrt') return 'mrt'
  return cat
}

export function makeAmenityIcon(category, highlighted = false) {
  const styleKey = mapStyleCategory(category)
  const style = MAP_CATEGORY_STYLES[styleKey] || MAP_CATEGORY_STYLES.mrt
  const size = highlighted ? 36 : 28
  const fontSize = highlighted ? 18 : 14
  const shadow = highlighted
    ? `0 0 12px 4px ${style.border}80, 0 2px 8px rgba(0,0,0,0.25)`
    : '0 2px 6px rgba(0,0,0,0.15)'
  const borderW = highlighted ? 3 : 2
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px; height:${size}px; border-radius:50%;
      background:${highlighted ? style.border : style.bg};
      border:${borderW}px solid ${highlighted ? 'white' : style.border};
      display:flex; align-items:center; justify-content:center;
      font-size:${fontSize}px; box-shadow:${shadow};
      transition: all 0.2s ease;
      ${highlighted ? 'filter:brightness(1.1);' : ''}
    ">${style.icon}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

function amenityDedupeKey(lat, lng, name) {
  const r = (x) => Math.round(Number(x) * 1e5) / 1e5
  const n = String(name || '')
    .trim()
    .toLowerCase()
  return `${r(lat)}_${r(lng)}_${n}`
}

/** HTML for Leaflet tooltip on amenity markers (school tier when present). */
export function amenityTooltipHtml(item, category) {
  const distLabel =
    item.dist_m >= 1000
      ? `${(item.dist_m / 1000).toFixed(1)} km`
      : `${Math.round(item.dist_m)}m`
  let tierLine = ''
  if (category === 'school' && item.tier) {
    const t = String(item.tier).toLowerCase()
    const label =
      t === 'high' ? 'High' : t === 'medium' ? 'Medium' : t === 'low' ? 'Lower' : String(item.tier)
    tierLine = `<br/><span style="color:#64748b;font-size:11px">P1 popularity: ${label} demand</span>`
  }
  let extraLine = ''
  if (category === 'highway' && item.type) {
    extraLine = `<br/><span style="color:#64748b;font-size:11px">${String(item.type)}</span>`
  }
  return `<span style="font-weight:600">${item.name}</span><br/><span style="color:#666">${distLabel}</span>${tierLine}${extraLine}`
}

/**
 * Merge nearby objects from multiple listings; dedupe POIs by rounded lat/lng + name.
 * When duplicate, keep the smaller dist_m. Sort by dist_m, cap at maxMarkers.
 */
/**
 * Dedupe highway polylines across selected listings (same corridor = same first vertex key).
 */
export function mergeHighwaySegmentsDeduped(nearbyById, selectedIds) {
  const seen = new Set()
  const out = []
  for (const id of selectedIds) {
    const nearby = nearbyById[id]
    if (!nearby) continue
    // Prefer `highway_segments` (polyline data with latlngs); fall back to
    // `highway` for older snapshots that stored polyline-shaped objects there.
    const sources = []
    if (Array.isArray(nearby.highway_segments)) sources.push(nearby.highway_segments)
    if (Array.isArray(nearby.highway)) sources.push(nearby.highway)
    for (const segs of sources) {
      for (const seg of segs) {
        const ll = seg?.latlngs
        if (!Array.isArray(ll) || ll.length < 2) continue
        const key = `${seg.name || ''}|${Math.round(ll[0][0] * 1e5)}|${Math.round(ll[0][1] * 1e5)}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(seg)
      }
    }
  }
  return out.sort((a, b) => (a.dist_m || 0) - (b.dist_m || 0))
}

export function highwaySegmentTooltipHtml(seg) {
  const d = Number(seg.dist_m) || 0
  const distLabel = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)}m`
  const typ = seg.type
    ? `<br/><span style="color:#64748b;font-size:11px">${String(seg.type)}</span>`
    : ''
  return `<span style="font-weight:600">${seg.name}</span><br/><span style="color:#666">${distLabel}</span>${typ}`
}

export function mergeNearbyDeduped(nearbyById, selectedIds, maxMarkers = 400) {
  const best = new Map()
  for (const id of selectedIds) {
    const nearby = nearbyById[id]
    if (!nearby || typeof nearby !== 'object') continue
    for (const [cat, items] of Object.entries(nearby)) {
      if (cat === 'highway_segments') continue
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const lat = Number(item.lat)
        const lng = Number(item.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const key = amenityDedupeKey(lat, lng, item.name)
        const dist = Number(item.dist_m) || 0
        const prev = best.get(key)
        if (!prev || dist < prev.dist_m) {
          best.set(key, { cat, item: { ...item, lat, lng, dist_m: dist }, dist_m: dist })
        }
      }
    }
  }
  const merged = Array.from(best.values())
    .sort((a, b) => a.dist_m - b.dist_m)
    .slice(0, maxMarkers)
  return merged
}
