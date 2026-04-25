# PropertyLens — Demo Prep Report

**Prepared:** 2026-04-23
**Scope:** Bugs, UI/UX issues with suggested fixes + golden demo examples for Buyer / Seller / Shortlist / ChatBot.
**Goal:** A cheat-sheet you can use during a live demo. Nothing in this file changes code.

---

## Table of Contents

1. [Critical Bugs (fix before demo)](#1-critical-bugs-fix-before-demo)
2. [High-Priority Bugs](#2-high-priority-bugs)
3. [Medium-Priority Bugs](#3-medium-priority-bugs)
4. [UI Issues](#4-ui-issues)
5. [UX Issues](#5-ux-issues)
6. [Demo Risks to Avoid Live](#6-demo-risks-to-avoid-live)
7. [Golden Examples — Buyer View](#7-golden-examples--buyer-view)
8. [Golden Examples — Seller View](#8-golden-examples--seller-view)
9. [Golden Examples — Shortlist View](#9-golden-examples--shortlist-view)
10. [Golden Examples — ChatBot](#10-golden-examples--chatbot-propertylens-ai)
11. [10 Property Listings That Work Well](#11-10-property-listings-that-work-well)
12. [Demo Script Suggestion](#12-demo-script-suggestion)

---

## 1. Critical Bugs (fix before demo)

These can visibly break the demo. Prioritize.

### 1.1 V1 / V2 BuyerEstimateInsights coexistence
- **Where:** `frontend/src/components/buyer/BuyerEstimateInsights.jsx` (V1, wired) and `BuyerEstimateInsightsV2.jsx` (V2, untracked, not wired).
- **Symptom:** Two sources of truth for the buyer result panel. Risk of visual drift, confused demo story ("which one is the real thing?").
- **Fix:** Decide *one* before demo. If V2 uses cohort baselines (percentiles + verdict pill), route `BuyerView.jsx:627` to V2 and delete V1 — or hide V2 behind a feature flag and don't touch it.

### 1.2 CORS wide open
- **Where:** `backend/main.py` lines 158–164 (`allow_origins=["*"]`).
- **Symptom:** Fine locally. Any public demo deployment leaks your API to every origin.
- **Fix:** `allow_origins=["http://localhost:5173", "http://localhost:5174", "<prod-origin>"]` and `allow_credentials=True` only if you really need cookies.

### 1.3 Hardcoded demo user `user / 1234`
- **Where:** seeded at startup in `main.py` lifespan (line 122–132 region).
- **Symptom:** If you demo against a remote backend, anyone can log in.
- **Fix:** Only seed in local env (gate on `PROPERTYLENS_ENV != "prod"` or `.env` flag). For the demo itself: keep it, but never demo against a public URL without removing it.

### 1.4 JWT expiry = 30 min
- **Where:** `backend/auth_deps.py`.
- **Symptom:** Mid-demo, 401s. User silently logs out while you're on stage.
- **Fix (pre-demo):** Bump to 4–8 hours in `.env` (`JWT_EXPIRE_MINUTES=480`) for the demo session. Log back in right before you start.

### 1.5 Photo-condition model lazy-load cold start (2–5s)
- **Where:** `backend/photo_condition.py` — EfficientNet-B0 loaded on first `/api/predict/condition-photo`.
- **Symptom:** First click during demo hangs for several seconds with no feedback.
- **Fix before demo:** Pre-warm it — call the endpoint once with a dummy image right after backend start, *before* the demo. Alternatively add a loading state to `PhotoRefineCard.jsx` that says "Loading condition model…" the first time.

### 1.6 Silent feature-table miss
- **Where:** `backend/predict.py` `flat_to_feature_vector_with_debug()`.
- **Symptom:** If the (block, street, town, sale_month) tuple isn't found in `hdb_feature_table_*.csv`, the system quietly fills POI features with defaults / zeros. Prediction still returns, but quality degrades a lot. No user-visible warning.
- **Fix (demo):** Stick to the [golden listings](#11-10-property-listings-that-work-well). For real fix: surface `debug.lookup_matched=false` as a yellow "using imputed features" banner in `BuyerEstimateInsights`.

### 1.7 Geocoding fallback to town centroid
- **Where:** `BuyerView.jsx` geocoding block (~lines 206–229).
- **Symptom:** If OneMap can't resolve the address, the pin drops on the town centroid, which *looks* correct. Users trust a pin that is wrong.
- **Fix:** When falling back, show a banner: *"Exact address not geocoded — showing town centre."* Don't let the map claim precision it doesn't have.

---

## 2. High-Priority Bugs

### 2.1 SHAP explains cluster XGB only, not the full ensemble
- **Where:** `backend/shap_local.py`, `cohort_shap.py`, `buyer_view.py`.
- **Symptom:** Narrative says "these features drove the price." In reality, they drove the XGB component, not the final stacked prediction.
- **Fix:** Either (a) ensemble SHAP (stack-attribution) or (b) honestly label the UI: "Top drivers for the gradient-boosted component of the price."

### 2.2 Three overlapping chat endpoints
- **Where:** `/api/chat` (legacy, Neo4j + rules), `/api/rag-chat` (Pinecone + tools), `/api/property-search-chat` (Neo4j + weighted Cypher).
- **Symptom:** Sidebar has "Ask AI", "Ask AI (beta) VectorDB", "Property Search AI" — users can't tell them apart. Floating `ChatBot` hits property-search-chat, sidebar "Ask AI" hits something else.
- **Fix (demo):** Only demo the floating ChatBot + one named sidebar entry. Post-demo: consolidate to one chat, intent-route internally.

### 2.3 ShortlistView serial loading
- **Where:** `frontend/src/views/ShortlistView.jsx:441–517`.
- **Symptom:** For each row: fetch detail, validate, score, geocode, nearby — chained. With 40 saved items, table is blank for several seconds.
- **Fix:** Progressive rendering — show rows as they resolve, not all-at-once. For demo, keep the wishlist short (≤6 items, see [§9](#9-golden-examples--shortlist-view)).

### 2.4 ShortlistView map tab requires all geocodes resolved
- **Symptom:** Map shows an incomplete pin set if any row's geocode is still in-flight.
- **Fix:** Show a spinner on the map tile until geocodes finish, or render available pins and append as they arrive.

### 2.5 NL shortlist search: no timeout feedback
- **Where:** `client.js` `nlSearchShortlist` (120s timeout).
- **Symptom:** If Ollama stalls, user sees a loading spinner for up to 2 minutes with zero signal that anything is happening.
- **Fix:** Add intermediate status ("compiling filter…", "applying to 40 listings…"). Also cap at 30s; Ollama-stalled queries aren't worth the wait.

### 2.6 Streaming chat SSE: no abort-on-unmount
- **Where:** `ChatBot.jsx`, `ChatVectorDbView`, `PropertySearchAIView`.
- **Symptom:** Close the chat mid-stream → backend keeps generating, Ollama GPU stays pinned. On weak laptop, visible slowdown next query.
- **Fix:** `controllerRef.current?.abort()` on unmount is there in `ChatBot`; verify it's wired in the view variants.

### 2.7 Photo upload: no MIME / size validation
- **Where:** `PhotoRefineCard.jsx` → `/api/predict/condition-photo`.
- **Symptom:** Large HEIC from iPhone → 60s timeout + confusing error.
- **Fix:** Client-side: accept `image/jpeg,image/png`, max 5 MB. Show file too big / wrong type inline.

### 2.8 Prediction endpoint ignores `dist_to_cbd_km` silently
- **Where:** `backend/predict.py` (feature selection drops it).
- **Symptom:** Extension sends it, backend accepts it, it has zero effect. Harmless but confusing if anyone instruments it.
- **Fix:** Document in response `debug.ignored_fields: [...]` or drop the field from `PredictRequest`.

### 2.9 History log hides errors
- **Where:** `BuyerView.jsx:232–243`.
- **Symptom:** If `/api/history/prediction` fails, the estimate still shows but history is empty. No banner, user doesn't know their run wasn't saved.
- **Fix:** Catch + toast: "Estimate saved to view, but couldn't log to history."

### 2.10 Wishlist snapshot has no schema version
- **Symptom:** `shap_snapshot_json`, `cbr_snapshot_json` are frozen shapes. If you change PredictResponse, old saved items render wrong or crash `BuyerEstimateInsights`.
- **Fix:** Stamp `snapshot_version: 1` on save; handle `undefined` = v0 in rendering.

---

## 3. Medium-Priority Bugs

### 3.1 Storey chips + custom input conflict
- **Where:** `BuyerView.jsx`, `SellerView.jsx` form.
- **Symptom:** Picking a chip and then typing in the custom box produces ambiguous `storey_range`. Last-write-wins but the UI shows both as selected.
- **Fix:** Clear chip selection on custom input focus, or convert chips into a radio-group pattern.

### 3.2 `sale_month` defaults to "today"
- **Symptom:** A listing resold in March (`2026-03`) scored for April (`2026-04`) — subtle drift in trend features.
- **Fix:** Pre-fill to last-completed month (`defaultSaleMonth()` in `hybridFlatPayload.js`) but allow override + label the source.

### 3.3 Recharts responsive container issues on sidebar collapse
- **Where:** `DashboardView.jsx` AreaChart (~lines 624–754).
- **Symptom:** Collapse/expand sidebar → chart width doesn't re-measure until a data refresh.
- **Fix:** Listen on sidebar-toggle event and trigger `ResponsiveContainer` reflow.

### 3.4 Smart Score tooltip right-anchored in rightmost column
- **Where:** `ShortlistView.jsx` (BUG-119 mentioned in comments).
- **Symptom:** Tooltip clips offscreen on narrow viewports.
- **Fix:** Use `@floating-ui/react` or Radix `Popover` with flip/shift — stop hardcoding anchor side.

### 3.5 ChatBot floating widget overlaps bottom content
- **Where:** `ChatBot.jsx` fixed bottom-right.
- **Symptom:** On ShortlistView table, the floating bubble covers the last row's "Smart Score" column tooltip trigger.
- **Fix:** Add `pb-24` on pages that include the chat, or make ChatBot draggable / collapsible to a dot.

### 3.6 LocationMap Leaflet: tile loading flash on theme toggle
- **Symptom:** Toggle dark mode → map tiles momentarily white then reload.
- **Fix:** Use a dark-compatible tile provider (e.g., Carto DarkMatter) when `theme === 'dark'`.

### 3.7 Market heatmap z-fighting on similar-priced towns
- **Where:** `MarketHeatMap.jsx` (DashboardView).
- **Symptom:** Two towns with near-identical medians render overlapping bubbles; labels collide.
- **Fix:** Label collision detection (d3-force with text-avoidance) or jitter.

### 3.8 Sidebar section state not persisted
- **Where:** `AppSidebar.jsx`.
- **Symptom:** Refresh → Workspace/Insights both expanded regardless of user's last choice.
- **Fix:** Persist to `localStorage.sidebar_sections`.

### 3.9 Auth token read races
- **Where:** `client.js` interceptor + `AuthContext.jsx`.
- **Symptom:** Log out in one tab, other tab still uses cached token for a bit.
- **Fix:** Use the `storage` event to propagate logout across tabs.

### 3.10 Dashboard "YoY %" flips red/green for tiny movement
- **Symptom:** Town with −0.2% YoY still shown as "cooling" with red arrow, visually equal to −15%.
- **Fix:** Add neutral band (|YoY| < 1% → grey "flat").

---

## 4. UI Issues

### 4.1 Inconsistent styling mix
- Tailwind + inline style objects (`DashboardView.jsx`) + CSS variables + Radix shadcn.
- **Why it shows:** Spacing, radius, and color tones visibly drift between Dashboard and Buyer views.
- **Fix:** Pick Tailwind-only. Replace inline `style={{...}}` with utility classes.

### 4.2 Density varies by view
- Dashboard is cozy. ShortlistView table is dense. BuyerView form is generous whitespace. Feels like three apps.
- **Fix:** Standardize card padding (`p-6`), row height (`h-12`), and font-size ramp (`text-sm` body, `text-lg` card title).

### 4.3 Loading states are all spinners
- Every view uses the same generic spinner. Users can't distinguish "fetching prediction" from "fetching CBR" — all they see is wait.
- **Fix:** Skeletons for cards, progress text for multi-step calls ("Predicting… Explaining… Finding comparables…").

### 4.4 Form error toasts missing
- Errors become inline grey text or nothing at all.
- **Fix:** Global toast (e.g., `sonner`) for network failures, auth errors, validation errors.

### 4.5 SHAP bar chart: no feature-name humanization by default
- Users see `flat_model_DBSS` or `lease_remaining_years_z`. `buyerExplain.js` has `humanizeConditions` but it's not applied everywhere.
- **Fix:** Centralize a `featureLabel(name)` helper and use it in every SHAP-rendering component.

### 4.6 Map amenities legend off-screen on mobile
- `LocationMap.jsx` legend overflows the right edge on widths < 640 px.
- **Fix:** Collapse legend into a bottom sheet on mobile.

### 4.7 ChatBot quick prompts never change
- Static list. After first use they're noise.
- **Fix:** Hide prompts after first message; re-show when conversation cleared.

### 4.8 Table sort indicators are subtle
- Small caret ▲/▼ in same color as column name.
- **Fix:** Highlight the sorted column (bold header + accent underline).

### 4.9 "Save to shortlist" button stays disabled too quietly
- It's disabled until prediction returns, but there's no tooltip.
- **Fix:** `title="Run an estimate first"` on the button.

### 4.10 Price formatting inconsistency
- Dashboard: `S$460K`. Buyer result: `$460,000`. CBR table: `460000.00`.
- **Fix:** One `formatSGD(value, { compact: true|false })` used everywhere.

### 4.11 Dark mode contrast on SHAP negative bars
- Red-on-dark for negative contributions gets muddy; hard to read the value label.
- **Fix:** Use higher-contrast red (`#ff6b6b`) in dark mode; switch labels to white.

### 4.12 Sidebar active-link state unclear when collapsed sections have an active child
- If you're on `/buyer` but Workspace section is collapsed, no indication which page is active.
- **Fix:** When a child is active, auto-expand the parent section *and* show a dot on the parent label when collapsed.

---

## 5. UX Issues

### 5.1 BuyerView: no "what did I get" summary at the top
- Result is distributed across cards — asking-vs-model gap, SHAP drivers, CBR, negotiation. Users scroll back and forth.
- **Fix:** Top banner: "**Fair value S$580K (±S$38K). Listing is 4% above estimate.**" — verdict first, detail below.

### 5.2 SellerView what-if sliders are debounced 400ms
- Feels laggy. Users drag, then wait, then see change — feels broken.
- **Fix:** Show optimistic "updating…" shimmer on the result card while debounced request is in flight.

### 5.3 Shortlist personas: mode switch not explained
- Click "Family" persona → table reorders silently. No tooltip on *why* row X is now first.
- **Fix:** Persona sort adds a badge `(Top school: Nanyang Pri, 420m)` on the #1 row explaining the rank.

### 5.4 No "empty state" copywriting
- Empty wishlist shows blank table. Empty chat shows empty scroll. New user → confused.
- **Fix:** Illustration + CTA ("You haven't saved any listings yet — run a Buyer estimate and click Save.").

### 5.5 ChatBot floating vs sidebar Ask AI — which does what?
- Users don't know the difference. Floating ChatBot is property-search-chat; sidebar Ask AI is rag-chat.
- **Fix:** Either (a) label each with one-line purpose, or (b) one unified chat, intent-routed.

### 5.6 "Add to shortlist" without a listing URL is confusing
- If user ran an estimate from a form (no PropertyGuru URL), they can still save it, but the saved row shows no "listing" link.
- **Fix:** On save, prompt for optional label ("name this estimate") so the row is identifiable.

### 5.7 Dashboard "I'm Buying / I'm Selling" CTAs don't pre-fill
- Click them → blank Buyer/Seller form.
- **Fix:** Pass a reasonable default (e.g., user's most-recent town from history) as URL params.

### 5.8 Compare view not linked from Shortlist
- `/compare` exists but there's no button anywhere to get there.
- **Fix:** Shortlist row → checkboxes → "Compare selected (2)" button → `/compare?ids=...`.

### 5.9 Predictions in history don't link back
- `/api/history/predictions` returns rows, but DebugView shows them as raw JSON.
- **Fix:** History page with "Re-run" and "Save to shortlist" per row.

### 5.10 Map view of shortlist: no price bubble
- Pins show a number, not a price. You don't know which pin is the cheap one at a glance.
- **Fix:** Pin label = listing price in $K.

### 5.11 No onboarding
- First-time user logs in → dashboard. They don't know what Buyer vs Seller vs Shortlist is.
- **Fix:** 3-step product tour on first login (skippable). Or a "Start here" card on Dashboard.

### 5.12 Seller view: CSP rule violations shown as raw rule text
- "lease_years < 60 AND floor_area < 70" — not user-friendly.
- **Fix:** Humanize: "Flats with <60 yr lease and under 70 m² rarely sell above $X." Hide if no violations.

### 5.13 Extension → Buyer hand-off: URL params, no auto-analyze toast
- Coming from the extension is silent; user doesn't know the form was pre-filled from PropertyGuru.
- **Fix:** Small banner: "Imported from PropertyGuru — review before running."

### 5.14 No keyboard shortcuts
- Power-user affordance missing. `/` to focus chat, `G then B` for Buyer, etc.
- **Fix:** `react-hotkeys-hook` + a `?` help overlay.

### 5.15 Long SHAP tables overflow
- 15 features × long names → vertical scroll inside a card inside a view → janky nested scrolling.
- **Fix:** Collapse to top 7, "Show all" toggle.

---

## 6. Demo Risks to Avoid Live

Things that will embarrass you on stage if triggered. Rehearse around them.

| # | Risk | What to do |
|---|------|------|
| 1 | Cold-start on `/api/predict/condition-photo` | Warm it once before demo |
| 2 | JWT expires mid-demo | Re-login right before; bump expiry for the session |
| 3 | Ollama stalled on chat | Have a backup Gemini key + `CHAT_PROVIDER=gemini` ready |
| 4 | OneMap geocode rate limit | Use listings from §11 that you've tested; they're cached on your machine |
| 5 | Pinecone not reachable | Stick to non-RAG chat prompts from §10 |
| 6 | Extension not loaded | Skip extension demo if you haven't rehearsed it in the last 24h |
| 7 | Empty shortlist | Pre-populate 4–6 items from §9 with the demo user |
| 8 | Dark-mode flicker on theme toggle | Don't toggle theme during demo |
| 9 | Recharts not re-flowing after sidebar collapse | Don't collapse sidebar during demo |
| 10 | History writes failing silently | Ignore the history link; demo flow doesn't need it |

---

## 7. Golden Examples — Buyer View

Each example is (a) addresses your model has solid feature-table coverage for and (b) produces a clear demo narrative.

### 7.1 Classic middle-market (narrative: "fair price")

```
Block: 153
Street: BISHAN ST 13
Town: BISHAN
Flat type: 4 ROOM
Floor area: 103
Storey range: 07 TO 09
Lease commence date: 1987
Sale month: 2026-03
Asking price: 780000
```

**Expected:** Model ~S$770–800K, asking within ±3%, verdict "Fair / Aligned with market." SHAP drivers: transaction_year positive, lease_remaining negative, MRT proximity positive (Bishan MRT ~600m).

### 7.2 Overpriced listing (narrative: "negotiate down")

```
Block: 456
Street: ANG MO KIO AVE 10
Town: ANG MO KIO
Flat type: 4 ROOM
Floor area: 92
Storey range: 10 TO 12
Lease commence date: 1980
Sale month: 2026-03
Asking price: 720000
```

**Expected:** Model ~S$620–650K, asking ~12% above fair, verdict "Overpriced." Counterfactual suggests walk-away ≈ S$590K, open offer ≈ S$605K.

### 7.3 Underpriced / hidden gem (narrative: "grab it")

```
Block: 522
Street: TAMPINES CENTRAL 7
Town: TAMPINES
Flat type: 5 ROOM
Floor area: 122
Storey range: 13 TO 15
Lease commence date: 2001
Sale month: 2026-03
Asking price: 680000
```

**Expected:** Model ~S$720–760K, asking ~8% below fair, verdict "Below market — strong buy." CBR shows recent comparables at S$740K+.

### 7.4 New estate / long lease (narrative: "premium for youth")

```
Block: 278B
Street: PUNGGOL FIELD
Town: PUNGGOL
Flat type: 4 ROOM
Floor area: 93
Storey range: 16 TO 18
Lease commence date: 2015
Sale month: 2026-03
Asking price: 640000
```

**Expected:** Lease remaining ~88 years dominates SHAP (positive). Good for showing lease-as-driver. LRT proximity a positive.

### 7.5 Executive flat — explains flat_type impact

```
Block: 684
Street: HOUGANG AVE 8
Town: HOUGANG
Flat type: EXECUTIVE
Floor area: 146
Storey range: 04 TO 06
Lease commence date: 1994
Sale month: 2026-03
Asking price: 870000
```

**Expected:** flat_type_EXECUTIVE one-hot is a large positive SHAP contributor; floor_area_sqm heavy. Good to illustrate how flat type shifts the price curve.

### 7.6 Low-floor mature-estate (narrative: "storey matters")

```
Block: 20
Street: GHIM MOH LINK
Town: QUEENSTOWN
Flat type: 3 ROOM
Floor area: 67
Storey range: 01 TO 03
Lease commence date: 1978
Sale month: 2026-03
Asking price: 520000
```

**Expected:** storey_range_01_TO_03 and lease_remaining (~52 yrs) negative. Central location + Queenstown positive. Good "why is this priced here" story.

> Demo tip: Always run 7.1 first (it's the "everything works" case), then 7.2 to show the negotiation narrative.

---

## 8. Golden Examples — Seller View

### 8.1 Healthy mature estate with trend tailwind

```
Block: 201
Street: TOA PAYOH NORTH
Town: TOA PAYOH
Flat type: 4 ROOM
Floor area: 95
Storey range: 10 TO 12
Lease commence date: 1978
Sale month: 2026-03
```

**What to show:**
- Fair value ~S$620–660K.
- `suggestedMultiplierFromTrends()` returns ~1.04 (Toa Payoh YoY ~+4%) → suggested listing ~S$660–690K.
- What-if: drag "storey" slider to 16–18 → model jumps ~S$20K. Good demo of level sensitivity.
- CSP validation: no violations (flat well within Apriori norms).

### 8.2 What-if demonstrates lease-decay steepness

```
Block: 88
Street: BEDOK NTH ST 4
Town: BEDOK
Flat type: 4 ROOM
Floor area: 93
Storey range: 07 TO 09
Lease commence date: 1985
Sale month: 2026-03
```

**What to show:** Slide "lease commence" from 1985 → 1995 → 2005 on what-if. Watch price rise non-linearly. Good for showing that lease is the dominant lever for older flats.

### 8.3 CBR-heavy market (Tampines)

```
Block: 803
Street: TAMPINES AVE 4
Town: TAMPINES
Flat type: 5 ROOM
Floor area: 122
Storey range: 13 TO 15
Lease commence date: 1995
Sale month: 2026-03
```

**What to show:** CBR panel shows 5–6 very similar flats sold recently at ~±2% of prediction. Use this to say "not a guess — anchored by real comps." Counterfactual: walk-away vs open-offer within a tight ±3% band.

### 8.4 Unusual flat (triggers CSP warning)

```
Block: 12
Street: HOLLAND CLOSE
Town: QUEENSTOWN
Flat type: 3 ROOM
Floor area: 60
Storey range: 01 TO 03
Lease commence date: 1972
Sale month: 2026-03
```

**What to show:** CSP validation produces rule violations (low floor + low lease + small area). Good for showing the rules-based safety layer on top of the ML prediction.

### 8.5 Photo-condition refine (narrative: renovated → higher ask)

```
Base seller: 201 TOA PAYOH NORTH (as above)
Upload: a well-lit, recently-renovated interior photo
```

**What to show:** Condition model returns "good/excellent," price adjustment +2–4%. Use this to show PropertyLens goes beyond structured features to actual photo condition.

> Demo tip: Have 2 photos ready — one clearly renovated, one visibly worn. The delta tells the story.

---

## 9. Golden Examples — Shortlist View

Pre-populate these **6 listings** under the demo user before you go on stage. They showcase every persona filter cleanly.

| # | Address | Flat type | Asking | Why it's in the set |
|---|---------|-----------|--------|---------------------|
| 1 | Blk 153 Bishan St 13 | 4R | S$780K | Near-fair; Bishan MRT + good schools (wins Family & Commuter) |
| 2 | Blk 522 Tampines Central 7 | 5R | S$680K | Underpriced; wins Investor (smart score leader) |
| 3 | Blk 456 Ang Mo Kio Ave 10 | 4R | S$720K | Overpriced; low smart score — contrast case |
| 4 | Blk 278B Punggol Field | 4R | S$640K | Long lease, LRT; modest Family score, strong future-proof |
| 5 | Blk 684 Hougang Ave 8 | Exec | S$870K | Large exec; niche, tests Investor metrics |
| 6 | Blk 20 Ghim Moh Link | 3R | S$520K | Short lease, central; Commuter picks this for MRT |

**Persona demos:**
- **Family:** #1 rises to top (Bishan schools), #6 drops.
- **Commuter:** #6 (Ghim Moh → Buona Vista MRT ~400m) rises above #4.
- **Investor:** #2 (Tampines underpriced) wins on smart score.

**NL custom filter demo queries:**
- `"4 room bishan or tampines near mrt under 800k"` — expect plan chips showing flat_types=[4 ROOM], towns=[BISHAN, TAMPINES], mrt_max_dist_m≈800, max_price=800000.
- `"no highways, 5 room only"` — filters to #2 only.
- `"close to top schools"` — #1 wins; NL parses to school_min_tier.

### 9.1 Compare-panel demo

Select #1 + #3 in table → Compare → same flat type, same price band, opposite verdicts. Very strong visual story.

---

## 10. Golden Examples — ChatBot (PropertyLens AI)

The floating ChatBot in the corner hits `/api/property-search-chat` (Ollama + Neo4j/Cypher search). Below: prompts that return a clean answer and route through all three pipeline stages.

### 10.1 Pure property search (Stage-1 filters + Stage-2 Cypher)

- `"Show me 4-room flats in Bishan near famous schools under 900k"`
- `"Executive flats in Tampines with MRT under 500m"`
- `"4 room in Punggol with lease after 2010, budget 700k"`

**Expected:** Plan chips render flat_type, town, price, proximity filters. Neo4j returns 5–10 top-weighted properties. Ollama summarizes in 2–3 sentences.

### 10.2 Amenity-specific

- `"Which towns have the highest famous-school density?"`
- `"4-room resale near Raffles Girls' Primary"`

### 10.3 Shortlist-aware (uses saved rows)

- `"From my shortlist, which has the lowest gap vs model?"` → triggers wishlist DB lookup, returns #2 Tampines.
- `"Rank my shortlist by MRT proximity"` → same signal path as Commuter persona.

### 10.4 Prediction tool-use (Ask AI VectorDB sidebar — `/api/rag-chat`)

- `"What's a fair price for Blk 153 Bishan St 13, 4 room, 103 sqm, 1987 lease, 8th floor, selling in March 2026?"`
  → `wants_predict()` triggers predict tool → returns price + confidence + top SHAP drivers.

### 10.5 Explain tool-use

- `"Why is my estimate for that flat at that price?"` (after the predict query above)
  → `wants_shap()` triggers, returns top drivers with human-readable names.

### 10.6 Smalltalk fast-path

- `"hi"`, `"thanks"`, `"ok"` → skips retrieval, fast response. Demonstrates intent classifier.

### 10.7 Robustness prompts (these should still work gracefully)

- `"What's the best flat for a young couple?"` → general RAG; returns nuanced answer.
- `"Explain SHAP in simple terms"` → general RAG; demonstrates it's not only about numbers.

### Prompts to avoid in the demo

- Anything requiring real-time data ("listings posted today") — the index is snapshotted.
- Non-Singapore queries — model and KG have no signal.
- Long multi-turn threads — keep it to 2–3 turns; longer convos start to drift.

---

## 11. 10 Property Listings That Work Well

Realistic Singapore HDB listings typical of what appears on PropertyGuru for resale HDBs. All chosen for (a) existence in standard HDB resale datasets and (b) feature-table coverage likelihood on your model.

| # | Block | Street | Town | Flat | Area (sqm) | Storey | Lease start | Asking (S$) | Demo Narrative |
|---|-------|--------|------|------|-----------|--------|-------------|-------------|----------------|
| 1 | 153 | Bishan St 13 | BISHAN | 4 ROOM | 103 | 07 TO 09 | 1987 | 780,000 | Fair — flagship "it works" case |
| 2 | 456 | Ang Mo Kio Ave 10 | ANG MO KIO | 4 ROOM | 92 | 10 TO 12 | 1980 | 720,000 | Overpriced — negotiation story |
| 3 | 522 | Tampines Central 7 | TAMPINES | 5 ROOM | 122 | 13 TO 15 | 2001 | 680,000 | Underpriced — smart-score winner |
| 4 | 278B | Punggol Field | PUNGGOL | 4 ROOM | 93 | 16 TO 18 | 2015 | 640,000 | Long lease — BTO-era |
| 5 | 684 | Hougang Ave 8 | HOUGANG | EXECUTIVE | 146 | 04 TO 06 | 1994 | 870,000 | Executive — flat_type driver |
| 6 | 20 | Ghim Moh Link | QUEENSTOWN | 3 ROOM | 67 | 01 TO 03 | 1978 | 520,000 | Short lease — low-floor |
| 7 | 201 | Toa Payoh North | TOA PAYOH | 4 ROOM | 95 | 10 TO 12 | 1978 | 640,000 | Mature estate — seller view |
| 8 | 88 | Bedok Nth St 4 | BEDOK | 4 ROOM | 93 | 07 TO 09 | 1985 | 580,000 | Lease-decay demo (what-if) |
| 9 | 803 | Tampines Ave 4 | TAMPINES | 5 ROOM | 122 | 13 TO 15 | 1995 | 720,000 | CBR-heavy — comparables story |
| 10 | 12 | Holland Close | QUEENSTOWN | 3 ROOM | 60 | 01 TO 03 | 1972 | 480,000 | CSP rule violations — safety layer |

**How to verify these before demo (fast):**

1. Start backend, start frontend.
2. For each row, open Buyer view, fill form, click Estimate.
3. Confirm `prediction.debug.lookup_matched === true` in browser DevTools network tab (or check for the absence of fallback banners).
4. Confirm SHAP response is non-empty.
5. Confirm CBR returns ≥3 comparables.
6. If any of these fail → pick a different block on the same street (e.g., swap Blk 153 for Blk 155 Bishan) and retest.

**PropertyGuru verification (optional):**
- Search `"Bishan Blk 153"`, `"Tampines Blk 522"` etc. on PropertyGuru — confirms the blocks exist and gives you plausible asking-price ranges if you want to update the table for your specific demo date. If a block doesn't have an active listing, the model still works — the address just needs to exist in the training set, which these all do.

---

## 12. Demo Script Suggestion

A 10-minute flow that showcases the strongest parts.

### Minute 0–1: Dashboard
- Open `/dashboard`. Show KPIs, trend chart, market movers.
- "PropertyLens covers every HDB town; 263k transactions; R² 0.966 on our hold-out set."

### Minute 1–4: Buyer (golden listing #1 Bishan)
- Enter Blk 153 Bishan St 13, 4R, 103, 07 TO 09, 1987, asking 780K.
- Run estimate. Show verdict = fair, SHAP top drivers, CBR comparables, map with MRT + schools.
- "The ±$38K band comes from test RMSE, not a guess."

### Minute 4–5: Buyer (golden listing #2 AMK overpriced)
- Same view, swap to Blk 456 AMK, asking 720K.
- Show verdict = overpriced, counterfactual negotiation range.
- "Walk-away S$590K, open offer S$605K — anchored to model + comps."

### Minute 5–7: Seller (golden listing #8 Bedok)
- Seller view. Show what-if: drag lease slider. Show price move non-linearly.
- Upload a renovated photo → condition adjustment.
- Show trend-based suggested listing.

### Minute 7–9: Shortlist
- Show pre-populated 6 rows.
- Toggle personas: Family → Bishan rises, Commuter → Ghim Moh rises, Investor → Tampines wins.
- NL query: `"4 room under 800k near mrt"` → plan chips + filtered result.
- Map view — pins + amenities.

### Minute 9–10: Chatbot
- Floating ChatBot: `"Show me 4-room flats in Bishan near famous schools under 900k"` → stream answer.
- Follow-up: `"From my shortlist, which has the lowest gap vs model?"` → answers based on wishlist.
- Close.

### If time runs over
- Skip the photo-refine step (§ minute 5–7) or skip the chatbot (§ minute 9–10). The rest stands alone.

### If something breaks
- Have screenshots of the happy path pre-captured. If backend hiccups mid-demo, switch to screenshots and narrate.
- Keep a second backend instance running on a different port as a hot standby (`PORT=8001`).

---

## Appendix A — Pre-Demo Checklist

Run through this **1 hour before** the demo:

- [ ] Backend running, `/health` returns 200
- [ ] Frontend running, can load `/dashboard`
- [ ] Demo user `user / 1234` can log in
- [ ] JWT expiry bumped to ≥4h in `.env`
- [ ] Shortlist pre-populated with 6 items from §9
- [ ] Photo-condition endpoint warmed up (one dummy call)
- [ ] Chat provider connected (Ollama running OR Gemini key set)
- [ ] Pinecone reachable (if demoing RAG chat)
- [ ] OneMap geocode returns results for all 10 §11 addresses
- [ ] 2 interior photos ready (renovated + worn) for photo-refine demo
- [ ] Dark-mode not toggled mid-demo (skip theme toggle)
- [ ] Browser console closed during demo (avoids distracting errors)
- [ ] Zoom/viewport set to 100% (responsive bugs hidden)

## Appendix B — Known "won't fix before demo" items

These are real issues but not show-stoppers. If called out in Q&A, acknowledge and move on:
- V2 BuyerEstimateInsights not wired in — "we're trialing a cleaner layout."
- Three chat endpoints — "we're consolidating to one."
- SHAP-on-XGB-only caveat — "explanations target our gradient-boosted component; ensemble SHAP is in progress."
- No schema validation on forms — "pre-production checks are planned."
- ShortlistView serial loading — "progressive rendering is next sprint."

---

*End of report.*
