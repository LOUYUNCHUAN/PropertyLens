# Shortlisting View — Logics

**Scope:** `ShortlistView.jsx`, `smartScore.js`, `personas.js`, `shortlistPersonaUtils.js`
**Branch:** development
**Last updated:** 2026-04-13

---

## Part 1 — How Persona Ranking Works

### Shared mechanics (all personas)

When a persona button is clicked, `ShortlistView.jsx` re-sorts the displayed rows by persona score:

```js
return [...rows]
  .map((row) => ({
    row,
    score: getPersonaScore(activePersona, snapshotsById[row.id])
  }))
  .sort((a, b) => {
    const d = b.score - a.score          // highest score first
    if (d !== 0) return d
    return baseOrder.get(a.row.id) - baseOrder.get(b.row.id)  // tie-break: original save order
  })
  .map((x) => x.row)
```

Inputs come from `snapshotsById[row.id]` — a normalised object built from the frozen detail snapshot stored at save time (SHAP values, CBR matches, model estimate, nearby amenities). Personas are enabled once **at least one** row snapshot has loaded (`snapshotsReadyForPersonas` uses `rows.some(...)`).

All three personas now use **normalised SHAP values** via `shapNormContrib()` and `shapNormSignedContrib()` from `personas.js`. These divide each feature's raw SHAP value by its global mean absolute SHAP (loaded from `globalShapMeans.json`, sourced from `data/artifacts/hybrid_xai/global_shap_cache.json`). This prevents high-scale features like `transaction_year` (global mean |SHAP| ~114,626) from dominating scores over lower-scale but equally meaningful features like `dist_to_mrt_m` (~6,108) or school quality (~800).

```js
function shapNormContrib(feature, raw, means) {
  const abs = Math.abs(Number(raw) || 0)
  if (abs === 0) return 0
  const mu = means[feature] ?? UNKNOWN_SHAP_FEATURE_SCALE  // fallback: 20,000
  return abs / Math.max(mu, 1e-9)
}

function shapNormSignedContrib(feature, raw, means) {
  // Same as above but preserves sign of the SHAP value
  const norm = shapNormContrib(feature, raw, means)
  return raw < 0 ? -norm : norm
}
```

---

### 👨‍👩‍👧 Family Persona

**File:** `personas.js:131-155`

#### Score formula

```js
export function familyScore(snap) {
  const shap = snap.shap_values
  const schoolQualitySHAP = Number(shap.primary_school_quality_1km_weighted ?? 0)
  const schoolCountSHAP   = Number(shap.school_count_1km ?? 0)
  const primaryCountSHAP  = Number(shap.primary_school_count_1km ?? 0)

  return (
    shapNormSignedContrib('primary_school_quality_1km_weighted', schoolQualitySHAP, globalShapMeans) * 0.7 +
    shapNormSignedContrib('school_count_1km',                    schoolCountSHAP,   globalShapMeans) * 0.2 +
    shapNormSignedContrib('primary_school_count_1km',            primaryCountSHAP,  globalShapMeans) * 0.1
  )
}
```

#### Inputs and weights

| SHAP Feature | Weight | What it captures |
|---|---|---|
| `primary_school_quality_1km_weighted` | 70% | Weighted quality score of primary schools within 1 km |
| `school_count_1km` | 20% | Number of all schools within 1 km |
| `primary_school_count_1km` | 10% | Number of primary schools specifically within 1 km |

#### Key behaviours
- Uses **signed** normalised SHAP — a school that *negatively* impacts price (bad quality) produces a **negative** contribution, correctly ranking that property lower
- Normalised by global mean, so school quality and count are on a comparable scale
- **Row tag shown:** `"<School name> · <dist>m"` (nearest school from `nearby.school` in map snapshot)
- **Column highlighted:** `address` (where the school tag appears)

---

### 💼 Commuter Persona

**File:** `personas.js:167-183`

#### Score formula

```js
export function commuterScore(snap) {
  const shap = snap.shap_values

  const mrt = shapNormSignedContrib(
    'dist_to_mrt_m',
    shap.dist_to_mrt_m ?? 0,
    globalShapMeans
  )

  const highwayRaw = Number(shap.dist_to_highway_m ?? 0)
  const highwayPenalty =
    highwayRaw > 0
      ? shapNormContrib('dist_to_highway_m', highwayRaw, globalShapMeans) * 0.2
      : 0

  return mrt - highwayPenalty
}
```

#### Inputs and logic

| Component | Source | Logic |
|---|---|---|
| `mrt` | `dist_to_mrt_m` SHAP (signed, normalised) | Positive = close to MRT adds value = good for commuter → higher score |
| `highwayPenalty` | `dist_to_highway_m` SHAP | Fires only when `highwaySHAP > 0` (far from highway, which is bad for commuter access) |

#### Key behaviours
- `mrt` uses **signed** normalised SHAP directly — no negation. Close-to-MRT properties have positive SHAP → positive `mrt` → ranked higher
- Highway penalty fires only when the property is **far** from a highway (positive SHAP = far distance benefits price, but bad for commuter car access). Properties **close** to a highway (negative SHAP) incur no penalty
- **Row tag shown:** `"<MRT name> · <dist>m · ~<X> min walk"` (assumes 75 m/min walk speed, from `nearby.mrt`/`nearby.lrt`)
- **Column highlighted:** `address` (where the MRT tag appears)

---

### 💰 Investor Persona

**File:** `personas.js:195-213`

#### Score formula

```js
investorScore = gapSignal * 0.4 + cbrSignal * 0.3 + fundamentalsSignal * 0.3
```

#### Signal 1 — Gap Signal (40% weight)

```js
const vsModel   = (listing_price - model_estimate) / model_estimate
const gapSignal = Math.max(0, Math.min(1, 0.5 - vsModel * 2.5))
```

| Scenario | vsModel | gapSignal |
|---|---|---|
| Listed 20% below model | -0.20 | 1.0 (max) |
| Listed at model | 0.00 | 0.5 |
| Listed 20% above model | +0.20 | 0.0 (min) |

Properties priced **below** the model estimate score higher. Falls to 0 at +20% above model.

#### Signal 2 — CBR Signal (30% weight)

```js
const cbr       = snap.cbr_matches.slice(0, 3)
const avgCBR    = cbr.length ? average(match_score) : 50   // fallback: 50 when no CBR
const cbrSignal = avgCBR / 100
```

Average similarity score of the top-3 comparable past sales (0–100), scaled to 0–1. High similarity = the model's price estimate is well-supported by real past transactions.

#### Signal 3 — Fundamentals Signal (30% weight)

**File:** `personas.js:78-96` (`investorFundamentalsSignal`)

```js
export const INVESTOR_STABLE_FEATURES = [
  'primary_school_quality_1km_weighted',
  'dist_to_mrt_m',
  'floor_area_sqm',
  'lease_remaining_years',
  'mall_weighted_access_3km'
]
const INVESTOR_VOLATILE_FEATURES = ['transaction_year']

export function investorFundamentalsSignal(snap, means = globalShapMeans) {
  const totalNorm    = totalNormalizedMass(shap, means)      // sum of norm |SHAP| for all features
  const stableNorm   = sum of shapNormContrib for stableFeatures
  const volatileNorm = sum of shapNormContrib for volatileFeatures

  const fundamentalsRatio = stableNorm / totalNorm
  const volatilityPenalty = volatileNorm / totalNorm
  return Math.max(0, fundamentalsRatio - volatilityPenalty)
}
```

Each feature's SHAP is normalised by its global mean before ratios are computed — so `transaction_year`'s huge raw scale no longer overwhelms stable features.

| If… | fundamentalsSignal | Meaning |
|---|---|---|
| Stable features outweigh volatile | > 0 | Property value driven by long-term fundamentals |
| Volatile equals stable | ≈ 0 | Mixed |
| `transaction_year` dominates even after normalisation | 0 (clamped) | Market timing driven |

#### Row tag shown (`investorTag`)

```js
const sig    = investorFundamentalsSignal(snap)
const txPct  = Math.round(investorTxYearNormShare(snap) * 100)

if (sig > 0.3)       driverStr = '✓ fundamentals-driven'
else if (sig > 0.1)  driverStr = '~ mixed drivers'
else                 driverStr = `⚠️ Market timing dominant (${txPct}% of normalized |SHAP| mass)`
```

Full tag: `"X% below/above model · <driverStr>"`

- **Column highlighted:** `vsmodel` (price gap column, since investor ranking is led by the gap signal)

---

## Part 2 — Smart Score

Smart Score is computed client-side and displayed as a badge on each shortlist row. It is independent of persona ranking but uses the same snapshot data.

### Where it is computed (data flow)

**Shortlist loads each row detail** via `GET /api/wishlist/items/{id}` (not the list DTO). For each row, the UI then **attempts** `POST /api/validate-listing` (rules/apriori only) using `buildValidateListingRequestBody(detail)`. If validation fails or required inputs are missing, the Smart Score is still computed, but marked as **Incomplete**.

### Formula

```
Smart Score = valueGapScore (0–30) + cbrScore (0–25) + aprioriScore (0–25) + fundamentalsScore (0–20)
```

### Components

| Component | Max | Source | Notes |
|---|---|---|---|
| `valueGapScore` | 30 | `listing_price` vs `model_estimate` | `30 - vsModel * 100 * 1.5`, floored at 0 |
| `cbrScore` | 25 | Top-3 CBR match scores | `(avgCBR / 100) * 25` |
| `aprioriScore` | 25 | `/api/validate-listing` | `25 - violation_count * 5` |
| `fundamentalsScore` | 20 | School + MRT SHAP, normalised | See below |

### Component details (exact formulas)

#### `valueGapScore` (0–30)

When both `listing_price` and `model_estimate` exist:

- `vsModel = (listing_price - model_estimate) / model_estimate`
- `valueGapScore = clamp(0, 30, 30 - vsModel * 100 * 1.5)`

Interpretation: listings priced **below** model estimate score higher; listings **above** score lower.

#### `cbrScore` (0–25)

- Use up to the **top 3** `cbr_matches[].match_score` values (0–100)
- `avgCBR = mean(top3)`
- `cbrScore = (avgCBR / 100) * 25`

#### `aprioriScore` (0–25)

From `/api/validate-listing` response: `apriori.violation_count`:

- `violation_count === 0` → `25`
- else `aprioriScore = clamp(0, 25, 25 - violation_count * 5)`

**Request shape note:** validation prefers a minimal “scalar” body when `floor_area_sqm`, `storey_mid`, `remaining_lease_years`, and `dist_nearest_mrt_km` exist; otherwise it falls back to `{ asking_price, flat: payload_json }` (more likely to 422 for partial extension payloads).

### `fundamentalsScore` — normalised calculation

**File:** `smartScore.js:16-44`

```js
const normSchool = |schoolSHAP| / globalMean_school
const normMrt    = |mrtSHAP|    / globalMean_mrt
const avgNorm    = (normSchool + normMrt) / 2
return Math.min(20, FUNDAMENTALS_SCALE * avgNorm)   // FUNDAMENTALS_SCALE = 10
```

When school and MRT SHAP are both at their global mean magnitude (`normSchool = normMrt = 1`), `avgNorm = 1` → `fundamentalsScore = 10 / 20`. At 2× their global mean → full 20 points.

### Incomplete score handling

If real data is missing for any component, it scores **0** (not a neutral mid-point). The `presence` object tracks which components have real data:

```js
presence: { valueGap: boolean, cbr: boolean, apriori: boolean }
```

`getBadge()` returns a grey **"Incomplete ◽"** badge when `smartScoreComplete()` is false, so users can see when the score is partial rather than treating a padded score as meaningful.

### Badge thresholds (when complete)

- `score >= 70` → **Strong**
- `score >= 45` → **Fair**
- otherwise → **Overpriced**

---

## Part 3 — Bug Log

### Summary

| # | ID | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| 1 | SS-1 | Medium | Smart Score | Hardcoded neutral fallbacks inflated scores when data was missing | ✅ Fixed |
| 2 | SS-2 | High | Smart Score | `fundamentalsScore` was always ~0 due to raw SHAP scale mismatch | ✅ Fixed |
| 3 | INV-1 | High | Investor | Wrong feature name `dist_to_nearest_mall_m` — always contributed 0 | ✅ Fixed |
| 4 | INV-2 | High | Investor | `transaction_year` dominance made `fundamentalsSignal` always ≈ 0 | ✅ Fixed |
| 5 | INV-3 | Medium | Investor | "✓ fundamentals-driven" tag was dead code — never shown | ✅ Fixed |
| 6 | COM-1 | High | Commuter | `mrtSignal = -mrtSHAP` was inverted — far-from-MRT ranked higher | ✅ Fixed |
| 7 | COM-2 | Medium | Commuter | Highway penalty fired on commuter-friendly (close to highway) properties | ✅ Fixed |
| 8 | UI-1 | Medium | UI | `snapshotsReady` used `every()` — one failed row blocked all personas | ✅ Fixed |
| 9 | UI-2 | Low | UI | Commuter highlighted "Model est." column instead of "Address" | ✅ Fixed |

---

### SS-1 — Hardcoded Neutral Fallbacks ✅ Fixed

**Was:** `valueGapScore` defaulted to `15`, `avgCBR` to `50`, `aprioriScore` to `12.5` when data was missing. A listing with no real data scored ~40 ("Fair" badge).

**Fix:** All three now default to `0`. A `presence` object tracks which components have real data. `getBadge()` returns "Incomplete ◽" when `presence.valueGap || cbr || apriori` is false.

---

### SS-2 — `fundamentalsScore` Always ~0 ✅ Fixed

**Was:** Raw school SHAP (~800) + MRT SHAP (~6,108) divided by `totalSHAP` (~250,000+) → fraction ≈ 0.028 → score ≈ 2.8 / 20. The component was effectively dead.

**Fix:** `fundamentalsScoreFromShap()` normalises school and MRT SHAP by their respective global means before scoring. Now at-average school/MRT SHAP → 10/20 pts; 2× average → 20/20 pts. `transaction_year`'s scale has no effect.

---

### INV-1 — Wrong Feature Name ✅ Fixed

**Was:** `dist_to_nearest_mall_m` in `stableFeatures` — key doesn't exist in SHAP snapshot, always returned `undefined → 0`.

**Fix:** Removed. `INVESTOR_STABLE_FEATURES` now only lists verified model feature names. `mall_weighted_access_3km` (already present) covers mall access.

---

### INV-2 — `transaction_year` Dominance ✅ Fixed

**Was:** Raw SHAP fractions → `transaction_year` (~114K) was 40–60% of `totalAbs` → `fundamentalsSignal` always clamped to 0.

**Fix:** `investorFundamentalsSignal()` normalises all SHAP values by their global mean via `shapNormContrib()` before computing ratios. All features are now on a dimensionless relative-importance scale. The 30% weight for fundamentals is now active.

---

### INV-3 — "Fundamentals-Driven" Tag Never Shown ✅ Fixed

**Was:** `topFeature === 'transaction_year'` check — since `transaction_year` was always #1 by raw SHAP, every property showed "⚠️ Market timing is top driver". The "✓ fundamentals-driven" branch was unreachable.

**Fix:** Tag now uses threshold checks on normalised `fundamentalsSignal`:
- `sig > 0.3` → "✓ fundamentals-driven"
- `sig > 0.1` → "~ mixed drivers"
- else → "⚠️ Market timing dominant (X% of normalized |SHAP| mass)"

---

### COM-1 — MRT Signal Inverted ✅ Fixed

**Was:** `mrtSignal = -mrtSHAP` — close-to-MRT properties (positive SHAP) got negative signal → ranked lower. Far-from-MRT ranked 1st.

**Fix:** Uses `shapNormSignedContrib('dist_to_mrt_m', ...)` directly — no negation. Close-to-MRT (positive SHAP) → positive signal → correctly ranked higher.

---

### COM-2 — Highway Penalty Inverted ✅ Fixed

**Was:** `highwayPenalty = highwaySHAP > 0 ? 0 : |highwaySHAP| * 0.2` — penalty fired when `highwaySHAP < 0` (close to highway = good for commuter), and not when `highwaySHAP > 0` (far from highway = bad for commuter).

**Fix:** `highwayPenalty = highwayRaw > 0 ? shapNormContrib(...) * 0.2 : 0` — penalty now fires when property is **far** from highway (bad for commuter access). Close-to-highway properties incur no penalty.

---

### UI-1 — `snapshotsReady` Deadlock ✅ Fixed

**Was:** `rows.every(r => snapshotsById[r.id] != null)` — one failed row kept `snapshotsReady = false` permanently, disabling all persona buttons.

**Fix:** Extracted to `snapshotsReadyForPersonas()` in `shortlistPersonaUtils.js` using `rows.some(...)` — personas activate as soon as at least one row snapshot loads.

---

### UI-2 — Wrong Column Highlight for Commuter ✅ Fixed

**Was:** `commuter: 'model'` — highlighted "Model est." column which has no relation to commuter data.

**Fix:** `commuter: 'address'` in `personaHighlightColumn()` (`shortlistPersonaUtils.js`) — highlights the address column where the MRT tag appears, consistent with the family persona pattern.

---

## Root Cause Summary

All bugs traced to a single root cause: **raw SHAP values were used without normalisation**. `transaction_year`'s global mean |SHAP| (~114,626) is orders of magnitude larger than school quality (~800) and MRT distance (~6,108). Any sum or ratio of raw SHAP values was dominated by `transaction_year`, making all other features invisible.

**Global fix applied:** All persona scoring and Smart Score fundamentals now normalise SHAP values by their global mean absolute SHAP from `globalShapMeans.json` before any arithmetic. This makes contributions dimensionless and comparable across all features.
