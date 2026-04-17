import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ShortlistMapView from '../components/ShortlistMapView.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  listWishlistItems,
  getWishlistItem,
  deleteWishlistItem,
  validateListing
} from '../api/client.js'
import {
  wishlistDetailToSnapshot,
  aprioriViolationCount,
  computeScoreComponents,
  sumComponents,
  getBadge,
  generateReason,
  buildValidateListingRequestBody,
  smartScoreComplete
} from '../lib/smartScore.js'
import { PERSONAS, getPersonaScore, getPersonaTag } from '../lib/personas.js'
import {
  snapshotsReadyForPersonas,
  personaHighlightColumn
} from '../lib/shortlistPersonaUtils.js'
import { Home, LayoutGrid, Map as MapIcon, Puzzle, X } from 'lucide-react'
import SHAPChart from '../components/SHAPChart.jsx'
import LocationMap from '../components/LocationMap.jsx'
import CBRTable from '../components/CBRTable.jsx'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'

/** "2 days ago" — recomputed every minute via tick state at view level */
function parseBackendTimestamp(iso) {
  if (!iso) return null
  // Backend stores UTC but the DB column drops tz info, so the API returns
  // naive ISO strings like "2026-04-15T02:30:00". JS would otherwise parse
  // those as local time. If there's no Z/offset suffix, treat as UTC.
  const s = String(iso)
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
  return new Date(hasTz ? s : `${s}Z`)
}

function formatRelativeTime(iso) {
  if (!iso) return ''
  const d = parseBackendTimestamp(iso)
  if (!d || Number.isNaN(d.getTime())) return ''
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const abs = Math.abs(diffSec)
  if (abs < 45) return rtf.format(Math.round(diffSec), 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), 'day')
  if (abs < 2419200) return rtf.format(Math.round(diffSec / 604800), 'week')
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2629800), 'month')
  return rtf.format(Math.round(diffSec / 31536000), 'year')
}

function savedRowTitle(row) {
  const parts = []
  if (row.created_at) parts.push(`Saved ${formatRelativeTime(row.created_at)}`)
  const label = row.display_label || row.address_short
  if (label) parts.push(label)
  return parts.length ? parts.join(' · ') : undefined
}

function parseStoreyMid(storeyRange) {
  const s = String(storeyRange || '').trim().toUpperCase()
  if (s.includes(' TO ')) {
    const parts = s.replace(/\s+TO\s+/i, ' ').split(/\s+/)
    const a = parseInt(parts[0], 10)
    const b = parseInt(parts[1], 10)
    if (!Number.isNaN(a) && !Number.isNaN(b)) return (a + b) / 2
  }
  const n = parseFloat(s)
  return Number.isNaN(n) ? 8 : n
}

function gapPct(listing, predicted) {
  if (listing == null || predicted == null || predicted <= 0) return null
  return ((listing - predicted) / predicted) * 100
}

// Per-component tonal classes so the four bars are scannable in the tooltip (BUG-118).
const SCORE_BAR_TONES = {
  'Value gap': 'bg-emerald-500',
  'CBR match': 'bg-sky-500',
  Rules: 'bg-violet-500',
  Fundamentals: 'bg-amber-500'
}

function ScoreBar({ label, value, max }) {
  const v = Number(value) || 0
  const pct = max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0
  const tone = SCORE_BAR_TONES[label] || 'bg-primary'
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {Math.round(v)}
      </span>
    </div>
  )
}

/** "Overpriced" → "Weak" for compactness; "Incomplete" → "Partial". */
function badgePrimaryLabel(label) {
  if (label === 'Overpriced') return 'Weak'
  if (label === 'Incomplete') return 'Partial'
  return label
}

// Persona variant token map — replaces 3-deep nested ternary (BUG-117).
const PERSONA_VARIANTS = {
  family: {
    active: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 shadow-sm',
    tagText: 'text-sky-600 dark:text-sky-300'
  },
  commuter: {
    active: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200 shadow-sm',
    tagText: 'text-violet-600 dark:text-violet-300'
  },
  default: {
    active: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 shadow-sm',
    tagText: 'text-amber-600 dark:text-amber-300'
  }
}
function personaVariant(id) {
  return PERSONA_VARIANTS[id] || PERSONA_VARIANTS.default
}

// Minimal accessible AlertDialog (BUG-114). No external dep.
function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => e.target === e.currentTarget && onCancel?.()}
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle id="confirm-title" className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex justify-end gap-2 pb-4">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onConfirm} autoFocus>
            {confirmLabel || 'Confirm'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function ShortlistDetailModal({ itemId, username, onClose, onRemoved }) {
  const navigate = useNavigate()
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removeError, setRemoveError] = useState(null)

  useEffect(() => {
    if (!itemId || !username) return
    getWishlistItem(itemId, username)
      .then(setDetail)
      .catch((e) => setErr(e?.message || 'Failed to load'))
  }, [itemId, username])

  if (!itemId) return null

  const p = detail?.payload_json || {}
  const mapSnap = detail?.map_snapshot_json || {}
  const predSnap = detail?.prediction_snapshot_json || {}

  const handleAnalyseAsSeller = () => {
    if (!detail) return
    const params = new URLSearchParams()
    if (p.block) params.set('block', String(p.block))
    if (p.street_name) params.set('street_name', String(p.street_name))
    if (p.town) params.set('town', String(p.town))
    if (p.flat_type) params.set('flat_type', String(p.flat_type))
    if (p.floor_area_sqm != null) params.set('floor_area_sqm', String(p.floor_area_sqm))
    if (p.storey_range) params.set('storey_range', String(p.storey_range))
    if (p.lease_commence_date != null) params.set('lease_commence_date', String(p.lease_commence_date))
    if (p.sale_month) params.set('sale_month', String(p.sale_month))
    navigate(`/seller?${params.toString()}`)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortlist-modal-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <Card
        className="max-h-[90vh] w-full max-w-[min(96vw,1100px)] overflow-y-auto py-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div>
            <h2 id="shortlist-modal-title" className="text-lg font-semibold text-foreground">
              {detail?.display_label || 'Listing'}
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Snapshot from when you saved — model, map, and drivers are stored locally.
            </p>
            {detail && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                {String(detail.source || '').toLowerCase() === 'extension' ? (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Puzzle className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
                    Extension
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Home className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                    Buyer
                  </span>
                )}
                {detail.created_at ? <span>· saved {formatRelativeTime(detail.created_at)}</span> : null}
              </div>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {err && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>
          )}
          {!detail && !err && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
          {detail && (
            <>
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Model estimate
                  </div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
                    S${Math.round(detail.predicted_price).toLocaleString()}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {detail.confidence_low != null && detail.confidence_high != null
                      ? `S$${Math.round(detail.confidence_low).toLocaleString()} – S$${Math.round(detail.confidence_high).toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Listing price
                  </div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
                    {detail.listing_price != null
                      ? `S$${Math.round(detail.listing_price).toLocaleString()}`
                      : '—'}
                  </div>
                  {gapPct(detail.listing_price, detail.predicted_price) != null && (
                    <div className="text-[11px] text-muted-foreground">
                      {gapPct(detail.listing_price, detail.predicted_price).toFixed(1)}% vs model
                    </div>
                  )}
                </div>
              </div>

              {detail.listing_url && (
                <a
                  href={detail.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-primary underline"
                >
                  Open original listing
                </a>
              )}

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Location & amenities
                </div>
                <div className="overflow-hidden rounded-xl border border-border">
                  <LocationMap
                    geocode={mapSnap.geocode || null}
                    nearby={mapSnap.nearby || null}
                    locationContext={predSnap.location_context}
                    town={p.town}
                    flatType={p.flat_type}
                    floorArea={p.floor_area_sqm}
                    storeyMid={parseStoreyMid(p.storey_range)}
                    remainingLease={p.remaining_lease_years}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Price drivers (SHAP)
                </div>
                {detail.shap_snapshot_json?.length ? (
                  <SHAPChart shapValues={detail.shap_snapshot_json} maxFeatures={12} />
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No SHAP snapshot stored for this row.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Similar past sales
                </div>
                <CBRTable comparables={detail.cbr_snapshot_json || []} />
              </div>

              {removeError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {removeError}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleAnalyseAsSeller}>
                  Analyse as seller
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                >
                  Remove from shortlist
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Remove this listing?"
        description="It will disappear from your shortlist. This cannot be undone."
        confirmLabel="Remove"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setRemoveError(null)
          try {
            await deleteWishlistItem(detail.id, username)
            setConfirmOpen(false)
            onRemoved?.(detail.id)
            onClose()
          } catch {
            setRemoveError('Could not remove item. Try again.')
            setConfirmOpen(false)
          }
        }}
      />
    </div>
  )
}

export default function ShortlistView() {
  const { username } = useAuth()
  const u = (username && username.trim()) || localStorage.getItem('hdb_user') || 'user'
  const [rows, setRows] = useState([])
  const [loadErr, setLoadErr] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [smartScores, setSmartScores] = useState({})
  const [snapshotsById, setSnapshotsById] = useState({})
  const [geocodeById, setGeocodeById] = useState({})
  const [nearbyById, setNearbyById] = useState({})
  /** @type {['address'|'listing'|'model'|'gap'|'smartScore', 'asc'|'desc']} */
  const [sortColumn, setSortColumn] = useState('smartScore')
  const [sortDir, setSortDir] = useState('desc')
  const [activePersona, setActivePersona] = useState(null)
  const [mainView, setMainView] = useState('table')
  const [mapSelectedIds, setMapSelectedIds] = useState(() => new Set())
  const mapSelectionInitRef = useRef(false)
  const [wishlistDetailsSettled, setWishlistDetailsSettled] = useState(false)
  // Forces re-render every 60s so "saved X ago" labels stay fresh (BUG-124).
  const [, setNowTick] = useState(0)
  const tableRef = useRef(null)

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const refresh = useCallback(() => {
    listWishlistItems(u, 80)
      .then(setRows)
      .catch(() => setLoadErr('Could not load shortlist.'))
  }, [u])

  useEffect(() => {
    setLoadErr(null)
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!rows.length) {
      setSmartScores({})
      setSnapshotsById({})
      setGeocodeById({})
      setNearbyById({})
      mapSelectionInitRef.current = false
      setMapSelectedIds(new Set())
      setWishlistDetailsSettled(false)
      return
    }
    let cancelled = false
    setWishlistDetailsSettled(false)
    ;(async () => {
      try {
        const settled = await Promise.allSettled(rows.map((r) => getWishlistItem(r.id, u)))
        const validatePromises = settled.map((s) => {
          if (s.status !== 'fulfilled') return Promise.resolve(null)
          const d = s.value
          const built = buildValidateListingRequestBody(d)
          if (!built) return Promise.resolve(null)
          return validateListing(built.body).catch(() => null)
        })
        const validates = await Promise.all(validatePromises)
        if (cancelled) return
        const next = {}
        const snaps = {}
        const geo = {}
        const near = {}
        for (let i = 0; i < rows.length; i++) {
          const s = settled[i]
          if (s.status !== 'fulfilled') continue
          const d = s.value
          const mapSnap = d.map_snapshot_json || {}
          geo[d.id] = mapSnap.geocode ?? null
          near[d.id] = mapSnap.nearby ?? null
          const snap = wishlistDetailToSnapshot(d)
          if (!snap) continue
          snaps[d.id] = snap
          const aprioriV = aprioriViolationCount(validates[i])
          const components = computeScoreComponents(snap, aprioriV)
          const score = sumComponents(components)
          const complete = smartScoreComplete(components)
          const badge = getBadge(score, { complete })
          const reason = generateReason(snap, components)
          next[d.id] = { score, badge, reason, components, complete }
        }
        setSnapshotsById(snaps)
        setGeocodeById(geo)
        setNearbyById(near)
        setSmartScores(next)
      } catch {
        if (!cancelled) {
          setSmartScores({})
          setSnapshotsById({})
          setGeocodeById({})
          setNearbyById({})
        }
      } finally {
        if (!cancelled) setWishlistDetailsSettled(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rows, u])

  const snapshotsReady = snapshotsReadyForPersonas(rows, snapshotsById)

  useEffect(() => {
    if (!wishlistDetailsSettled || rows.length === 0) return
    const geocodedIds = rows.map((r) => r.id).filter((id) => geocodeById[id]?.found)
    setMapSelectedIds((prev) => {
      if (!mapSelectionInitRef.current) {
        mapSelectionInitRef.current = true
        return new Set(geocodedIds)
      }
      const geoSet = new Set(geocodedIds)
      const next = new Set()
      for (const id of prev) if (geoSet.has(id)) next.add(id)
      for (const id of geocodedIds) if (!prev.has(id)) next.add(id)
      return next
    })
  }, [wishlistDetailsSettled, rows, geocodeById])

  const toggleMapRow = useCallback(
    (id) => {
      if (!geocodeById[id]?.found) return
      setMapSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [geocodeById]
  )

  const selectAllMapPins = useCallback(() => {
    setMapSelectedIds(new Set(rows.filter((r) => geocodeById[r.id]?.found).map((r) => r.id)))
  }, [rows, geocodeById])

  const clearMapPins = useCallback(() => {
    setMapSelectedIds(new Set())
  }, [])

  const noGeocodeCount = useMemo(
    () => rows.filter((r) => !geocodeById[r.id]?.found).length,
    [rows, geocodeById]
  )

  const displayRows = useMemo(() => {
    const baseOrder = new Map(rows.map((r, i) => [r.id, i]))
    if (activePersona && snapshotsReady) {
      return [...rows]
        .map((row) => ({ row, score: getPersonaScore(activePersona, snapshotsById[row.id]) }))
        .sort((a, b) => {
          const d = b.score - a.score
          if (d !== 0) return d
          return (baseOrder.get(a.row.id) ?? 0) - (baseOrder.get(b.row.id) ?? 0)
        })
        .map((x) => x.row)
    }

    const mul = sortDir === 'asc' ? 1 : -1
    const sorted = [...rows]
    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'address': {
          const sa = String(a.display_label || a.address_short || '').toLowerCase()
          const sb = String(b.display_label || b.address_short || '').toLowerCase()
          return mul * sa.localeCompare(sb)
        }
        case 'listing': {
          const va = a.listing_price != null ? a.listing_price : -Infinity
          const vb = b.listing_price != null ? b.listing_price : -Infinity
          return mul * (va - vb)
        }
        case 'model':
          return mul * (a.predicted_price - b.predicted_price)
        case 'gap': {
          const ga = gapPct(a.listing_price, a.predicted_price)
          const gb = gapPct(b.listing_price, b.predicted_price)
          const na = ga ?? (sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
          const nb = gb ?? (sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
          return mul * (na - nb)
        }
        case 'smartScore':
        default:
          return mul * ((smartScores[b.id]?.score ?? -1) - (smartScores[a.id]?.score ?? -1))
      }
    })
    return sorted
  }, [rows, activePersona, snapshotsReady, snapshotsById, sortColumn, sortDir, smartScores])

  const headerSubtitle = useMemo(() => {
    const n = rows.length
    const countStr = `${n} listing${n === 1 ? '' : 's'}`
    if (activePersona && snapshotsReady) {
      const sl = PERSONAS.find((p) => p.id === activePersona)?.sortLabel
      return `${countStr} · ${sl || 'Persona ranking'}`
    }
    const labels = {
      address: 'Address',
      listing: 'Listing price',
      model: 'Model estimate',
      gap: 'vs model',
      smartScore: 'Smart Score'
    }
    return `${countStr} · sorted by ${labels[sortColumn]} (${sortDir === 'asc' ? 'asc' : 'desc'})`
  }, [rows.length, activePersona, snapshotsReady, sortColumn, sortDir])

  const onSortHeader = useCallback(
    (col) => {
      // Persona overrides manual sort. Disable header clicks while a persona is active (BUG-123).
      if (activePersona) return
      setSortColumn((prev) => {
        if (prev === col) {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
          return prev
        }
        setSortDir(col === 'address' ? 'asc' : 'desc')
        return col
      })
    },
    [activePersona]
  )

  const handlePersonaClick = useCallback((id) => {
    setActivePersona((prev) => (prev === id ? null : id))
    const el = tableRef.current
    if (el) {
      el.classList.add('shortlist-reranking')
      window.setTimeout(() => el.classList.remove('shortlist-reranking'), 400)
    }
  }, [])

  const personaColKey = activePersona ? personaHighlightColumn(activePersona) : null

  const thBase =
    'px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors'
  const personaThHighlight = (col) =>
    activePersona && (personaColKey === col || (col === 'gap' && personaColKey === 'vsmodel'))

  const thBtn = (col, align = 'left') =>
    `${thBase} ${activePersona ? 'cursor-default' : 'cursor-pointer hover:text-foreground'} select-none ${
      sortColumn === col && !activePersona
        ? 'border-b-2 border-primary text-primary'
        : 'border-b border-transparent'
    } ${align === 'right' ? 'text-right' : ''} ${
      personaThHighlight(col) ? 'border-b-2 border-primary/70 text-primary' : ''
    }`

  const smartScoresLoading = !wishlistDetailsSettled && rows.length > 0

  return (
    <div className="space-y-4">
      {loadErr && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadErr}</div>
      )}

      {rows.length === 0 && !loadErr ? (
        <Card className="py-24">
          <CardContent className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 text-4xl" aria-hidden>🏠</div>
            <p className="text-base font-medium text-foreground">No listings saved yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Use the browser extension on PropertyGuru or the Buyer page to save listings here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Shortlist</h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{headerSubtitle}</p>
            </div>
            <div
              className="inline-flex rounded-full bg-muted p-1"
              role="tablist"
              aria-label="Shortlist layout"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mainView === 'table'}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${
                  mainView === 'table'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMainView('table')}
              >
                <LayoutGrid className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                Table
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainView === 'map'}
                disabled={!wishlistDetailsSettled}
                title={
                  !wishlistDetailsSettled
                    ? 'Loading listing details…'
                    : 'Map of saved listings and amenities'
                }
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
                  mainView === 'map'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMainView('map')}
              >
                <MapIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                Map
              </button>
            </div>
          </header>

          <Card className="py-0">
            {mainView === 'table' && (
              <>
                <div className="space-y-2 border-b border-border px-5 py-4">
                  <div className="flex flex-wrap gap-3">
                    {PERSONAS.map((p) => {
                      const active = activePersona === p.id
                      const variant = personaVariant(p.id)
                      const cls = active
                        ? variant.active
                        : 'border-border bg-card text-muted-foreground hover:-translate-y-0.5 hover:shadow-sm'
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={!snapshotsReady}
                          title={!snapshotsReady ? 'Loading listing snapshots…' : p.sortLabel}
                          onClick={() => handlePersonaClick(p.id)}
                          className={`flex h-12 min-w-[140px] max-w-[180px] flex-1 flex-col items-center justify-center rounded-xl border-[1.5px] text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${cls} ${active ? 'font-bold' : ''}`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span aria-hidden>{p.emoji}</span>
                            {p.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {activePersona && snapshotsReady && (
                    <div className="flex flex-wrap items-center gap-2 pl-0.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                        Persona: {PERSONAS.find((x) => x.id === activePersona)?.label}
                        <button
                          type="button"
                          className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
                          aria-label="Clear persona"
                          onClick={() => setActivePersona(null)}
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </span>
                      <p className="text-[12px] text-muted-foreground">
                        {PERSONAS.find((x) => x.id === activePersona)?.sortLabel} · column sort
                        disabled while persona is active
                      </p>
                    </div>
                  )}
                  {smartScoresLoading && (
                    <p className="text-[12px] text-muted-foreground" aria-live="polite">
                      <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/60" />
                      Computing smart scores…
                    </p>
                  )}
                </div>

                <div>
                  <table
                    ref={tableRef}
                    className="shortlist-table w-full border-collapse text-left"
                  >
                    <thead>
                      <tr className="border-b border-border">
                        <th className={thBtn('address')}>
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => onSortHeader('address')}
                            disabled={!!activePersona}
                          >
                            Address
                          </button>
                        </th>
                        <th className={`${thBase} w-[200px]`}>
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className={`text-left ${sortColumn === 'listing' && !activePersona ? 'text-primary' : ''} ${activePersona ? 'cursor-default' : ''}`}
                              onClick={() => onSortHeader('listing')}
                              disabled={!!activePersona}
                            >
                              Asking
                            </button>
                            <button
                              type="button"
                              className={`text-left ${sortColumn === 'model' && !activePersona ? 'text-primary' : ''} ${activePersona ? 'cursor-default' : ''}`}
                              onClick={() => onSortHeader('model')}
                              disabled={!!activePersona}
                            >
                              Model est.
                            </button>
                          </div>
                        </th>
                        <th className={thBtn('gap', 'right')}>
                          <button
                            type="button"
                            className="w-full text-right"
                            onClick={() => onSortHeader('gap')}
                            disabled={!!activePersona}
                          >
                            vs model
                          </button>
                        </th>
                        <th className={`${thBtn('smartScore')} w-[160px]`}>
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => onSortHeader('smartScore')}
                            disabled={!!activePersona}
                          >
                            Smart Score
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row, idx) => {
                        const g = gapPct(row.listing_price, row.predicted_price)
                        const sm = smartScores[row.id]
                        const personaTag =
                          activePersona && snapshotsReady
                            ? getPersonaTag(activePersona, snapshotsById[row.id])
                            : null
                        const tagLineCls = personaVariant(activePersona).tagText
                        const topAccent =
                          idx === 0 &&
                          snapshotsReady &&
                          (activePersona || (sortColumn === 'smartScore' && sortDir === 'desc'))
                        const absGap = g != null ? Math.abs(g) : 0
                        const barFill =
                          g == null ? 0 : Math.min(100, (Math.min(absGap, 30) / 30) * 100)
                        const barTone =
                          g == null
                            ? 'bg-muted'
                            : absGap <= 2
                              ? 'bg-muted-foreground/40'
                              : g < 0
                                ? 'bg-emerald-500'
                                : 'bg-red-400'
                        // BUG-119: Smart Score is the last cell. Tooltip must flip away from
                        // the right edge — anchor it left for the rightmost column.
                        const tooltipPos =
                          'pointer-events-none absolute right-full top-1/2 z-50 mr-3 w-56 -translate-y-1/2 rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/score:opacity-100'

                        return (
                          <tr
                            key={row.id}
                            className={`shortlist-row group cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50 ${
                              topAccent ? 'border-l-[3px] border-l-primary bg-primary/5' : ''
                            }`}
                            title={savedRowTitle(row)}
                            onClick={() => setSelectedId(row.id)}
                          >
                            <td className="min-w-0 px-5 py-4 align-top">
                              <div className="flex flex-wrap items-baseline gap-x-1.5">
                                {activePersona && idx === 0 && snapshotsReady ? (
                                  <span className="text-[10px] font-semibold text-primary">1st</span>
                                ) : null}
                                <span className="text-[14px] font-semibold leading-snug text-foreground">
                                  {row.display_label || row.address_short}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[12px] text-muted-foreground">
                                {row.town || '—'}
                                {row.created_at ? <> · Saved {formatRelativeTime(row.created_at)}</> : null}
                              </div>
                              {personaTag ? (
                                <span className={`mt-0.5 block text-xs font-medium ${tagLineCls}`}>
                                  {personaTag}
                                </span>
                              ) : null}
                            </td>
                            <td className="w-[200px] px-5 py-4 align-top">
                              <div className="text-[14px] text-foreground">
                                {row.listing_price != null
                                  ? `S$${Math.round(row.listing_price).toLocaleString()}`
                                  : '—'}{' '}
                                <span className="text-[12px] font-normal text-muted-foreground">asking</span>
                              </div>
                              <div className="mt-0.5 text-[13px] font-medium text-primary/90">
                                S${Math.round(row.predicted_price).toLocaleString()}{' '}
                                <span className="text-[12px] font-normal text-muted-foreground">model est.</span>
                              </div>
                            </td>
                            <td className="w-[90px] px-3 py-4 align-middle text-right">
                              {g == null ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <div className="inline-flex flex-col items-end gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <div className="h-1.5 w-8 overflow-hidden rounded-full bg-muted">
                                      <div className={`h-full rounded-full ${barTone}`} style={{ width: `${barFill}%` }} />
                                    </div>
                                    <span
                                      className={`text-sm font-semibold tabular-nums ${
                                        Math.abs(g) <= 2
                                          ? 'text-muted-foreground'
                                          : g < 0
                                            ? 'text-emerald-600'
                                            : 'text-red-500'
                                      }`}
                                    >
                                      {Math.abs(g) <= 2 ? <>≈ {g.toFixed(1)}%</> : g < 0 ? <>↓ {g.toFixed(1)}%</> : <>↑ +{g.toFixed(1)}%</>}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="relative w-[160px] px-5 py-4 align-middle">
                              {sm ? (
                                <div className="group/score relative flex justify-end">
                                  <div className={tooltipPos}>
                                    <p className="text-xs leading-relaxed text-muted-foreground">{sm.reason}</p>
                                    <div className="mt-2 space-y-1">
                                      <ScoreBar label="Price vs model" value={sm.components?.priceScore ?? 0} max={50} />
                                      <ScoreBar label="Comparable sales" value={sm.components?.compScore ?? 0} max={35} />
                                      <ScoreBar label="Lease quality" value={sm.components?.leaseScore ?? 0} max={15} />
                                    </div>
                                    {(() => {
                                      const f = sm.components?.flags || {}
                                      const bits = []
                                      if (f.apriori > 0) bits.push(`🚩 ${f.apriori} rule violation${f.apriori > 1 ? 's' : ''}`)
                                      if (f.wideBand) bits.push('⚠️ wide confidence band')
                                      if (f.fewComps) bits.push('⚠️ few comps')
                                      return bits.length ? (
                                        <div className="mt-2 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                                          {bits.map((b) => (
                                            <div key={b}>{b}</div>
                                          ))}
                                        </div>
                                      ) : null
                                    })()}
                                  </div>
                                  {sm.badge.color === 'green' ? (
                                    <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
                                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                      {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}{sm.score}
                                    </div>
                                  ) : sm.badge.color === 'amber' ? (
                                    <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-sm font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
                                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                                      {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}{sm.score}
                                    </div>
                                  ) : sm.badge.color === 'slate' ? (
                                    <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-semibold text-foreground ring-1 ring-border">
                                      <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                                      {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}{sm.score}
                                    </div>
                                  ) : (
                                    <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-red-50 px-3 text-sm font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900">
                                      <span className="h-2 w-2 rounded-full bg-red-400" />
                                      {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}{sm.score}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="ml-auto h-7 w-24 rounded-full bg-muted" aria-hidden />
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {mainView === 'map' && (
              <div className="pb-2 pt-1">
                {!wishlistDetailsSettled ? (
                  <p className="px-4 py-3 text-[13px] text-muted-foreground">Loading map data…</p>
                ) : (
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <aside className="w-full shrink-0 space-y-3 rounded-xl border border-border bg-card p-3 lg:max-h-[560px] lg:w-72 lg:overflow-y-auto">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-[11px] font-medium text-primary underline decoration-primary/50 hover:text-primary/80"
                          onClick={selectAllMapPins}
                        >
                          Select all with pin
                        </button>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-muted-foreground underline hover:text-foreground"
                          onClick={clearMapPins}
                        >
                          Clear
                        </button>
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Checked listings show a numbered pin and merge amenities (deduplicated, capped) into the map. Default category is All.
                      </p>
                      <ul className="space-y-2.5">
                        {rows.map((row) => {
                          const hasPin = geocodeById[row.id]?.found
                          return (
                            <li key={row.id}>
                              <label
                                className={`flex cursor-pointer items-start gap-2 text-[12px] ${
                                  !hasPin ? 'cursor-not-allowed opacity-55' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5 shrink-0"
                                  disabled={!hasPin}
                                  checked={hasPin && mapSelectedIds.has(row.id)}
                                  onChange={() => toggleMapRow(row.id)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="line-clamp-2 font-medium text-foreground">
                                    {row.display_label || row.address_short}
                                  </span>
                                  {!hasPin ? (
                                    <span className="mt-0.5 block text-[10px] text-amber-700 dark:text-amber-300">
                                      No saved map pin
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </aside>
                    <div className="min-w-0 flex-1">
                      <ShortlistMapView
                        rows={rows}
                        geocodeById={geocodeById}
                        nearbyById={nearbyById}
                        selectedListingIds={mapSelectedIds}
                        onOpenListing={setSelectedId}
                        gapPct={gapPct}
                      />
                      {noGeocodeCount > 0 ? (
                        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                          {noGeocodeCount} listing(s) have no saved address pin. Save from Buyer or the extension with block and street so geocode and amenities are stored.
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {selectedId != null && (
        <ShortlistDetailModal
          itemId={selectedId}
          username={u}
          onClose={() => setSelectedId(null)}
          onRemoved={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
        />
      )}
    </div>
  )
}
