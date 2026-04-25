import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getTownCoords } from '../constants/towns.js'
import {
  MAP_AMENITY_CATEGORIES as CATEGORIES,
  MAP_CATEGORY_STYLES as CATEGORY_STYLES,
  makeAmenityIcon,
  amenityTooltipHtml,
  highwaySegmentTooltipHtml
} from '@/lib/mapAmenities.js'

function formatRoadType(type) {
  const raw = String(type || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower === 'motorway') return 'Expressway'
  const name = lower.charAt(0).toUpperCase() + lower.slice(1)
  return `${name} road`
}

export default function LocationMap({
  geocode,
  nearby,
  locationContext,
  town,
  flatType,
  floorArea,
  storeyMid,
  remainingLease
}) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef([])
  const amenityMarkersRef = useRef({})
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedItem, setSelectedItem] = useState(null)

  const hasGeocode = geocode && geocode.found
  const center = hasGeocode
    ? [geocode.lat, geocode.lng]
    : getTownCoords(town)
  const hasRealPin = hasGeocode

  useEffect(() => {
    if (mapInstance.current) {
      mapInstance.current.remove()
      mapInstance.current = null
    }

    const map = L.map(mapRef.current, {
      center,
      zoom: hasRealPin ? 16 : 14,
      zoomControl: false,
      scrollWheelZoom: false
    })

    L.control.zoom({ position: 'topleft' }).addTo(map)

    // Ensure highway polylines render above other overlays.
    const highwayPane = map.createPane('highwayPane')
    highwayPane.style.zIndex = 650

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
    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [geocode?.lat, geocode?.lng, town])

  useEffect(() => {
    if (!mapInstance.current) return
    const map = mapInstance.current

    layersRef.current.forEach((l) => map.removeLayer(l))
    layersRef.current = []
    amenityMarkersRef.current = {}

    const layers = []

    if (hasRealPin) {
      const ring500 = L.circle(center, {
        radius: 500,
        color: '#4a7c6f',
        fillColor: '#4a7c6f',
        fillOpacity: 0.06,
        weight: 1.5,
        dashArray: '4 4'
      }).addTo(map)
      ring500.bindTooltip('500m radius', {
        permanent: false,
        direction: 'top'
      })
      layers.push(ring500)

      const ring1km = L.circle(center, {
        radius: 1000,
        color: '#1a5f9a',
        fillColor: '#1a5f9a',
        fillOpacity: 0.04,
        weight: 1.5,
        dashArray: '4 4'
      }).addTo(map)
      ring1km.bindTooltip('1km radius', {
        permanent: false,
        direction: 'top'
      })
      layers.push(ring1km)
    }

    const pulseIcon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative; width:20px; height:20px;">
          <div style="
            position:absolute; inset:0;
            background:#4a7c6f; border-radius:50%;
            border: 2px solid white;
            box-shadow: 0 2px 8px rgba(74,124,111,0.5);
            animation: xai-pulse 2s ease-in-out infinite;
          "></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    })

    const matureLabel = locationContext?.is_mature_estate
      ? '✓ Mature Estate'
      : '○ Non-Mature Estate'

    const flatMarker = L.marker(center, { icon: pulseIcon })
      .addTo(map)
      .bindPopup(
        `<div style="font-family:'Inter',sans-serif; font-size:12px; min-width:140px">
          <div style="font-weight:700; font-size:13px; color:#1a1714; margin-bottom:4px">
            📍 ${geocode?.address || town || '—'}
          </div>
          <div style="color:#4a4540">${flatType || '—'} · ${floorArea ?? '—'} sqm</div>
          <div style="color:#4a4540">Floor ${storeyMid ?? '—'} · ${remainingLease ?? '—'}yr lease</div>
          <div style="
            margin-top:6px; padding:4px 8px;
            background:#e8f2ef; border-radius:6px;
            color:#4a7c6f; font-weight:600; font-size:11px;
          ">${matureLabel}</div>
        </div>`,
        { maxWidth: 220 }
      )
    layers.push(flatMarker)

    if (nearby) {
      const segs = nearby.highway_segments
      if (
        Array.isArray(segs) &&
        segs.length > 0 &&
        (activeCategory === 'all' || activeCategory === 'highway')
      ) {
        segs.forEach((seg, idx) => {
          const latlngs = (seg.latlngs || []).map(([la, ln]) => [la, ln])
          if (latlngs.length < 2) return
          const key = `highway-seg-${idx}`
          const isSelected = selectedItem === key
          // Two-stroke highway: soft halo + neutral core so it reads as a
          // road, not an alert. Selected state keeps the teal emphasis.
          const halo = L.polyline(latlngs, {
            pane: 'highwayPane',
            color: '#ffffff',
            weight: isSelected ? 8 : 6,
            opacity: 0.6,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map)
          const line = L.polyline(latlngs, {
            pane: 'highwayPane',
            color: isSelected ? '#4a7c6f' : '#9ca3af',
            weight: isSelected ? 5 : 3,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map)
          try {
            halo.bringToFront()
            line.bringToFront()
          } catch {
            /* ignore */
          }
          line.bindTooltip(highwaySegmentTooltipHtml(seg), {
            sticky: true,
            className: 'amenity-tooltip'
          })
          line.on('click', () => setSelectedItem(key))
          amenityMarkersRef.current[key] = line
          layers.push(halo)
          layers.push(line)
        })
      } else if (
        Array.isArray(nearby.highway) &&
        nearby.highway.length > 0 &&
        (activeCategory === 'all' || activeCategory === 'highway')
      ) {
        for (let idx = 0; idx < nearby.highway.length; idx++) {
          const item = nearby.highway[idx]
          const key = `highway-${idx}`
          const isSelected = selectedItem === key
          const icon = makeAmenityIcon('highway', isSelected)
          const marker = L.marker([item.lat, item.lng], {
            icon,
            zIndexOffset: isSelected ? 1000 : 0
          })
            .addTo(map)
            .bindTooltip(amenityTooltipHtml(item, 'highway'), {
              direction: 'top',
              offset: [0, -12],
              className: 'amenity-tooltip'
            })
          marker.on('click', () => setSelectedItem(key))
          amenityMarkersRef.current[key] = marker
          layers.push(marker)
        }
      }

      for (const [category, items] of Object.entries(nearby)) {
        if (category === 'highway' || category === 'highway_segments') continue
        if (activeCategory !== 'all' && activeCategory !== category) continue
        if (!Array.isArray(items)) continue
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx]
          const key = `${category}-${idx}`
          const isSelected = selectedItem === key
          const icon = makeAmenityIcon(category, isSelected)
          const marker = L.marker([item.lat, item.lng], {
            icon,
            zIndexOffset: isSelected ? 1000 : 0
          })
            .addTo(map)
            .bindTooltip(amenityTooltipHtml(item, category), {
              direction: 'top',
              offset: [0, -12],
              className: 'amenity-tooltip'
            })
          amenityMarkersRef.current[key] = marker
          layers.push(marker)
        }
      }
    }

    layersRef.current = layers
  }, [nearby, activeCategory, selectedItem, geocode?.lat, geocode?.lng])

  const handleSidebarClick = useCallback((key) => {
    setSelectedItem((prev) => (prev === key ? null : key))
  }, [])

  // Aggregate distance chips dropped: they reported feature-table averages that
  // often contradicted the nearest-POI values shown in the grid below. Single
  // source of truth is now the POI grid.

  const totalNearby = useMemo(() => {
    if (!nearby) return 0
    const segN = Array.isArray(nearby.highway_segments) ? nearby.highway_segments.length : 0
    const legacyH = segN > 0 ? 0 : Array.isArray(nearby.highway) ? nearby.highway.length : 0
    let n = segN + legacyH
    for (const [k, arr] of Object.entries(nearby)) {
      if (k === 'highway' || k === 'highway_segments') continue
      n += Array.isArray(arr) ? arr.length : 0
    }
    return n
  }, [nearby])

  const gridItems = useMemo(() => {
    if (!nearby) return []
    const out = []
    const segs = nearby.highway_segments
    if (
      Array.isArray(segs) &&
      segs.length > 0 &&
      (activeCategory === 'all' || activeCategory === 'highway')
    ) {
      segs.forEach((seg, idx) => {
        out.push({
          cat: 'highway',
          item: {
            name: seg.name,
            dist_m: seg.dist_m,
            type: seg.type,
            latlngs: seg.latlngs
          },
          key: `highway-seg-${idx}`
        })
      })
    } else if (
      Array.isArray(nearby.highway) &&
      nearby.highway.length > 0 &&
      (activeCategory === 'all' || activeCategory === 'highway')
    ) {
      nearby.highway.forEach((item, idx) => {
        out.push({ cat: 'highway', item, key: `highway-${idx}` })
      })
    }
    for (const [cat, items] of Object.entries(nearby)) {
      if (cat === 'highway' || cat === 'highway_segments') continue
      if (activeCategory !== 'all' && activeCategory !== cat) continue
      if (!Array.isArray(items)) continue
      items.forEach((item, idx) => {
        out.push({ cat, item, key: `${cat}-${idx}` })
      })
    }
    return out
  }, [nearby, activeCategory])

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>
        What&apos;s Nearby
      </div>

      {/* Category filter tabs */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          marginBottom: '12px',
          flexWrap: 'wrap'
        }}
      >
        {CATEGORIES.map((cat) => {
          const count =
            cat.key === 'all'
              ? totalNearby
              : cat.key === 'highway'
                ? (nearby?.highway_segments?.length ?? nearby?.highway?.length ?? 0)
                : (nearby?.[cat.key] || []).length
          const isActive = activeCategory === cat.key
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 14px',
                borderRadius: '20px',
                border: `1.5px solid ${isActive ? '#4a7c6f' : 'var(--border)'}`,
                background: isActive ? '#e8f2ef' : 'white',
                color: isActive ? '#4a7c6f' : 'var(--ink-light)',
                fontSize: '12px',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {cat.icon} {cat.label}
              {count > 0 && (
                <span
                  style={{
                    fontSize: '10px',
                    background: isActive
                      ? '#4a7c6f'
                      : 'var(--border)',
                    color: isActive ? 'white' : 'var(--ink-muted)',
                    borderRadius: '10px',
                    padding: '1px 6px',
                    fontWeight: 700
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3">
        {/* Map full width */}
        <div
          style={{
            position: 'relative',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid var(--border)'
          }}
        >
          <div ref={mapRef} style={{ width: '100%', height: '420px' }} />

          {/* Town + mature badge — bottom-left, clear of zoom controls */}
          <div
            style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              zIndex: 1000,
              background: 'white',
              borderRadius: '10px',
              padding: '8px 12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid var(--border)'
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: '13px',
                color: 'var(--ink)'
              }}
            >
              {town || '—'}
            </span>
            {locationContext?.is_mature_estate ? (
              <span
                style={{
                  background: 'var(--sage-light)',
                  color: 'var(--sage)',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '20px'
                }}
              >
                Mature
              </span>
            ) : (
              <span
                style={{
                  background: 'var(--border)',
                  color: 'var(--ink-muted)',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '20px'
                }}
              >
                Non-Mature
              </span>
            )}
            {!hasRealPin && (
              <span
                style={{
                  fontSize: '9px',
                  color: 'var(--ink-muted)',
                  fontStyle: 'italic'
                }}
              >
                approx.
              </span>
            )}
          </div>

        </div>

        {/* POI grid below map */}
        {nearby && totalNearby > 0 && (
          <div>
            <div
              style={{
                marginBottom: '8px',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--ink-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              Nearby ({totalNearby})
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gridItems.map(({ cat, item, key }) => {
                const isActive = selectedItem === key
                return (
                  <div
                    key={key}
                    onClick={() => handleSidebarClick(key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSidebarClick(key)
                      }
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '10px',
                      border: `1px solid var(--border)`,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '6px',
                      cursor: 'pointer',
                      background: isActive
                        ? `${CATEGORY_STYLES[cat]?.border || '#4a7c6f'}12`
                        : 'white',
                      boxShadow: isActive ? '0 0 0 2px rgba(74, 124, 111, 0.35)' : 'none',
                      transition: 'all 0.15s ease',
                      minWidth: 0
                    }}
                  >
                    <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>
                      {CATEGORY_STYLES[cat]?.icon || '📍'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: isActive ? 700 : 600,
                          color: isActive
                            ? CATEGORY_STYLES[cat]?.border || 'var(--ink)'
                            : 'var(--ink)',
                          lineHeight: '1.3',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical'
                        }}
                        title={item.name}
                      >
                        {item.name}
                      </div>
                      <div
                        style={{
                          fontSize: '10px',
                          color: 'var(--ink-muted)',
                          fontFamily: 'JetBrains Mono, monospace',
                          marginTop: '2px'
                        }}
                      >
                        {item.dist_m >= 1000
                          ? `${(item.dist_m / 1000).toFixed(1)} km`
                          : `${item.dist_m}m`}
                      </div>
                      {cat === 'school' && item.tier ? (
                        <div
                          style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: 'var(--ink-muted)',
                            marginTop: '3px',
                            textTransform: 'capitalize'
                          }}
                        >
                          P1: {String(item.tier)} demand
                        </div>
                      ) : null}
                      {cat === 'highway' && item.type ? (
                        <div
                          style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: 'var(--ink-muted)',
                            marginTop: '3px'
                          }}
                        >
                          {formatRoadType(item.type)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
