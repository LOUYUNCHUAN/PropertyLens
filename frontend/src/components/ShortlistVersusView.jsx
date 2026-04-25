/**
 * ShortlistVersusView — head-to-head comparison of up to 3 shortlisted flats.
 *
 * Design intent (after design review):
 *   • Apple-to-apple by default — first picked row is the "anchor"; the picker
 *     dims non-comparable chips (different flat type, or floor area outside
 *     ±20%). User can un-toggle either constraint to relax the filter.
 *   • Drop the synthetic Smart Score in favour of concrete neighbourhood facts
 *     pulled from /api/nearby (already deduped, with school tier attached
 *     server-side via location.py).
 *   • One headline bar (Price per sqm — the only metric where a magnitude bar
 *     earns its space). Everything else is a compact scorecard table — small
 *     numbers + units + 🏆 on the per-row winner.
 *   • Map gets ~60% of the card width (was ~50%); panels become much denser.
 *
 * Radii (matching the brainstorm spec):
 *   MRT / Hawker  → 1 km   (close walking)
 *   Schools       → 2 km   + flag if a top-tier school sits within 2 km
 *   Malls         → 2 km
 *
 * Top-tier school = nearby.school item with `tier === 'high'`. The tier value
 * is enriched server-side from data/amenities/school_popularity_combined.csv.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  GraduationCap,
  Home,
  ShoppingBag,
  Swords,
  TrainFront,
  Trophy,
  Utensils
} from 'lucide-react'

import { cn } from '@/lib/utils'
import ShortlistMapView from '@/components/ShortlistMapView.jsx'

const MAX_PICKS = 3
const PICKER_LIMIT = 8
const SQM_TOLERANCE = 0.20

// ── Slot palette (assigned by picked-position) ────────────────────────────
const SLOT = [
  {
    label: 'emerald',
    chipBorder: 'border-emerald-600',
    chipText: 'text-emerald-700 dark:text-emerald-400',
    chipBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    badgeBg: 'bg-emerald-600',
    valueText: 'text-emerald-700 dark:text-emerald-400',
    bar: 'bg-emerald-500/80 border-emerald-600 dark:bg-emerald-500/40'
  },
  {
    label: 'violet',
    chipBorder: 'border-violet-600',
    chipText: 'text-violet-700 dark:text-violet-400',
    chipBg: 'bg-violet-50 dark:bg-violet-950/40',
    badgeBg: 'bg-violet-600',
    valueText: 'text-violet-700 dark:text-violet-400',
    bar: 'bg-violet-500/80 border-violet-600 dark:bg-violet-500/40'
  },
  {
    // NOTE: this project's tailwind.config.js overrides the default `amber`
    // palette to a single colour — `bg-amber-600` etc. don't exist anymore.
    // Using `orange` instead (full Tailwind palette, distinct hue from the
    // emerald/violet slots above).
    label: 'orange',
    chipBorder: 'border-orange-600',
    chipText: 'text-orange-700 dark:text-orange-400',
    chipBg: 'bg-orange-50 dark:bg-orange-950/40',
    badgeBg: 'bg-orange-600',
    valueText: 'text-orange-700 dark:text-orange-400',
    bar: 'bg-orange-500/80 border-orange-600 dark:bg-orange-500/40'
  }
]

// ── Helpers ────────────────────────────────────────────────────────────────
// IMPORTANT: Number(null) === 0 in JS, so a naive `Number(x ?? y)` silently
// turns missing data into a 0 — produces nonsense like "S$0/m²" downstream.
// Coerce manually.
const _numOrNull = (raw) => {
  if (raw == null || raw === '') return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}

// All accessors take (row, snap) — `snap` is snapshotsById[row.id], which holds
// the full payload including floor_area_sqm; the bare `row` is just the wishlist
// summary and lacks that field.
const flatTypeOf = (row, snap) =>
  String(
    snap?.payload_json?.flat_type ?? row?.payload_json?.flat_type ?? row?.flat_type ?? ''
  )
    .toUpperCase()
    .trim()
const sqmOf = (row, snap) => {
  const v = _numOrNull(
    snap?.payload_json?.floor_area_sqm ??
      row?.payload_json?.floor_area_sqm ??
      row?.floor_area_sqm
  )
  return v != null && v > 0 ? v : null
}
const askingOf = (row, snap) => {
  const v = _numOrNull(snap?.listing_price ?? row?.listing_price)
  return v != null && v > 0 ? v : null
}
const aiEstimateOf = (row, snap) => {
  const v = _numOrNull(snap?.model_estimate ?? row?.predicted_price)
  return v != null && v > 0 ? v : null
}
// Price for psm: prefer asking, fall back to AI estimate so we still show
// something meaningful for unpriced listings.
const priceOf = (row, snap) => askingOf(row, snap) ?? aiEstimateOf(row, snap)
const psmOf = (row, snap) => {
  const p = priceOf(row, snap)
  const a = sqmOf(row, snap)
  return p != null && a != null ? p / a : null
}

// All formatters MUST short-circuit on null/undefined explicitly — Number(null)
// is 0 and Number.isFinite(0) is true, which would silently produce "S$0/m²".
const fmtSgdK = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (v >= 1_000_000) return `S$${(v / 1_000_000).toFixed(2)}M`
  return `S$${Math.round(v / 1000)}k`
}
const fmtSgd = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  return Number.isFinite(v) ? `S$${Math.round(v).toLocaleString('en-SG')}` : '—'
}
const fmtPsm = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  return Number.isFinite(v) ? `S$${Math.round(v).toLocaleString('en-SG')}/m²` : '—'
}
const fmtDist = (m) => {
  if (m == null) return '—'
  const x = Number(m)
  if (!Number.isFinite(x)) return '—'
  if (x < 1000) return `${Math.round(x)} m`
  return `${(x / 1000).toFixed(1)} km`
}
const fmtCount = (n, noun) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  const i = Math.round(v)
  return `${i} ${i === 1 ? noun : `${noun}s`}`
}
const shortLabel = (row) =>
  String(row?.display_label || row?.address_short || `Listing ${row?.id ?? ''}`).replace(/^BLK\s+/i, '')

const slotFor = (id, selectedIds) => {
  const idx = selectedIds.indexOf(id)
  return idx >= 0 ? SLOT[idx] : null
}

// ── Nearby filters (radius in metres, items already deduped per listing) ──
const within = (items, radiusM) =>
  Array.isArray(items)
    ? items.filter((s) => Number.isFinite(Number(s?.dist_m)) && Number(s.dist_m) <= radiusM)
    : []
const nearestDist = (items) => {
  if (!items?.length) return null
  const dists = items.map((s) => Number(s?.dist_m)).filter(Number.isFinite)
  return dists.length ? Math.min(...dists) : null
}
const schoolsWithin = (nearby, r) => within(nearby?.school, r)
const mrtWithin = (nearby, r) =>
  within(nearby?.mrt, r).concat(within(nearby?.lrt, r))
const hawkerWithin = (nearby, r) => within(nearby?.hawker, r)
const mallWithin = (nearby, r) => within(nearby?.mall, r)
const hasTopTierSchoolWithin = (nearby, r) =>
  schoolsWithin(nearby, r).some((s) => String(s?.tier || '').toLowerCase() === 'high')

// ── Sub-component: filter chip toggle ──────────────────────────────────────
function FilterChip({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
        active
          ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border-border bg-card text-slate-600 hover:border-slate-300 hover:text-foreground dark:text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'inline-flex h-3 w-3 items-center justify-center rounded-sm border',
          active
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-300 bg-card dark:border-muted'
        )}
        aria-hidden
      >
        {active ? '✓' : ''}
      </span>
      {children}
    </button>
  )
}

// ── Sub-component: picker chip ─────────────────────────────────────────────
function PickerChip({ row, slot, position, onClick, dimmed }) {
  const active = slot != null
  return (
    <button
      type="button"
      onClick={onClick}
      title={dimmed ? 'Outside the apple-to-apple filter — relax the constraints to enable' : undefined}
      className={cn(
        'group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all',
        active
          ? cn(slot.chipBorder, slot.chipText, slot.chipBg, 'shadow-sm')
          : dimmed
          ? 'cursor-not-allowed border-dashed border-border bg-card/60 text-slate-400 opacity-60'
          : 'border-border bg-card text-slate-600 hover:border-slate-300 hover:text-foreground dark:text-muted-foreground dark:hover:border-muted-foreground/40'
      )}
      disabled={dimmed && !active}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-display text-[10px] font-extrabold',
          active ? cn(slot.badgeBg, 'text-white') : 'bg-slate-200 text-slate-500 dark:bg-muted'
        )}
        aria-hidden
      >
        {active ? position + 1 : ''}
      </span>
      <span className="max-w-[200px] truncate">{shortLabel(row)}</span>
    </button>
  )
}

// ── Sub-component: column-header row of the scorecard ──────────────────────
function ScorecardHeader({ selected, selectedIds }) {
  return (
    <div
      className="grid items-end gap-2 border-b border-border pb-2"
      style={{ gridTemplateColumns: `minmax(0, 1.6fr) repeat(${selected.length}, minmax(0, 1fr))` }}
    >
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500 dark:text-muted-foreground">
        Metric
      </span>
      {selected.map((r) => {
        const slot = slotFor(r.id, selectedIds)
        const idx = selectedIds.indexOf(r.id)
        return (
          <div key={r.id} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] font-display text-[9px] font-extrabold text-white',
                  slot?.badgeBg
                )}
                aria-hidden
              >
                {idx + 1}
              </span>
              <span className="truncate text-[11px] font-semibold text-foreground" title={shortLabel(r)}>
                {shortLabel(r)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Sub-component: one scorecard row (label + N value cells + trophy) ─────
function ScorecardRow({ label, values, higherIsBetter, closestToZero, render, selectedIds, suffix }) {
  // Determine winner (numeric only). Booleans handled by `render` only — no trophy.
  const numeric = values.map((v) => (typeof v.val === 'number' && Number.isFinite(v.val) ? v.val : null))
  const validNums = numeric.filter((n) => n != null)
  let winnerVal = null
  if (validNums.length > 1) {
    if (closestToZero) {
      // Pick the value with the smallest |x|.
      winnerVal = validNums.reduce((best, n) => (Math.abs(n) < Math.abs(best) ? n : best), validNums[0])
    } else {
      winnerVal = higherIsBetter ? Math.max(...validNums) : Math.min(...validNums)
    }
    // Don't crown a winner if everyone tied
    const allEqual = validNums.every((n) => Math.abs(n - winnerVal) < 1e-6)
    if (allEqual) winnerVal = null
  }

  return (
    <div
      className="grid items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0"
      style={{ gridTemplateColumns: `minmax(0, 1.6fr) repeat(${values.length}, minmax(0, 1fr))` }}
    >
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-slate-700 dark:text-slate-200" title={label}>
          {label}
        </p>
        {suffix && (
          <p className="truncate text-[10px] font-medium text-slate-500 dark:text-muted-foreground">
            {suffix}
          </p>
        )}
      </div>
      {values.map((v) => {
        const slot = slotFor(v.id, selectedIds)
        const isWin =
          winnerVal != null && typeof v.val === 'number' && Math.abs(v.val - winnerVal) < 1e-6
        return (
          <div key={v.id} className="flex items-center gap-1 truncate">
            <span
              className={cn(
                'truncate font-mono text-[12px] font-bold tabular-nums',
                isWin ? slot?.valueText : 'text-foreground'
              )}
            >
              {render ? render(v.val) : v.display}
            </span>
            {isWin && <Trophy className="h-3 w-3 shrink-0 text-amber-600" aria-hidden />}
          </div>
        )
      })}
    </div>
  )
}

// ── Sub-component: panel wrapper (Schools / Transport / Lifestyle) ────────
function Panel({ title, sub, Icon, iconBg, iconFg, children }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', iconBg)} aria-hidden>
          <Icon className={cn('h-3.5 w-3.5', iconFg)} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[13px] font-bold tracking-tight text-foreground">{title}</p>
          {sub && (
            <p className="truncate text-[11px] font-medium text-slate-500 dark:text-muted-foreground">
              {sub}
            </p>
          )}
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}

// PsmBars removed — pricing is now a scorecard table inside the main panels.

// ── Main view ─────────────────────────────────────────────────────────────
// Slot pin colours for the embedded leaflet map (must match SLOT order).
const SLOT_HEX = [
  { bg: '#059669', fg: '#ffffff' }, // emerald-600
  { bg: '#7c3aed', fg: '#ffffff' }, // violet-600
  { bg: '#ea580c', fg: '#ffffff' }  // orange-600
]

export default function ShortlistVersusView({
  rows,
  smartScores = {},
  snapshotsById = {},
  geocodeById = {},
  nearbyById = {},
  gapPct,
  onOpenListing
}) {
  // Sort the picker source by a price-per-sqm heuristic if smartScores absent.
  const ranked = useMemo(() => {
    const arr = Array.isArray(rows) ? [...rows] : []
    return arr.sort((a, b) => {
      const sa = smartScores[a.id]?.score ?? null
      const sb = smartScores[b.id]?.score ?? null
      if (sa != null || sb != null) return (sb ?? -1) - (sa ?? -1)
      // Fallback: cheaper psm first
      const pa = psmOf(a, snapshotsById[a.id]) ?? Infinity
      const pb = psmOf(b, snapshotsById[b.id]) ?? Infinity
      return pa - pb
    })
  }, [rows, smartScores, snapshotsById])

  // Default selection: first MAX_PICKS rows
  const initialIds = useMemo(
    () => ranked.slice(0, Math.min(MAX_PICKS, ranked.length)).map((r) => r.id),
    [ranked]
  )
  const [selectedIds, setSelectedIds] = useState(initialIds)
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillValid = prev.filter((id) => ranked.some((r) => r.id === id))
      if (stillValid.length === prev.length && stillValid.length > 0) return prev
      if (stillValid.length === 0) return initialIds
      return stillValid
    })
  }, [ranked, initialIds])

  // Apple-to-apple filters
  const [sameType, setSameType] = useState(true)
  const [similarSqm, setSimilarSqm] = useState(true)

  const togglePick = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((x) => x !== id) : prev
      if (prev.length < MAX_PICKS) return [...prev, id]
      return [...prev.slice(1), id] // FIFO replace
    })
  }

  const selected = useMemo(
    () => selectedIds.map((id) => ranked.find((r) => r.id === id)).filter(Boolean),
    [selectedIds, ranked]
  )
  const anchor = selected[0] || null
  const anchorSnap = anchor ? snapshotsById[anchor.id] : null
  const anchorType = anchor ? flatTypeOf(anchor, anchorSnap) : null
  const anchorSqm = anchor ? sqmOf(anchor, anchorSnap) : null

  const visibleInPicker = useMemo(() => {
    // Always include picked listings first (in slot order) so their numbered
    // badges always render, even if a pick falls outside the top-N ranked window.
    const selectedRows = selectedIds
      .map((id) => ranked.find((r) => r.id === id))
      .filter(Boolean)
    const remaining = ranked.filter((r) => !selectedIds.includes(r.id))
    const fillCount = Math.max(0, PICKER_LIMIT - selectedRows.length)
    const combined = [...selectedRows, ...remaining.slice(0, fillCount)]
    return combined.map((r) => {
      let dimmed = false
      if (anchor && r.id !== anchor.id) {
        const rSnap = snapshotsById[r.id]
        if (sameType && anchorType && flatTypeOf(r, rSnap) !== anchorType) dimmed = true
        if (similarSqm && anchorSqm) {
          const a = sqmOf(r, rSnap)
          if (a == null) {
            dimmed = true
          } else if (Math.abs(a - anchorSqm) / anchorSqm > SQM_TOLERANCE) {
            dimmed = true
          }
        }
      }
      return { row: r, dimmed }
    })
  }, [ranked, selectedIds, snapshotsById, anchor, anchorType, anchorSqm, sameType, similarSqm])

  // Pin appearance map for the embedded leaflet map. Slot 1/2/3 in the
  // picker → emerald/violet/orange pins on the map with matching numbered
  // labels, instead of the default sequential shortlist-rank pins.
  const pinAppearanceById = useMemo(() => {
    const out = {}
    selectedIds.forEach((id, idx) => {
      const s = SLOT_HEX[idx]
      if (s) out[id] = { label: String(idx + 1), bg: s.bg, fg: s.fg }
    })
    return out
  }, [selectedIds])

  // Translucent 2 km radius circle around each picked pin, in the slot colour.
  // The 2 km radius matches the "Schools / Malls within 2 km" panels above,
  // so the user sees the actual area those counts cover.
  const radiusOverlayById = useMemo(() => {
    const out = {}
    selectedIds.forEach((id, idx) => {
      const s = SLOT_HEX[idx]
      if (s) out[id] = { radiusM: 2000, color: s.bg, fillOpacity: 0.18 }
    })
    return out
  }, [selectedIds])

  const focusedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  if (!ranked.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No listings in your shortlist yet. Save flats from the Buyer view or the extension to compare them here.
      </div>
    )
  }

  // Build values for each scorecard row across `selected`. Each `read` callback
  // gets (row, nearby, snapshot) so it can pull whatever it needs.
  const buildVals = (read) =>
    selected.map((r) => {
      const out = read(r, nearbyById[r.id], snapshotsById[r.id])
      return { id: r.id, ...out }
    })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display flex items-center gap-2 text-[18px] font-extrabold tracking-tight text-foreground">
            <Swords className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
            Compare
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
              {selected.length} of {ranked.length}
            </span>
          </p>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-muted-foreground">
            Up to {MAX_PICKS} listings · plain-English neighbourhood facts ·{' '}
            <Trophy className="inline h-3 w-3 text-amber-600" aria-hidden /> marks the per-row winner
          </p>
        </div>
      </div>

      {/* Filter row + picker */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-muted-foreground">
          <span className="font-semibold uppercase tracking-[0.08em]">Comparing only:</span>
          <FilterChip
            active={sameType}
            onClick={() => setSameType((v) => !v)}
            title="Restrict the picker to listings of the same flat type as your anchor"
          >
            Same flat type
          </FilterChip>
          <FilterChip
            active={similarSqm}
            onClick={() => setSimilarSqm((v) => !v)}
            title={`Restrict the picker to listings within ±${Math.round(SQM_TOLERANCE * 100)}% floor area of your anchor`}
          >
            Floor area ±{Math.round(SQM_TOLERANCE * 100)}%
          </FilterChip>
          {anchor && (
            <span className="ml-auto truncate text-[11px] text-slate-500 dark:text-muted-foreground">
              anchor: <strong className="text-foreground">{flatTypeOf(anchor)}</strong>
              {anchorSqm ? <> · <strong className="text-foreground">{Math.round(anchorSqm)} sqm</strong></> : null}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleInPicker.map(({ row, dimmed }) => {
            const slot = slotFor(row.id, selectedIds)
            return (
              <PickerChip
                key={row.id}
                row={row}
                slot={slot}
                position={selectedIds.indexOf(row.id)}
                onClick={() => togglePick(row.id)}
                dimmed={dimmed}
              />
            )
          })}
        </div>
      </div>

      {/* Body: panels (left) + map (right). `items-stretch` keeps the right
          column the same height as the (taller) left scorecard column so the
          map can fill that space. */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        {/* Left column — panels */}
        <div className="flex flex-col gap-3">
          <Panel
            title="Pricing"
            sub="Asking vs AI estimate · price per sqm"
            Icon={Home}
            iconBg="bg-slate-100 dark:bg-muted/40"
            iconFg="text-slate-700 dark:text-slate-200"
          >
            <ScorecardHeader selected={selected} selectedIds={selectedIds} />
            <ScorecardRow
              label="Asking price"
              higherIsBetter={false}
              selectedIds={selectedIds}
              values={buildVals((r, _near, snap) => {
                const v = askingOf(r, snap)
                return { val: v, display: fmtSgdK(v) }
              })}
            />
            <ScorecardRow
              label="AI estimate"
              higherIsBetter={false}
              selectedIds={selectedIds}
              values={buildVals((r, _near, snap) => {
                const v = aiEstimateOf(r, snap)
                return { val: v, display: fmtSgdK(v) }
              })}
            />
            <ScorecardRow
              label="vs AI"
              closestToZero
              selectedIds={selectedIds}
              suffix="closer to 0% wins"
              values={buildVals((r, _near, snap) => {
                const ask = askingOf(r, snap)
                const ai = aiEstimateOf(r, snap)
                if (ask == null || ai == null || ai <= 0) return { val: null, display: '—' }
                const pct = ((ask - ai) / ai) * 100
                const sign = pct > 0 ? '+' : ''
                return { val: pct, display: `${sign}${pct.toFixed(1)}%` }
              })}
            />
            <ScorecardRow
              label="Price per sqm"
              higherIsBetter={false}
              selectedIds={selectedIds}
              suffix="lower is better — fair across sizes"
              values={buildVals((r, _near, snap) => {
                const v = psmOf(r, snap)
                return { val: v, display: fmtPsm(v) }
              })}
            />
          </Panel>

          <Panel
            title="Schools"
            sub="Within 2 km · top tier flagged"
            Icon={GraduationCap}
            iconBg="bg-amber-50 dark:bg-amber-950/30"
            iconFg="text-amber-700 dark:text-amber-400"
          >
            <ScorecardHeader selected={selected} selectedIds={selectedIds} />
            <ScorecardRow
              label="Schools within 2 km"
              higherIsBetter
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const items = schoolsWithin(near, 2000)
                return { val: items.length, display: fmtCount(items.length, 'school') }
              })}
            />
            <ScorecardRow
              label="Nearest school"
              higherIsBetter={false}
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const d = nearestDist(schoolsWithin(near, 2000))
                return { val: d, display: fmtDist(d) }
              })}
            />
            <ScorecardRow
              label="Top-tier school within 2 km"
              higherIsBetter
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const ok = hasTopTierSchoolWithin(near, 2000)
                // Numeric val so the trophy goes on ✓ winners; display does the
                // human label.
                return { val: ok ? 1 : 0, display: ok ? '✓ Yes' : '✗ No' }
              })}
            />
          </Panel>

          <Panel
            title="Transport"
            sub="MRT / LRT within walking distance"
            Icon={TrainFront}
            iconBg="bg-blue-50 dark:bg-blue-950/30"
            iconFg="text-blue-700 dark:text-blue-400"
          >
            <ScorecardHeader selected={selected} selectedIds={selectedIds} />
            <ScorecardRow
              label="MRT/LRT within 1 km"
              higherIsBetter
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const items = mrtWithin(near, 1000)
                return { val: items.length, display: fmtCount(items.length, 'station') }
              })}
            />
            <ScorecardRow
              label="Nearest MRT/LRT"
              higherIsBetter={false}
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const all = (near?.mrt || []).concat(near?.lrt || [])
                const d = nearestDist(all)
                return { val: d, display: fmtDist(d) }
              })}
            />
          </Panel>

          <Panel
            title="Lifestyle"
            sub="Hawker (1 km) and malls (2 km)"
            Icon={Utensils}
            iconBg="bg-rose-50 dark:bg-rose-950/30"
            iconFg="text-rose-700 dark:text-rose-400"
          >
            <ScorecardHeader selected={selected} selectedIds={selectedIds} />
            <ScorecardRow
              label="Hawker centres within 1 km"
              higherIsBetter
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const items = hawkerWithin(near, 1000)
                return { val: items.length, display: fmtCount(items.length, 'centre') }
              })}
            />
            <ScorecardRow
              label="Nearest hawker"
              higherIsBetter={false}
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const d = nearestDist(near?.hawker)
                return { val: d, display: fmtDist(d) }
              })}
            />
            <ScorecardRow
              label="Malls within 2 km"
              higherIsBetter
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const items = mallWithin(near, 2000)
                return { val: items.length, display: fmtCount(items.length, 'mall') }
              })}
            />
            <ScorecardRow
              label="Nearest mall"
              higherIsBetter={false}
              selectedIds={selectedIds}
              values={buildVals((r, near) => {
                const d = nearestDist(near?.mall)
                return { val: d, display: fmtDist(d) }
              })}
            />
          </Panel>
        </div>

        {/* Right column — map fills the available height, matched to the
            stacked panels on the left. Pins for picked listings are
            colour-coded and labelled to match the picker chips, with a
            translucent 2 km radius overlay in the slot colour. */}
        <div className="min-w-0 min-h-[480px] h-full">
          <ShortlistMapView
            rows={rows}
            geocodeById={geocodeById}
            nearbyById={nearbyById}
            selectedListingIds={focusedSet}
            onOpenListing={onOpenListing}
            gapPct={gapPct}
            pinAppearanceById={pinAppearanceById}
            radiusOverlayById={radiusOverlayById}
            fillHeight
          />
        </div>
      </div>
    </div>
  )
}
