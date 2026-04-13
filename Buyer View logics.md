# Buyer View — Logics

**Scope (frontend):** `frontend/src/views/BuyerView.jsx`, `frontend/src/components/buyer/BuyerEstimateInsights.jsx`, `frontend/src/lib/buyerExplain.js`, `frontend/src/lib/hybridFlatPayload.js`

---

## What the Buyer view does (high level)

The Buyer view collects 8 key inputs (address, town, flat type, area, storey range, lease start year, sale month), calls the backend to **predict fair value**, and renders a step-by-step explanation:

- **Predict**: model estimate + confidence band
- **Explain**: SHAP drivers (with “this flat vs typical HDB flat” framing)
- **Support**: similar past sales (CBR)
- **Validate**: rule-based checks (Apriori + surrogate) to produce plain-English “why” and negotiation guidance
- **Explore**: interactive what-if sliders (area / lease / floor)
- **Save**: store the run to history + optionally save to Shortlist

---

## Inputs → payload (hybrid flat payload)

Buyer form state is built from defaults and can be overridden via URL query params (e.g. `town`, `asking_price`).

The request payload sent to the backend is built via:

- `buildHybridFlatPayload(...)` in `frontend/src/lib/hybridFlatPayload.js`
- exposed as `buildHybridBuyerApiPayload()` (deprecated wrapper) in `frontend/src/views/BuyerView.jsx`

Computed fields used in the UI (and for what-if) include:

- `storey_mid = parseStoreyMid(storey_range)`
- `remaining_lease_years = remainingLeaseApprox(lease_commence_date, sale_month)`

---

## Main “Run estimate” flow (API calls)

When the user submits the form (or the view auto-runs from URL params), `runEstimate(flatPayload)` executes:

### Parallel model/XAI calls

Buyer runs these requests in parallel:

- `POST /api/predict` (via `predictPrice(flatPayload)`)
- `POST /api/explain/shap` (via `getSHAP(flatPayload)`)
- `POST /api/cbr/similar` (via `getCBR(flatPayload, 5)`)
- `GET /api/analytics/global-shap` (via `getGlobalSHAP()`; failures are tolerated and treated as empty)

### Location enrichment (best-effort)

After model responses, Buyer attempts to show a location map and nearby POIs:

- `geocodeAddress("${block} ${street}")`
- if geocode succeeds: `getNearbyAmenities(lat, lng, 2000)`
- if geocode fails: fallback to town center coords via `getTownCoords(town)` and still calls `getNearbyAmenities(...)`

### Persistence (best-effort)

Buyer then attempts to persist a history record:

- `savePredictionHistory({ username, source: 'buyer', payload, predicted_price, confidence_low, confidence_high })`

Failures are logged but do not block showing results.

---

## Results rendering (BuyerEstimateInsights)

The view passes the following “result bundle” into `BuyerEstimateInsights`:

- **Model**: `prediction` (`predicted_price`, `confidence_low`, `confidence_high`, etc.)
- **SHAP**: local SHAP values (`shap`)
- **Global SHAP**: `globalShapImportance` (mean absolute SHAP per feature)
- **CBR**: comparables list (`cbr`)
- **Rules**: `rulesPayload` from `getRules()` (loaded on mount)
- **Location**: `geocodeResult`, `nearbyResult`
- **Original payload**: `savedFlatPayload` (the “truth” for saving and what-if base)

Key explanation logic comes from `frontend/src/lib/buyerExplain.js`:

- **SHAP comparison cards**: `buildComparisonDrivers(localShap, globalShapImportance, { topN: 4 })`
- **Rules matching**:
  - `matchAprioriRules(flat, rules.apriori)`
  - `pickBestSurrogateRule(flat, rules.surrogate, queryFeatures?)`
  - `humanizeConditions(...)`, `humanizeOutcome(...)`
- **Negotiation copy**: `buildNegotiationGuide(...)`

### Baseline context panel (why “above/below average”)

`BuyerEstimateInsights` renders a baseline context panel based on:

- `base_value` (from SHAP result) vs `predicted_price`
- baseline sub-label changes when `base_value > 480000` (cluster baseline vs national baseline framing)

---

## What-if tool (buyer)

Buyer’s what-if sliders call `POST /api/predict` after a short debounce.

Important implementation detail:

- the what-if payload intentionally **strips address fields** (`block`, `street_name`, `sale_month`, `storey_range`) so the backend does not override slider values by re-looking up the address record
- if `locationContext` exists, the what-if base **injects amenity distances/counts** derived from that context so the scenario stays anchored to the same location

---

## Saving to Shortlist

The “Add to shortlist” button calls:

- `saveWishlistItem({ username, source: 'buyer', listing_price, payload, listing_url: null })`

Validation is minimal (ensures address, storey range, and sale month look valid).

---

## Common failure modes (how Buyer handles them)

- **Global SHAP unavailable**: explanation cards still render using local SHAP; global importance becomes `{}`.
- **Geocode/nearby failures**: falls back to town coords; map still renders with approximate context.
- **History save failure**: results still shown; only persistence is skipped.

