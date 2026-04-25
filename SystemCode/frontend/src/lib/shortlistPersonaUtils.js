/**
 * Pure helpers for Shortlist persona UI (testable without React).
 */

/** Personas enabled once at least one row has a loaded wishlist detail snapshot. */
export function snapshotsReadyForPersonas(rows, snapshotsById) {
  if (!rows?.length) return false
  return rows.some((r) => snapshotsById[r.id] != null)
}

/** Which table column key gets the emerald header highlight for the active persona. */
export function personaHighlightColumn(persona) {
  const map = {
    family: 'address',
    commuter: 'address',
    investor: 'vsmodel'
  }
  return map[persona] ?? null
}
