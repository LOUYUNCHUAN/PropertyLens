import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  aprioriPointsFromValidate,
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
import { Home, LayoutGrid, Map as MapIcon, Puzzle } from 'lucide-react'
import SHAPChart from '../components/SHAPChart.jsx'
import LocationMap from '../components/LocationMap.jsx'
import CBRTable from '../components/CBRTable.jsx'

/** e.g. "2 days ago" for tooltips */
function formatRelativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
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
  if (row.created_at) {
    parts.push(`Saved ${formatRelativeTime(row.created_at)}`)
  }
  const label = row.display_label || row.address_short
  if (label) parts.push(label)
  return parts.length ? parts.join(' · ') : undefined
}

function parseStoreyMid(storeyRange) {
  const s = String(storeyRange || '')
    .trim()
    .toUpperCase()
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

function ScoreBar({ label, value, max }) {
  const v = Number(value) || 0
  const pct = max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-emerald-600/75"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {Math.round(v)}
      </span>
    </div>
  )
}

/** Map backend badge label to dashboard copy (Overpriced → Weak). */
function badgePrimaryLabel(label) {
  if (label === 'Overpriced') return 'Weak'
  if (label === 'Incomplete') return 'Partial'
  return label
}

function ShortlistDetailModal({ itemId, username, onClose, onRemoved }) {
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState(null)

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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortlist-modal-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="bg-[color:var(--cream)] rounded-2xl shadow-2xl w-full max-h-[90vh] max-w-[min(96vw,1100px)] overflow-y-auto border border-[color:var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-[color:var(--border)] bg-[color:var(--cream)] z-10">
          <div>
            <h2
              id="shortlist-modal-title"
              className="text-lg font-semibold text-[color:var(--ink)]"
            >
              {detail?.display_label || 'Listing'}
            </h2>
            <p className="text-[11px] text-[color:var(--ink-muted)] mt-1">
              Snapshot from when you saved — model, map, and drivers are stored in your
              local database.
            </p>
            {detail && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-[color:var(--ink-muted)]">
                {String(detail.source || '').toLowerCase() === 'extension' ? (
                  <>
                    <span className="inline-flex items-center gap-1 font-medium text-[color:var(--ink)]">
                      <Puzzle className="w-3.5 h-3.5 shrink-0 text-violet-600" aria-hidden />
                      Extension
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-[color:var(--ink)]">
                    <Home className="w-3.5 h-3.5 shrink-0 text-emerald-700" aria-hidden />
                    Buyer
                  </span>
                )}
                {detail.created_at ? (
                  <span>
                    · saved {formatRelativeTime(detail.created_at)}
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 text-[color:var(--ink-muted)] hover:text-[color:var(--ink)] text-xl leading-none px-2"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">
              {err}
            </div>
          )}
          {!detail && !err && (
            <div className="text-sm text-[color:var(--ink-muted)]">Loading…</div>
          )}
          {detail && (
            <>
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div className="card !p-3">
                  <div className="text-[10px] uppercase text-[color:var(--ink-muted)]">
                    Model estimate
                  </div>
                  <div className="font-mono font-semibold text-lg">
                    S$
                    {Math.round(detail.predicted_price).toLocaleString()}
                  </div>
                  <div className="text-[11px] text-[color:var(--ink-muted)]">
                    {detail.confidence_low != null && detail.confidence_high != null
                      ? `S$${Math.round(detail.confidence_low).toLocaleString()} – S$${Math.round(detail.confidence_high).toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <div className="card !p-3">
                  <div className="text-[10px] uppercase text-[color:var(--ink-muted)]">
                    Listing price
                  </div>
                  <div className="font-mono font-semibold text-lg">
                    {detail.listing_price != null
                      ? `S$${Math.round(detail.listing_price).toLocaleString()}`
                      : '—'}
                  </div>
                  {gapPct(detail.listing_price, detail.predicted_price) != null && (
                    <div className="text-[11px] text-[color:var(--ink-muted)]">
                      {gapPct(detail.listing_price, detail.predicted_price).toFixed(1)}%
                      vs model
                    </div>
                  )}
                </div>
              </div>

              {detail.listing_url && (
                <a
                  href={detail.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-[color:var(--green-600)] underline"
                >
                  Open original listing
                </a>
              )}

              <div className="card overflow-hidden">
                <div className="section-label mb-2">Location & amenities</div>
                <div className="rounded-xl border border-[color:var(--border)] overflow-hidden">
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

              <div className="card">
                <div className="section-label mb-2">Price drivers (SHAP)</div>
                {detail.shap_snapshot_json?.length ? (
                  <SHAPChart shapValues={detail.shap_snapshot_json} maxFeatures={12} />
                ) : (
                  <p className="text-[12px] text-[color:var(--ink-muted)]">
                    No SHAP snapshot stored for this row.
                  </p>
                )}
              </div>

              <div className="card">
                <div className="section-label mb-2">Similar past sales</div>
                <CBRTable comparables={detail.cbr_snapshot_json || []} />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="text-[12px] px-3 py-2 rounded-lg border border-[color:var(--border)] text-[color:var(--ink-muted)] hover:bg-[color:var(--bg-sidebar)]"
                  onClick={onClose}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="text-[12px] px-3 py-2 rounded-lg bg-red-50 text-red-800 border border-red-200 hover:bg-red-100"
                  onClick={async () => {
                    if (!window.confirm('Remove this listing from your shortlist?')) return
                    try {
                      await deleteWishlistItem(detail.id, username)
                      onRemoved?.(detail.id)
                      onClose()
                    } catch {
                      window.alert('Could not remove item.')
                    }
                  }}
                >
                  Remove from shortlist
                </button>
              </div>
            </>
          )}
        </div>
      </div>
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
  const tableRef = useRef(null)

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
      /* Smart score + personas: each row uses GET /api/wishlist/items/{id} (not the list DTO).
         Snapshots: shap_snapshot_json, cbr_snapshot_json, map_snapshot_json.nearby */
      try {
        const settled = await Promise.allSettled(
          rows.map((r) => getWishlistItem(r.id, u))
        )
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
          const aprioriPts = aprioriPointsFromValidate(validates[i])
          const components = computeScoreComponents(snap, aprioriPts)
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
    const geocodedIds = rows
      .map((r) => r.id)
      .filter((id) => geocodeById[id]?.found)
    setMapSelectedIds((prev) => {
      if (!mapSelectionInitRef.current) {
        mapSelectionInitRef.current = true
        return new Set(geocodedIds)
      }
      const geoSet = new Set(geocodedIds)
      const next = new Set()
      for (const id of prev) {
        if (geoSet.has(id)) next.add(id)
      }
      for (const id of geocodedIds) {
        if (!prev.has(id)) next.add(id)
      }
      return next
    })
  }, [wishlistDetailsSettled, rows, geocodeById])

  const toggleMapRow = useCallback((id) => {
    if (!geocodeById[id]?.found) return
    setMapSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [geocodeById])

  const selectAllMapPins = useCallback(() => {
    setMapSelectedIds(
      new Set(rows.filter((r) => geocodeById[r.id]?.found).map((r) => r.id))
    )
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
        .map((row) => ({
          row,
          score: getPersonaScore(activePersona, snapshotsById[row.id])
        }))
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
          const sa = String(a.display_label || a.address_short || '')
            .toLowerCase()
          const sb = String(b.display_label || b.address_short || '')
            .toLowerCase()
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
          const na =
            ga ??
            (sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
          const nb =
            gb ??
            (sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
          return mul * (na - nb)
        }
        case 'smartScore':
        default:
          return (
            mul *
            ((smartScores[b.id]?.score ?? -1) - (smartScores[a.id]?.score ?? -1))
          )
      }
    })
    return sorted
  }, [
    rows,
    activePersona,
    snapshotsReady,
    snapshotsById,
    sortColumn,
    sortDir,
    smartScores
  ])

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

  const onSortHeader = useCallback((col) => {
    setActivePersona(null)
    setSortColumn((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(col === 'address' ? 'asc' : 'desc')
      return col
    })
  }, [])

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
    activePersona &&
    (personaColKey === col || (col === 'gap' && personaColKey === 'vsmodel'))

  const thBtn = (col, align = 'left') =>
    `${thBase} cursor-pointer select-none hover:text-foreground ${
      sortColumn === col && !activePersona
        ? 'border-b-2 border-emerald-600 text-emerald-800'
        : 'border-b border-transparent'
    } ${align === 'right' ? 'text-right' : ''} ${
      personaThHighlight(col) ? 'border-b-2 border-emerald-500/70 text-emerald-900' : ''
    }`

  return (
    <div className="space-y-4 bg-background">
      {loadErr && (
        <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">
          {loadErr}
        </div>
      )}

      {rows.length === 0 && !loadErr ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white py-24 text-center">
          <div className="mb-4 text-4xl" aria-hidden>
            🏠
          </div>
          <p className="text-base font-medium text-foreground">No listings saved yet</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Use the browser extension on PropertyGuru or the Buyer page to save listings
            here.
          </p>
        </div>
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Shortlist
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{headerSubtitle}</p>
            </div>
            <div
              className="inline-flex rounded-full bg-muted/60 p-1"
              role="tablist"
              aria-label="Shortlist layout"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mainView === 'table'}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${
                  mainView === 'table'
                    ? 'bg-[#3d7a4f] text-white shadow-sm'
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
                    ? 'bg-[#3d7a4f] text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMainView('map')}
              >
                <MapIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                Map
              </button>
            </div>
          </header>

          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            {mainView === 'table' && (
              <>
                <div className="space-y-2 border-b border-gray-100 px-5 py-4">
                  <div className="flex flex-wrap gap-3">
                    {PERSONAS.map((p) => {
                      const active = activePersona === p.id
                      const cardCls =
                        p.id === 'family'
                          ? active
                            ? 'border-blue-300 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-600 hover:shadow-sm hover:-translate-y-0.5'
                          : p.id === 'commuter'
                            ? active
                              ? 'border-violet-300 bg-violet-50 text-violet-700 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-600 hover:shadow-sm hover:-translate-y-0.5'
                            : active
                              ? 'border-amber-300 bg-amber-50 text-amber-700 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-600 hover:shadow-sm hover:-translate-y-0.5'
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={!snapshotsReady}
                          title={
                            !snapshotsReady
                              ? 'Loading listing snapshots…'
                              : p.sortLabel
                          }
                          onClick={() => handlePersonaClick(p.id)}
                          className={`flex h-12 w-[140px] flex-col items-center justify-center rounded-xl border-[1.5px] text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${cardCls} ${
                            active ? 'font-bold' : ''
                          }`}
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
                    <p className="text-[12px] text-muted-foreground pl-0.5">
                      {PERSONAS.find((x) => x.id === activePersona)?.sortLabel}
                    </p>
                  )}
                </div>

                <div className="overflow-x-auto">
                <table
                  ref={tableRef}
                  className="shortlist-table w-full min-w-[720px] border-collapse text-left"
                >
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thBtn('address')}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => onSortHeader('address')}
                        >
                          Address
                        </button>
                      </th>
                      <th className={`${thBase} w-[200px]`}>
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            className={`text-left ${sortColumn === 'listing' && !activePersona ? 'text-emerald-800' : ''}`}
                            onClick={() => onSortHeader('listing')}
                          >
                            Asking
                          </button>
                          <button
                            type="button"
                            className={`text-left ${sortColumn === 'model' && !activePersona ? 'text-emerald-800' : ''}`}
                            onClick={() => onSortHeader('model')}
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
                        >
                          vs model
                        </button>
                      </th>
                      <th className={`${thBtn('smartScore')} w-[160px]`}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => onSortHeader('smartScore')}
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
                      const tagLineCls =
                        activePersona === 'family'
                          ? 'text-blue-600'
                          : activePersona === 'commuter'
                            ? 'text-violet-600'
                            : 'text-amber-600'
                      const topAccent =
                        idx === 0 &&
                        snapshotsReady &&
                        (activePersona ||
                          (sortColumn === 'smartScore' && sortDir === 'desc'))
                      const absGap = g != null ? Math.abs(g) : 0
                      const barFill =
                        g == null ? 0 : Math.min(100, (Math.min(absGap, 30) / 30) * 100)
                      const barTone =
                        g == null
                          ? 'bg-gray-200'
                          : absGap <= 2
                            ? 'bg-gray-300'
                            : g < 0
                              ? 'bg-emerald-500'
                              : 'bg-red-400'

                      return (
                        <tr
                          key={row.id}
                          className={`shortlist-row group cursor-pointer border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50/60 ${
                            topAccent ? 'border-l-[3px] border-l-emerald-400 bg-emerald-50/20' : ''
                          }`}
                          title={savedRowTitle(row)}
                          onClick={() => setSelectedId(row.id)}
                        >
                          <td className="min-w-0 px-5 py-4 align-top">
                            <div className="flex flex-wrap items-baseline gap-x-1.5">
                              {activePersona && idx === 0 && snapshotsReady ? (
                                <span className="text-[10px] font-semibold text-emerald-700">
                                  1st
                                </span>
                              ) : null}
                              <span className="text-[14px] font-semibold leading-snug text-[#111]">
                                {row.display_label || row.address_short}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[12px] text-muted-foreground">
                              {row.town || '—'}
                              {row.created_at ? (
                                <>
                                  {' '}
                                  · Saved {formatRelativeTime(row.created_at)}
                                </>
                              ) : null}
                            </div>
                            {personaTag ? (
                              <span
                                className={`mt-0.5 block text-xs font-medium ${tagLineCls}`}
                              >
                                {personaTag}
                              </span>
                            ) : null}
                          </td>
                          <td className="w-[200px] px-5 py-4 align-top">
                            <div className="text-[14px] text-gray-700">
                              {row.listing_price != null
                                ? `S$${Math.round(row.listing_price).toLocaleString()}`
                                : '—'}{' '}
                              <span className="text-[12px] font-normal text-muted-foreground">
                                asking
                              </span>
                            </div>
                            <div className="mt-0.5 text-[13px] font-medium text-emerald-800/90">
                              S$
                              {Math.round(row.predicted_price).toLocaleString()}{' '}
                              <span className="text-[12px] font-normal text-muted-foreground">
                                model est.
                              </span>
                            </div>
                          </td>
                          <td className="w-[90px] px-3 py-4 align-middle text-right">
                            {g == null ? (
                              <span className="text-sm text-gray-400">—</span>
                            ) : (
                              <div className="inline-flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="h-1.5 w-8 overflow-hidden rounded-full bg-gray-100">
                                    <div
                                      className={`h-full rounded-full ${barTone}`}
                                      style={{ width: `${barFill}%` }}
                                    />
                                  </div>
                                  <span
                                    className={`text-sm font-semibold tabular-nums ${
                                      Math.abs(g) <= 2
                                        ? 'text-gray-500'
                                        : g < 0
                                          ? 'text-emerald-600'
                                          : 'text-red-500'
                                    }`}
                                  >
                                    {Math.abs(g) <= 2 ? (
                                      <>≈ {g.toFixed(1)}%</>
                                    ) : g < 0 ? (
                                      <>
                                        ↓ {g.toFixed(1)}%
                                      </>
                                    ) : (
                                      <>
                                        ↑ +{g.toFixed(1)}%
                                      </>
                                    )}
                                  </span>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="relative w-[160px] px-5 py-4 align-middle">
                            {sm ? (
                              <div className="group/score relative flex justify-end">
                                <div
                                  className={`pointer-events-none absolute right-full top-1/2 z-50 mr-3 w-56 -translate-y-1/2 rounded-xl border border-border bg-white p-3 text-left opacity-0 shadow-lg transition-opacity group-hover/score:opacity-100`}
                                >
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    {sm.reason}
                                  </p>
                                  <div className="mt-2 space-y-1">
                                    <ScoreBar
                                      label="Value gap"
                                      value={sm.components?.valueGapScore ?? 0}
                                      max={30}
                                    />
                                    <ScoreBar
                                      label="CBR match"
                                      value={sm.components?.cbrScore ?? 0}
                                      max={25}
                                    />
                                    <ScoreBar
                                      label="Rules"
                                      value={sm.components?.aprioriScore ?? 0}
                                      max={25}
                                    />
                                    <ScoreBar
                                      label="Fundamentals"
                                      value={sm.components?.fundamentalsScore ?? 0}
                                      max={20}
                                    />
                                  </div>
                                </div>
                                {sm.badge.color === 'green' ? (
                                  <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                    {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}
                                    {sm.score}
                                  </div>
                                ) : sm.badge.color === 'amber' ? (
                                  <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-sm font-semibold text-amber-700 ring-1 ring-amber-200">
                                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                                    {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}
                                    {sm.score}
                                  </div>
                                ) : sm.badge.color === 'slate' ? (
                                  <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-slate-50 px-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-200">
                                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                                    {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}
                                    {sm.score}
                                  </div>
                                ) : (
                                  <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-red-50 px-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">
                                    <span className="h-2 w-2 rounded-full bg-red-400" />
                                    {badgePrimaryLabel(sm.badge.label)} · {sm.complete === false ? '~' : ''}
                                    {sm.score}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div
                                className="ml-auto h-7 w-24 animate-pulse rounded-full bg-gray-100"
                                aria-hidden
                              />
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
                  <p className="text-[13px] text-[color:var(--ink-muted)]">
                    Loading map data…
                  </p>
                ) : (
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <aside className="w-full shrink-0 space-y-3 rounded-xl border border-[color:var(--border)] bg-white p-3 lg:max-h-[560px] lg:w-72 lg:overflow-y-auto">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-[11px] font-medium text-emerald-800 underline decoration-emerald-600/50 hover:text-emerald-950"
                          onClick={selectAllMapPins}
                        >
                          Select all with pin
                        </button>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-[color:var(--ink-muted)] underline hover:text-[color:var(--ink)]"
                          onClick={clearMapPins}
                        >
                          Clear
                        </button>
                      </div>
                      <p className="text-[11px] leading-snug text-[color:var(--ink-muted)]">
                        Checked listings show a numbered pin and merge amenities (deduplicated,
                        capped) into the map. Default category is All.
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
                                  <span className="line-clamp-2 font-medium text-[color:var(--ink)]">
                                    {row.display_label || row.address_short}
                                  </span>
                                  {!hasPin ? (
                                    <span className="mt-0.5 block text-[10px] text-amber-900">
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
                        <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--ink-muted)]">
                          {noGeocodeCount} listing(s) have no saved address pin. Save from Buyer
                          or the extension with block and street so geocode and amenities are
                          stored.
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

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
