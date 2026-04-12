import { useEffect, useMemo, useState } from 'react'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  predictPrice,
  getSHAP,
  getCBR,
  getLIME,
  getRules,
  geocodeAddress,
  getNearbyAmenities,
  savePredictionHistory,
  saveWishlistItem
} from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LocationMap from '../components/LocationMap.jsx'
import BuyerEstimateInsights from '../components/buyer/BuyerEstimateInsights.jsx'
import { TOWNS, getTownCoords } from '../constants/towns.js'
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
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  MATURE_ESTATES_LIST,
  defaultSaleMonth,
  parseStoreyMid,
  remainingLeaseApprox,
  buildHybridFlatPayload
} from '@/lib/hybridFlatPayload.js'

const MATURE_ESTATES = MATURE_ESTATES_LIST

const FLAT_TYPES = [
  '1 ROOM',
  '2 ROOM',
  '3 ROOM',
  '4 ROOM',
  '5 ROOM',
  'EXECUTIVE',
  'MULTI-GENERATION'
]

function normalizeStoreyRange(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+TO\s+/gi, ' TO ')
}

/** One-line counts for collapsible nearby section (keys match LocationMap / API). */
function nearbyAmenitySummary(nearby) {
  if (!nearby || typeof nearby !== 'object') return 'Map loads after estimate'
  const mrt =
    (Array.isArray(nearby.mrt) ? nearby.mrt.length : 0) +
    (Array.isArray(nearby.lrt) ? nearby.lrt.length : 0)
  const schools = Array.isArray(nearby.school) ? nearby.school.length : 0
  const hawker = Array.isArray(nearby.hawker) ? nearby.hawker.length : 0
  const mall = Array.isArray(nearby.mall) ? nearby.mall.length : 0
  if (mrt + schools + hawker + mall === 0) return 'No POIs in range · expand for map'
  const parts = []
  if (mrt) parts.push(`${mrt} MRT/LRT`)
  if (schools) parts.push(`${schools} schools`)
  if (hawker) parts.push(`${hawker} hawkers`)
  if (mall) parts.push(`${mall} malls`)
  return parts.join(' · ')
}

/** @deprecated Use buildHybridFlatPayload from @/lib/hybridFlatPayload.js */
export function buildHybridBuyerApiPayload(f) {
  return buildHybridFlatPayload(f)
}

const DEFAULT_FLAT = {
  block: '1',
  street_name: 'LORONG LEW LIAN',
  town: 'SERANGOON',
  flat_type: '3 ROOM',
  floor_area_sqm: 64,
  storey_range: '07 TO 09',
  lease_commence_date: 1978,
  sale_month: '2026-04'
}

function buildInitialForm() {
  const params = new URLSearchParams(window.location.search)
  if (!params.toString()) {
    return { ...DEFAULT_FLAT }
  }

  const fromParams = { ...DEFAULT_FLAT }
  const stringKeys = [
    'town',
    'flat_type',
    'block',
    'street_name',
    'storey_range',
    'sale_month'
  ]
  const numericKeys = ['floor_area_sqm', 'lease_commence_date']

  params.forEach((value, key) => {
    if (stringKeys.includes(key)) {
      fromParams[key] = value
    }
    if (numericKeys.includes(key)) {
      const num = Number(value)
      if (!Number.isNaN(num)) fromParams[key] = num
    }
  })

  return fromParams
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

export default function BuyerView() {
  const { username } = useAuth()
  const [form, setForm] = useState(() => buildInitialForm())
  const [listingPrice, setListingPrice] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('asking_price')
    if (p && !Number.isNaN(Number(p))) return p
    return '430000'
  })
  const [savedFlatPayload, setSavedFlatPayload] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [shap, setShap] = useState(null)
  const [cbr, setCbr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [geocodeResult, setGeocodeResult] = useState(null)
  const [nearbyResult, setNearbyResult] = useState(null)
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistMsg, setShortlistMsg] = useState(null)
  const [showResults, setShowResults] = useState(false)
  const [nearbyExpanded, setNearbyExpanded] = useState(false)
  const [rulesPayload, setRulesPayload] = useState(null)
  const [limeResult, setLimeResult] = useState(null)
  const [limeLoading, setLimeLoading] = useState(false)
  const [limeError, setLimeError] = useState(null)

  const listingAsNumber = useMemo(() => {
    const raw = String(listingPrice ?? '').replace(/,/g, '').trim()
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [listingPrice])

  const compareFlatForm = useMemo(
    () => ({
      ...form,
      storey_mid: parseStoreyMid(form.storey_range),
      remaining_lease_years: remainingLeaseApprox(
        Number(form.lease_commence_date),
        form.sale_month || defaultSaleMonth()
      )
    }),
    [form]
  )

  const normalizedStorey = normalizeStoreyRange(form.storey_range)

  const onChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const runEstimate = async (flatPayload) => {
    setLoading(true)
    setShowResults(true)
    setError(null)
    setPrediction(null)
    setShap(null)
    setCbr(null)
    setGeocodeResult(null)
    setNearbyResult(null)
    setSavedFlatPayload(flatPayload)
    setNearbyExpanded(false)
    setLimeResult(null)
    setLimeError(null)

    try {
      const [predRes, shapRes, cbrRes] = await Promise.all([
        predictPrice(flatPayload),
        getSHAP(flatPayload),
        getCBR(flatPayload, 5)
      ])


      setPrediction(predRes)
      setShap(shapRes)
      setCbr(cbrRes)

      const block = String(flatPayload.block || '').trim()
      let street = String(flatPayload.street_name || '').trim()
      const PG_NOISE = /\b(GALLERY|OVERVIEW|LOCATION|AMENITIES|MORTGAGE|PRICE HISTORY|FLOOR PLAN|DESCRIPTION)\b/i
      const noiseIdx = street.search(PG_NOISE)
      if (noiseIdx > 0) street = street.slice(0, noiseIdx).trim()
      street = street.replace(/\s+S\$\s*\d+.*$/i, '').trim()
      if (street.length > 60) street = street.split(/\s+/).slice(0, 6).join(' ')
      const town = String(flatPayload.town || '').trim()
      try {
        let geo = null
        if (block && street) {
          geo = await geocodeAddress(`${block} ${street}`)
        }
        if (geo && geo.found) {
          setGeocodeResult(geo)
          const nb = await getNearbyAmenities(geo.lat, geo.lng, 2000)
          setNearbyResult(nb)
        } else {
          const fallback = getTownCoords(town)
          setGeocodeResult({
            found: false,
            lat: fallback[0],
            lng: fallback[1],
            address: town,
            postal_code: null
          })
          const nb = await getNearbyAmenities(fallback[0], fallback[1], 2000)
          setNearbyResult(nb)
        }
      } catch (e) {
        console.warn('Geocode/nearby failed:', e)
      }

      try {
        const u = (username && username.trim()) || localStorage.getItem('hdb_user') || 'user'
        await savePredictionHistory({
          username: u,
          source: 'buyer',
          payload: flatPayload,
          predicted_price: predRes.predicted_price,
          confidence_low: predRes.confidence_low,
          confidence_high: predRes.confidence_high
        })
      } catch (histErr) {
        console.warn('Could not save prediction history', histErr)
      }
    } catch (err) {
      console.error(err)
      setError('Something went wrong while fetching the estimate.')
      setShowResults(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('town')) return

    const askingPrice = params.get('asking_price')
    if (askingPrice) setListingPrice(askingPrice)

    const flatPayload = buildHybridBuyerApiPayload(buildInitialForm())
    runEstimate(flatPayload).catch((err) => {
      console.error(err)
      setError('Something went wrong while fetching the estimate.')
      setLoading(false)
      setShowResults(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getRules()
      .then(setRulesPayload)
      .catch(() => setRulesPayload(null))
  }, [])

  useEffect(() => {
    if (!savedFlatPayload || !prediction) return
    let cancelled = false
    setLimeLoading(true)
    setLimeError(null)
    getLIME(savedFlatPayload)
      .then((r) => {
        if (!cancelled) {
          setLimeResult(r)
        }
      })
      .catch((e) => {
        if (!cancelled) setLimeError(e?.message || 'Could not load LIME explanation.')
      })
      .finally(() => {
        if (!cancelled) setLimeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [savedFlatPayload, prediction])

  const saveToShortlist = async () => {
    setShortlistMsg(null)
    if (!form.block?.trim() || !form.street_name?.trim()) {
      setError(
        'Enter block and street to save — the API needs a full address for the hybrid model.'
      )
      return
    }
    if (!form.storey_range?.trim()) {
      setError('Enter a storey range before saving to shortlist.')
      return
    }
    if (!/^\d{4}-\d{2}$/.test((form.sale_month || '').trim())) {
      setError('Sale month must be YYYY-MM before saving to shortlist.')
      return
    }
    const u = (username && username.trim()) || localStorage.getItem('hdb_user') || 'user'
    const raw = String(listingPrice || '').replace(/,/g, '').trim()
    const lp = raw ? Number(raw) : null
    setShortlistLoading(true)
    try {
      await saveWishlistItem({
        username: u,
        source: 'buyer',
        listing_price: lp != null && !Number.isNaN(lp) && lp > 0 ? lp : null,
        payload: buildHybridBuyerApiPayload(form),
        listing_url: null
      })
      setShortlistMsg('Saved to Shortlist. Open Shortlist in the nav to view.')
      setError(null)
    } catch (e) {
      console.warn(e)
      setError('Could not save to shortlist. Is the API running?')
    } finally {
      setShortlistLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.block?.trim() || !form.street_name?.trim()) {
      setError(
        'Enter block number and street name so we can look up this flat in our records.'
      )
      return
    }
    if (!form.storey_range?.trim()) {
      setError('Choose a storey band below or enter a custom range (e.g. 07 TO 09).')
      return
    }
    if (!/^\d{4}-\d{2}$/.test((form.sale_month || '').trim())) {
      setError('Sale month must be YYYY-MM (e.g. 2026-04).')
      return
    }
    try {
      await runEstimate(buildHybridBuyerApiPayload(form))
    } catch (err) {
      console.error(err)
      setError('Something went wrong while fetching the estimate.')
      setLoading(false)
      setShowResults(false)
    }
  }

  const selectTriggerClass = 'h-9 w-full'
  const hasPrediction = prediction != null && !loading
  const shortlistDisabled =
    !hasPrediction || loading || shortlistLoading

  return (
    <div className="min-h-screen space-y-6 bg-background pb-4">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Estimate fair value for this flat</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            We predict fair resale value using eight key inputs: address (block and street),
            town, flat type, floor area, storey range, lease start year, and the month you
            are pricing for. Location and amenity distances are filled from our data when
            the address matches. Defaults mirror a sample listing (Blk 1 Lorong Lew Lian,
            Serangoon).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <FieldGroup className="gap-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field>
                  <FieldLabel>Block</FieldLabel>
                  <FieldContent>
                    <Input
                      placeholder="e.g. 18C"
                      value={form.block}
                      onChange={(e) => onChange('block', e.target.value)}
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Street name</FieldLabel>
                  <FieldContent>
                    <Input
                      placeholder="e.g. CIRCUIT ROAD"
                      value={form.street_name}
                      onChange={(e) => onChange('street_name', e.target.value)}
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Town</FieldLabel>
                  <FieldContent>
                    <Select value={form.town} onValueChange={(v) => onChange('town', v)}>
                      <SelectTrigger className={selectTriggerClass}>
                        <SelectValue placeholder="Town" />
                      </SelectTrigger>
                      <SelectContent>
                        {TOWNS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Flat type</FieldLabel>
                  <FieldContent>
                    <Select value={form.flat_type} onValueChange={(v) => onChange('flat_type', v)}>
                      <SelectTrigger className={selectTriggerClass}>
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
                  </FieldContent>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field>
                  <FieldLabel>Floor area (sqm)</FieldLabel>
                  <FieldContent>
                    <Input
                      type="number"
                      min={30}
                      max={250}
                      value={form.floor_area_sqm}
                      onChange={(e) => onChange('floor_area_sqm', Number(e.target.value))}
                    />
                  </FieldContent>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>Storey range</FieldLabel>
                  <FieldContent>
                    {/* Chips set canonical values; highlight matches normalized form value. */}
                    <div className="flex flex-wrap gap-1.5">
                      {STOREY_PRESETS.map((p) => {
                        const selected = normalizedStorey === p.value
                        return (
                          <button
                            key={p.value}
                            type="button"
                            aria-pressed={selected}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              selected
                                ? 'border-primary bg-primary/15 text-primary ring-2 ring-primary/30'
                                : 'border-border bg-muted/50 hover:bg-muted'
                            }`}
                            onClick={() => onChange('storey_range', p.value)}
                          >
                            {p.label}
                          </button>
                        )
                      })}
                    </div>
                    <Input
                      className="mt-2"
                      placeholder="Custom e.g. 07 TO 09"
                      value={form.storey_range}
                      onChange={(e) => onChange('storey_range', e.target.value)}
                      aria-label="Custom storey range"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Pick a band or type your own in HDB format (e.g. 07 TO 09).
                    </p>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Lease commence year</FieldLabel>
                  <FieldContent>
                    <Input
                      type="number"
                      min={1960}
                      max={2035}
                      value={form.lease_commence_date}
                      onChange={(e) => onChange('lease_commence_date', Number(e.target.value))}
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Sale month</FieldLabel>
                  <FieldContent>
                    <Input
                      type="month"
                      value={form.sale_month}
                      onChange={(e) => onChange('sale_month', e.target.value)}
                    />
                  </FieldContent>
                </Field>
              </div>

              <div className="rounded-lg border border-border/80 bg-muted/30 p-4 space-y-3">
                <Field>
                  <FieldLabel className="text-base">Listing asking price</FieldLabel>
                  <FieldContent>
                    <Input
                      id="buyer-listing-ask"
                      type="number"
                      placeholder="e.g. 520000"
                      value={listingPrice}
                      onChange={(e) => setListingPrice(e.target.value)}
                    />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Add the seller&apos;s asking price to see if the listing looks overpriced
                      or a good deal compared to the estimate and recent sales.
                    </p>
                  </FieldContent>
                </Field>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button type="submit" className="w-full sm:flex-1" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Estimating…
                    </>
                  ) : (
                    'Estimate price'
                  )}
                </Button>
                <Button
                  type="button"
                  variant={shortlistDisabled ? 'ghost' : 'outline'}
                  className="w-full sm:flex-1"
                  disabled={shortlistDisabled}
                  title={
                    shortlistDisabled
                      ? 'Run a successful estimate first to save a full snapshot'
                      : 'Save to shortlist'
                  }
                  onClick={saveToShortlist}
                >
                  {shortlistLoading ? 'Saving…' : 'Add to shortlist'}
                </Button>
              </div>
            </FieldGroup>

            {shortlistMsg && (
              <div className="text-sm font-medium text-primary">{shortlistMsg}</div>
            )}
            {error && <div className="text-sm text-destructive">{error}</div>}
          </form>
        </CardContent>
      </Card>

      {showResults && (
        <>
          {loading && !prediction && (
            <Card className="border-border/60 shadow-sm">
              <CardContent className="pt-6">
                <LoadingSpinner label="Fetching estimate, explanations, and comparables…" />
              </CardContent>
            </Card>
          )}

          {prediction && (
            <>
              <BuyerEstimateInsights
                prediction={prediction}
                shap={shap}
                cbr={cbr}
                flatForm={compareFlatForm}
                savedFlatPayload={savedFlatPayload}
                comparables={cbr?.comparables ?? []}
                listingAmount={listingAsNumber}
                setListingAmount={(n) =>
                  setListingPrice(n != null ? String(Math.round(n)) : '')
                }
                listingInput={listingPrice}
                setListingInput={setListingPrice}
                rules={rulesPayload}
                lime={limeResult}
                limeLoading={limeLoading}
                limeError={limeError}
                saleMonthLabel={form.sale_month}
              />

              <Card className="border-border/60 shadow-sm overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => setNearbyExpanded((e) => !e)}
                  aria-expanded={nearbyExpanded}
                >
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      What&apos;s nearby
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {nearbyAmenitySummary(nearbyResult)}
                    </div>
                  </div>
                  {nearbyExpanded ? (
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
                {nearbyExpanded && (
                  <CardContent className="pt-0 border-t border-border/60">
                    <LocationMap
                      geocode={geocodeResult}
                      nearby={nearbyResult}
                      locationContext={prediction?.location_context}
                      town={form.town}
                      flatType={form.flat_type}
                      floorArea={form.floor_area_sqm}
                      storeyMid={parseStoreyMid(form.storey_range)}
                      remainingLease={remainingLeaseApprox(
                        Number(form.lease_commence_date),
                        form.sale_month || defaultSaleMonth()
                      )}
                    />
                  </CardContent>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
