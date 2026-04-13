# Seller View — Logics

**Scope (frontend):** `frontend/src/views/SellerView.jsx`, `frontend/src/components/seller/SellerResultsStepFlow.jsx`, `frontend/src/components/seller/sellerResultsWidgets.jsx`, `frontend/src/lib/sellerSignals.js`, `frontend/src/lib/sellerNegotiation.js`, `frontend/src/lib/hybridFlatPayload.js`

---

## What the Seller view does (high level)

The Seller view is a “workspace” that helps a seller decide:

- **Fair value** (AI estimate + confidence band)
- **How to price** (suggested asking price and “CSP” rule checks)
- **What drives value** (SHAP drivers)
- **What comparables support it** (CBR similar sales)
- **How buyers might negotiate** (what-if tool + tactics + before-you-list insights)

---

## Inputs → payload (hybrid flat payload)

Seller form inputs are converted into a hybrid model request via:

- `buildHybridFlatPayload(...)` in `frontend/src/lib/hybridFlatPayload.js`
- plus Seller-specific adjustments in `buildSellerFlatPayload(form)`:
  - sets `dist_to_cbd_km` from a town lookup table
  - optionally applies “advanced POI overrides” (manual MRT/school distances, hawker count, etc.)

When **advanced overrides are OFF**, Seller tries to geocode the address and inject nearby amenities:

- `geocodeAddress("${block} ${street}")`
- `getNearbyAmenities(lat, lng, 2000)`
- `applyNearbyToFlatPayload(flat, nearby)`

---

## Main “Analyse” flow (API calls)

When the user clicks Analyse, `handleAnalyse()` runs:

### 1) Trend-based listing multiplier (pricing headroom)

- `GET /api/trends/{town}` (via `getTrends(form.town)`)
- Converts YoY median change into a suggested multiplier (`suggestedMultiplierFromTrends`)
  - warm town → more headroom
  - cooling town → less headroom

### 2) Predict + explain + comps (parallel)

Runs in parallel:

- `POST /api/predict` with `flat`
- `POST /api/explain/shap` with `{ flat }`
- `POST /api/cbr/similar` with `{ flat, k: 6 }`

### 3) Counterfactual suggestion (optional)

Attempts:

- `POST /api/counterfactual` with `{ flat, asking_price: round(predicted * clamp(mult + buffer)) }`

### 4) Initialize the “what-if” baseline

After results:

- initializes storey/lease/area sliders from the analysed flat
- stores `baseFlatPayload` inside `results` for later what-if calls
- sets an initial `askingPrice = round(predicted * suggestedMultiplier)`

---

## Results rendering (SellerResultsStepFlow)

`SellerResultsStepFlow` renders a 6-step flow and derives most “insight cards” from memoized helpers:

- **Signals**: `buildSignalCards(...)` (`frontend/src/lib/sellerSignals.js`)
- **Drivers**: `buildDriverCards(shap_values, { topN: 4 })` (reuses driver-card logic)
- **Rules context**:
  - `matchAprioriRules(baseFlat, rules.apriori)` (Apriori match)
  - `pickBestSurrogateRule(baseFlat, rules.surrogate, queryFeatures)` (surrogate rule match)
- **Asking guidance**:
  - `buildSuggestedListingNote({ aprioriViolated, askingPrice, predictedPrice, listingMultiplier })`
- **Strategy**:
  - `buildNegotiationTactics({ driverCards, town, comparables })`
  - `getBeforeYouListInsight(baseFlat, shap_values)`

Seller also derives a confidence label from the confidence band:

- `confidenceLevelFromBand(low, high)` and `confidenceBandTooltip(...)`

---

## Live “CSP” validation (asking price checks)

Whenever the seller edits `askingPrice`, Seller debounces a live validation call:

- `POST /api/validate-listing` with `{ asking_price, flat: baseFlatPayload }`

This result is shown in the Asking step (via widgets like `CSPBanner`).

---

## What-if tool (seller)

Seller’s what-if simulates negotiation levers by re-running predict + SHAP on modified values:

- `POST /api/predict` with `modified`
- `POST /api/explain/shap` with `{ flat: modified }`

Important implementation detail (prevents zero-delta bugs):

- the what-if baseline payload intentionally **removes address fields** (`block`, `street_name`, `sale_month`, `storey_range`) before sending to `/api/predict`
  - this prevents backend “address lookup” logic from overwriting slider inputs (storey/lease/etc.)

What-if calls are debounced (400ms) to avoid spamming the backend while dragging sliders.

---

## Comparable sorting

Seller sorts comparables to prioritize same-town rows first, then by similarity.

---

## Common failure modes (how Seller handles them)

- **Trends unavailable**: falls back to a default multiplier (still produces an asking price).
- **Geocode/nearby failures**: analysis still runs; it just uses model defaults for amenity distances.
- **Counterfactual fails**: `cf` becomes `null` and the rest of the flow still works.
- **Validate-listing fails**: CSP banner becomes unavailable; asking guidance still renders from model + heuristics.

