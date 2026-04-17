import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MAP_AMENITY_CATEGORIES,
  makeAmenityIcon,
  mapStyleCategory,
  mergeNearbyDeduped
} from '@/lib/mapAmenities.js'

function readThemeColor(varName, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const root = document.documentElement
    const raw = getComputedStyle(root).getPropertyValue(varName).trim()
    if (!raw) return fallback
    if (raw.startsWith('#') || raw.startsWith('rgb') || raw.startsWith('hsl')) return raw
    return `hsl(${raw})`
  } catch {
    return fallback
  }
}

function listingNumberIcon(n) {
  const primary = readThemeColor('--primary', '#4a7c6f')
  const onPrimary = readThemeColor('--primary-foreground', '#ffffff')
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${primary};color:${onPrimary};font-weight:800;font-size:12px;
      display:flex;align-items:center;justify-content:center;
      border:2px solid ${onPrimary};box-shadow:0 2px 8px rgba(0,0,0,0.25);
    ">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  })
}

function amenityMatchesCategory(cat, activeCategory) {
  if (activeCategory === 'all') return true
  if (activeCategory === 'mrt') return cat === 'mrt' || cat === 'lrt'
  return cat === activeCategory
}

/**
 * @param {object} props
 * @param {Array} props.rows
 * @param {Record<number, object>} props.geocodeById
 * @param {Record<number, object>} props.nearbyById
 * @param {Set<number>} props.selectedListingIds
 * @param {(id: number) => void} props.onOpenListing
 * @param {(listing: number, predicted: number) => number|null} props.gapPct
 */
export default function ShortlistMapView({
  rows,
  geocodeById,
  nearbyById,
  selectedListingIds,
  onOpenListing,
  gapPct
}) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef([])
  const [activeCategory, setActiveCategory] = useState('all')

  const geocodedOrder = useMemo(
    () => rows.filter((r) => geocodeById[r.id]?.found),
    [rows, geocodeById]
  )

  const listingNumber = useCallback(
    (rowId) => {
      const i = geocodedOrder.findIndex((r) => r.id === rowId)
      return i >= 0 ? i + 1 : 0
    },
    [geocodedOrder]
  )

  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) => selectedListingIds.has(r.id) && geocodeById[r.id]?.found
      ),
    [rows, selectedListingIds, geocodeById]
  )

  const mergedAmenities = useMemo(() => {
    const ids = geocodedOrder
      .map((r) => r.id)
      .filter((id) => selectedListingIds.has(id))
    return mergeNearbyDeduped(nearbyById, ids, 400)
  }, [nearbyById, selectedListingIds, geocodedOrder])

  const categoryCounts = useMemo(() => {
    const counts = { all: 0, mrt: 0, school: 0, hawker: 0, mall: 0 }
    for (const { cat } of mergedAmenities) {
      counts.all += 1
      if (cat === 'mrt' || cat === 'lrt') counts.mrt += 1
      else if (counts[cat] != null) counts[cat] += 1
    }
    return counts
  }, [mergedAmenities])

  useEffect(() => {
    if (mapInstance.current) return
    const el = mapRef.current
    if (!el) return
    const map = L.map(el, {
      center: [1.3521, 103.8198],
      zoom: 12,
      zoomControl: false,
      // Match LocationMap: wheel zoom steals page scroll; use +/- controls or drag instead
      scrollWheelZoom: false
    })
    L.control.zoom({ position: 'topleft' }).addTo(map)
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://www.openstreetmap.org">OSM</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }
    ).addTo(map)
    mapInstance.current = map

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ debounceMoveend: true })
    })
    ro.observe(el)

    const onWinResize = () =>
      map.invalidateSize({ debounceMoveend: true })
    window.addEventListener('resize', onWinResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
      map.remove()
      mapInstance.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    layersRef.current.forEach((l) => {
      try {
        map.removeLayer(l)
      } catch {
        /* ignore */
      }
    })
    layersRef.current = []

    const layers = []
    const bounds = []

    for (const row of visibleRows) {
      const g = geocodeById[row.id]
      const latlng = [g.lat, g.lng]
      bounds.push(latlng)
      const num = listingNumber(row.id)
      const gPct = gapPct?.(row.listing_price, row.predicted_price)
      const gapStr =
        gPct != null ? `${gPct > 0 ? '+' : ''}${gPct.toFixed(1)}% vs model` : '—'

      const m = L.marker(latlng, { icon: listingNumberIcon(num) }).addTo(map)
      const rid = row.id
      const popupPrimary = readThemeColor('--primary', '#4a7c6f')
      const popupOnPrimary = readThemeColor('--primary-foreground', '#ffffff')
      const popupHeading = readThemeColor('--foreground', '#1a1714')
      const popupMuted = readThemeColor('--muted-foreground', '#64748b')
      m.bindPopup(
        `<div class="shortlist-map-popup" style="font-family:Inter,system-ui,sans-serif;font-size:12px;min-width:160px">
          <div style="font-weight:700;margin-bottom:4px;color:${popupHeading}">${
            row.display_label || row.address_short || 'Listing'
          }</div>
          <div style="color:${popupMuted}">${row.town || '—'}</div>
          <div style="margin-top:6px;color:${popupMuted}">${gapStr}</div>
          <button type="button" class="shortlist-map-popup-btn" style="margin-top:8px;padding:6px 10px;background:${popupPrimary};color:${popupOnPrimary};border:none;border-radius:6px;cursor:pointer;font-size:12px;width:100%">Open detail</button>
        </div>`,
        { maxWidth: 280 }
      )
      m.on('popupopen', () => {
        const elPop = m.getPopup()?.getElement?.()
        const btn = elPop?.querySelector('.shortlist-map-popup-btn')
        if (btn) btn.onclick = () => onOpenListing(rid)
      })
      layers.push(m)
    }

    mergedAmenities.forEach((entry) => {
      const { cat, item } = entry
      if (!amenityMatchesCategory(cat, activeCategory)) return
      const mk = L.marker([item.lat, item.lng], {
        icon: makeAmenityIcon(mapStyleCategory(cat), false)
      }).addTo(map)
      const distLabel =
        item.dist_m >= 1000
          ? `${(item.dist_m / 1000).toFixed(1)} km`
          : `${Math.round(item.dist_m)}m`
      mk.bindTooltip(
        `<span style="font-weight:600">${item.name}</span><br/><span style="color:#666">${distLabel}</span>`,
        { direction: 'top', offset: [0, -12], className: 'amenity-tooltip' }
      )
      layers.push(mk)
    })

    layersRef.current = layers

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15 })
    } else {
      map.setView([1.3521, 103.8198], 11)
    }
    requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }))
  }, [
    visibleRows,
    geocodeById,
    mergedAmenities,
    activeCategory,
    listingNumber,
    gapPct,
    onOpenListing
  ])

  return (
    <div className="w-full space-y-3">
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Amenity categories"
      >
        {MAP_AMENITY_CATEGORIES.map((cat) => {
          const count =
            cat.key === 'all'
              ? categoryCounts.all
              : cat.key === 'mrt'
                ? categoryCounts.mrt
                : categoryCounts[cat.key] ?? 0
          const isActive = activeCategory === cat.key
          return (
            <button
              key={cat.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveCategory(cat.key)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/60'
              }`}
            >
              <span aria-hidden>{cat.icon}</span>
              {cat.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-bold ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-border"
        style={{ minHeight: 480 }}
      >
        <div ref={mapRef} className="h-[480px] w-full" />
      </div>
    </div>
  )
}
