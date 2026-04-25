import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MAP_AMENITY_CATEGORIES,
  MAP_CATEGORY_STYLES,
  amenityTooltipHtml,
  highwaySegmentTooltipHtml,
  makeAmenityIcon,
  mapStyleCategory,
  mergeHighwaySegmentsDeduped,
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

function listingNumberIcon(n, override = null) {
  const bg = override?.bg || readThemeColor('--primary', '#4a7c6f')
  const fg = override?.fg || readThemeColor('--primary-foreground', '#ffffff')
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};color:${fg};font-weight:800;font-size:12px;
      display:flex;align-items:center;justify-content:center;
      border:2px solid ${fg};box-shadow:0 2px 8px rgba(0,0,0,0.25);
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
  gapPct,
  // Optional: { [rowId]: { label: '1', bg: '#059669', fg: '#fff' } }
  // When set, overrides the default sequential pin label + theme colour for
  // those listings. Used by ShortlistVersusView to colour-code slots 1/2/3.
  pinAppearanceById = null,
  // Optional: { [rowId]: { radiusM: 2000, color: '#059669', fillOpacity: 0.2 } }
  // Renders a translucent circle around the pin showing the requested radius.
  radiusOverlayById = null,
  // When true, the map container stretches to fill its parent's height
  // (parent must have an explicit height for this to do anything).
  fillHeight = false
}) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef([])
  const [activeCategory, setActiveCategory] = useState('all')
  // Toggle to hide highway polylines independently of category filter.
  // Defaults ON; users can disable when the lines distract from listing pins.
  const [showHighways, setShowHighways] = useState(true)

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

  const mergedHighwaySegments = useMemo(() => {
    const ids = geocodedOrder
      .map((r) => r.id)
      .filter((id) => selectedListingIds.has(id))
    return mergeHighwaySegmentsDeduped(nearbyById, ids)
  }, [nearbyById, selectedListingIds, geocodedOrder])

  const categoryCounts = useMemo(() => {
    const counts = { all: 0, mrt: 0, school: 0, hawker: 0, mall: 0, highway: 0 }
    for (const { cat } of mergedAmenities) {
      if (cat === 'mrt' || cat === 'lrt') counts.mrt += 1
      else if (counts[cat] != null) counts[cat] += 1
    }
    counts.highway = mergedHighwaySegments.length
    counts.all = mergedAmenities.length + mergedHighwaySegments.length
    return counts
  }, [mergedAmenities, mergedHighwaySegments])

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
    // Ensure highway polylines render above other overlays.
    const highwayPane = map.createPane('highwayPane')
    highwayPane.style.zIndex = 650
    // Radius circles sit just above tiles but BELOW everything else (markers,
    // amenity pins, highway lines) so they never visually obscure other data.
    const radiusPane = map.createPane('radiusPane')
    radiusPane.style.zIndex = 350
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
      const override = pinAppearanceById ? pinAppearanceById[row.id] : null
      const num = override?.label != null ? override.label : listingNumber(row.id)
      const gPct = gapPct?.(row.listing_price, row.predicted_price)
      const gapStr =
        gPct != null ? `${gPct > 0 ? '+' : ''}${gPct.toFixed(1)}% vs model` : '—'

      // Optional translucent radius circle. Renders in `radiusPane` (z 350)
      // — above the basemap tiles but BELOW amenity pins, listing markers,
      // and highway polylines so the comparison overlay never hides data.
      const overlay = radiusOverlayById ? radiusOverlayById[row.id] : null
      if (overlay && Number.isFinite(Number(overlay.radiusM)) && overlay.radiusM > 0) {
        const c = L.circle(latlng, {
          pane: 'radiusPane',
          radius: Number(overlay.radiusM),
          color: overlay.color || '#4a7c6f',
          fillColor: overlay.color || '#4a7c6f',
          fillOpacity: overlay.fillOpacity ?? 0.2,
          weight: 1.25,
          opacity: 0.55,
          interactive: false
        }).addTo(map)
        layers.push(c)
      }

      const m = L.marker(latlng, { icon: listingNumberIcon(num, override) }).addTo(map)
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

    if (
      showHighways &&
      mergedHighwaySegments.length > 0 &&
      (activeCategory === 'all' || activeCategory === 'highway')
    ) {
      mergedHighwaySegments.forEach((seg) => {
        const latlngs = (seg.latlngs || []).map(([la, ln]) => [la, ln])
        if (latlngs.length < 2) return
        // Two-stroke highway: white halo + neutral grey core. Grey reads as
        // a road on the basemap without competing with the slot-coloured
        // listing pins. Toggle via the "Show highways" switch.
        const halo = L.polyline(latlngs, {
          pane: 'highwayPane',
          color: '#ffffff',
          weight: 10,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map)
        const line = L.polyline(latlngs, {
          pane: 'highwayPane',
          color: '#6b7280',
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map)
        try {
          halo.bringToFront()
          line.bringToFront()
        } catch {
          /* ignore */
        }
        // Include highway endpoints in the fit-bounds so we don't zoom in so
        // tight on the picked listings that the highway lines are clipped off
        // the map.
        latlngs.forEach((p) => bounds.push(p))
        line.bindTooltip(highwaySegmentTooltipHtml(seg), {
          sticky: true,
          className: 'amenity-tooltip'
        })
        layers.push(halo)
        layers.push(line)
      })
    }

    mergedAmenities.forEach((entry) => {
      const { cat, item } = entry
      if (!amenityMatchesCategory(cat, activeCategory)) return
      const mk = L.marker([item.lat, item.lng], {
        icon: makeAmenityIcon(mapStyleCategory(cat), false)
      }).addTo(map)
      mk.bindTooltip(amenityTooltipHtml(item, cat), {
        direction: 'top',
        offset: [0, -12],
        className: 'amenity-tooltip'
      })
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
    mergedHighwaySegments,
    showHighways,
    activeCategory,
    listingNumber,
    pinAppearanceById,
    radiusOverlayById,
    gapPct,
    onOpenListing
  ])

  return (
    <div className={`w-full space-y-3 ${fillHeight ? 'flex h-full flex-col' : ''}`}>
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

        <label
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          title="Toggle major-road overlays"
        >
          <input
            type="checkbox"
            checked={showHighways}
            onChange={(e) => setShowHighways(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-primary"
          />
          <span aria-hidden>🛣️</span>
          Show highways
        </label>
      </div>

      <div
        className={`relative overflow-hidden rounded-xl border border-border ${
          fillHeight ? 'min-h-0 flex-1' : ''
        }`}
        style={fillHeight ? { minHeight: 480 } : { minHeight: 480 }}
      >
        <div
          ref={mapRef}
          className={fillHeight ? 'h-full w-full' : 'h-[480px] w-full'}
        />
      </div>
    </div>
  )
}
