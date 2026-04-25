import { describe, it, expect } from 'vitest'
import {
  snapshotsReadyForPersonas,
  personaHighlightColumn
} from './shortlistPersonaUtils.js'

describe('UI-1 snapshotsReadyForPersonas', () => {
  it('false when no rows', () => {
    expect(snapshotsReadyForPersonas([], {})).toBe(false)
    expect(snapshotsReadyForPersonas(null, {})).toBe(false)
  })

  it('false when rows exist but no snapshots loaded', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    expect(snapshotsReadyForPersonas(rows, {})).toBe(false)
    expect(snapshotsReadyForPersonas(rows, { 1: null })).toBe(false)
  })

  it('true when at least one row has a snapshot', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const snaps = { 1: { shap_values: {} } }
    expect(snapshotsReadyForPersonas(rows, snaps)).toBe(true)
  })

  it('true if any row loaded even when another missing', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const snaps = { 2: { shap_values: {} } }
    expect(snapshotsReadyForPersonas(rows, snaps)).toBe(true)
  })
})

describe('UI-2 personaHighlightColumn', () => {
  it('commuter highlights address column key', () => {
    expect(personaHighlightColumn('commuter')).toBe('address')
  })

  it('family address, investor vsmodel', () => {
    expect(personaHighlightColumn('family')).toBe('address')
    expect(personaHighlightColumn('investor')).toBe('vsmodel')
  })
})
