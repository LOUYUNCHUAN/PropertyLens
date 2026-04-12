# PropertyLens: Buyer, Seller, and Shortlist views — developer guide

This document explains how the three main persona views work **from a code perspective**: state, API calls, derived data, child components, and edge-case logic. File paths are relative to the repo root unless stated otherwise.

---

## Shared concepts

### Hybrid flat payload (`frontend/src/lib/hybridFlatPayload.js`)

Both **Buyer** and **Seller** ultimately send a `PredictRequest`-shaped JSON to `/api/predict` (and wrapped `{ flat }` to SHAP/CBR). The important idea:

- If **`block`**, **`street_name`**, **`town`**, and **`sale_month`** are present and non-empty, the backend (`backend/predict.py`) uses **`_use_address_feature_builder`** → `build_yc_hybrid_vector` → feature table lookup. That aligns the model and **CBR BallTree** with training data.
- `buildHybridFlatPayload` also sets **`year` / `month_num`** from `sale_month`, **`storey_mid`** from **`storey_range`** via `parseStoreyMid`, **`remaining_lease_years`** from lease commence + sale month via `remainingLeaseApprox`, **`is_mature_estate`** from town vs `MATURE_ESTATES_LIST`, and placeholder POI fields (MRT/school/hawker counts) that can be overwritten by **`applyNearbyToFlatPayload`** after geocoding.

### Key API client helpers (`frontend/src/api/client.js`)

| Helper | Endpoint | Body shape |
|--------|----------|------------|
| `predictPrice(data)` | `POST /api/predict` | Top-level `PredictRequest` (not wrapped) |
| `getSHAP(data)` | `POST /api/explain/shap` | `{ flat: data }` |
| `getCBR(data, k)` | `POST /api/cbr/similar` | `{ flat: data, k }` |
| `geocodeAddress(q)` | `GET /api/geocode` | Query string |
| `getNearbyAmenities(lat, lng, radiusM)` | `GET /api/nearby` | Query params |
| `getTrends(town)` | `GET /api/analytics/trends` | Optional town filter |
| `saveWishlistItem`, `listWishlistItems`, `getWishlistItem` | wishlist routes | Per backend |

### ComparePanel (Buyer embed) (`frontend/src/components/ComparePanel.jsx`)

When **`embedded`** is true (Buyer), it renders a single vertical “Listing Comparison” experience:

1. **Header** — title, optional back (not used on Buyer).
2. **Stat boxes** — AI estimate, optional listing price input, confidence band (uses `formatConfidenceBandK` for compact band text), CBR median from **`comparables`**, gap vs CBR.
3. **Verdict** — `getVerdict(listing, predicted, low, high)` → Overpriced / Slightly High / Fair / Underpriced from listing vs AI and confidence band.
4. **SHAP** — Top features (hidden: lat/lng aliases, `years_since_2000`), sorted by `|shap_value|`, with narrative `explainFeature`. If **`initialShapValues`** is passed (Buyer), it **does not** refetch SHAP; otherwise it would call `getSHAP(flatDetails)`.
5. **CBR table** — Comparables list + negotiation playbook sections.

**Buyer passes:** `predictedPrice`, `confidenceLow/High`, `savedFlatPayload` as `flatDetails`, `compareFlatForm` as `flatForm` (for labels/town), `cbr.comparables`, `shap.shap_values` as `initialShapValues`, and controlled listing price via `listingPrice` / `setListingPrice` / `listingInput` / `setListingInput`.

---

## 1. Buyer view (`frontend/src/views/BuyerView.jsx`)

### 1.1 Purpose

Estimate fair value for a flat the user is considering, compare to **asking price**, show SHAP + CBR + negotiation copy in **ComparePanel**, optional **geocode + amenities map**, save to **shortlist** and **prediction history**.

### 1.2 Initial state and URL behaviour

- **`form`**: `useState(() => buildInitialForm())`.  
  - Default: `DEFAULT_FLAT` (demo Serangoon listing).  
  - If `window.location.search` has params, overrides: string keys `town`, `flat_type`, `block`, `street_name`, `storey_range`, `sale_month`; numeric `floor_area_sqm`, `lease_commence_date`.
- **`listingPrice`**: From URL `asking_price` if valid number, else `'430000'`.
- **`savedFlatPayload`**: Last payload sent to `runEstimate` (used as `flatDetails` for ComparePanel).
- **`prediction`**, **`shap`**, **`cbr`**: API results; cleared at start of each estimate.
- **`loading`**, **`error`**, **`showResults`**: `showResults` set **true** at start of `runEstimate` so the results region can show a loading card before `prediction` exists.
- **`geocodeResult`**, **`nearbyResult`**: Filled **after** predict/SHAP/CBR succeed (sequential), not in parallel with them.
- **`nearbyExpanded`**: Collapsible “What’s nearby”; reset **false** on new estimate.
- **`shortlistLoading`**, **`shortlistMsg`**: Shortlist save feedback.

**Auto-run on mount:** `useEffect` with `[]` — if URL has `?town=...`, it reads `asking_price`, builds `buildHybridBuyerApiPayload(buildInitialForm())`, calls `runEstimate`. On failure: sets error, `loading` false, **`showResults` false**.

### 1.3 Derived values (`useMemo`)

- **`listingAsNumber`**: Parsed listing price; `null` if invalid/empty.
- **`compareFlatForm`**: `{ ...form, storey_mid, remaining_lease_years }` for ComparePanel subtitles/helpers.
- **`normalizedStorey`**: Storey string normalized for chip “selected” state (`normalizeStoreyRange`).

### 1.4 `runEstimate(flatPayload)` — core pipeline

1. `setLoading(true)`, `setShowResults(true)`, clear error, clear `prediction`/`shap`/`cbr`, clear geocode/nearby, **`setSavedFlatPayload(flatPayload)`**, `setNearbyExpanded(false)`.
2. **`Promise.all`**: `predictPrice`, `getSHAP`, `getCBR(..., 5)` with the **same** `flatPayload`.
3. On success: store `predRes`, `shapRes`, `cbrRes`.
4. **Geocode path** (only after step 2):
   - Cleans `street_name`: strips PropertyGuru noise words, trailing price text, truncates long strings.
   - If `block` + `street`: `geocodeAddress(\`${block} ${street}\`)`.
   - If found: `setGeocodeResult(geo)`, `getNearbyAmenities(lat, lng, 2000)` → `setNearbyResult`.
   - Else: **`getTownCoords(town)`** fallback center, synthetic `geocodeResult` with `found: false`, still fetch nearby at town center.
   - Errors: `console.warn` only; estimate still stands.
5. **History:** `savePredictionHistory` with `username` (auth or `localStorage hdb_user` or `'user'`), source `'buyer'`, payload + predicted + confidence. Failure is non-fatal.
6. On catch: generic error, **`setShowResults(false)`**.
7. `finally`: `setLoading(false)`.

### 1.5 Form validation (`handleSubmit`)

- Requires **block**, **street**, **storey_range**, **`sale_month`** matching `/^\d{4}-\d{2}$/`.
- Calls `runEstimate(buildHybridBuyerApiPayload(form))`; catch resets error/loading/showResults like auto-run failure path.

### 1.6 `saveToShortlist`

- Validates same address + storey + sale month rules as above.
- **`saveWishlistItem`**: `username`, `source: 'buyer'`, `listing_price` if positive number else `null`, **`payload: buildHybridBuyerApiPayload(form)`** (current form, not necessarily last run if user edited without re-estimating — intentional tradeoff).
- **`shortlistDisabled`**: `!(prediction && !loading) || shortlistLoading` — must have a successful estimate; button ghost + tooltip when disabled.

### 1.7 UI sections (cards / regions)

| Region | When shown | What it is / data source |
|--------|------------|---------------------------|
| **Main Card — form** | Always | Title/description, fields (block, street, town, type, area, storey chips + custom input, lease year, sale month), highlighted **listing asking price**, Estimate + Add to shortlist, errors/messages. |
| **Loading card** | `showResults && loading && !prediction` | `LoadingSpinner` — user sees feedback while APIs run. |
| **CbrDivergenceWarning** | `prediction` set | Uses `prediction.cbr_check` + `predicted_price`. Backend computes CBR median inside predict; flag when model vs CBR diverges strongly. |
| **ComparePanel `embedded`** | `prediction` set | Single post-estimate breakdown: price, SHAP (from `shap` prop), comparables from `cbr`, listing line from `listingAsNumber` + inputs. |
| **What’s nearby** (collapsible) | `prediction` set | Header button toggles `nearbyExpanded`; summary line from **`nearbyAmenitySummary(nearbyResult)`** (counts mrt+lrt, school, hawker, mall). Expanded: **`LocationMap`** with `geocodeResult`, `nearbyResult`, `prediction.location_context`, and flat props from `form`. |

### 1.8 Helpers in file

- **`nearbyAmenitySummary`**: Defensive counts; string for collapsed header.
- **`buildHybridBuyerApiPayload`**: Re-export of `buildHybridFlatPayload` (backward-compatible name).

---

## 2. Seller view (`frontend/src/views/SellerView.jsx`)

### 2.1 Purpose

Seller-oriented flow: **hybrid address + trends**, **predict + SHAP + CBR + counterfactual**, **dynamic suggested listing %** from town trends, **CSP validation** on asking price, **what-if** sliders (storey, MRT distance, lease), **SHAP-driven “what adds value”**, **PriceRangeCard**, **RecentSalesTable**.

### 2.2 Form model (`form` state)

CamelCase UI fields mapped into API via **`buildSellerFlatPayload`** → `buildHybridFlatPayload` + optional **`applyNearbyToFlatPayload`** + optional **advanced POI overrides**:

- `block`, `streetName`, `town`, `flatType`, `floorArea`, `storey_range`, `leaseCommenceDate`, `sale_month`, `useAdvancedPoi`, `distMrt`, `distTopSchool`, `hawkers500m`.

**`remainingLease`**: `remainingLeaseApprox(leaseCommenceDate, sale_month)` — drives lease tone colors (green/amber/red bands).

### 2.3 `buildSellerFlatPayload` (in SellerView)

- Starts from `buildHybridFlatPayload({...})` with `dist_to_cbd_km` overridden from **`TOWN_CBD_DIST`** table for the town.
- If **`useAdvancedPoi`**: overwrites MRT, top school, hawker-related fields from manual inputs.

### 2.4 `suggestedMultiplierFromTrends` (in SellerView)

- Input: `getTrends(town)` response with **`trends[]`** `{ year, median_price, transaction_count }`.
- Sorts by year; compares **last two** years’ median prices → **YoY %**.
- Maps YoY to a multiplier (e.g. hot markets → higher buffer up to ~1.08; weak markets → lower / below 1). Default **1.03** if insufficient data.
- Stored in **`suggestedListingMultiplier`** after each successful analyse.

### 2.5 `sortSellerComparables`

- Client-side sort of CBR `comparables`: **same town as `form.town` first**, then by **`similarity_display_pct ?? similarity_pct`** descending.

### 2.6 `handleAnalyse`

1. Validates **block** and **streetName**; else error and return.
2. `buildSellerFlatPayload(form)` → `flat`.
3. `getTrends(form.town)` → `suggestedMultiplierFromTrends` → `setSuggestedListingMultiplier`.
4. If **not** advanced POI: `geocodeAddress`, then `getNearbyAmenities` → **`applyNearbyToFlatPayload(flat, nearby)`** mutates POI fields on the payload.
5. **`Promise.all`**: `POST /api/predict` with `flat`, `POST /api/explain/shap` `{ flat }`, `POST /api/cbr/similar` `{ flat, k: 6 }`.
6. **`POST /api/counterfactual`** `{ flat, asking_price: round(predicted * min(mult+0.02, 1.08)) }` — separate call; failure caught → `cf: null`.
7. Sets **what-if** baseline state from `flat` and `remainingLease`.
8. **`setResults`**: `predict`, `shap`, `cbr` (sorted comparables), `cf`, **`baseFlatPayload: flat`** (frozen for what-if + CSP).
9. **`setAskingPrice(round(predicted * mult))`**, **`setFormCollapsed(true)`**.

### 2.7 What-if (`runWhatIf`)

- Debounced 400ms on slider changes.
- **`modified`**: `{ ...baseFlatPayload, storey_mid, dist_nearest_mrt_km, remaining_lease_years }`.
- **`POST /api/predict`** + **`POST /api/explain/shap` `{ flat: modified }`** — updates `whatIfPrice` and `whatIfShap` only (does not replace main `results`).

### 2.8 CSP / validate listing (`useEffect`)

- When **`results`** and **`askingPrice`** exist: debounce **600ms**, then **`POST /api/validate-listing`** with `{ asking_price, flat: results.baseFlatPayload }`.
- Sets **`cspResult`** / loading state; errors clear result to null.

### 2.9 Form collapse

- After successful analyse: **`formCollapsed`** true → summary bar (block, street, town, type, area, lease, sale month) + **Edit inputs** + **Re-run analysis**.
- Edit sets **`formCollapsed` false** to show full form again.

### 2.10 Results UI (logical blocks)

| Block | Role |
|-------|------|
| **Fair Value Analysis** | AI estimate, **ConfidenceBadge** (band width → High/Medium/Low + tooltip + `formatConfidenceBandK`), neutral **floor/ceiling** confidence $, $/sqm, **suggested listing** copy using **`suggestedListingMultiplier`**. |
| **What drove this valuation?** | **`WhatAddsValue`** from `results.shap.shap_values` — splits actionable vs structural features. |
| **CbrDivergenceWarning** | Same idea as Buyer. |
| **Negotiation Range** | **`NegotiationRange`** from counterfactual response; suggested marker uses **`listingMultiplier`**. |
| **Price positioning** | **`PriceRangeCard`** when `askingPrice` and `cbr_check.cbr_median` exist. |
| **Set Your Asking Price** | Input + zone legend + **`AskingPriceSummary`**. |
| **CSPBanner** | From **`cspResult`**. |
| **What-If Simulator** | Sliders → debounced `runWhatIf`. |
| **Recent comparable sales** | **`RecentSalesTable`** with sorted comparables. |

### 2.11 Subcomponents in SellerView file (non-exhaustive but important)

- **`ConfidenceBadge`**: `range = high - low`; thresholds `< 60k` High, `< 120k` Medium, else Low; `title` explains meaning + band.
- **`WhatAddsValue` / WhatIfSimulator / NegotiationRange / CSPBanner / RecentSalesTable`**: Large inline components; SHAP feature naming via **`FEATURE_LABELS`**, persona-like splits via **`ACTIONABLE_FEATURES`** / **`NON_ACTIONABLE_FEATURES`**.

---

## 3. Shortlist view (`frontend/src/views/ShortlistView.jsx`)

### 3.1 Purpose

List saved wishlist rows (from **Buyer** or **extension**), enrich each row with **full detail** + **Smart Score** + optional **persona ranking**, open a **modal** with frozen snapshots, optional **map** of all pins with merged amenities.

### 3.2 User identity `u`

`username` from auth, else `localStorage.getItem('hdb_user')`, else `'user'`. Used for all wishlist API calls.

### 3.3 `refresh` / initial load

- **`listWishlistItems(u, 80)`** → **`rows`**.
- **`loadErr`** on failure.

### 3.4 The big enrichment `useEffect` (depends on `[rows, u]`)

When **`rows.length === 0`**:

- Clears `smartScores`, `snapshotsById`, `geocodeById`, `nearbyById`, **`mapSelectionInitRef.current = false`**, `mapSelectedIds` empty Set, **`wishlistDetailsSettled = false`**, return.

When **`rows` non-empty**:

1. **`setWishlistDetailsSettled(false)`** at start.
2. **`Promise.allSettled(rows.map(r => getWishlistItem(r.id, u)))`** — one full detail per row (not the list DTO).
3. **Validate pipeline (parallel to nothing blocking):** for each fulfilled detail, **`buildValidateListingRequestBody(d)`**:
   - If it returns **`null`**, validate promise resolves **`null`**.
   - Else **`validateListing(built.body)`** — only the inner **`body`** is POSTed to `/api/validate-listing` (the returned **`mode`** field is for human readers; it is not sent). Body is either top-level scalars (`asking_price`, `flat_type`, `floor_area_sqm`, …) or **`{ asking_price, flat }`** when scalar fields are not all finite.
4. After validates array is ready (and not cancelled), loop `i`:
   - Skip rejected wishlist fetches (no `geo` / `near` / score for that id — map treats missing geocode as “no pin”).
   - **`geo[d.id] = map_snapshot_json.geocode ?? null`**, **`near[d.id] = map_snapshot_json.nearby ?? null`** for every fulfilled detail.
   - **`wishlistDetailToSnapshot(d)`** — if **`null`**, **`continue`** (no `smartScores[id]`); **geo/near remain set** for map/checkbox state, but the Smart Score cell stays the **skeleton pulse** forever for that row.
   - Else **`snaps[d.id] = snap`**, compute:
     - **`aprioriPointsFromValidate(validates[i])`** → 0–25 or `null`.
     - **`computeScoreComponents(snap, aprioriPts)`** → see §3.5.
     - **`sumComponents`** → integer score 0–100.
     - **`smartScoreComplete(components)`** → all of valueGap, cbr, apriori present.
     - **`getBadge(score, { complete })`** → emoji/label/color.
     - **`generateReason(snap, components)`** → prose line.
     - **`next[d.id] = { score, badge, reason, components, complete }`**
5. On success path inside `try`: **`setSnapshotsById`**, **`setGeocodeById`**, **`setNearbyById`**, **`setSmartScores`**.
6. On **`catch`**: if not cancelled, clear those four maps to empty objects.
7. **`finally`**: if not cancelled, **`setWishlistDetailsSettled(true)`** (always marks loading done, even after catch).

### 3.5 `wishlistDetailToSnapshot` (`frontend/src/lib/smartScore.js`)

Builds the **persona + Smart Score** input object from **`getWishlistItem`** response:

- **`listing_price`**, **`model_estimate`** ← `predicted_price`.
- **`shap_values`**: object built from **`shap_snapshot_json`** array of `{ feature, shap_value }`.
- **`cbr_matches`**: from **`cbr_snapshot_json`**, each `{ match_score: similarity_pct ?? match_score ?? 0 }`.
- **`nearby`**: `map_snapshot_json.nearby`.
- **`payload_json`**: passed through.

If `detail` falsy → `null`.

### 3.6 Smart Score math (`smartScore.js`)

**`computeScoreComponents(snap, aprioriScore)`**

1. **Value gap (up to 30)** — if listing and model exist:  
   `vsModel = (listing - model) / model`,  
   `valueGapScore = clamp(0, 30, 30 - vsModel * 100 * 1.5)`.  
   Higher when listing is **below** model (bargain framing). **`presence.valueGap`** if listing+model valid.

2. **CBR (up to 25)** — average **`match_score`** of first **3** `cbr_matches`;  
   `cbrScore = (avgCBR / 100) * 25`.  
   **`presence.cbr`** if at least one comparable.

3. **Apriori (0–25)** — from **`aprioriPointsFromValidate`**: violations reduce points; `null` → score 0 and **`presence.apriori`** false.

4. **Fundamentals (up to 20)** — **`fundamentalsScoreFromShap`**: school-side SHAP (weighted quality / top school / school distance) and **MRT** `dist_to_mrt_m`, each **abs(SHAP)** normalized by **global mean** from `globalShapMeans.json`, averaged and scaled — caps so huge features do not zero out the rest.

**`sumComponents`**: sum of four, clamped to **[0, 100]**, rounded.

**`smartScoreComplete`**: true only if **`presence.valueGap && cbr && apriori`** — used for **Incomplete** badge (~ prefix on score chip).

**`getBadge`**: Incomplete if not complete (label **Incomplete**, slate); else Strong ≥70, Fair ≥45, else Overpriced. In the table UI, **`~`** is prefixed to the numeric score when **`complete === false`**.

**`generateReason`**: Combines listing vs model sentence, top SHAP driver (by abs value) with **`DRIVER_LABELS`**, CBR support sentence, optional “rule validation unavailable”.

**`buildValidateListingRequestBody`**: Prefers **scalar** apriori body when `floor_area_sqm`, `storey_mid`, `remaining_lease_years`, `dist_nearest_mrt_km` all finite; else full `{ asking_price, flat: payload_json }`.

### 3.7 Personas (`frontend/src/lib/personas.js` + `shortlistPersonaUtils.js`)

**`snapshotsReadyForPersonas(rows, snapshotsById)`**: `true` if **at least one** row id has a non-null snapshot (enables persona buttons).

**`displayRows` (`useMemo`)** — order logic:

1. Base order map: original **`rows`** index by id.
2. If **`activePersona`** and **`snapshotsReady`**:  
   attach **`getPersonaScore(persona, snapshotsById[row.id])`**, sort **descending** by score; ties break by **original row order**.
3. Else if **`sortBySmartScore`**: sort by **`smartScores[b].score - smartScores[a].score`** (missing scores sort as -1).
4. Else: **`rows`** order.

**Persona scores (summary)**

- **Family**: `0.6*|primary_school_quality_1km_weighted| + 0.25*|school_count_1km| + 0.15*|primary_school_count_1km|`. Tag from **`nearby.school`** nearest.
- **Commuter**: raw **`dist_to_mrt_m`** SHAP (signed value as returned). Tag from **`nearby.mrt` + `nearby.lrt`** nearest + walk min estimate.
- **Investor**: `0.4*gapSignal + 0.3*cbrSignal + 0.3*fundamentalsSignal` with **`investorFundamentalsSignal`** (stable vs volatile SHAP mass). Tag explains gap vs model + fundamentals vs timing.

**`handlePersonaClick`**: Toggles persona id; adds CSS class **`shortlist-reranking`** to table for 400ms (visual feedback).

**`highlightTh(key)`**: When persona active, emerald ring on column header matching **`personaHighlightColumn(persona)`** — family/commuter → `address`, investor → `vsmodel`.

**Table row click**: **`setSelectedId(row.id)`** — opens modal (separate from checkbox in map view).

**Row display details**

- **vs model** column: **`gapPct(row.listing_price, row.predicted_price)`** — note: table uses **list DTO** `predicted_price`, not re-fetched detail, for listing row numbers; modal uses detail fields.
- **Smart score cell**: skeleton pulse if **`!smartScores[row.id]`**; else chip with badge, **`smartScoreBreakdownTitle(components)`** on title, hover expands **`reason`**.
- **Persona**: first row gets **“1st”** badge when persona active; **`personaTag`** under address with color by persona.

### 3.8 Map tab logic

**State**

- **`mainView`**: `'table' | 'map'`.
- **`mapSelectedIds`**: `Set` of row ids **shown on map**.
- **`mapSelectionInitRef`**: first time after details settle, select all geocoded ids.

**`useEffect` ([`wishlistDetailsSettled`, `rows`, `geocodeById`])**

- **`geocodedIds`**: row ids where **`geocodeById[id]?.found`**.
- First run (`!mapSelectionInitRef.current`): **`mapSelectedIds = new Set(geocodedIds)`**, ref true.
- Later: keep previous selection intersected with still-valid ids; **add any new** geocoded id not in prev (new saves default on).

**Handlers**

- **`toggleMapRow(id)`**: only if geocoded; flip membership in Set.
- **`selectAllMapPins`**: all geocoded ids.
- **`clearMapPins`**: empty Set.

**`noGeocodeCount`**: rows where **`!geocodeById[r.id]?.found`** (includes missing key).

**Map tab UI**

- **Map** button **disabled** until **`wishlistDetailsSettled`**.
- Sidebar: checkboxes + copy; **`ShortlistMapView`** props: `rows`, `geocodeById`, `nearbyById`, `mapSelectedIds`, `onOpenListing={setSelectedId}`, `gapPct` (same helper as table modal).

### 3.9 `ShortlistMapView` (`frontend/src/components/ShortlistMapView.jsx`)

- **Listing markers**: only rows in **`selectedListingIds`** with **`geocode.found`**; number = index among **all geocoded rows in `rows` order** + 1.
- **fitBounds** on visible listing lat/lngs; padding; default Singapore view if none.
- **Amenities**: **`mergeNearbyDeduped(nearbyById, selected geocoded ids, 400)`** from `mapAmenities.js` — dedupe key lat/lng/name; keep best `dist_m`; sort by distance; cap 400.
- **Category chips**: `MAP_AMENITY_CATEGORIES`, default **all**; filters which merged amenities render.
- **Popup**: listing label, town, gap vs model, **Open detail** button → `onOpenListing(id)`.

### 3.10 `ShortlistDetailModal`

- **`getWishlistItem(itemId, username)`** on mount.
- **Source badge**: extension vs buyer from `detail.source`.
- **Cards**: model estimate + confidence, listing price + gap, optional listing URL, **`LocationMap`** from saved **`map_snapshot_json` + `prediction_snapshot_json.location_context`**, **`SHAPChart`**, **`CBRTable`**, Close + **Remove** ( **`deleteWishlistItem`**, **`onRemoved`** prunes **`rows`**).

### 3.11 Pure helpers in ShortlistView

- **`formatRelativeTime`**: `Intl.RelativeTimeFormat` buckets.
- **`savedRowTitle`**: tooltip string for table row.
- **`parseStoreyMid`**: duplicate of Buyer logic for modal map props (string storey range → mid).
- **`gapPct`**: `(listing - predicted) / predicted * 100` or null.

---

## 4. Quick reference — which file owns what

| Concern | Primary file(s) |
|---------|------------------|
| Hybrid payload + nearby merge | `frontend/src/lib/hybridFlatPayload.js` |
| Map amenity icons + dedupe | `frontend/src/lib/mapAmenities.js` |
| Smart Score + snapshot mapping | `frontend/src/lib/smartScore.js` |
| Persona scores/tags | `frontend/src/lib/personas.js` |
| Persona gating + column highlight | `frontend/src/lib/shortlistPersonaUtils.js` |
| Buyer orchestration | `frontend/src/views/BuyerView.jsx` |
| Seller orchestration | `frontend/src/views/SellerView.jsx` |
| Shortlist + modal + map tab | `frontend/src/views/ShortlistView.jsx` |
| Buyer comparison UI | `frontend/src/components/ComparePanel.jsx` |
| Single-listing map | `frontend/src/components/LocationMap.jsx` |
| Shortlist multi-listing map | `frontend/src/components/ShortlistMapView.jsx` |

---

## 5. Backend touchpoints (for mental model)

- **`POST /api/predict`**: Hybrid cluster model; embeds **CBR check** in response (`cbr_check`).
- **`POST /api/explain/shap`**: SHAP or global fallback if TreeExplainer missing.
- **`POST /api/cbr/similar`**: BallTree on scaled CBR features; returns **`comparables`** + optional **`similarity_display_pct`** for UI bars.
- **`POST /api/wishlist/...`**: Persists payload + snapshots (SHAP, CBR, map) when saving from Buyer/extension.
- **`GET /api/wishlist/items`**: List rows (summary).
- **`GET /api/wishlist/items/{id}`**: Full detail for Shortlist enrichment.

This should be enough to trace **any** branch in these three views from UI event → state → API → derived child props. If you add features, update this doc in the same section structure.
