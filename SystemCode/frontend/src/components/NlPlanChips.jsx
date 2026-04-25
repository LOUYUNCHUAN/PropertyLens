import { useState, useMemo } from 'react'

const FLAT_TYPE_LABEL = {
  '1 ROOM': '1-room',
  '2 ROOM': '2-room',
  '3 ROOM': '3-room',
  '4 ROOM': '4-room',
  '5 ROOM': '5-room',
  EXECUTIVE: 'Executive',
  'MULTI-GENERATION': 'Multi-gen'
}

const SORT_LABEL = {
  smart_score: 'Smart Score',
  listing_price: 'Listing price',
  predicted_price: 'Model price',
  vs_model_pct: 'vs-model gap',
  remaining_lease_years: 'Lease remaining',
  floor_area_sqm: 'Floor area',
  storey_mid: 'Storey',
  nearest_mrt: 'Closest MRT',
  nearest_school: 'Closest school',
  nearest_hawker: 'Closest hawker',
  nearest_mall: 'Closest mall',
  nearest_highway: 'Distance to highway',
  created_at: 'Saved recently'
}

const UNKNOWN_LABEL = {
  nearest_mrt: 'no MRT data',
  nearest_highway: 'no highway data',
  nearest_school: 'no school data',
  nearest_school_tier: 'no school tier',
  nearest_hawker: 'no hawker data',
  nearest_mall: 'no mall data',
  listing_price: 'no listing price',
  vs_model_pct: 'no model gap',
  flat_type: 'no flat type',
  floor_area_sqm: 'no floor area',
  storey_mid: 'no storey',
  remaining_lease_years: 'no lease years',
  town: 'no town',
  address: 'no address'
}

function titleCase(t) {
  return String(t).replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
}

function money(n) {
  if (n == null) return ''
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

function Chip({ icon, text }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground">
      <span aria-hidden>{icon}</span>
      {text}
    </span>
  )
}

export default function NlPlanChips({ plan, notes }) {
  const [showJson, setShowJson] = useState(false)

  const unknownSummary = useMemo(() => {
    if (!Array.isArray(notes)) return []
    const counts = {}
    for (const n of notes) {
      for (const tag of n.unknown || []) counts[tag] = (counts[tag] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [notes])

  if (!plan) return null

  const area = plan.area || {}
  const price = plan.price || {}
  const unit = plan.unit || {}
  const prox = plan.proximity || {}
  const sort = Array.isArray(plan.sort) ? plan.sort : []
  const limit = plan.limit

  const chips = []

  const towns = (area.towns || []).filter(Boolean)
  if (towns.length > 0) {
    chips.push({ icon: '📍', text: towns.map(titleCase).join(', ') })
  }
  if (area.street_contains) {
    chips.push({ icon: '🏘️', text: titleCase(area.street_contains) })
  }

  if (price.min != null && price.max != null) {
    chips.push({ icon: '💰', text: `${money(price.min)}–${money(price.max)}` })
  } else if (price.max != null) {
    chips.push({ icon: '💰', text: `≤ ${money(price.max)}` })
  } else if (price.min != null) {
    chips.push({ icon: '💰', text: `≥ ${money(price.min)}` })
  }
  if (price.vs_model_pct_max != null) {
    chips.push({
      icon: '📉',
      text:
        price.vs_model_pct_max <= 0
          ? `≥ ${Math.abs(price.vs_model_pct_max)}% below model`
          : `≤ ${price.vs_model_pct_max}% over model`
    })
  }

  const fts = (unit.flat_types || []).filter(Boolean)
  if (fts.length > 0) {
    chips.push({ icon: '🏠', text: fts.map((f) => FLAT_TYPE_LABEL[f] || f).join(', ') })
  }
  if (unit.floor_area_min_sqm != null || unit.floor_area_max_sqm != null) {
    const lo = unit.floor_area_min_sqm
    const hi = unit.floor_area_max_sqm
    const text =
      lo != null && hi != null
        ? `${lo}–${hi} sqm`
        : lo != null
          ? `≥ ${lo} sqm`
          : `≤ ${hi} sqm`
    chips.push({ icon: '📐', text })
  }
  if (unit.storey_min != null || unit.storey_max != null) {
    const lo = unit.storey_min
    const hi = unit.storey_max
    const text =
      lo != null && hi != null
        ? `Storey ${lo}–${hi}`
        : lo != null
          ? `≥ ${lo}th storey`
          : `≤ ${hi}th storey`
    chips.push({ icon: '🏢', text })
  }
  if (unit.lease_min_years != null || unit.lease_max_years != null) {
    const lo = unit.lease_min_years
    const hi = unit.lease_max_years
    const text =
      lo != null && hi != null
        ? `${lo}–${hi} yrs lease`
        : lo != null
          ? `≥ ${lo} yrs lease`
          : `≤ ${hi} yrs lease`
    chips.push({ icon: '📜', text })
  }

  if (prox.mrt_max_dist_m != null) {
    chips.push({ icon: '🚇', text: `≤ ${Math.round(prox.mrt_max_dist_m)}m MRT` })
  }
  if (prox.highway_min_dist_m != null) {
    chips.push({ icon: '🛣️', text: `≥ ${Math.round(prox.highway_min_dist_m)}m from highway` })
  }
  if (prox.school_max_dist_m != null || prox.school_min_tier) {
    const parts = []
    if (prox.school_max_dist_m != null) parts.push(`≤ ${Math.round(prox.school_max_dist_m)}m`)
    if (prox.school_min_tier) parts.push(`${prox.school_min_tier} demand`)
    chips.push({ icon: '🎓', text: parts.join(', ') || 'school' })
  }
  if (prox.hawker_max_dist_m != null) {
    chips.push({ icon: '🍜', text: `≤ ${Math.round(prox.hawker_max_dist_m)}m hawker` })
  }
  if (prox.mall_max_dist_m != null) {
    chips.push({ icon: '🛍️', text: `≤ ${Math.round(prox.mall_max_dist_m)}m mall` })
  }

  if (sort.length > 0) {
    const names = sort.map((s) => {
      const base = SORT_LABEL[s.key] || s.key
      const arrow = s.dir === 'asc' ? '↑' : '↓'
      return `${base} ${arrow}`
    })
    chips.push({ icon: '↕', text: names.join(' → ') })
  }
  if (limit != null) {
    chips.push({ icon: '🔢', text: `Top ${limit}` })
  }

  return (
    <div className="flex flex-col gap-2">
      {chips.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">
          No explicit filters — showing most recent first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <Chip key={i} icon={c.icon} text={c.text} />
          ))}
        </div>
      )}

      {unknownSummary.length > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {unknownSummary.map(([tag, n], i) => (
            <span key={tag}>
              {i > 0 ? ' · ' : ''}
              {n} missing {UNKNOWN_LABEL[tag] || tag}
            </span>
          ))}
          <span className="ml-1 opacity-75">(kept, ranked last)</span>
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowJson((v) => !v)}
        className="self-start text-[10px] text-muted-foreground underline-offset-2 hover:underline"
      >
        {showJson ? 'Hide raw plan' : 'Show raw plan'}
      </button>
      {showJson ? (
        <pre className="break-all rounded border border-border bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(plan, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

export function unknownTagsById(notes) {
  const map = {}
  if (!Array.isArray(notes)) return map
  for (const n of notes) {
    if (n && n.id != null && Array.isArray(n.unknown) && n.unknown.length > 0) {
      map[n.id] = n.unknown
    }
  }
  return map
}

export { UNKNOWN_LABEL }
