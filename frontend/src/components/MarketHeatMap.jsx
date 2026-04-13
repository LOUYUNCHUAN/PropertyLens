import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getTownCoords } from '../constants/towns.js'

// Map YoY % change to a diverging colour scale.
function yoyColor(yoy) {
  if (yoy == null) return '#d4d4d8' // neutral grey when unknown
  if (yoy >= 15) return '#b91c1c' // strong red
  if (yoy >= 10) return '#ef4444'
  if (yoy >= 5) return '#f97316'
  if (yoy >= 0) return '#22c55e'
  if (yoy <= -5) return '#2563eb'
  return '#60a5fa'
}

export default function MarketHeatMap({ townStats }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef([])

  // Initialise map once
  useEffect(() => {
    if (mapInstance.current) return

    const map = L.map(mapRef.current, {
      center: [1.3521, 103.8198],
      zoom: 11,
      zoomControl: false,
      scrollWheelZoom: false
    })

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '© <a href="https://carto.com">CARTO</a> © <a href="https://www.openstreetmap.org">OSM</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }
    ).addTo(map)

    mapInstance.current = map

    return () => {
      map.remove()
      mapInstance.current = null
      layersRef.current = []
    }
  }, [])

  // Render / update town circles when stats change
  useEffect(() => {
    if (!mapInstance.current) return

    const map = mapInstance.current

    // Clear previous layers
    layersRef.current.forEach((l) => map.removeLayer(l))
    layersRef.current = []

    if (!townStats || !townStats.length) return

    const valid = townStats.filter((t) => !!t.town)
    if (!valid.length) return

    const maxTxn = Math.max(
      ...valid.map((t) => (t.txn_current ? Number(t.txn_current) : 0))
    )

    const layers = []

    valid.forEach((t) => {
      const [lat, lng] = getTownCoords(t.town)
      const yoy = t.yoy_pct ?? 0
      const color = yoyColor(yoy)

      const ratio =
        maxTxn > 0 ? Math.max(0.15, Math.min(1, (t.txn_current || 0) / maxTxn)) : 0.4
      const radius = 6 + ratio * 14

      const circle = L.circleMarker([lat, lng], {
        radius,
        color,
        weight: 1.5,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.45
      }).addTo(map)

      const yoyLabel =
        yoy == null ? '—' : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`

      circle.bindTooltip(
        `<div style="font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size:11px;">
          <div style="font-weight:600; margin-bottom:2px;">${t.town}</div>
          <div style="color:#4b5563;">S$${Math.round(
            t.price_current
          ).toLocaleString()} · ${(t.txn_current || 0).toLocaleString()} txn</div>
          <div style="margin-top:2px; font-weight:600; color:${color};">YoY: ${yoyLabel}</div>
        </div>`,
        { direction: 'top', offset: [0, -4] }
      )

      layers.push(circle)
    })

    layersRef.current = layers
  }, [townStats])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 230,
        borderRadius: '14px',
        overflow: 'hidden',
        border: '1px solid #e5e7eb',
        background: '#f9fafb'
      }}
    >
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          padding: '6px 10px',
          borderRadius: '10px',
          background: 'rgba(255,255,255,0.95)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontSize: '10px',
          color: '#4b5563',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 130
        }}
      >
        <div
          style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#111827',
            marginBottom: 2
          }}
        >
          Market heatmap
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '999px',
              background: '#ef4444'
            }}
          />
          <span>Heating up (higher YoY)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '999px',
              background: '#60a5fa'
            }}
          />
          <span>Cooling / slower growth</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '999px',
              background: '#9ca3af'
            }}
          />
          <span>Flat / unknown</span>
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: '9px',
            color: '#9ca3af'
          }}
        >
          Bubble size ≈ 2024 transaction count
        </div>
      </div>
    </div>
  )
}

