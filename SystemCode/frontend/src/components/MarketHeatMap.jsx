import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getTownCoords } from '../constants/towns.js'

function yoyColor(yoy) {
  if (yoy == null) return '#d4d4d8'
  if (yoy >= 10) return '#b91c1c'
  if (yoy >= 5) return '#ef4444'
  if (yoy >= 0) return '#fbbf24'
  if (yoy >= -5) return '#60a5fa'
  return '#2563eb'
}

export default function MarketHeatMap({ townStats }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef([])

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

  useEffect(() => {
    if (!mapInstance.current) return

    const map = mapInstance.current

    layersRef.current.forEach((l) => map.removeLayer(l))
    layersRef.current = []

    if (!townStats || !townStats.length) return

    const valid = townStats.filter((t) => !!t.town)
    if (!valid.length) return

    const maxTxn = Math.max(
      ...valid.map((t) => (t.txn_current ? Number(t.txn_current) : 0))
    )

    const labeledTownSet = new Set(
      [...valid]
        .sort((a, b) => (b.txn_current || 0) - (a.txn_current || 0))
        .slice(0, 15)
        .map((t) => t.town)
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

      if (labeledTownSet.has(t.town)) {
        const labelMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'market-heatmap-town-label',
            html: `<span>${t.town}</span>`,
            iconSize: null,
            iconAnchor: [-(radius + 4), 6]
          }),
          interactive: false,
          keyboard: false
        }).addTo(map)
        layers.push(labelMarker)
      }
    })

    layersRef.current = layers
  }, [townStats])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 360,
        borderRadius: '14px',
        overflow: 'hidden',
        border: '1px solid #e5e7eb',
        background: '#f9fafb'
      }}
    >
      <style>{`
        .market-heatmap-town-label {
          background: transparent;
          border: 0;
          pointer-events: none;
        }
        .market-heatmap-town-label span {
          display: inline-block;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
          font-size: 10px;
          font-weight: 600;
          color: #111827;
          background: rgba(255, 255, 255, 0.88);
          padding: 1px 5px;
          border-radius: 4px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
          white-space: nowrap;
        }
      `}</style>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          padding: '8px 10px',
          borderRadius: '10px',
          background: 'rgba(255,255,255,0.96)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontSize: '10px',
          color: '#4b5563',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 150,
          zIndex: 500
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
          Market heat (YoY)
        </div>
        {[
          { c: '#b91c1c', label: '≥ +10%' },
          { c: '#ef4444', label: '+5 to +10%' },
          { c: '#fbbf24', label: '0 to +5%' },
          { c: '#60a5fa', label: '–5 to 0%' },
          { c: '#2563eb', label: '≤ –5%' }
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: '999px',
                background: row.c,
                flex: '0 0 12px'
              }}
            />
            <span>{row.label}</span>
          </div>
        ))}
        <div
          style={{
            marginTop: 4,
            paddingTop: 4,
            borderTop: '1px dashed #e5e7eb',
            fontSize: '9px',
            color: '#6b7280'
          }}
        >
          ○ Bubble size ≈ transactions
        </div>
      </div>
    </div>
  )
}
