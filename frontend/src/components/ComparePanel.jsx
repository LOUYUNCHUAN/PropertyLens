import { useState, useEffect, useMemo } from 'react'
import { getSHAP } from '../api/client.js'
import { formatConfidenceBandK } from '@/lib/formatPrice.js'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const FEATURE_LABELS = {
  year:                        'Sale Year',
  floor_area_sqm:              'Floor Area',
  dist_to_cbd_km:              'Distance to CBD',
  is_mature_estate:            'Mature Estate',
  age_at_sale:                 'Flat Age',
  dist_nearest_mrt_km:         'MRT Distance',
  storey_mid:                  'Floor Level',
  remaining_lease_years:       'Lease Remaining',
  dist_nearest_top_school_km:  'Top School Proximity',
  hawkers_within_500m:         'Nearby Hawker Centres',
  'flat_type_3 ROOM':          '3-Room Flat',
  'flat_type_4 ROOM':          '4-Room Flat',
  'flat_type_5 ROOM':          '5-Room Flat',
  flat_type_EXECUTIVE:         'Executive Flat',
  years_since_2000:            'Years Since 2000',
  post_cooling_2022:           '2022 Cooling Policy',
  post_cooling_2018:           '2018 Cooling Policy',
}

const cardStyle = {
  background: 'white',
  borderRadius: '16px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: '20px',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const fmt = (n) => Math.round(n).toLocaleString()

const toTitle = (str) =>
  str.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')

function getVerdict(listing, predicted, low, high) {
  if (listing > high)      return { label: 'Overpriced',    emoji: '🔴', bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' }
  if (listing > predicted) return { label: 'Slightly High', emoji: '🟡', bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' }
  if (listing >= low)      return { label: 'Fair',          emoji: '🟢', bg: '#F0FDF4', color: '#16A34A', border: '#BBF7D0' }
  return                          { label: 'Underpriced',   emoji: '🔵', bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' }
}

function explainFeature(feature, featureValue, shapValue, town) {
  const positive = shapValue >= 0
  const verb = positive ? 'adds' : 'reduces value by'
  const amt = `$${fmt(Math.abs(shapValue))}`
  const fv = typeof featureValue === 'number' ? Math.round(featureValue * 10) / 10 : featureValue
  switch (feature) {
    case 'dist_to_cbd_km':
      return `Being ${fv}km from the CBD ${verb} ~${amt} — ${positive ? 'central locations command a premium' : 'distance from CBD reduces desirability'}.`
    case 'is_mature_estate':
      return `${town ? toTitle(town) : 'This area'} is a ${fv ? 'mature' : 'non-mature'} estate, which ${verb} ~${amt}.`
    case 'age_at_sale':
      return `The flat is ${Math.round(fv)} years old, which ${verb} ~${amt}.`
    case 'floor_area_sqm':
      return `At ${fv} sqm, the floor area ${verb} ~${amt} to the valuation.`
    case 'storey_mid':
      return `Being on floor ~${fv} ${verb} ~${amt} — higher floors attract a premium.`
    case 'remaining_lease_years':
      return `With ${Math.round(fv)} years of lease remaining, ${verb} ~${amt}.`
    case 'dist_nearest_mrt_km':
      return `The nearest MRT is ${fv}km away, which ${verb} ~${amt}.`
    case 'year':
      return `Valued in ${Math.round(fv)}, the market timing ${verb} ~${amt}.`
    default:
      return `${FEATURE_LABELS[feature] || feature}: ${verb} ~${amt}.`
  }
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function PriceBar({ listing, predicted, low, high, cbrMedian }) {
  const verdict = getVerdict(listing, predicted, low, high)
  const allPrices = [low, predicted, high, listing, cbrMedian].filter(Boolean)
  const rangeMin = Math.min(...allPrices) * 0.92
  const rangeMax = Math.max(...allPrices) * 1.08
  const span = rangeMax - rangeMin
  const pct = (p) => Math.max(0, Math.min(100, ((p - rangeMin) / span) * 100))

  const fmtFull = (n) => `$${Math.round(n).toLocaleString()}`
  const fmtK = (n) => `S$${Math.round(Number(n) / 1000)}k`

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    gap: 16,
  }

  const labelCol = {
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: 3,
  }

  const subCol = { fontSize: 12, color: '#64748b', lineHeight: 1.35 }

  const valueStyle = (color) => ({
    fontSize: 18,
    fontWeight: 700,
    color,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
  })

  const rows = [
    {
      key: 'floor',
      label: 'AI floor',
      sub: 'Lower confidence bound',
      value: fmtK(low),
      valueColor: '#64748b',
    },
    {
      key: 'ai',
      label: 'AI estimate',
      sub: 'Hybrid model fair value',
      value: fmtFull(predicted),
      valueColor: '#16a34a',
    },
    {
      key: 'ceil',
      label: 'AI ceiling',
      sub: 'Upper confidence bound',
      value: fmtK(high),
      valueColor: '#64748b',
    },
  ]

  if (cbrMedian) {
    rows.splice(3, 0, {
      key: 'cbr',
      label: 'CBR median',
      sub: 'Median of comparable sales',
      value: fmtFull(cbrMedian),
      valueColor: '#0284c7',
    })
  }

  rows.push({
    key: 'listing',
    label: 'Listing',
    sub: `${verdict.emoji} ${verdict.label}`,
    value: fmtFull(listing),
    valueColor: verdict.color,
  })

  const bandLeft = pct(low)
  const bandWidth = Math.max(0.5, pct(high) - pct(low))
  const listingTick = pct(listing)

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #e8eaef',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05), 0 4px 16px rgba(15, 23, 42, 0.04)',
        overflow: 'hidden',
        marginTop: 20,
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid #f1f5f9',
          fontSize: 12,
          fontWeight: 700,
          color: '#64748b',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Price snapshot
      </div>

      {rows.map((r, i) => (
        <div
          key={r.key}
          style={{
            ...rowStyle,
            borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={labelCol}>{r.label}</div>
            <div style={subCol}>{r.sub}</div>
          </div>
          <div style={valueStyle(r.valueColor)}>{r.value}</div>
        </div>
      ))}

      <div style={{ padding: '16px 18px 18px', background: '#f8fafc' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
          Relative to scale (AI band in green)
        </div>
        <div
          style={{
            height: 8,
            background: '#e2e8f0',
            borderRadius: 999,
            position: 'relative',
            overflow: 'visible',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: `${bandLeft}%`,
              width: `${bandWidth}%`,
              top: 0,
              bottom: 0,
              background: 'linear-gradient(90deg, #d1fae5, #a7f3d0)',
              borderRadius: 999,
            }}
          />
          <div
            title="Listing"
            style={{
              position: 'absolute',
              left: `${listingTick}%`,
              top: -5,
              bottom: -5,
              width: 3,
              borderRadius: 2,
              background: verdict.color,
              transform: 'translateX(-50%)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 10,
            fontSize: 11,
            fontWeight: 600,
            color: '#94a3b8',
          }}
        >
          <span>{fmtK(low)}</span>
          <span style={{ color: '#16a34a' }}>{fmtK(predicted)}</span>
          <span>{fmtK(high)}</span>
        </div>
      </div>
    </div>
  )
}

function ShapRow({ feature, shapValue, featureValue, maxAbsShap, town }) {
  const positive = shapValue >= 0
  const width = (Math.abs(shapValue) / maxAbsShap) * 100
  const label = FEATURE_LABELS[feature] || feature
  const fv = typeof featureValue === 'number' ? Math.round(featureValue * 10) / 10 : featureValue
  const showValue = typeof featureValue === 'number' && feature !== 'year' && feature !== 'is_mature_estate'

  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', alignItems: 'baseline' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
          {label}{showValue ? ` (${fv})` : ''}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: positive ? '#16a34a' : '#ef4444' }}>
          {positive ? '+' : '-'}${fmt(Math.abs(shapValue))}
        </span>
      </div>
      <div style={{ background: '#f3f4f6', borderRadius: '999px', height: '8px', marginBottom: '6px' }}>
        <div style={{
          width: `${width}%`, height: '100%',
          background: positive ? '#22c55e' : '#ef4444',
          borderRadius: '999px', transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{ fontSize: '11px', color: '#6b7280', fontStyle: 'italic', lineHeight: 1.5 }}>
        {explainFeature(feature, fv, shapValue, town)}
      </div>
    </div>
  )
}

function PlaybookCard({ title, lines, accent }) {
  return (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '16px',
      border: '1px solid #f3f4f6', borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827', marginBottom: '10px' }}>
        {title}
      </div>
      {lines.map((line, i) => (
        <p key={i} style={{ fontSize: '12px', color: '#374151', margin: '0 0 6px', lineHeight: 1.5 }}>
          {line}
        </p>
      ))}
    </div>
  )
}

function NegotiationPlaybook({ listing, predicted, low, high, comparables, town }) {
  const verdict = getVerdict(listing, predicted, low, high)
  const openingOffer = Math.round(low)
  const targetLow = Math.round(predicted * 0.98)
  const targetHigh = Math.round(high * 0.97)
  const compPrices = comparables?.map((c) => c.resale_price) ?? []
  const compMin = compPrices.length ? fmt(Math.min(...compPrices)) : null
  const compMax = compPrices.length ? fmt(Math.max(...compPrices)) : null

  if (listing < low) {
    return (
      <div style={{ background: '#eff6ff', borderRadius: '12px', padding: '16px 20px', border: '1px solid #bfdbfe' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#1d4ed8', marginBottom: '8px' }}>
          🔵 This looks like a good deal.
        </div>
        <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
          The asking price is below the AI's conservative floor estimate of ${fmt(low)}.
          Recommend moving quickly — verify flat condition and lease details first.
        </p>
      </div>
    )
  }

  if (verdict.label === 'Fair' || verdict.label === 'Slightly High') {
    const nudge = Math.round(listing * 0.97)
    return (
      <div style={{ background: '#f0fdf4', borderRadius: '12px', padding: '16px 20px', border: '1px solid #bbf7d0' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#16a34a', marginBottom: '8px' }}>
          ✅ This listing is fairly priced.
        </div>
        <p style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>
          Opening offer of ${fmt(nudge)} (2–3% below asking) is reasonable.
        </p>
        <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
          No major red flags — focus negotiation on timeline, inclusions, and any minor defects.
        </p>
      </div>
    )
  }

  // Overpriced — full playbook
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
      <PlaybookCard
        title="💬 Opening Offer Suggestion"
        accent="#22c55e"
        lines={[
          `Start at the AI floor: $${fmt(openingOffer)}`,
          `This is defensible — it's the model's lower confidence bound from our hybrid ensemble.`,
        ]}
      />
      <PlaybookCard
        title="🎯 Your Target Price"
        accent="#3b82f6"
        lines={[
          `Aim to close at: $${fmt(targetLow)} – $${fmt(targetHigh)}`,
          `This is within the AI fair range. Anything below $${fmt(Math.round(high))} is a reasonable outcome.`,
        ]}
      />
      <PlaybookCard
        title="📋 Negotiation Talking Points"
        accent="#f59e0b"
        lines={[
          compMin && compMax
            ? `"Similar flats in ${toTitle(town)} sold for $${compMin}–$${compMax} — I have the data here."`
            : `"The AI hybrid ensemble model values this flat at $${fmt(predicted)}."`,
          `"I'm prepared to move quickly on paperwork if we can agree on a fair price today."`,
          `"The AI's fair value estimate is $${fmt(predicted)} — ${fmt(listing - Math.round(predicted))} below your asking price."`,
        ]}
      />
      <PlaybookCard
        title="⚠️ Watch Out For"
        accent="#ef4444"
        lines={[
          'COV (Cash Over Valuation) — HDB valuation may come in lower than asking price.',
          'Sellers anchoring to recent peak prices.',
          'Emotional pricing on long-held family flats.',
        ]}
      />
    </div>
  )
}

// ─── PANEL (Buyer embed + /compare page) ─────────────────────────────────────

export function ComparePanel({
  embedded = false,
  showBackButton = false,
  onBack,
  predictedPrice,
  confidenceLow,
  confidenceHigh,
  flatDetails,
  flatForm,
  comparables = [],
  initialShapValues = null,
  listingPrice,
  setListingPrice,
  listingInput,
  setListingInput,
}) {
  const [shapValues, setShapValues] = useState(initialShapValues || null)
  const [shapLoading, setShapLoading] = useState(false)

  useEffect(() => {
    if (initialShapValues != null) {
      setShapValues(initialShapValues)
      setShapLoading(false)
      return
    }
    if (!flatDetails) return
    setShapLoading(true)
    getSHAP(flatDetails)
      .then((res) => setShapValues(res.shap_values))
      .catch(console.error)
      .finally(() => setShapLoading(false))
  }, [flatDetails, initialShapValues])

  const cbrMedian = useMemo(() => {
    if (!comparables?.length) return null
    const prices = [...comparables].map((c) => c.resale_price).sort((a, b) => a - b)
    return prices[Math.floor(prices.length / 2)]
  }, [comparables])

  if (!predictedPrice) return null

  const HIDDEN_FEATURES = ['lat', 'lng', 'lon', 'latitude', 'longitude', 'years_since_2000']

  const shapArray = shapValues
    ? (Array.isArray(shapValues) ? shapValues : Object.values(shapValues))
        .filter((v) => v && typeof v === 'object' && !HIDDEN_FEATURES.includes(v.feature))
        .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
        .slice(0, 6)
    : []
  const maxAbsShap = shapArray.length ? Math.abs(shapArray[0].shap_value) : 1

  const verdict = listingPrice
    ? getVerdict(listingPrice, predictedPrice, confidenceLow, confidenceHigh)
    : null
  const gap = listingPrice ? listingPrice - predictedPrice : 0
  const gapPct = listingPrice ? Math.abs((gap / predictedPrice) * 100).toFixed(1) : '0'

  const gapVsCbr = (cbrMedian && listingPrice) ? listingPrice - cbrMedian : null
  const gapVsCbrPct = (cbrMedian && listingPrice)
    ? ((gapVsCbr / cbrMedian) * 100)
    : null

  const cbrVerdictColor =
    gapVsCbrPct === null        ? '#9ca3af' :
    Math.abs(gapVsCbrPct) <= 5  ? '#16a34a' :
    Math.abs(gapVsCbrPct) <= 20 ? '#d97706' :
                                   '#dc2626'

  const cbrVerdictLabel =
    gapVsCbrPct === null        ? null :
    Math.abs(gapVsCbrPct) <= 5  ? 'Within CBR range' :
    gapVsCbr > 0                ? 'Above recent sales' :
                                   'Below recent sales'

  // Second verdict line: listing looks overpriced vs AI but is near CBR median
  const showCbrSecondVerdict =
    gapVsCbrPct !== null &&
    Math.abs(gapVsCbrPct) < 15 &&
    Math.abs((gap / predictedPrice) * 100) > 30

  const town = flatForm?.town || flatDetails?.town || ''

  const wrapStyle = embedded
    ? { maxWidth: '100%', margin: 0 }
    : { maxWidth: '900px', margin: '0 auto' }

  return (
    <div style={wrapStyle} className={embedded ? 'space-y-5' : ''}>

      {/* ══ SECTION 1 — HEADER ══════════════════════════════════════════ */}
      <div style={{ marginBottom: '20px' }}>
        {showBackButton && onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '13px', fontWeight: 600,
              padding: '4px 0', marginBottom: '10px',
              display: 'flex', alignItems: 'center', gap: '4px' }}>
            ← Back to Buyer
          </button>
        )}
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '0 0 6px' }}>
          🔍 Listing Comparison
        </h1>
        <div style={{ fontSize: '13px', color: '#6b7280' }}>
          {[
            town && toTitle(town),
            flatForm?.flat_type,
            flatForm?.floor_area_sqm && `${flatForm.floor_area_sqm} sqm`,
            flatForm?.storey_mid && `Floor ${flatForm.storey_mid}`,
            flatForm?.remaining_lease_years && `${flatForm.remaining_lease_years} yr lease`,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/* ══ LISTING PRICE INPUT (if missing) ════════════════════════════ */}
      {!listingPrice && (
        <div style={{ ...cardStyle, background: '#fffbeb', border: '1px solid #fde68a' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#92400e', marginBottom: '10px' }}>
            📋 Enter the listing's asking price (SGD)
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              placeholder="e.g. 520000"
              value={listingInput}
              onChange={(e) => setListingInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number(listingInput)
                  if (v > 0) setListingPrice(v)
                }
              }}
              style={{ fontSize: '14px', padding: '8px 12px', borderRadius: '8px',
                border: '1px solid #d1d5db', fontFamily: 'Inter, sans-serif', width: '200px' }}
            />
            <button
              onClick={() => { const v = Number(listingInput); if (v > 0) setListingPrice(v) }}
              style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '8px',
                padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              Compare →
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#92400e', margin: '8px 0 0' }}>
            Enter the seller's asking price to see the price verdict and negotiation guide.
          </p>
        </div>
      )}

      {/* ══ SECTION 2 — PRICE VERDICT ════════════════════════════════════ */}
      {listingPrice && verdict && (
        <div style={cardStyle}>
          {/* Stat boxes row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: cbrMedian ? '1fr 1fr 1fr 1fr' : '1fr 1fr',
            gap: '12px',
            marginBottom: '16px',
          }}>
            {/* Box 1 — AI Estimate */}
            <div style={{
              textAlign: 'center', padding: '14px 10px',
              background: '#f0fdf4', borderRadius: '12px',
              borderLeft: '3px solid #16a34a',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: '6px' }}>
                AI Estimate
              </div>
              <div style={{ fontSize: '26px', fontWeight: 800, color: '#16a34a', lineHeight: 1, marginBottom: '4px' }}>
                ${fmt(predictedPrice)}
              </div>
              <div style={{ fontSize: '10px', color: '#9ca3af' }}>
                {formatConfidenceBandK(confidenceLow, confidenceHigh)}
              </div>
              <span style={{ display: 'inline-block', marginTop: '6px',
                background: '#1a2e2a', color: '#e2ede9',
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.7px',
                padding: '2px 6px', borderRadius: '4px' }}>
                MODEL-BASED
              </span>
            </div>

            {/* Box 2 — CBR Median (conditional) */}
            {cbrMedian && (
              <div style={{
                textAlign: 'center', padding: '14px 10px',
                background: '#f0f9ff', borderRadius: '12px',
                borderLeft: '3px solid #0ea5e9',
              }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                  letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: '6px' }}>
                  CBR Median
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0ea5e9', lineHeight: 1, marginBottom: '4px' }}>
                  ${fmt(cbrMedian)}
                </div>
                <div style={{ fontSize: '10px', color: '#9ca3af' }}>
                  {comparables.length} recent comparable sales
                </div>
                <span style={{ display: 'inline-block', marginTop: '6px',
                  background: '#1a2e2a', color: '#e2ede9',
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.7px',
                  padding: '2px 6px', borderRadius: '4px' }}>
                  CBR
                </span>
              </div>
            )}

            {/* Box 3 — Listing Price */}
            <div style={{
              textAlign: 'center', padding: '14px 10px',
              background: verdict.bg, borderRadius: '12px',
              borderLeft: `3px solid ${verdict.border}`,
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: '6px' }}>
                Listing Price
              </div>
              <div style={{ fontSize: '26px', fontWeight: 800, color: '#111827', lineHeight: 1, marginBottom: '4px' }}>
                ${fmt(listingPrice)}
              </div>
              <div style={{ fontSize: '10px', color: '#9ca3af' }}>Seller's asking price</div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                marginTop: '6px', background: verdict.bg,
                border: `1px solid ${verdict.border}`,
                borderRadius: '6px', padding: '2px 8px',
              }}>
                <span style={{ fontSize: '12px' }}>{verdict.emoji}</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: verdict.color }}>
                  {verdict.label}
                </span>
              </div>
            </div>

            {/* Box 4 — Gap vs CBR (conditional) */}
            {cbrMedian && gapVsCbrPct !== null && (
              <div style={{
                textAlign: 'center', padding: '14px 10px',
                background: '#fafafa', borderRadius: '12px',
                borderLeft: `3px solid ${cbrVerdictColor}`,
              }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                  letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: '6px' }}>
                  vs CBR Median
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: cbrVerdictColor, lineHeight: 1, marginBottom: '4px' }}>
                  {gapVsCbr > 0 ? '+' : ''}${fmt(Math.abs(gapVsCbr))}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: cbrVerdictColor }}>
                  {gapVsCbr > 0 ? '+' : ''}{gapVsCbrPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>
                  {cbrVerdictLabel}
                </div>
              </div>
            )}
          </div>

          {/* Second verdict line (CBR context) */}
          {showCbrSecondVerdict && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: '8px', padding: '10px 14px', marginBottom: '12px',
              fontSize: '12px', color: '#92400e',
            }}>
              <span style={{ fontWeight: 700 }}>🟡 Near CBR Median ({gapVsCbrPct.toFixed(1)}%)</span>
              {' '}— Recent comparable sales support this price range. The ML model may be underestimating current market values.
            </div>
          )}

          {/* Price bar */}
          <PriceBar
            listing={listingPrice}
            predicted={predictedPrice}
            low={confidenceLow}
            high={confidenceHigh}
            cbrMedian={cbrMedian}
          />

          {/* Gap summary */}
          <div style={{
            background: verdict.bg, border: `1px solid ${verdict.border}`,
            borderRadius: '10px', padding: '12px 16px', fontSize: '13px',
          }}>
            {gap > 0 && listingPrice > confidenceHigh && (
              <span style={{ color: verdict.color }}>
                This listing is{' '}
                <strong>${fmt(Math.abs(gap))} ({gapPct}%) above</strong> the AI estimate.
                {showCbrSecondVerdict ? ' However, recent sales suggest the market supports this price.' : ' You have significant room to negotiate.'}
              </span>
            )}
            {gap > 0 && listingPrice <= confidenceHigh && (
              <span style={{ color: verdict.color }}>
                This listing is{' '}
                <strong>${fmt(Math.abs(gap))} ({gapPct}%) above</strong> the AI estimate
                but within the fair confidence range.
              </span>
            )}
            {gap === 0 && (
              <span style={{ color: verdict.color }}>
                This listing exactly matches the AI estimate.
              </span>
            )}
            {gap < 0 && (
              <span style={{ color: verdict.color }}>
                This listing is{' '}
                <strong>${fmt(Math.abs(gap))} below</strong> the AI estimate — could be a
                good deal. Verify condition and lease details.
              </span>
            )}
          </div>

          <button
            onClick={() => { setListingPrice(null); setListingInput('') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', fontSize: '11px', marginTop: '10px',
              textDecoration: 'underline' }}>
            Change asking price
          </button>
        </div>
      )}

      {/* ══ SECTION 3 — SHAP ═════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
            ⚡ What Drives This Flat's Value?
          </h3>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
            These are the factors the AI weighted most heavily for this specific flat. Bar length
            shows roughly how many Singapore dollars each factor adds or subtracts from the
            estimate.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#64748b', lineHeight: 1.45 }}>
            <strong>Transaction year</strong> (or sale timing) reflects broad market conditions for
            when you buy — it is not something unique to this unit, but it often moves the price
            a lot because the market overall shifts over time.
          </p>
        </div>
        {shapLoading && (
          <div style={{ color: '#9ca3af', fontSize: '13px', padding: '16px 0' }}>
            Computing SHAP explanations…
          </div>
        )}
        {shapArray.map((item) => (
          <ShapRow
            key={item.feature}
            feature={item.feature}
            shapValue={item.shap_value}
            featureValue={item.feature_value}
            maxAbsShap={maxAbsShap}
            town={town}
          />
        ))}
        {!shapLoading && shapArray.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: '13px' }}>No SHAP data available.</div>
        )}
      </div>

      {/* ══ SECTION 4 — COMPARABLES ══════════════════════════════════════ */}
      {comparables?.length > 0 && (
        <div style={cardStyle}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
              📍 What Did Similar Flats Actually Sell For?
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              The {comparables.length} most comparable past transactions in the same area.
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                  {['Address', 'sqm', 'Floor', 'Price', 'Year', 'vs AI Est.',
                    ...(listingPrice ? ['vs Listing'] : [])].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left',
                      fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                      textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparables.map((c, i) => {
                  const vsAI = ((c.resale_price - predictedPrice) / predictedPrice * 100).toFixed(1)
                  const vsListing = listingPrice
                    ? ((c.resale_price - listingPrice) / listingPrice * 100).toFixed(1)
                    : null
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px', color: '#111827', fontWeight: 500 }}>
                        {c.block} {c.street_name}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{c.floor_area_sqm}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{c.storey_mid}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#111827' }}>
                        ${fmt(c.resale_price)}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{c.year}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontWeight: 700,
                          color: Number(vsAI) >= 0 ? '#16a34a' : '#dc2626' }}>
                          {Number(vsAI) >= 0 ? '+' : ''}{vsAI}%
                        </span>
                      </td>
                      {listingPrice && (
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontWeight: 700,
                            color: Number(vsListing) >= 0 ? '#16a34a' : '#dc2626' }}>
                            {Number(vsListing) >= 0 ? '+' : ''}{vsListing}%
                          </span>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {cbrMedian && (
            <div style={{ marginTop: '14px', paddingTop: '12px',
              borderTop: '1px solid #f3f4f6', fontSize: '13px', color: '#374151' }}>
              Median of comparables: <strong>${fmt(cbrMedian)}</strong>
              {listingPrice && (
                <span style={{
                  color: listingPrice > cbrMedian ? '#dc2626' : '#16a34a',
                  fontWeight: 600,
                }}>
                  {' '}— listing is{' '}
                  <strong>
                    {Math.abs(((listingPrice - cbrMedian) / cbrMedian) * 100).toFixed(1)}%{' '}
                    {listingPrice > cbrMedian ? 'above' : 'below'}
                  </strong>
                  {' '}comparable sales.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ SECTION 5 — NEGOTIATION PLAYBOOK ════════════════════════════ */}
      {listingPrice && (
        <div style={{ ...cardStyle, marginBottom: '40px' }}>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
              🤝 Your Negotiation Guide
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              Based on the AI analysis and market data.
            </p>
          </div>
          <NegotiationPlaybook
            listing={listingPrice}
            predicted={predictedPrice}
            low={confidenceLow}
            high={confidenceHigh}
            comparables={comparables}
            town={town}
          />
        </div>
      )}

    </div>
  )
}
