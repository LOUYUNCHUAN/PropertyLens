import { useState, useCallback, useRef, useEffect } from 'react'
import api, {
  geocodeAddress,
  getNearbyAmenities,
  getRules,
  getTrends
} from '../api/client.js'
import SellerResultsStepFlow from '@/components/seller/SellerResultsStepFlow.jsx'
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
import {
  applyNearbyToFlatPayload,
  buildHybridFlatPayload,
  defaultSaleMonth,
  parseStoreyMid,
  remainingLeaseApprox
} from '@/lib/hybridFlatPayload.js'

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
  const [whatIfLease, setWhatIfLease] = useState(67)
  const [whatIfArea, setWhatIfArea] = useState(90)
  const [whatIfPrice, setWhatIfPrice] = useState(null)
  const [whatIfShap, setWhatIfShap] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [rules, setRules] = useState(null)
  const [resultsKey, setResultsKey] = useState(0)
  const debounceRef = useRef(null)
  const cspDebounceRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getRules()
      .then((data) => {
        if (!cancelled) setRules(data)
      })
      .catch(() => {
        if (!cancelled) setRules(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      setWhatIfLease(remainingLease)
      setWhatIfArea(flat.floor_area_sqm)
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
      setResultsKey((k) => k + 1)
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

  const runWhatIf = useCallback(async (storey, lease, area, baseFlatPayload) => {
    if (!baseFlatPayload) return
    setWhatIfLoading(true)
    try {
      const { block, street_name, sale_month, storey_range, ...basePayload } =
        baseFlatPayload
      const modified = {
        ...basePayload,
        storey_mid: storey,
        remaining_lease_years: lease,
        floor_area_sqm: area
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
    const newLease = field === 'lease' ? value : whatIfLease
    const newArea = field === 'area' ? value : whatIfArea
    if (field === 'storey') setWhatIfStorey(value)
    if (field === 'lease') setWhatIfLease(value)
    if (field === 'area') setWhatIfArea(value)

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runWhatIf(newStorey, newLease, newArea, results?.baseFlatPayload)
    }, 400)
  }

  const resetWhatIf = useCallback(() => {
    const flat = results?.baseFlatPayload
    if (!flat) return
    const sm = parseStoreyMid(form.storey_range)
    const lease = remainingLease
    const area = flat.floor_area_sqm
    setWhatIfStorey(sm)
    setWhatIfLease(lease)
    setWhatIfArea(area)
    runWhatIf(sm, lease, area, flat)
  }, [results?.baseFlatPayload, form.storey_range, remainingLease, runWhatIf])

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
    <div className="space-y-6">
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
        <SellerResultsStepFlow
          resultsKey={resultsKey}
          form={form}
          results={results}
          rules={rules}
          askingPrice={askingPrice}
          setAskingPrice={setAskingPrice}
          cspResult={cspResult}
          cspLoading={cspLoading}
          suggestedListingMultiplier={suggestedListingMultiplier}
          whatIfStorey={whatIfStorey}
          whatIfLease={whatIfLease}
          whatIfArea={whatIfArea}
          whatIfPrice={whatIfPrice}
          whatIfShap={whatIfShap}
          whatIfLoading={whatIfLoading}
          handleWhatIfChange={handleWhatIfChange}
          onResetWhatIf={resetWhatIf}
        />
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

