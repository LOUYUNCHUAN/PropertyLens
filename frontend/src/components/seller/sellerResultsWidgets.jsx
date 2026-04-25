import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell
} from 'recharts'
import { humanizeAprioriWarning, humanizePriceBand } from '@/lib/sellerSignals.js'
import { cn } from '@/lib/utils'
import { WhatIfSlider } from '@/components/whatif/WhatIfSlider.jsx'

const WHATSIF_FEATURE_LABELS = {
  storey_mid: 'Floor Level',
  remaining_lease_years: 'Remaining Lease',
  floor_area_sqm: 'Floor Area'
}

export function ViolationCard({ v }) {
  const friendly = humanizeAprioriWarning(v)
  return (
    <div
      style={{
        background: 'white',
        borderRadius: '10px',
        padding: '12px 14px',
        marginBottom: '8px',
        border: `1px solid ${v.severity === 'warning' ? '#fcd34d' : '#d1d5db'}`,
        borderLeft: `3px solid ${v.severity === 'warning' ? '#f59e0b' : '#9ca3af'}`
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#9ca3af',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '6px'
        }}
      >
        {v.source === 'surrogate'
          ? 'Decision tree rule'
          : v.source === 'model_band'
            ? 'AI estimate band'
            : 'Market pattern'}
      </div>
      <div
        style={{
          fontSize: '13px',
          color: '#111827',
          fontWeight: 500,
          marginBottom: '6px'
        }}
      >
        {friendly}
      </div>
      <div
        style={{
          display: 'flex',
          gap: '12px',
          fontSize: '11px',
          color: '#6b7280',
          marginBottom: '6px',
          flexWrap: 'wrap'
        }}
      >
        {v.source === 'surrogate' ? (
          <>
            <span>
              Reference price:{' '}
              <strong style={{ color: '#16a34a' }}>{v.expected}</strong>
            </span>
            <span>·</span>
            <span>
              Your asking:{' '}
              <strong style={{ color: '#dc2626' }}>{v.actual}</strong>
            </span>
            <span>·</span>
            <span title="Tree fidelity is global to the surrogate model — not per-rule. Use as a directional check.">
              Tree fidelity:{' '}
              <strong>{Math.round(v.rule_confidence * 100)}%</strong>
            </span>
          </>
        ) : v.source === 'model_band' ? (
          <>
            <span>
              AI band:{' '}
              <strong style={{ color: '#16a34a' }}>{v.expected}</strong>
            </span>
            <span>·</span>
            <span>
              Your asking:{' '}
              <strong style={{ color: '#dc2626' }}>{v.actual}</strong>
            </span>
            <span>·</span>
            <span title="Model confidence = the AI estimate's 95% interval coverage.">
              Confidence:{' '}
              <strong>{Math.round(v.rule_confidence * 100)}%</strong>
            </span>
          </>
        ) : (
          <>
            <span>
              Expected:{' '}
              <strong style={{ color: '#16a34a' }}>
                {humanizePriceBand(v.expected)}
              </strong>
            </span>
            <span>·</span>
            <span>
              Your listing:{' '}
              <strong style={{ color: '#dc2626' }}>
                {humanizePriceBand(v.actual)}
              </strong>
            </span>
            <span>·</span>
            <span title="Confidence = fraction of historical sales matching this IF that ended up in the THEN bucket.">
              Confidence:{' '}
              <strong>{Math.round(v.rule_confidence * 100)}%</strong>
            </span>
          </>
        )}
      </div>
      <div style={{ fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>
        {v.suggestion}
      </div>
    </div>
  )
}

export function CSPBanner({ cspResult, askingPrice, predictedPrice, loading }) {
  if (!cspResult || !askingPrice || !predictedPrice) return null
  const hasViolations = cspResult.violation_count > 0
  const ap = cspResult.apriori
  const su = cspResult.surrogate
  const mb = cspResult.model_band
  const allViol = cspResult.violations || []
  const apViol = ap?.violations?.length
    ? ap.violations
    : allViol.filter((x) => (x.source || 'apriori') === 'apriori')
  const suViol = su?.violations?.length
    ? su.violations
    : allViol.filter((x) => x.source === 'surrogate')
  const mbViol = mb?.violations?.length
    ? mb.violations
    : allViol.filter((x) => x.source === 'model_band')
  const apSat = ap?.satisfied ?? []
  const suSat = su?.satisfied ?? []
  const mbSat = mb?.satisfied ?? []
  const showSurrogateBlock = su != null || suViol.length > 0 || suSat.length > 0
  const showModelBandBlock = mb != null || mbViol.length > 0 || mbSat.length > 0

  return (
    <div
      style={{
        borderRadius: '14px',
        border: `1px solid ${hasViolations ? '#fde68a' : '#bbf7d0'}`,
        background: hasViolations ? '#fffbeb' : '#f0fdf4',
        padding: '16px 20px',
        marginTop: '12px'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: hasViolations ? '12px' : '8px'
        }}
      >
        <span style={{ fontSize: '18px' }}>{hasViolations ? '⚠️' : '✅'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '14px', color: '#111827' }}>
            {hasViolations
              ? `Listing checks — ${cspResult.violation_count} issue${cspResult.violation_count > 1 ? 's' : ''}`
              : 'Listing consistent with market patterns and decision-tree checks'}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
            Asking price{' '}
            <strong>${askingPrice.toLocaleString()}</strong>{' '}
            <span
              style={{
                fontWeight: 700,
                color: hasViolations ? '#b45309' : '#16a34a'
              }}
            >
              {hasViolations
                ? '— above typical pattern for this flat profile'
                : '— consistent with typical pattern for this flat profile'}
            </span>
            {loading && (
              <span style={{ marginLeft: '6px', opacity: 0.7 }}>…</span>
            )}
          </div>
        </div>
      </div>

      {showModelBandBlock && (
        <div style={{ marginBottom: '12px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#64748b',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: '8px'
            }}
          >
            AI estimate confidence band
          </div>
          {mbViol.map((v, i) => (
            <ViolationCard key={`m-${i}`} v={v} />
          ))}
          {mbSat.map((s, i) => (
            <div
              key={`ms-${i}`}
              style={{ fontSize: '12px', color: '#166534', marginBottom: '4px' }}
            >
              {s}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: showSurrogateBlock ? '12px' : 0 }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#64748b',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            marginBottom: '8px'
          }}
        >
          Market patterns
        </div>
        {apViol.map((v, i) => (
          <ViolationCard key={`a-${i}`} v={v} />
        ))}
        {apViol.length === 0 && apSat.length === 0 && (
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>
            No Apriori rules matched this profile.
          </div>
        )}
        {apSat.map((s, i) => (
          <div
            key={`as-${i}`}
            style={{ fontSize: '12px', color: '#166534', marginBottom: '4px' }}
          >
            {s}
          </div>
        ))}
      </div>

      {showSurrogateBlock && (
        <div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#64748b',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: '8px'
            }}
          >
            Decision tree reference price
          </div>
          {su == null && suViol.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
              Decision-tree cross-check unavailable for this flat.
            </div>
          )}
          {su != null && suViol.length === 0 && suSat.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
              No decision-tree path flagged your asking price — it lines up with the model&apos;s expected range.
            </div>
          )}
          {suViol.map((v, i) => (
            <ViolationCard key={`s-${i}`} v={v} />
          ))}
          {suSat.map((s, i) => (
            <div
              key={`ss-${i}`}
              style={{ fontSize: '12px', color: '#166534', marginBottom: '4px' }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AskingPriceSummary({ askingPrice, predicted, low, high }) {
  if (!askingPrice || !predicted) return null

  const diff = askingPrice - predicted
  const pct = predicted ? (diff / predicted) * 100 : 0

  let tone = '#16a34a'
  let bg = '#f0fdf4'
  let label = 'Within fair range — competitive for current market.'

  if (askingPrice < low) {
    tone = '#b91c1c'
    bg = '#fef2f2'
    label = 'Below the model floor — you may be underpricing and leaving money on the table.'
  } else if (askingPrice > high) {
    tone = '#b45309'
    bg = '#fffbeb'
    label =
      'Above the recommended ceiling — this may deter buyers or cause your listing to sit longer.'
  }

  return (
    <div
      style={{
        background: bg,
        borderRadius: '12px',
        padding: '12px 14px',
        border: `1px solid ${tone}`,
        fontSize: '13px'
      }}
    >
      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          marginBottom: '4px'
        }}
      >
        Compared to AI estimate of{' '}
        <strong>${Math.round(predicted).toLocaleString()}</strong>
      </div>
      <div
        style={{
          fontWeight: 600,
          color: tone,
          marginBottom: '4px'
        }}
      >
        {diff >= 0 ? '+' : '-'}$
        {Math.abs(Math.round(diff)).toLocaleString()} ({diff >= 0 ? '+' : ''}
        {Math.abs(pct).toFixed(1)}%) vs AI estimate
      </div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-secondary)'
        }}
      >
        {label}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid #e5e7eb',
  fontSize: '14px',
  fontFamily: 'Inter',
  outline: 'none',
  background: 'white',
  color: '#111827',
  boxSizing: 'border-box'
}

export function NegotiationRange({
  cf,
  predicted,
  listingMultiplier = 1.03,
  suggestedListingNote = null
}) {
  const floor = Math.round(cf.negotiation_walk_away)
  const mid = Math.round(cf.negotiation_fair)
  const ceil = Math.round(predicted * 1.05)
  const suggested = Math.round(predicted * listingMultiplier)

  const rangeWidth = ceil - floor
  const midPct = ((mid - floor) / rangeWidth) * 100
  const suggestPct = ((suggested - floor) / rangeWidth) * 100

  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: '8px',
          background: '#e5e7eb',
          borderRadius: '999px',
          margin: '20px 0 8px'
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: '100%',
            background: 'linear-gradient(to right, #fee2e2, #dcfce7)',
            borderRadius: '999px'
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '-6px',
            left: `${midPct}%`,
            transform: 'translateX(-50%)',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#22c55e',
            border: '3px solid white',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '-6px',
            left: `${suggestPct}%`,
            transform: 'translateX(-50%)',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#3b82f6',
            border: '3px solid white',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          marginBottom: '16px'
        }}
      >
        <span style={{ color: '#ef4444', fontWeight: 500 }}>
          ${floor.toLocaleString()}
          <br />
          Walk Away
        </span>
        <span
          style={{
            color: '#22c55e',
            fontWeight: 500,
            textAlign: 'center'
          }}
        >
          ${mid.toLocaleString()}
          <br />
          Fair Value
        </span>
        <span
          style={{
            color: '#3b82f6',
            fontWeight: 500,
            textAlign: 'right'
          }}
        >
          ${ceil.toLocaleString()}
          <br />
          Ceiling
        </span>
      </div>

      <div
        style={{
          background: '#eff6ff',
          borderRadius: '10px',
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <div
            style={{
              fontSize: '11px',
              color: '#3b82f6',
              fontWeight: 600,
              marginBottom: '2px'
            }}
          >
            SUGGESTED LISTING PRICE
          </div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 800,
              color: '#1d4ed8'
            }}
          >
            ${suggested.toLocaleString()}
          </div>
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#3b82f6',
            textAlign: 'right',
            maxWidth: '120px'
          }}
        >
          {((listingMultiplier - 1) * 100).toFixed(1)}% vs AI estimate — room to negotiate
        </div>
      </div>
      {suggestedListingNote && (
        <p
          style={{
            marginTop: '12px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: 1.45
          }}
        >
          {suggestedListingNote}
        </p>
      )}
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
  reverse
}) {
  const pct = ((value - min) / (max - min)) * 100
  const trackColor = reverse
    ? pct < 33
      ? '#22c55e'
      : pct < 66
        ? '#f59e0b'
        : '#ef4444'
    : pct > 66
      ? '#22c55e'
      : pct > 33
        ? '#f59e0b'
        : '#ef4444'

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '6px'
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 500 }}>{label}</span>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: trackColor
          }}
        >
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          accentColor: trackColor,
          cursor: 'pointer'
        }}
      />
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          marginTop: '2px'
        }}
      >
        {hint}
      </div>
    </div>
  )
}

export function WhatIfSimulator({
  basePrice,
  whatIfPrice,
  whatIfShap,
  baseShap,
  whatIfStorey,
  whatIfLease,
  whatIfArea,
  loading,
  onStoreyChange,
  onLeaseChange,
  onAreaChange,
  onReset,
  originalFlat
}) {
  const currentPrice = whatIfPrice || basePrice
  const delta = Math.round(currentPrice - basePrice)
  const deltaPositive = delta >= 0

  const WHATSIF_FEATURES = ['storey_mid', 'remaining_lease_years', 'floor_area_sqm']
  const shapDeltaData = WHATSIF_FEATURES.map((feat) => {
    const baseVal = baseShap?.find((s) => s.feature === feat)?.shap_value || 0
    const currentVal = whatIfShap?.find((s) => s.feature === feat)?.shap_value || 0
    return {
      feature: WHATSIF_FEATURE_LABELS[feat] || feat,
      delta: Math.round(currentVal - baseVal)
    }
  }).filter((d) => d.delta !== 0)

  const formatSGD = (v) =>
    new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
      maximumFractionDigits: 0
    }).format(Math.abs(Number(v) || 0))

  const buildSellerInsight = () => {
    const orig = originalFlat || {}
    const changes = []

    if (Number(whatIfStorey) !== Number(orig.storey_mid)) {
      const dir = whatIfStorey > orig.storey_mid ? 'higher' : 'lower'
      changes.push(`floor ${Math.round(whatIfStorey)} (${dir} than yours)`)
    }
    if (Number(whatIfLease) !== Number(orig.remaining_lease_years)) {
      const dir = whatIfLease > orig.remaining_lease_years ? 'longer' : 'shorter'
      changes.push(`${Math.round(whatIfLease)}-year lease (${dir} than yours)`)
    }
    if (Number(whatIfArea) !== Number(orig.floor_area_sqm)) {
      const dir = whatIfArea > orig.floor_area_sqm ? 'larger' : 'smaller'
      changes.push(`${Math.round(whatIfArea)} sqm (${dir} than yours)`)
    }

    if (!changes.length)
      return "Drag any slider to see how much that factor affects your flat's price — and how much to concede."

    const absD = formatSGD(Math.abs(delta))
    const changeStr = changes.join(', ')
    return delta < 0
      ? `A comparable flat with ${changeStr} would be worth ~${absD} less. If a buyer uses this to negotiate, the fair concession is around ${absD}.`
      : `A comparable flat with ${changeStr} would be worth ~${absD} more. Use this to justify your asking price if compared to lower-floor or shorter-lease listings.`
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-gray-50 px-4 py-3 dark:bg-muted/30">
        <div>
          <p className="text-xs text-muted-foreground">Your AI estimate</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {formatSGD(basePrice)}
          </p>
        </div>

        <div className="px-2 text-center">
          <p className="text-xs text-muted-foreground">difference</p>
          {loading ? (
            <p className="text-xs text-muted-foreground animate-pulse">calculating…</p>
          ) : Math.abs(delta) < 1 ? (
            <p className="text-xs text-muted-foreground">adjust sliders</p>
          ) : (
            <p
              className={cn(
                'text-sm font-bold tabular-nums',
                delta > 0 ? 'text-emerald-600' : 'text-foreground'
              )}
            >
              {delta > 0 ? '+' : '−'}
              {formatSGD(Math.abs(delta))}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="text-xs text-muted-foreground">Scenario estimate</p>
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              loading ? 'text-muted-foreground animate-pulse' : 'text-foreground'
            )}
          >
            {loading ? '…' : formatSGD(currentPrice)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <WhatIfSlider
          icon="🏢"
          label="Floor level"
          value={whatIfStorey}
          min={2}
          max={25}
          step={1}
          originalValue={Number(originalFlat?.storey_mid) || whatIfStorey}
          onChange={onStoreyChange}
          formatValue={(v) => `Floor ${Math.round(v)}`}
          hint="Higher floors typically command a premium"
        />

        <WhatIfSlider
          icon="📅"
          label="Remaining lease"
          value={whatIfLease}
          min={Math.max(30, (Number(originalFlat?.remaining_lease_years) || whatIfLease) - 20)}
          max={Math.min(99, (Number(originalFlat?.remaining_lease_years) || whatIfLease) + 20)}
          step={1}
          originalValue={Number(originalFlat?.remaining_lease_years) || whatIfLease}
          onChange={onLeaseChange}
          formatValue={(v) => `${Math.round(v)} yrs`}
          hint="Lease length is the most common buyer objection"
        />

        <WhatIfSlider
          icon="📐"
          label="Floor area"
          value={whatIfArea}
          min={Math.max(50, (Number(originalFlat?.floor_area_sqm) || whatIfArea) - 20)}
          max={Math.min(200, (Number(originalFlat?.floor_area_sqm) || whatIfArea) + 40)}
          step={5}
          originalValue={Number(originalFlat?.floor_area_sqm) || whatIfArea}
          onChange={onAreaChange}
          formatValue={(v) => `${Math.round(v)} sqm`}
          hint="Buyers compare price-per-sqm across similar listings"
        />
      </div>

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 text-left text-xs font-semibold text-emerald-600 hover:underline"
        >
          ↩ Reset to your flat&apos;s actual values
        </button>
      )}

      <div className="mt-3 rounded-lg border border-border/40 bg-gray-50 px-4 py-3 dark:bg-muted/30">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">💡 Negotiation insight: </span>
          {buildSellerInsight()}
        </p>
      </div>

      {shapDeltaData.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            Price Change Breakdown
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart
              data={shapDeltaData}
              layout="vertical"
              margin={{ left: 140, right: 20 }}
            >
              <XAxis
                type="number"
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11 }}
              />
              <YAxis type="category" dataKey="feature" width={140} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v) => [
                  `$${Math.abs(v).toLocaleString()}`,
                  v >= 0 ? 'Increase' : 'Decrease'
                ]}
              />
              <ReferenceLine x={0} stroke="#e5e7eb" />
              <Bar dataKey="delta" radius={[0, 4, 4, 0]}>
                {shapDeltaData.map((d) => (
                  <Cell key={d.feature} fill={d.delta >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export function RecentSalesTable({ comparables, estimate }) {
  if (!comparables || comparables.length === 0) {
    return (
      <p
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)'
        }}
      >
        No comparable sales found.
      </p>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12px'
        }}
      >
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            {['Address', 'Type', 'sqm', 'Floor', 'Price', 'Year', 'vs Your estimate'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '8px 10px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid #e5e7eb',
                  whiteSpace: 'nowrap'
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparables.map((c, i) => {
            const diff = c.resale_price - estimate
            const diffPct = ((diff / estimate) * 100).toFixed(1)
            return (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px', fontWeight: 500 }}>
                  {c.block}{' '}
                  {c.street_name.length > 14
                    ? `${c.street_name.slice(0, 14)}…`
                    : c.street_name}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {c.flat_type}
                </td>
                <td style={{ padding: '8px 10px' }}>{c.floor_area_sqm}</td>
                <td style={{ padding: '8px 10px' }}>{c.storey_mid}</td>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                  ${c.resale_price.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {c.year}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    fontWeight: 600,
                    color: diff >= 0 ? '#16a34a' : '#dc2626'
                  }}
                >
                  {diff >= 0 ? '+' : ''}
                  {diffPct}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p
        style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          marginTop: '8px'
        }}
      >
        &quot;vs Your estimate&quot; = each sale versus your AI fair value. For you as seller, comps
        above your estimate are green (stronger benchmarks); below are red.
      </p>
    </div>
  )
}

