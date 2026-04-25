# Amenities data notes

## School popularity join

This folder contains:

- `schools.csv`: canonical list of school-like amenities with geocodes.
- `school_popularity.csv`: popularity scores (Phase 2C oversubscription ratio), generated from SGSchooling P1 registration data.
- `school_popularity_aliases.csv`: explicit mapping between popularity names and canonical `schools.csv` names.
- `school_popularity_combined.csv`: **left-join output** (all rows from `schools.csv` plus popularity columns when mapped).

### Regenerate `school_popularity.csv`

```bash
python backend/label_school_popularity.py \
  --input data/amenities/sgschooling_2015plus_20260412.csv \
  --output data/amenities/school_popularity.csv \
  --year-start 2020 \
  --year-end 2025
```

### Update mappings

If the join script prints unmapped popularity schools, add rows to:

- `school_popularity_aliases.csv` (`popularity_school` → `schools_name`)

Both values must match the source CSVs **exactly** (including punctuation).

### Regenerate `school_popularity_combined.csv`

```bash
python -m backend.join_school_popularity \
  --schools data/amenities/schools.csv \
  --popularity data/amenities/school_popularity.csv \
  --aliases data/amenities/school_popularity_aliases.csv \
  --output data/amenities/school_popularity_combined.csv
```

## Highways (major roads / expressways)

- `highways.csv`: sampled points along major corridors used for **distance-to-highway** (shortlist NL search, map nearby). Full fidelity can be rebuilt from OpenStreetMap (motorway/trunk/primary) clipped to Singapore; the repo ships interpolated samples from [backend/scripts/build_highways_csv.py](backend/scripts/build_highways_csv.py).

```bash
python backend/scripts/build_highways_csv.py
```

