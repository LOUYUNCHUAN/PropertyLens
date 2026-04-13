import { useState } from 'react'
import { getCBR, predictPrice } from '../api/client.js'
import IRSTag from '../components/IRSTag.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'

export default function DiscoverView() {
  const [prefs, setPrefs] = useState({
    budget_low: 300000,
    budget_high: 800000,
    floor_area_sqm: 90,
    storey_mid: 10,
    max_mrt_km: 1.0,
    mature: 1,
    top_school: 0
  })
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const onChange = (field, value) =>
    setPrefs((p) => ({ ...p, [field]: value }))

  const handleSearch = async () => {
    setLoading(true)
    setResults([])
    setError(null)
    const flat = {
      floor_area_sqm: Number(prefs.floor_area_sqm),
      storey_mid: Number(prefs.storey_mid),
      remaining_lease_years: 75,
      lease_commence_date: 1995,
      dist_nearest_mrt_km: Number(prefs.max_mrt_km),
      dist_to_cbd_km: 10,
      is_mature_estate: Number(prefs.mature),
      top_school_within_1km: Number(prefs.top_school),
      year: new Date().getFullYear(),
      month_num: new Date().getMonth() + 1,
      dist_nearest_primary_school_km: 0.5,
      dist_nearest_top_school_km: 1.2,
      dist_nearest_hawker_km: 0.4,
      dist_nearest_market_km: 0.6,
      mrt_count_within_1km: 2,
      primary_schools_within_1km: 3,
      primary_schools_within_2km: 6,
      top_school_within_2km: 1,
      hawkers_within_500m: 2,
      flat_type: '4 ROOM'
    }

    try {
      const cbrRes = await getCBR(flat, 12)
      const enriched = await Promise.all(
        cbrRes.comparables.map(async (c) => {
          const payload = {
            ...flat,
            floor_area_sqm: c.floor_area_sqm,
            storey_mid: c.storey_mid,
            remaining_lease_years: c.remaining_lease_years
          }
          const pred = await predictPrice(payload)
          return { ...c, predicted_price: pred.predicted_price }
        })
      )
      setResults(enriched)
    } catch (err) {
      console.error('Discover search error:', err)
      setError('Failed to find recommendations. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n) => `$${Math.round(n).toLocaleString()}`

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)]">
      <section className="space-y-4">
        <div className="card">
          <div className="section-label">Find better-value flats</div>
          <div className="space-y-3 text-sm">
            <div>
              <label className="block text-xs font-semibold text-[color:var(--ink-muted)] mb-1">
                Budget range (SGD)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input-base"
                  value={prefs.budget_low}
                  onChange={(e) =>
                    onChange('budget_low', Number(e.target.value))
                  }
                />
                <input
                  type="number"
                  className="input-base"
                  value={prefs.budget_high}
                  onChange={(e) =>
                    onChange('budget_high', Number(e.target.value))
                  }
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[color:var(--ink-muted)] mb-1">
                Floor area (sqm)
              </label>
              <input
                type="range"
                min={40}
                max={200}
                value={prefs.floor_area_sqm}
                onChange={(e) =>
                  onChange('floor_area_sqm', Number(e.target.value))
                }
                className="w-full"
              />
              <div className="text-[11px] text-[color:var(--ink-muted)] mt-0.5">
                <span className="mono">{prefs.floor_area_sqm} sqm</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[color:var(--ink-muted)] mb-1">
                Max distance to MRT (km)
              </label>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.1}
                value={prefs.max_mrt_km}
                onChange={(e) =>
                  onChange('max_mrt_km', Number(e.target.value))
                }
                className="w-full"
              />
              <div className="text-[11px] text-[color:var(--ink-muted)] mt-0.5">
                <span className="mono">{prefs.max_mrt_km.toFixed(1)} km</span>
              </div>
            </div>
            <button
              type="button"
              className="btn-primary w-full mt-2"
              onClick={handleSearch}
            >
              {loading ? 'Searching…' : 'Discover similar flats →'}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="section-label mb-0">Recommended flats</div>
            <IRSTag type="Recommender" />
          </div>
          {loading && <LoadingSpinner label="Finding similar flats..." />}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-3">
              {error}
              <button onClick={handleSearch} className="ml-2 underline text-red-700 font-medium">Retry</button>
            </div>
          )}
          {!loading && !error && !results.length && (
            <div className="text-xs text-[color:var(--ink-muted)]">
              Adjust your preferences and click{' '}
              <strong>Discover similar flats →</strong> to see recommendations
              based on comparable past sales.
            </div>
          )}
          {!loading && results.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3 text-xs">
              {results.map((r, i) => {
                const pricePerSqm = r.predicted_price / r.floor_area_sqm
                const better = pricePerSqm < prefs.budget_high / 90
                return (
                  <div
                    key={i}
                    className="p-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--warm-white)] shadow-sm"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="text-[color:var(--ink-light)] font-semibold">
                        {r.town}
                      </div>
                      {better && (
                        <span className="px-2 py-0.5 rounded-full bg-[color:var(--amber-light)] text-[10px] text-[color:var(--amber)] font-semibold">
                          Better value
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[color:var(--ink-muted)] mb-1">
                      {r.block} {r.street_name}
                    </div>
                    <div className="serif text-lg text-[color:var(--ink)] mb-1">
                      {fmt(r.predicted_price)}
                    </div>
                    <div className="text-[11px] text-[color:var(--ink-muted)] mb-2">
                      <span className="mono">
                        {fmt(pricePerSqm)} / sqm
                      </span>{' '}
                      · {r.floor_area_sqm} sqm · #{r.storey_mid}
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Similarity</span>
                      <span className="mono">
                        {Math.round(r.similarity_pct)}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

