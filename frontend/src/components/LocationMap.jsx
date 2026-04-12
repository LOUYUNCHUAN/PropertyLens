import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getTownCoords } from '../constants/towns.js'
import {
  MAP_AMENITY_CATEGORIES as CATEGORIES,
  MAP_CATEGORY_STYLES as CATEGORY_STYLES,
  makeAmenityIcon
} from '@/lib/mapAmenities.js'

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
      for (const [category, items] of Object.entries(nearby)) {
        if (activeCategory !== 'all' && activeCategory !== category) continue
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx]
          const key = `${category}-${idx}`
          const isSelected = selectedItem === key
          const icon = makeAmenityIcon(category, isSelected)
          const distLabel = item.dist_m >= 1000
            ? `${(item.dist_m / 1000).toFixed(1)} km`
            : `${item.dist_m}m`
          const marker = L.marker([item.lat, item.lng], {
            icon,
            zIndexOffset: isSelected ? 1000 : 0
          })
            .addTo(map)
            .bindTooltip(
              `<span style="font-weight:600">${item.name}</span><br/><span style="color:#666">${distLabel}</span>`,
              { direction: 'top', offset: [0, -12], className: 'amenity-tooltip' }
            )
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

  const distChips = locationContext
    ? [
        {
          icon: '🚇',
          label: 'MRT',
          val: `${(locationContext.dist_to_mrt_m / 1000).toFixed(2)} km`
        },
        {
          icon: '🎓',
          label: 'School',
          val: `${(locationContext.dist_to_school_m / 1000).toFixed(2)} km`
        },
        {
          icon: '🍜',
          label: 'Hawker',
          val: `${(locationContext.dist_to_hawker_m / 1000).toFixed(2)} km`
        },
        {
          icon: '🛍️',
          label: 'Mall',
          val: `${(locationContext.dist_to_mall_m / 1000).toFixed(2)} km`
        }
      ]
    : []

  const totalNearby = nearby
    ? Object.values(nearby).reduce((s, arr) => s + arr.length, 0)
    : 0

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

      <div style={{ display: 'flex', gap: '12px' }}>
        {/* Map */}
        <div
          style={{
            flex: 1,
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

          {/* Distance chips */}
          {distChips.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                right: '12px',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                alignItems: 'flex-end'
              }}
            >
              {distChips.map((chip) => (
                <div
                  key={chip.label}
                  style={{
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '20px',
                    padding: '3px 10px',
                    fontSize: '11px',
                    color: 'var(--ink-light)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  {chip.icon} {chip.label}{' '}
                  <strong
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--ink)'
                    }}
                  >
                    {chip.val}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Amenity list panel */}
        {nearby && totalNearby > 0 && (
          <div
            style={{
              width: '260px',
              flexShrink: 0,
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div
              style={{
                padding: '12px 14px 8px',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--ink-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid var(--border)'
              }}
            >
              Nearby ({totalNearby})
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                maxHeight: '376px'
              }}
            >
              {Object.entries(nearby)
                .filter(
                  ([cat]) =>
                    activeCategory === 'all' || activeCategory === cat
                )
                .map(([cat, items]) =>
                  items.map((item, idx) => {
                    const key = `${cat}-${idx}`
                    const isActive = selectedItem === key
                    return (
                      <div
                        key={key}
                        onClick={() => handleSidebarClick(key)}
                        style={{
                          padding: '8px 14px',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                          cursor: 'pointer',
                          background: isActive ? `${CATEGORY_STYLES[cat]?.border || '#4a7c6f'}12` : 'transparent',
                          borderLeft: isActive ? `3px solid ${CATEGORY_STYLES[cat]?.border || '#4a7c6f'}` : '3px solid transparent',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>
                          {CATEGORY_STYLES[cat]?.icon || '📍'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: isActive ? 700 : 600,
                              color: isActive ? (CATEGORY_STYLES[cat]?.border || 'var(--ink)') : 'var(--ink)',
                              lineHeight: '1.3',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            title={item.name}
                          >
                            {item.name}
                          </div>
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--ink-muted)',
                              fontFamily: 'JetBrains Mono, monospace'
                            }}
                          >
                            {item.dist_m >= 1000
                              ? `${(item.dist_m / 1000).toFixed(1)} km`
                              : `${item.dist_m}m`}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
