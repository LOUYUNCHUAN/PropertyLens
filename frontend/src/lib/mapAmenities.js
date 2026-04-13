import L from 'leaflet'

export const MAP_AMENITY_CATEGORIES = [
  { key: 'all', label: 'All', icon: '📍' },
  { key: 'mrt', label: 'MRT/LRT', icon: '🚇' },
  { key: 'school', label: 'Schools', icon: '🎓' },
  { key: 'hawker', label: 'Hawker', icon: '🍜' },
  { key: 'mall', label: 'Shopping', icon: '🛍️' }
]

export const MAP_CATEGORY_STYLES = {
  mrt: { bg: '#e8f2fa', border: '#1a5f9a', icon: '🚇' },
  lrt: { bg: '#e8f2fa', border: '#1a5f9a', icon: '🚇' },
  school: { bg: '#fef3e2', border: '#c8791a', icon: '🎓' },
  hawker: { bg: '#faf8f4', border: '#9a9590', icon: '🍜' },
  mall: { bg: '#f3e8f9', border: '#7c3aed', icon: '🛍️' }
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

/**
 * Merge nearby objects from multiple listings; dedupe POIs by rounded lat/lng + name.
 * When duplicate, keep the smaller dist_m. Sort by dist_m, cap at maxMarkers.
 */
export function mergeNearbyDeduped(nearbyById, selectedIds, maxMarkers = 400) {
  const best = new Map()
  for (const id of selectedIds) {
    const nearby = nearbyById[id]
    if (!nearby || typeof nearby !== 'object') continue
    for (const [cat, items] of Object.entries(nearby)) {
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
