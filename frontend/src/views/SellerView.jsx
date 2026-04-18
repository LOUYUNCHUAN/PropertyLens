import { useState, useCallback, useRef, useEffect } from 'react'
import api, {
  geocodeAddress,
  getNearbyAmenities,
  getRules,
  getTrends
} from '../api/client.js'
import SellerResultsStepFlow from '@/components/seller/SellerResultsStepFlow.jsx'
import { TOWNS } from '../constants/towns.js'
import { FLAT_TYPES } from '@/constants/flatTypes.js'
import { STOREY_PRESETS } from '@/constants/storeyPresets.js'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
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

const SELLER_DEFAULT_FORM = {
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
}

function buildInitialSellerForm() {
  if (typeof window === 'undefined') return { ...SELLER_DEFAULT_FORM }
  const params = new URLSearchParams(window.location.search)
  if (!params.toString()) return { ...SELLER_DEFAULT_FORM }
  const next = { ...SELLER_DEFAULT_FORM }
  const paramMap = {
    block: 'block',
    street_name: 'streetName',
    town: 'town',
    flat_type: 'flatType',
    floor_area_sqm: 'floorArea',
    storey_range: 'storey_range',
    lease_commence_date: 'leaseCommenceDate',
    sale_month: 'sale_month'
  }
  Object.entries(paramMap).forEach(([urlKey, formKey]) => {
    const v = params.get(urlKey)
    if (v != null && v !== '') next[formKey] = String(v)
  })
  return next
}

export default function SellerView() {
  const [form, setForm] = useState(() => buildInitialSellerForm())
  const [fromShortlist] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).toString().length > 0
  )

  const [results, setResults] = useState(null)
  const [askingPrice, setAskingPrice] = useState(null)
  const [cspResult, setCspResult] = useState(null)
  const [cspLoading, setCspLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [formCollapsed, setFormCollapsed] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [suggestedListingMultiplier, setSuggestedListingMultiplier] = useState(1.03)
  const [photoAdjustment, setPhotoAdjustment] = useState(null)

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
    setPhotoAdjustment(null)

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
      // Anchor the asking-price input at the fair market estimate — not at the
      // town-YoY-buffered figure. The multiplier is still surfaced as a quick pick
      // so sellers can opt in with the rationale visible (BUG-013).
      setAskingPrice(Math.round(predictedPrice))
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
      ? 'text-emerald-600 dark:text-emerald-400'
      : remainingLease >= 40
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'

  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Seller&apos;s workspace</CardTitle>
          <CardDescription>
            Fair market value, asking price guidance, and what drives your valuation.
          </CardDescription>
          {!fromShortlist && (
            <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              Example flat pre-filled (Blk 201 Tampines St 21) — edit any field to your own.
            </div>
          )}
          {fromShortlist && (
            <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-md border border-dashed border-primary/50 bg-primary/10 px-2 py-1 text-xs text-primary">
              Loaded from your shortlist — analysing this saved flat.
            </div>
          )}
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
                      {FLAT_TYPES.map((t) => (
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

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Remaining lease
                  </span>
                  <div className="flex min-h-9 items-baseline gap-2">
                    <span className={`text-2xl font-semibold tabular-nums ${leaseTone}`}>
                      {remainingLease > 0 ? remainingLease : '—'}
                    </span>
                    <span className="text-sm text-muted-foreground">years remaining</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Auto-calculated from lease start {form.leaseCommenceDate} and sale month{' '}
                    {form.sale_month || defaultSaleMonth()}.
                  </p>
                </div>
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
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.useAdvancedPoi}
                        onChange={(e) => handleFormChange('useAdvancedPoi', e.target.checked)}
                      />
                      Use manual values instead of map-based distances
                    </label>
                    {form.useAdvancedPoi ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <FormField label="Nearest MRT (km)">
                          <Input
                            type="number"
                            value={form.distMrt}
                            step={0.1}
                            onChange={(e) => handleFormChange('distMrt', e.target.value)}
                            min={0}
                            max={5}
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
                            className="h-9"
                          />
                        </FormField>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Distances are automatically computed from your address. Enable manual override to type them in.
                      </p>
                    )}
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
          photoAdjustment={photoAdjustment}
          onPhotoAdjustmentChange={setPhotoAdjustment}
        />
      )}
    </div>
  )
}

// FormField now imported from '@/components/ui/form-field'

