import { useEffect, useMemo, useState } from 'react'
import { HandCoins, Loader2 } from 'lucide-react'
import {
  predictPrice,
  getSHAP,
  getGlobalSHAP,
  getCBR,
  getRules,
  geocodeAddress,
  getNearbyAmenities,
  savePredictionHistory,
  saveWishlistItem
} from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
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

import { FLAT_TYPES } from '@/constants/flatTypes.js'
import { STOREY_PRESETS } from '@/constants/storeyPresets.js'

function normalizeStoreyRange(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+TO\s+/gi, ' TO ')
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

export default function BuyerView() {
  const { username } = useAuth()
  const [form, setForm] = useState(() => buildInitialForm())
  // Tick counter; bumped by the floating "Plan your offer" CTA → opens
  // step 5 (negotiation) and focuses its planned-offer input.
  const [offerFocusToken, setOfferFocusToken] = useState(0)
  const [listingPrice, setListingPrice] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('asking_price')
    if (p && !Number.isNaN(Number(p))) return p
    return '430000'
  })
  const [savedFlatPayload, setSavedFlatPayload] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [shap, setShap] = useState(null)
  const [globalShapImportance, setGlobalShapImportance] = useState({})
  const [cbr, setCbr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [geocodeResult, setGeocodeResult] = useState(null)
  const [nearbyResult, setNearbyResult] = useState(null)
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistMsg, setShortlistMsg] = useState(null)
  const [showResults, setShowResults] = useState(false)
  const [estimateKey, setEstimateKey] = useState(0)
  const [rulesPayload, setRulesPayload] = useState(null)
  const [formCollapsed, setFormCollapsed] = useState(false)

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

  function validateBuyerForm() {
    if (!form.block?.trim() || !form.street_name?.trim()) {
      setError(
        'Enter block number and street name so we can look up this flat in our records.'
      )
      return false
    }
    if (!form.storey_range?.trim()) {
      setError(
        'Choose a storey band below or enter a custom range (e.g. 07 TO 09).'
      )
      return false
    }
    if (!/^\d{4}-\d{2}$/.test((form.sale_month || '').trim())) {
      setError('Sale month must be YYYY-MM (e.g. 2026-04).')
      return false
    }
    setError(null)
    return true
  }

  const runEstimate = async (flatPayload) => {
    setLoading(true)
    setError(null)
    setPrediction(null)
    setShap(null)
    setGlobalShapImportance({})
    setCbr(null)
    setGeocodeResult(null)
    setNearbyResult(null)
    setSavedFlatPayload(flatPayload)

    try {
      const [predRes, shapRes, cbrRes, globalRes] = await Promise.all([
        predictPrice(flatPayload),
        getSHAP(flatPayload),
        getCBR(flatPayload, 5),
        getGlobalSHAP().catch((e) => {
          console.warn('global-shap failed:', e)
          return { shap_importance: {} }
        })
      ])

      setPrediction(predRes)
      setShap(shapRes)
      setCbr(cbrRes)
      setGlobalShapImportance(globalRes?.shap_importance ?? {})
      setShowResults(true)

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

      setFormCollapsed(true)
      setEstimateKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError('Something went wrong while fetching the estimate.')
      setShowResults(false)
      setFormCollapsed(false)
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
    if (!validateBuyerForm()) return
    try {
      await runEstimate(buildHybridBuyerApiPayload(form))
    } catch (err) {
      console.error(err)
      setError('Something went wrong while fetching the estimate.')
      setLoading(false)
      setShowResults(false)
      setFormCollapsed(false)
    }
  }

  const handleReRunEstimate = async () => {
    if (!validateBuyerForm()) {
      setFormCollapsed(false)
      return
    }
    try {
      await runEstimate(buildHybridBuyerApiPayload(form))
    } catch (err) {
      console.error(err)
      setError('Something went wrong while fetching the estimate.')
      setLoading(false)
      setShowResults(false)
      setFormCollapsed(false)
    }
  }

  const selectTriggerClass = 'h-9 w-full'
  const hasPrediction = prediction != null && !loading
  const shortlistDisabled =
    !hasPrediction || loading || shortlistLoading

  return (
    <div className="space-y-6 bg-background pb-4">
      <Card className="border-border/60 shadow-sm">
        {!(formCollapsed && prediction) && (
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Estimate fair value for this flat</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              We predict fair resale value using eight key inputs: address (block and street),
              town, flat type, floor area, storey range, lease start year, and the month you
              are pricing for. Location and amenity distances are filled from our data when
              the address matches.
            </CardDescription>
            <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              Example flat pre-filled (Blk 1 Lorong Lew Lian, Serangoon) — edit any field to your own.
            </div>
          </CardHeader>
        )}
        <CardContent
          className={
            formCollapsed && prediction
              ? 'space-y-5 pt-5'
              : 'space-y-5 border-t border-border/60 pt-5'
          }
        >
          {shortlistMsg && (
            <div className="text-sm font-medium text-primary">{shortlistMsg}</div>
          )}
          {error && <div className="text-sm text-destructive">{error}</div>}

          {formCollapsed && prediction ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-foreground">
                <span className="font-semibold">
                  Blk {form.block} {form.street_name}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {form.town} · {form.flat_type} · {form.floor_area_sqm} sqm · Storey{' '}
                  {form.storey_range} · Lease start {form.lease_commence_date} (~
                  {remainingLeaseApprox(
                    Number(form.lease_commence_date),
                    form.sale_month || defaultSaleMonth()
                  )}{' '}
                  yrs left) · Sale month {form.sale_month}
                  {listingAsNumber != null && (
                    <>
                      {' '}
                      · Ask{' '}
                      <span className="tabular-nums">
                        ${listingAsNumber.toLocaleString()}
                      </span>
                    </>
                  )}
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
                <Button
                  type="button"
                  size="sm"
                  onClick={handleReRunEstimate}
                  disabled={loading}
                >
                  {loading ? 'Estimating…' : 'Re-run estimate'}
                </Button>
              </div>
            </div>
          ) : (
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
                  variant="outline"
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
              {shortlistDisabled && !shortlistLoading && !loading && (
                <p className="text-xs text-muted-foreground mt-2">
                  Run an estimate first to save this flat to your shortlist.
                </p>
              )}
            </FieldGroup>
          </form>
          )}
        </CardContent>
      </Card>

      {loading && !prediction && (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="pt-6">
            <LoadingSpinner label="Fetching estimate, explanations, and comparables…" />
          </CardContent>
        </Card>
      )}

      {showResults && (
        <>
          {prediction && (
            <>
              <BuyerEstimateInsights
                resultsKey={estimateKey}
                prediction={prediction}
                shap={shap}
                globalShapImportance={globalShapImportance}
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
                saleMonthLabel={form.sale_month}
                geocodeResult={geocodeResult}
                nearbyResult={nearbyResult}
                mapTown={form.town}
                mapFlatType={form.flat_type}
                mapFloorArea={form.floor_area_sqm}
                mapStoreyRange={form.storey_range}
                mapLeaseCommence={form.lease_commence_date}
                mapSaleMonth={form.sale_month}
                offerFocusToken={offerFocusToken}
              />
            </>
          )}
        </>
      )}

      {/* Floating "Plan your offer" CTA — only after a prediction AND an
          asking price are entered (otherwise the offer plan has nothing to
          anchor against). Sits at the same bottom edge as the ChatBot
          bubble, immediately to its left, with matching primary colour. */}
      {prediction && listingAsNumber != null && listingAsNumber > 0 && (
        <button
          type="button"
          onClick={() => setOfferFocusToken((t) => t + 1)}
          className="fixed bottom-6 right-24 z-[1100] inline-flex h-14 items-center gap-2 rounded-full border-0 bg-primary px-5 text-[14px] font-bold text-primary-foreground shadow-lg shadow-primary/40 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-label="Plan your offer — open the buyer offer planner."
          title="Jump to step 5 and plan your offer with bands + evidence"
        >
          <HandCoins className="h-4 w-4" aria-hidden />
          <span>Plan your offer</span>
        </button>
      )}
    </div>
  )
}
