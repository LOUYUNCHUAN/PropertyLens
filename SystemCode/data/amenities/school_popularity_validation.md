# School popularity validation report

**Date:** 2026-04-17
**Input:** `data/amenities/school_popularity_combined.csv` (179 rows)
**Script:** `backend/label_school_popularity.py` (produces `school_popularity.csv`)

Our tiers were derived from Singapore MOE P1 registration data averaged over 2020–2025
(Phase 2C oversubscription ratio, 4-tier logic collapsed to high/medium/low).
This report cross-checks each school against two public references:

- **Top 100 Primary School Ranking 2025** — single-year (2024) balloting ratios
  ([p1registration.sg](https://www.p1registration.sg/2025/05/25/top-100-primary-school-ranking-2025-singapore-based-on-2024-balloting/))
- **62 primary schools always available at Phase 2C (2024)** — list of
  undersubscribed schools
  ([p1registration.sg](https://www.p1registration.sg/2025/05/15/62-primary-schools-always-available-even-at-phase-2c-based-on-2024-balloting-history/))

A subset of schools (54) is outside both reference lists (middle-band schools not
flagged as top-100 competitive nor explicitly undersubscribed). For those we
accept our own tier without web validation.

---

## 1. Agreement summary (before corrections)

| Category | Count |
|---|---|
| Match with web ranking | 98 |
| Mismatch (ours `high`, web `medium` — rank 51–84) | 12 |
| Mismatch (ours `medium`, web `low` — on undersubscribed list) | 12 |
| Mismatch (ours `medium`, web `high` — rank ≤ 30) | 3 |
| Not on web reference (unverifiable) | 54 |
| **Total rows** | **179** |

98/125 verifiable schools (78%) match the web reference. The remaining 27
discrepancies are analysed below.

---

## 2. Matching failures (fixed — name normalisation bug)

These 7 schools were in the source sgschooling dataset but failed the
`_normalize_school_name()` join because of punctuation/apostrophe differences.
Tiers have been filled in from the source CSV:

| Combined-CSV name | Source name | Score | Tier |
|---|---|---|---|
| PEI HWA PRESBYTERIAN PRIMARY SCHOOL | Pei Hwa Presbyterian | 1.052 | **high** |
| YU NENG PRIMARY SCHOOL | Yu Neng | 1.040 | **high** |
| CHONGZHENG PRIMARY SCHOOL | Chongzheng | 1.047 | **high** |
| PASIR RIS PRIMARY SCHOOL | Pasir Ris | 1.031 | **high** |
| SAINT GABRIEL'S PRIMARY SCHOOL | St. Gabriel's | 0.867 | **medium** |
| RADIN MAS PRIMARY SCHOOL | Radin Mas | 1.076 | **high** |
| SPRINGDALE PRIMARY SCHOOL | Springdale | 0.875 | **medium** |

Remaining 2 schools with empty tier that are **correctly** unmatched
(no MOE P1 data — private/international):
- AVONDALE GRAMMAR SCHOOL (PRIMARY & MIDDLE YEARS CAMPUS)
- THE JAPANESE PRIMARY SCHOOL

The other 20 empty-tier rows are student-care centres / schoolhouse branches
(`BIG HEART STUDENT CARE (...)`, `AFTERSCHOOL @ ...`, etc.) — not actual
primary schools. Empty tier is correct for these.

---

## 3. Corrections applied (promoted to `high`)

Three schools were labelled `medium` by our 5-year average but the 2024
balloting data shows clear high-tier popularity (top 40 web rank). In all
three, inspection of year-by-year registration data confirms recent saturation
of Phase 2C:

| School | Our 5-yr avg | Web rank (2024) | Year-by-year evidence | Action |
|---|---|---|---|---|
| ANGSANA PRIMARY SCHOOL | 0.73 | **#10 (2.58)** | Ratio 0.14 in 2017 → 1.03 in 2024; sharp 2022+ rise | medium → **high** |
| NORTH VIEW PRIMARY SCHOOL | 0.91 | **#26 (1.79)** | 2C saturated (ratio ≈ 1.0) since 2019 | medium → **high** |
| DAZHONG PRIMARY SCHOOL | 0.85 | **#37 (1.57)** | 2C saturated from 2023 onwards | medium → **high** |

---

## 4. Discrepancies left unchanged (documented, not overwritten)

### 4a. Our `high` vs web `medium` — threshold artefact (12 schools)

Both sources agree these schools ballot at Phase 2C (web rank 51–84). Our
cutoff `score >= 1.0` puts them in `high`; the web source ranks them in the
lower half of the top-100. Not clearly wrong either way — leaving as `high`:

| School | Our score | Web rank | Web ratio |
|---|---|---|---|
| RIVER VALLEY PRIMARY SCHOOL | 1.06 | #81 | 1.10 |
| RAFFLES GIRLS' PRIMARY SCHOOL | 1.01 | #55 | 1.36 |
| YANGZHENG PRIMARY SCHOOL | 1.03 | #51 | 1.41 |
| ANDERSON PRIMARY SCHOOL | 1.03 | #84 | 1.07 |
| CANBERRA PRIMARY SCHOOL | 1.01 | #77 | 1.16 |
| CHUA CHU KANG PRIMARY SCHOOL | 1.01 | #60 | 1.31 |
| PAYA LEBAR METHODIST GIRLS' SCHOOL (PRIMARY) | 1.02 | #57 | 1.35 |
| COMPASSVALE PRIMARY SCHOOL | 1.01 | #52 | 1.39 |
| PUNGGOL PRIMARY SCHOOL | 1.02 | #70 | 1.21 |
| RIVERSIDE PRIMARY SCHOOL | 1.00 | #53 | 1.38 |
| RIVERVALE PRIMARY SCHOOL | 1.01 | #54 | 1.37 |
| ANGLO-CHINESE SCHOOL (PRIMARY) | 1.02 | #66 | 1.25 |

### 4b. Our `medium` vs web `low` — declining-popularity schools (8 schools)

These appear on the 2024 "always available at 2C" list but scored 0.5 ≤ mean < 1.0
in our 2020-2025 average — meaning they had positive demand in earlier years
but dropped off recently. The web's single-year label may understate historical
popularity; our 5-year average may overstate current popularity.

Leaving at `medium` as a middle-ground label; flag for review if you'd prefer
to bias towards the more recent year:

- BUKIT TIMAH PRIMARY SCHOOL (our score 0.65)
- CANOSSA CATHOLIC PRIMARY SCHOOL (0.76)
- JURONG PRIMARY SCHOOL (0.68)
- OPERA ESTATE PRIMARY SCHOOL (0.78)
- JURONG WEST PRIMARY SCHOOL (0.97)
- PALM VIEW PRIMARY SCHOOL (0.53)
- FUHUA PRIMARY SCHOOL (0.52)
- JIEMIN PRIMARY SCHOOL (0.56)
- PUNGGOL COVE PRIMARY SCHOOL (0.68)
- GREENWOOD PRIMARY SCHOOL (0.73)
- WEST GROVE PRIMARY SCHOOL (0.55)
- WOODLANDS RING PRIMARY SCHOOL (0.52)

---

## 5. Methodology difference — why the two signals don't line up perfectly

| Aspect | Our CSV (source script) | p1registration.sg reference |
|---|---|---|
| Time window | 2020–2025 mean | 2024 only |
| Ratio definition | `(2C_cum − 2B_cum) / (total_vacancy − 2B_cum)` | Applicants-per-vacancy (Phase 2C, SC-within-1km view) |
| Tier cut-offs | `≥1.0 high`, `≥0.5 med`, `<0.5 low` | Top-50 / top-100 rank bands |

Effects:
- **Elite alumni-heavy schools** (Tao Nan, Nanyang, Catholic High, ACS Primary)
  exhaust most vacancies at Phase 2A — few seats left at 2C means our 2C-only
  metric under-weighs them. These still land in `high` here but closer to the
  threshold than their reputation would suggest.
- **Recent risers** (Angsana, Dazhong) are smoothed down by the 5-year average.
  Corrected above.
- **Recent decliners** (Bukit Timah, Canossa Catholic) are smoothed up.
  Documented above.

---

## 6. Final state of `school_popularity_combined.csv`

| Tier | Count |
|---|---|
| high | 52 |
| medium | 47 |
| low | 51 |
| *empty* (student-care/branch/private) | 29 |
| **Total** | **179** |

Compared with the pre-fix state (`high: 44`, `medium: 48`, `low: 51`, empty: 36),
the net change is +8 `high` and −1 `medium` (7 unmatched filled + 3 promoted
− 2 `medium` added back via match), with 7 spurious empty rows cleared.

---

## Sources

- [Top 100 Primary School Ranking 2025 Singapore (based on 2024 balloting) — p1registration.sg](https://www.p1registration.sg/2025/05/25/top-100-primary-school-ranking-2025-singapore-based-on-2024-balloting/)
- [62 Primary Schools always Available Even at Phase 2C (Based on 2024 Balloting History) — p1registration.sg](https://www.p1registration.sg/2025/05/15/62-primary-schools-always-available-even-at-phase-2c-based-on-2024-balloting-history/)
- [Top 50 Primary Schools for Phase 2C based on 2024, 2023, 2022 Vacancies and Balloting — p1registration.sg](https://www.p1registration.sg/2025/05/12/top-50-primary-schools-for-phase-2c-based-on-2024-2023-2022-vacancies-and-balloting/)
- [Most Oversubscribed Primary Schools Singapore 2025 — SGSchoolKaki](https://sgschoolkaki.com/blog/oversubscribed-primary-schools-singapore-2025)
- [Vacancies and balloting data: 2025 P1 Registration Exercise — MOE Singapore](https://www.moe.gov.sg/primary/p1-registration/past-vacancies-and-balloting-data)
