import { useState, useCallback, useRef, useEffect } from 'react'
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
import api, { geocodeAddress, getNearbyAmenities, getTrends } from '../api/client.js'
import CbrDivergenceWarning from '../components/CbrDivergenceWarning.jsx'
import { TOWNS } from '../constants/towns.js'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PriceRangeCard } from '@/components/price-range-card.jsx'
import {
  applyNearbyToFlatPayload,
  buildHybridFlatPayload,
  defaultSaleMonth,
  parseStoreyMid,
  remainingLeaseApprox
} from '@/lib/hybridFlatPayload.js'
import { formatConfidenceBandK } from '@/lib/formatPrice.js'

const MATURE_ESTATES = new Set([
  'ANG MO KIO',
  'BEDOK',
  'BISHAN',
  'BUKIT MERAH',
  'BUKIT TIMAH',
  'CENTRAL AREA',
  'CLEMENTI',
  'GEYLANG',
  'KALLANG/WHAMPOA',
  'MARINE PARADE',
  'PASIR RIS',
  'QUEENSTOWN',
  'SERANGOON',
  'TAMPINES',
  'TOA PAYOH'
])

const TOWN_CBD_DIST = {
  TAMPINES: 14.2,
  BEDOK: 11.5,
  'JURONG WEST': 18.0,
  'JURONG EAST': 15.5,
  SENGKANG: 14.0,
  PUNGGOL: 17.5,
  WOODLANDS: 21.5,
  YISHUN: 16.5,
  HOUGANG: 11.5,
  'ANG MO KIO': 9.0,
  BISHAN: 8.0,
  'TOA PAYOH': 5.5,
  QUEENSTOWN: 3.5,
  'BUKIT MERAH': 4.5,
  CLEMENTI: 9.0,
  GEYLANG: 4.5,
  SERANGOON: 8.5,
  'MARINE PARADE': 6.0,
  'PASIR RIS': 18.0,
  'KALLANG/WHAMPOA': 3.5,
  'CENTRAL AREA': 1.5,
  'BUKIT TIMAH': 9.5,
  'CHOA CHU KANG': 20.0,
  'BUKIT BATOK': 15.0,
  'BUKIT PANJANG': 18.0,
  SEMBAWANG: 23.0
}

// Human-readable labels for SHAP feature names
const FEATURE_LABELS = {
  year: 'Sale Year',
  years_since_2000: 'Market Timing',
  is_mature_estate: 'Mature Estate',
  dist_to_cbd_km: 'Distance to CBD',
  age_at_sale: 'Flat Age',
  remaining_lease_years: 'Remaining Lease',
  post_cooling_2022: '2022 Cooling Measures',
  'flat_type_4 ROOM': 'Flat Type (4 Room)',
  'flat_type_5 ROOM': 'Flat Type (5 Room)',
  'flat_type_3 ROOM': 'Flat Type (3 Room)',
  flat_type_EXECUTIVE: 'Flat Type (Executive)',
  floor_area_sqm: 'Floor Area',
  storey_mid: 'Floor Level',
  dist_nearest_mrt_km: 'Distance to MRT',
  top_school_within_1km: 'Top School Nearby',
  mrt_count_within_1km: 'MRT Count (1km)',
  dist_nearest_top_school_km: 'Distance to Top School',
  hawkers_within_500m: 'Hawker Centres Nearby',
  primary_schools_within_1km: 'Primary Schools (1km)',
  interest_rate_proxy: 'Interest Rate Climate',
  transaction_count_per_block_last_2yr: 'Block Demand (2yr)',
  month_sin: 'Seasonal Factor',
  quarter: 'Quarter',
  post_cooling_2018: '2018 Cooling Measures',
  post_cooling_2013: '2013 Cooling Measures',
  post_covid_boom: 'Post-COVID Boom',
  lat: 'Location (Lat)',
  lng: 'Location (Lng)'
}

// Which features are actionable (seller can influence/frame differently)
// vs structural (fixed, cannot be changed)
const ACTIONABLE_FEATURES = new Set([
  'storey_mid',
  'dist_nearest_mrt_km',
  'month_sin',
  'quarter',
  'top_school_within_1km',
  'hawkers_within_500m',
  'mrt_count_within_1km',
  'transaction_count_per_block_last_2yr',
  'interest_rate_proxy'
])

const NON_ACTIONABLE_FEATURES = new Set([
  'year',
  'years_since_2000',
  'is_mature_estate',
  'dist_to_cbd_km',
  'age_at_sale',
  'remaining_lease_years',
  'floor_area_sqm',
  'flat_type_4 ROOM',
  'flat_type_5 ROOM',
  'flat_type_3 ROOM',
  'flat_type_EXECUTIVE',
  'flat_type_MULTI-GENERATION',
  'post_cooling_2022',
  'post_cooling_2018',
  'post_cooling_2013',
  'post_covid_boom',
  'lease_commence_date',
  'lat',
  'lng'
])

const STOREY_PRESETS = [
  { label: '01–03', value: '01 TO 03' },
  { label: '04–06', value: '04 TO 06' },
  { label: '07–09', value: '07 TO 09' },
  { label: '10–12', value: '10 TO 12' },
  { label: '13–15', value: '13 TO 15' },
  { label: '16–18', value: '16 TO 18' },
  { label: '19–21', value: '19 TO 21' },
  { label: '22–25', value: '22 TO 25' }
]

function normalizeStoreyRange(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+TO\s+/gi, ' TO ')
}

/** Map town median YoY to listing buffer vs model estimate (warmer town -> more headroom). */
function suggestedMultiplierFromTrends(trendsResponse) {
  const t = trendsResponse?.trends
  if (!Array.isArray(t) || t.length < 2) return 1.03
  const sorted = [...t].sort((a, b) => a.year - b.year)
  const prev = sorted[sorted.length - 2]
  const last = sorted[sorted.length - 1]
  const base = Number(prev.median_price)
  if (!base || base <= 0) return 1.03
  const yoy = ((Number(last.median_price) - base) / base) * 100
  if (yoy >= 6) return 1 + Math.min(0.08, 0.04 + (yoy - 6) * 0.008)
  if (yoy >= 3) return 1.03 + (yoy - 3) * 0.01
  if (yoy <= -4) return Math.max(0.98, 1 + yoy * 0.003)
  if (yoy < 0) return 1 + yoy * 0.002
  return 1.03
}

function sortSellerComparables(comparables, town) {
  const tu = String(town || '').toUpperCase()
  return [...(comparables || [])].sort((a, b) => {
    const am = String(a.town || '').toUpperCase() === tu ? 1 : 0
    const bm = String(b.town || '').toUpperCase() === tu ? 1 : 0
    if (bm !== am) return bm - am
    const ad = a.similarity_display_pct ?? a.similarity_pct ?? 0
    const bd = b.similarity_display_pct ?? b.similarity_pct ?? 0
    return bd - ad
  })
}

function buildSellerFlatPayload(form) {
  let flat = buildHybridFlatPayload({
    block: form.block,
    street_name: form.streetName,
    town: form.town,
    flat_type: form.flatType,
    floor_area_sqm: parseFloat(String(form.floorArea)) || 0,
    storey_range: String(form.storey_range || '').trim(),
    lease_commence_date: parseInt(form.leaseCommenceDate, 10),
    sale_month: form.sale_month || defaultSaleMonth()
  })
  flat.dist_to_cbd_km = TOWN_CBD_DIST[form.town] || flat.dist_to_cbd_km
  if (form.useAdvancedPoi) {
    const dm = parseFloat(form.distMrt)
    const ds = parseFloat(form.distTopSchool)
    flat = {
      ...flat,
      dist_nearest_mrt_km: Number.isFinite(dm) ? dm : flat.dist_nearest_mrt_km,
      dist_nearest_top_school_km: Number.isFinite(ds) ? ds : flat.dist_nearest_top_school_km,
      top_school_within_1km: Number.isFinite(ds) && ds <= 1 ? 1 : 0,
      top_school_within_2km: Number.isFinite(ds) && ds <= 2 ? 1 : 0,
      hawkers_within_500m: parseInt(form.hawkers500m, 10) || 0,
      mrt_count_within_1km:
        Number.isFinite(dm) && dm <= 1 ? 2 : flat.mrt_count_within_1km,
      dist_nearest_hawker_km:
        parseInt(form.hawkers500m, 10) > 0 ? 0.3 : flat.dist_nearest_hawker_km
    }
  }
  return flat
}

// ─── CSP Banner ───────────────────────────────────────────────────────────────

function ViolationCard({ v }) {
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
        {v.source === 'surrogate' ? 'Surrogate rule' : 'Apriori pattern'}
      </div>
      <div
        style={{
          fontSize: '13px',
          color: '#111827',
          fontWeight: 500,
          marginBottom: '6px'
        }}
      >
        {v.message}
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
        <span>
          Expected:{' '}
          <strong style={{ color: '#16a34a' }}>{v.expected}</strong>
        </span>
        <span>·</span>
        <span>
          Your listing:{' '}
          <strong style={{ color: '#dc2626' }}>{v.actual}</strong>
        </span>
        <span>·</span>
        <span>
          Confidence: <strong>{Math.round(v.rule_confidence * 100)}%</strong>
        </span>
      </div>
      <div style={{ fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>
        {v.suggestion}
      </div>
    </div>
  )
}

function CSPBanner({ cspResult, askingPrice, predictedPrice, loading }) {
  if (!cspResult || !askingPrice || !predictedPrice) return null
  const hasViolations = cspResult.violation_count > 0
  const ap = cspResult.apriori
  const su = cspResult.surrogate
  const apViol = ap?.violations?.length
    ? ap.violations
    : (cspResult.violations || []).filter((x) => (x.source || 'apriori') !== 'surrogate')
  const suViol = su?.violations?.length
    ? su.violations
    : (cspResult.violations || []).filter((x) => x.source === 'surrogate')
  const apSat = ap?.satisfied ?? []
  const suSat = su?.satisfied ?? []
  const showSurrogateBlock = su != null || suViol.length > 0 || suSat.length > 0

  return (
    <div
      style={{
        borderRadius: '14px',
        border: `1px solid ${hasViolations ? '#fde68a' : '#bbf7d0'}`,
        background: hasViolations ? '#fffbeb' : '#f0fdf4',
        padding: '16px 20px',
        marginBottom: '16px'
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
              : 'Listing consistent with market patterns and surrogate checks'}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
            Asking price{' '}
            <strong>${askingPrice.toLocaleString()}</strong> · CSP{' '}
            <span
              style={{
                fontWeight: 700,
                color: hasViolations ? '#b45309' : '#16a34a'
              }}
            >
              {cspResult.csp_status}
            </span>
            {loading && (
              <span style={{ marginLeft: '6px', opacity: 0.7 }}>…</span>
            )}
          </div>
        </div>
      </div>

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
          Market patterns (Apriori)
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
            Model rules (surrogate)
          </div>
          {su == null && suViol.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
              Surrogate check unavailable (feature bundle not loaded or error on server).
            </div>
          )}
          {su != null && suViol.length === 0 && suSat.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
              No surrogate rule path matched, or all matched paths align with your ask.
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

function AskingPriceSummary({ askingPrice, predicted, low, high }) {
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SellerView() {
  const [form, setForm] = useState({
    block: '201',
    streetName: 'TAMPINES ST 21',
    town: 'TAMPINES',
    flatType: '4 ROOM',
    floorArea: '92',
    storey_range: '07 TO 09',
    leaseCommenceDate: '1993',
    sale_month: defaultSaleMonth(),
    useAdvancedPoi: false,
    distMrt: '0.4',
    distTopSchool: '0.8',
    hawkers500m: '2'
  })

  const [results, setResults] = useState(null)
  const [askingPrice, setAskingPrice] = useState(null)
  const [cspResult, setCspResult] = useState(null)
  const [cspLoading, setCspLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [formCollapsed, setFormCollapsed] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [suggestedListingMultiplier, setSuggestedListingMultiplier] = useState(1.03)

  const [whatIfStorey, setWhatIfStorey] = useState(8)
  const [whatIfMrt, setWhatIfMrt] = useState(0.4)
  const [whatIfLease, setWhatIfLease] = useState(67)
  const [whatIfPrice, setWhatIfPrice] = useState(null)
  const [whatIfShap, setWhatIfShap] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const debounceRef = useRef(null)
  const cspDebounceRef = useRef(null)

  const remainingLease = remainingLeaseApprox(
    parseInt(form.leaseCommenceDate || '1993', 10),
    form.sale_month || defaultSaleMonth()
  )

  const normalizedStorey = normalizeStoreyRange(form.storey_range)

  function handleFormChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleAnalyse() {
    setLoading(true)
    setError(null)
    setResults(null)

    const block = String(form.block || '').trim()
    const street = String(form.streetName || '').trim()
    if (!block || !street) {
      setError('Enter block and street name so we can locate your flat and match comparables.')
      setLoading(false)
      return
    }

    let flat = buildSellerFlatPayload(form)

    try {
      const trendsRes = await getTrends(form.town).catch(() => null)
      const mult = suggestedMultiplierFromTrends(trendsRes)
      setSuggestedListingMultiplier(mult)

      if (!form.useAdvancedPoi) {
        try {
          const geo = await geocodeAddress(`${block} ${street}`)
          if (geo?.found) {
            const nearby = await getNearbyAmenities(geo.lat, geo.lng, 2000)
            flat = applyNearbyToFlatPayload(flat, nearby)
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Geocode/nearby failed:', e)
        }
      }

      const [predictRes, shapRes, cbrRes] = await Promise.all([
        api.post('/api/predict', flat),
        api.post('/api/explain/shap', { flat }),
        api.post('/api/cbr/similar', { flat, k: 6 })
      ])

      const predictedPrice = predictRes.data.predicted_price

      const cfFinal = await api
        .post('/api/counterfactual', {
          flat,
          asking_price: Math.round(predictedPrice * Math.min(mult + 0.02, 1.08))
        })
        .catch(() => null)

      const sm = parseStoreyMid(form.storey_range)
      setWhatIfStorey(sm)
      setWhatIfMrt(flat.dist_nearest_mrt_km)
      setWhatIfLease(remainingLease)
      setWhatIfPrice(predictedPrice)
      setWhatIfShap(shapRes.data.shap_values)

      const comparablesSorted = sortSellerComparables(
        cbrRes.data.comparables,
        form.town
      )

      setResults({
        predict: predictRes.data,
        shap: shapRes.data,
        cbr: { ...cbrRes.data, comparables: comparablesSorted },
        cf: cfFinal?.data || null,
        baseFlatPayload: flat
      })
      const initialAsking = Math.round(predictedPrice * mult)
      setAskingPrice(initialAsking)
      setCspResult(null)
      setFormCollapsed(true)
    } catch (err) {
      setError(
        'Could not connect to backend. Make sure FastAPI is running on port 8000.'
      )
      // eslint-disable-next-line no-console
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const runWhatIf = useCallback(async (storey, mrt, lease, baseFlatPayload) => {
    if (!baseFlatPayload) return
    setWhatIfLoading(true)
    try {
      const modified = {
        ...baseFlatPayload,
        storey_mid: storey,
        dist_nearest_mrt_km: mrt,
        remaining_lease_years: lease
      }
      const [predRes, shapRes] = await Promise.all([
        api.post('/api/predict', modified),
        api.post('/api/explain/shap', { flat: modified })
      ])
      setWhatIfPrice(predRes.data.predicted_price)
      setWhatIfShap(shapRes.data.shap_values)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('What-if error', e)
    } finally {
      setWhatIfLoading(false)
    }
  }, [])

  function handleWhatIfChange(field, value) {
    const newStorey = field === 'storey' ? value : whatIfStorey
    const newMrt = field === 'mrt' ? value : whatIfMrt
    const newLease = field === 'lease' ? value : whatIfLease
    if (field === 'storey') setWhatIfStorey(value)
    if (field === 'mrt') setWhatIfMrt(value)
    if (field === 'lease') setWhatIfLease(value)

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runWhatIf(newStorey, newMrt, newLease, results?.baseFlatPayload)
    }, 400)
  }

  // ─── Live CSP validation based on asking price ─────────────────────
  useEffect(() => {
    if (!results || !askingPrice) return

    const flat = results.baseFlatPayload
    if (!flat) return

    // Debounce CSP checks to avoid spamming the backend while typing.
    if (cspDebounceRef.current) {
      clearTimeout(cspDebounceRef.current)
    }

    setCspLoading(true)
    cspDebounceRef.current = setTimeout(async () => {
      try {
        const payload = {
          asking_price: askingPrice,
          flat
        }
        const resp = await api.post('/api/validate-listing', payload)
        setCspResult(resp.data)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('CSP check failed:', e)
        setCspResult(null)
      } finally {
        setCspLoading(false)
      }
    }, 600)

    return () => {
      if (cspDebounceRef.current) {
        clearTimeout(cspDebounceRef.current)
      }
    }
  }, [askingPrice, results])

  const leaseTone =
    remainingLease >= 60
      ? { bg: 'bg-emerald-50', text: 'text-emerald-800' }
      : remainingLease >= 40
        ? { bg: 'bg-amber-50', text: 'text-amber-900' }
        : { bg: 'bg-red-50', text: 'text-red-900' }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Seller&apos;s workspace</CardTitle>
          <CardDescription>
            Fair market value, asking price guidance, and what drives your valuation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 border-t border-border/60 pt-5">
          {formCollapsed && results ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-foreground">
                <span className="font-semibold">
                  Blk {form.block} {form.streetName}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {form.town} · {form.flatType} · {form.floorArea} sqm · Lease start{' '}
                  {form.leaseCommenceDate} · Sale month {form.sale_month || defaultSaleMonth()}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormCollapsed(false)}
                >
                  Edit inputs
                </Button>
                <Button type="button" size="sm" onClick={handleAnalyse} disabled={loading}>
                  {loading ? 'Analysing…' : 'Re-run analysis'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Block number">
                  <Input
                    value={form.block}
                    onChange={(e) => handleFormChange('block', e.target.value)}
                    placeholder="e.g. 201"
                    className="h-9"
                  />
                </FormField>
                <FormField label="Street name">
                  <Input
                    value={form.streetName}
                    onChange={(e) => handleFormChange('streetName', e.target.value)}
                    placeholder="e.g. TAMPINES ST 21"
                    className="h-9"
                  />
                </FormField>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                We use your address to match the same data path as official resale records and to
                estimate distances to MRT, schools, and hawkers (unless you use overrides below).
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Town">
                  <Select value={form.town} onValueChange={(v) => handleFormChange('town', v)}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TOWNS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Flat Type">
                  <Select value={form.flatType} onValueChange={(v) => handleFormChange('flatType', v)}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE'].map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Floor Area (sqm)">
                  <Input
                    type="number"
                    value={form.floorArea}
                    onChange={(e) => handleFormChange('floorArea', e.target.value)}
                    min={30}
                    max={300}
                    className="h-9"
                  />
                </FormField>

                <FormField label="Sale month (valuation)">
                  <Input
                    type="month"
                    value={form.sale_month || defaultSaleMonth()}
                    onChange={(e) => handleFormChange('sale_month', e.target.value)}
                    className="h-9"
                  />
                </FormField>
              </div>

              <FormField label="Storey range">
                <div className="flex flex-wrap gap-2">
                  {STOREY_PRESETS.map((p) => {
                    const selected = normalizedStorey === normalizeStoreyRange(p.value)
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => handleFormChange('storey_range', p.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
                            : 'border-border bg-background hover:bg-muted/60'
                        }`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <Input
                  className="mt-2 h-9 max-w-xs"
                  placeholder="Custom e.g. 07 TO 09"
                  value={form.storey_range}
                  onChange={(e) => handleFormChange('storey_range', e.target.value)}
                />
              </FormField>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Lease start year">
                  <Input
                    type="number"
                    value={form.leaseCommenceDate}
                    onChange={(e) => handleFormChange('leaseCommenceDate', e.target.value)}
                    min={1960}
                    max={2035}
                    className="h-9"
                  />
                </FormField>

                <FormField label="Remaining lease (from lease year + sale month)">
                  <div className="space-y-1">
                    <div
                      className={`flex min-h-9 items-center rounded-md border border-input px-3 text-sm font-medium ${leaseTone.bg} ${leaseTone.text}`}
                    >
                      {remainingLease > 0 ? `${remainingLease} years` : '—'}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Calculated from lease start {form.leaseCommenceDate} and sale month{' '}
                      {form.sale_month || defaultSaleMonth()}. Change those fields to adjust.
                    </p>
                  </div>
                </FormField>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-sm font-medium text-foreground"
                  onClick={() => setAdvancedOpen((o) => !o)}
                >
                  Advanced: manual distance overrides
                  <span className="text-muted-foreground">{advancedOpen ? '−' : '+'}</span>
                </button>
                {advancedOpen && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.useAdvancedPoi}
                        onChange={(e) => handleFormChange('useAdvancedPoi', e.target.checked)}
                      />
                      Use manual values instead of map-based distances
                    </label>
                    <FormField label="Nearest MRT (km)">
                      <Input
                        type="number"
                        value={form.distMrt}
                        step={0.1}
                        onChange={(e) => handleFormChange('distMrt', e.target.value)}
                        min={0}
                        max={5}
                        disabled={!form.useAdvancedPoi}
                        className="h-9"
                      />
                    </FormField>
                    <FormField label="Nearest top school (km)">
                      <Input
                        type="number"
                        value={form.distTopSchool}
                        step={0.1}
                        onChange={(e) => handleFormChange('distTopSchool', e.target.value)}
                        min={0}
                        max={5}
                        disabled={!form.useAdvancedPoi}
                        className="h-9"
                      />
                    </FormField>
                    <FormField label="Hawkers within 500m (count)">
                      <Input
                        type="number"
                        value={form.hawkers500m}
                        onChange={(e) => handleFormChange('hawkers500m', e.target.value)}
                        min={0}
                        max={20}
                        disabled={!form.useAdvancedPoi}
                        className="h-9"
                      />
                    </FormField>
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 pt-4">
                <Button type="button" size="lg" onClick={handleAnalyse} disabled={loading}>
                  {loading ? 'Analysing…' : 'Analyse my flat'}
                </Button>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {results && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginBottom: '16px'
            }}
          >
            <div style={cardStyle}>
              <SectionLabel>🏷 Fair Value Analysis</SectionLabel>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '12px',
                  marginBottom: '16px'
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      marginBottom: '4px'
                    }}
                  >
                    AI ESTIMATE
                  </div>
                  <div
                    style={{
                      fontSize: '36px',
                      fontWeight: 800,
                      color: '#111827',
                      lineHeight: 1
                    }}
                  >
                    $
                    {Math.round(
                      results.predict.predicted_price
                    ).toLocaleString()}
                  </div>
                </div>
                <ConfidenceBadge
                  low={results.predict.confidence_low}
                  high={results.predict.confidence_high}
                />
              </div>

              <div
                style={{
                  marginBottom: '16px',
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '16px'
                }}
              >
                <SectionLabel>What drove this valuation?</SectionLabel>
                <p
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    marginBottom: '16px'
                  }}
                >
                  Top factors from the model for your flat (green adds value, red reduces it).
                </p>
                <WhatAddsValue shapValues={results.shap.shap_values} />
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '24px',
                  marginBottom: '16px'
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    FLOOR
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: '#64748b'
                    }}
                  >
                    $
                    {Math.round(
                      results.predict.confidence_low
                    ).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    CEILING
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: '#64748b'
                    }}
                  >
                    $
                    {Math.round(
                      results.predict.confidence_high
                    ).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    $/SQM
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 600 }}>
                    $
                    {results.predict.price_per_sqm?.toLocaleString()}
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  background: '#f9fafb',
                  borderRadius: '8px',
                  padding: '10px 12px'
                }}
              >
                Suggested listing price:{' '}
                <strong style={{ color: '#111827' }}>
                  $
                  {Math.round(
                    results.predict.predicted_price * suggestedListingMultiplier
                  ).toLocaleString()}
                </strong>{' '}
                — based on recent median trend in {form.town}: list about{' '}
                {((suggestedListingMultiplier - 1) * 100).toFixed(1)}% vs estimate for
                negotiation room (adjust if your unit is exceptional).
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <CbrDivergenceWarning
                cbrCheck={results.predict.cbr_check}
                predictedPrice={results.predict.predicted_price}
              />
            </div>

            <div style={cardStyle}>
              <SectionLabel>🤝 Negotiation Range</SectionLabel>
              {results.cf ? (
                <NegotiationRange
                  cf={results.cf}
                  predicted={results.predict.predicted_price}
                  listingMultiplier={suggestedListingMultiplier}
                />
              ) : (
                <div
                  style={{ color: 'var(--text-secondary)', fontSize: '13px' }}
                >
                  Negotiation data unavailable
                </div>
              )}
            </div>
          </div>

          {askingPrice != null && results.predict.cbr_check?.cbr_median != null && (
            <Card className="mb-4 border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-medium text-muted-foreground">
                  Price positioning
                </CardTitle>
                <CardDescription>AI estimate vs CBR median vs asking price</CardDescription>
              </CardHeader>
              <CardContent>
                <PriceRangeCard
                  aiEstimate={results.predict.predicted_price}
                  cbrMedian={results.predict.cbr_check.cbr_median}
                  listingPrice={askingPrice}
                  confidenceLow={results.predict.confidence_low}
                  confidenceHigh={results.predict.confidence_high}
                  cbrSampleSize={results.predict.cbr_check.cbr_sample_size ?? 5}
                  onEditListing={() => {
                    document.getElementById('seller-asking-price')?.focus()
                    document.getElementById('seller-asking-price')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center'
                    })
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* Set Asking Price — full width card */}
          <div style={{ ...cardStyle, marginBottom: '16px' }}>
            <SectionLabel>💵 Set Your Asking Price</SectionLabel>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '12px'
              }}
            >
              Start with a fair asking price, then fine‑tune based on your strategy.
              We&apos;ll check it against market rules in real time.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.6fr)',
                gap: '18px',
                alignItems: 'flex-start'
              }}
            >
              <div>
                <FormField label="Your Asking Price (SGD)">
                  <input
                    id="seller-asking-price"
                    type="number"
                    min="0"
                    value={askingPrice ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setAskingPrice(v === '' ? null : Number(v))
                    }}
                    style={{
                      ...inputStyle,
                      maxWidth: '260px'
                    }}
                  />
                </FormField>

                {/* Zone legend */}
                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span
                      style={{
                        background: '#fef2f2',
                        color: '#b91c1c',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontWeight: 600,
                        fontSize: '11px'
                      }}
                    >
                      🔴 Below floor — leaving money on the table
                    </span>
                    <span
                      style={{
                        background: '#f0fdf4',
                        color: '#166534',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontWeight: 600,
                        fontSize: '11px'
                      }}
                    >
                      🟢 Fair zone — competitive
                    </span>
                    <span
                      style={{
                        background: '#fffbeb',
                        color: '#b45309',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontWeight: 600,
                        fontSize: '11px'
                      }}
                    >
                      🟡 Above ceiling — may deter buyers
                    </span>
                  </div>
                </div>
              </div>

              <div>
                {askingPrice && (
                  <AskingPriceSummary
                    askingPrice={askingPrice}
                    predicted={results.predict.predicted_price}
                    low={results.predict.confidence_low}
                    high={results.predict.predicted_price * 1.08}
                  />
                )}
                {cspLoading && (
                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    Checking your asking price against market rules…
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CSP banner driven by asking price */}
          <CSPBanner
            cspResult={cspResult}
            askingPrice={askingPrice}
            predictedPrice={results.predict.predicted_price}
            loading={cspLoading}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginBottom: '16px'
            }}
          >
            <div style={cardStyle}>
              <SectionLabel>🎛 What-If Price Simulator</SectionLabel>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginBottom: '16px'
                }}
              >
                Drag the sliders to see how changes affect your estimated price
                in real time.
              </p>

              <WhatIfSimulator
                basePrice={results.predict.predicted_price}
                whatIfPrice={whatIfPrice}
                whatIfShap={whatIfShap}
                baseShap={results.shap.shap_values}
                whatIfStorey={whatIfStorey}
                whatIfMrt={whatIfMrt}
                whatIfLease={whatIfLease}
                loading={whatIfLoading}
                onStoreyChange={(v) => handleWhatIfChange('storey', v)}
                onMrtChange={(v) => handleWhatIfChange('mrt', v)}
                onLeaseChange={(v) => handleWhatIfChange('lease', v)}
              />
            </div>

            <div style={cardStyle}>
              <SectionLabel>📍 Recent comparable sales</SectionLabel>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginBottom: '14px'
                }}
              >
                Same-town matches are listed first when available, then wider market. Use as a
                benchmark, not a guarantee.
              </p>
              <RecentSalesTable
                comparables={results.cbr.comparables}
                estimate={results.predict.predicted_price}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormField({ label, children }) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
          marginBottom: '6px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <h3
      style={{
        fontSize: '14px',
        fontWeight: 600,
        marginBottom: '14px',
        color: '#111827'
      }}
    >
      {children}
    </h3>
  )
}

function ConfidenceBadge({ low, high }) {
  const range = high - low
  const level = range < 60000 ? 'High' : range < 120000 ? 'Medium' : 'Low'
  const colors = {
    High: { bg: '#f0fdf4', text: '#166534' },
    Medium: { bg: '#fffbeb', text: '#92400e' },
    Low: { bg: '#fef2f2', text: '#991b1b' }
  }
  const c = colors[level]
  const band = formatConfidenceBandK(low, high)
  const title =
    level === 'High'
      ? `Narrow 95% band (${band}): the model is relatively confident for flats similar to yours.`
      : level === 'Medium'
        ? `Medium-width band (${band}): fewer very similar recent sales in the data — treat the range as a guide.`
        : `Wide band (${band}): higher uncertainty; compare with recent sales and professional advice.`
  return (
    <div
      title={title}
      style={{
        background: c.bg,
        color: c.text,
        padding: '4px 12px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        marginBottom: '8px',
        cursor: 'help',
        maxWidth: 'min(280px, 100%)'
      }}
    >
      {level === 'High' ? '🟢' : level === 'Medium' ? '🟡' : '🔴'} {level}{' '}
      Confidence
    </div>
  )
}

function NegotiationRange({ cf, predicted, listingMultiplier = 1.03 }) {
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
    </div>
  )
}

function WhatAddsValue({ shapValues }) {
  if (!shapValues) return null

  const actionable = [...shapValues]
    .filter((f) => ACTIONABLE_FEATURES.has(f.feature))
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .slice(0, 4)
  const nonActionable = [...shapValues]
    .filter((f) => NON_ACTIONABLE_FEATURES.has(f.feature))
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .slice(0, 5)


  function getTip(item) {
    const val = Math.round(item.shap_value)
    const label = FEATURE_LABELS[item.feature] || item.feature
    const impact =
      val >= 0
        ? `adds ~$${Math.abs(val).toLocaleString()}`
        : `reduces by ~$${Math.abs(val).toLocaleString()}`
    const tips = {
      storey_mid:
        val >= 0
          ? `Being on floor ${item.feature_value} ${impact}. Higher floors command a premium.`
          : `Being on floor ${item.feature_value} ${impact}. This is a structural factor buyers consider.`,
      dist_nearest_mrt_km:
        val >= 0
          ? `MRT proximity (${item.feature_value}km) ${impact}. Emphasise walking distance in your listing.`
          : `MRT distance (${item.feature_value}km) ${impact}. Mention bus connections or cycling distance.`,
      top_school_within_1km:
        val >= 0
          ? `Top school within 1km ${impact}. Highlight this in your listing title.`
          : `No top school within 1km ${impact}. Focus on other amenities nearby.`,
      hawkers_within_500m:
        val >= 0
          ? `${item.feature_value} hawker centre(s) nearby ${impact}. Mention food options in listing.`
          : `Limited hawkers nearby ${impact} compared to average.`,
      mrt_count_within_1km:
        val >= 0
          ? `${item.feature_value} MRT station(s) within 1km ${impact}. Multiple transit options are a selling point.`
          : `Fewer MRT options nearby slightly reduces value.`
    }
    return tips[item.feature] || `${label} ${impact} to your price.`
  }

  function getNonActionableTip(item) {
    const val = Math.round(item.shap_value)
    const label = FEATURE_LABELS[item.feature] || item.feature
    const tips = {
      is_mature_estate:
        val >= 0
          ? `✅ Mature estate adds $${Math.abs(val).toLocaleString()} — established infrastructure and amenities are highly valued.`
          : `Non-mature estate — newer town, slightly lower premium vs mature estates.`,
      remaining_lease_years:
        val >= 0
          ? `✅ ${item.feature_value}yr remaining lease adds $${Math.abs(
              val
            ).toLocaleString()} — above average lease remaining.`
          : `⚠️ ${item.feature_value}yr remaining lease reduces value by $${Math.abs(
              val
            ).toLocaleString()} — below average.`,
      floor_area_sqm:
        val >= 0
          ? `✅ ${item.feature_value}sqm floor area adds $${Math.abs(
              val
            ).toLocaleString()} — above average for this flat type.`
          : `${item.feature_value}sqm is below average for this flat type, reducing value by $${Math.abs(
              val
            ).toLocaleString()}.`,
      dist_to_cbd_km:
        val >= 0
          ? `✅ ${item.feature_value}km from CBD adds $${Math.abs(
              val
            ).toLocaleString()} — location premium.`
          : `${item.feature_value}km from CBD reduces value by $${Math.abs(
              val
            ).toLocaleString()} compared to central areas.`,
      age_at_sale:
        val >= 0
          ? `Flat age (${item.feature_value} years) is neutral or positive.`
          : `Flat age (${item.feature_value} years) reduces value by $${Math.abs(
              val
            ).toLocaleString()} — older flats trade at a discount.`
    }
    return (
      tips[item.feature] ||
      `${label}: ${val >= 0 ? 'adds' : 'reduces'} $${Math.abs(
        val
      ).toLocaleString()}.`
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px'
      }}
    >
      <div>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            color: '#16a34a',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          ✅ Actionable — You Can Leverage These
        </div>
        {actionable.length === 0 && (
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)'
            }}
          >
            No actionable factors in top drivers.
          </p>
        )}
        {actionable.map((item) => (
          <div
            key={item.feature}
            style={{
              background:
                item.shap_value >= 0 ? '#f0fdf4' : '#fef2f2',
              borderLeft: `3px solid ${
                item.shap_value >= 0 ? '#22c55e' : '#ef4444'
              }`,
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '8px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '4px'
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600 }}>
                {FEATURE_LABELS[item.feature] || item.feature}
              </span>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color:
                    item.shap_value >= 0 ? '#16a34a' : '#dc2626'
                }}
              >
                {item.shap_value >= 0 ? '+' : '-'}$
                {Math.abs(Math.round(item.shap_value)).toLocaleString()}
              </span>
            </div>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                margin: 0
              }}
            >
              {getTip(item)}
            </p>
          </div>
        ))}
      </div>

      <div>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            color: '#6b7280',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          ℹ️ Structural — Fixed Factors
        </div>
        {nonActionable.length === 0 && (
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)'
            }}
          >
            No structural factors in top drivers.
          </p>
        )}
        {nonActionable.map((item) => (
          <div
            key={item.feature}
            style={{
              background: '#f9fafb',
              borderLeft: `3px solid ${
                item.shap_value >= 0 ? '#22c55e' : '#9ca3af'
              }`,
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '8px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '4px'
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600 }}>
                {FEATURE_LABELS[item.feature] || item.feature}
              </span>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#6b7280'
                }}
              >
                {item.shap_value >= 0 ? '+' : '-'}$
                {Math.abs(Math.round(item.shap_value)).toLocaleString()}
              </span>
            </div>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                margin: 0
              }}
            >
              {getNonActionableTip(item)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function WhatIfSimulator({
  basePrice,
  whatIfPrice,
  whatIfShap,
  baseShap,
  whatIfStorey,
  whatIfMrt,
  whatIfLease,
  loading,
  onStoreyChange,
  onMrtChange,
  onLeaseChange
}) {
  const currentPrice = whatIfPrice || basePrice
  const delta = Math.round(currentPrice - basePrice)
  const deltaPositive = delta >= 0

  const WHATSIF_FEATURES = [
    'storey_mid',
    'dist_nearest_mrt_km',
    'remaining_lease_years'
  ]
  const shapDeltaData = WHATSIF_FEATURES.map((feat) => {
    const baseVal =
      baseShap?.find((s) => s.feature === feat)?.shap_value || 0
    const currentVal =
      whatIfShap?.find((s) => s.feature === feat)?.shap_value || 0
    return {
      feature: FEATURE_LABELS[feat] || feat,
      delta: Math.round(currentVal - baseVal)
    }
  }).filter((d) => d.delta !== 0)

  return (
    <div>
      <div
        style={{
          background: deltaPositive ? '#f0fdf4' : '#fef2f2',
          borderRadius: '12px',
          padding: '14px 18px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              marginBottom: '2px'
            }}
          >
            NEW ESTIMATE
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800 }}>
            ${Math.round(currentPrice).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              marginBottom: '2px'
            }}
          >
            VS BASE
          </div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: deltaPositive ? '#16a34a' : '#dc2626'
            }}
          >
            {deltaPositive ? '+' : '-'}$
            {Math.abs(delta).toLocaleString()}
            {loading && (
              <span
                style={{
                  fontSize: '14px',
                  marginLeft: '8px',
                  opacity: 0.5
                }}
              >
                ⏳
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          marginBottom: '20px'
        }}
      >
        <SliderRow
          label="Floor Level"
          value={whatIfStorey}
          min={1}
          max={50}
          step={1}
          onChange={onStoreyChange}
          format={(v) => `Floor ${v}`}
          hint="Higher floors typically command a premium"
        />
        <SliderRow
          label="Distance to MRT"
          value={whatIfMrt}
          min={0.1}
          max={3.0}
          step={0.1}
          onChange={onMrtChange}
          format={(v) => `${v.toFixed(1)} km`}
          hint="Closer to MRT = higher value"
          reverse
        />
        <SliderRow
          label="Remaining Lease"
          value={whatIfLease}
          min={20}
          max={99}
          step={1}
          onChange={onLeaseChange}
          format={(v) => `${v} years`}
          hint="Longer lease = higher value"
        />
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
              <YAxis
                type="category"
                dataKey="feature"
                width={140}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(v) => [
                  `$${Math.abs(v).toLocaleString()}`,
                  v >= 0 ? 'Increase' : 'Decrease'
                ]}
              />
              <ReferenceLine x={0} stroke="#e5e7eb" />
              <Bar dataKey="delta" radius={[0, 4, 4, 0]}>
                {shapDeltaData.map((d) => (
                  <Cell
                    key={d.feature}
                    fill={d.delta >= 0 ? '#22c55e' : '#ef4444'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
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

function RecentSalesTable({ comparables, estimate }) {
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
            {['Address', 'Type', 'sqm', 'Floor', 'Price', 'Year', 'vs Est.'].map(
              (h) => (
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
              )
            )}
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
        &quot;vs Est.&quot; = how much each comp sold relative to your AI
        estimate. Positive means that comp sold higher than your estimate.
      </p>
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const cardStyle = {
  background: 'white',
  borderRadius: '16px',
  padding: '24px',
  boxShadow: 'var(--shadow-card)'
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

