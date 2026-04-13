import { describe, it, expect } from 'vitest'
import {
  aprioriPointsFromValidate,
  computeScoreComponents,
  sumComponents,
  getBadge,
  smartScoreComplete,
  smartScoreBreakdownTitle,
  generateReason,
  fundamentalsScoreFromShap
} from './smartScore.js'

const emptySnap = {
  listing_price: null,
  model_estimate: null,
  cbr_matches: [],
  shap_values: {}
}

describe('SS-1 neutral fallbacks', () => {
  it('aprioriPointsFromValidate returns null without apriori', () => {
    expect(aprioriPointsFromValidate(null)).toBeNull()
    expect(aprioriPointsFromValidate({})).toBeNull()
  })

  it('all missing SS-1 inputs: zeros, no ~40 padding, incomplete badge', () => {
    const c = computeScoreComponents(emptySnap, aprioriPointsFromValidate(null))
    expect(c.valueGapScore).toBe(0)
    expect(c.cbrScore).toBe(0)
    expect(c.aprioriScore).toBe(0)
    expect(c.avgCBR).toBeNull()
    expect(c.presence).toEqual({
      valueGap: false,
      cbr: false,
      apriori: false
    })
    const score = sumComponents(c)
    expect(score).toBe(0)
    expect(score).not.toBe(40)
    expect(smartScoreComplete(c)).toBe(false)
    expect(getBadge(score, { complete: false }).label).toBe('Incomplete')
  })

  it('apriori only on empty snap: 25 points from rules', () => {
    const pts = aprioriPointsFromValidate({ apriori: { violation_count: 0 } })
    const c = computeScoreComponents(emptySnap, pts)
    expect(c.aprioriScore).toBe(25)
    expect(c.presence.apriori).toBe(true)
    expect(c.presence.valueGap).toBe(false)
    expect(c.presence.cbr).toBe(false)
    expect(sumComponents(c)).toBe(25)
  })

  it('value gap only: presence flags', () => {
    const snap = {
      listing_price: 500_000,
      model_estimate: 480_000,
      cbr_matches: [],
      shap_values: {}
    }
    const c = computeScoreComponents(snap, aprioriPointsFromValidate(null))
    expect(c.presence.valueGap).toBe(true)
    expect(c.presence.apriori).toBe(false)
    expect(c.presence.cbr).toBe(false)
  })

  it('CBR only: avgCBR and presence', () => {
    const snap = {
      listing_price: null,
      model_estimate: null,
      cbr_matches: [{ match_score: 80 }],
      shap_values: {}
    }
    const c = computeScoreComponents(snap, aprioriPointsFromValidate(null))
    expect(c.presence.cbr).toBe(true)
    expect(c.avgCBR).toBe(80)
    expect(c.presence.valueGap).toBe(false)
  })

  it('smartScoreBreakdownTitle shows dashes and partial prefix when incomplete', () => {
    const c = computeScoreComponents(emptySnap, null)
    const t = smartScoreBreakdownTitle(c)
    expect(t).toContain('Partial score — some inputs missing.')
    expect(t).toContain('—')
  })

  it('generateReason avoids false gap/comparables when presence all false', () => {
    const c = computeScoreComponents(emptySnap, null)
    const text = generateReason(emptySnap, c)
    expect(text).not.toContain('Listed close to model estimate.')
    expect(text).not.toContain('Comparables strongly')
    expect(text).not.toContain('Comparables partially')
    expect(text).not.toContain('Limited comparable support.')
    expect(text).toContain('Listing vs model comparison unavailable.')
    expect(text).toContain('Comparable data unavailable.')
    expect(text).toContain('Rule validation unavailable.')
  })
})

describe('SS-2 fundamentalsScore normalization', () => {
  const aprioriFull = aprioriPointsFromValidate({ apriori: { violation_count: 0 } })

  it('large transaction_year does not collapse fundamentals when school/MRT are typical', () => {
    const snap = {
      listing_price: null,
      model_estimate: null,
      cbr_matches: [],
      shap_values: {
        transaction_year: 114_626,
        primary_school_quality_1km_weighted: 800,
        dist_to_mrt_m: 6100
      }
    }
    const c = computeScoreComponents(snap, aprioriFull)
    expect(c.fundamentalsScore).toBeGreaterThanOrEqual(8)
    expect(c.fundamentalsScore).toBeLessThanOrEqual(20)
  })

  it('only non-fundamentals SHAP => fundamentals 0', () => {
    const snap = {
      listing_price: null,
      model_estimate: null,
      cbr_matches: [],
      shap_values: { transaction_year: 114_626, floor_area_sqm: 60_000 }
    }
    expect(fundamentalsScoreFromShap(snap.shap_values)).toBe(0)
  })

  it('only school + MRT near global means: positive and capped at 20', () => {
    const shap = {
      primary_school_quality_1km_weighted: 799.855357773304,
      dist_to_mrt_m: 6107.952041177154
    }
    const f = fundamentalsScoreFromShap(shap)
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThanOrEqual(20)
    expect(f).toBeCloseTo(10, 0)
  })

  it('dist_to_nearest_school_m only uses dist_to_nearest_school_m mean', () => {
    const mean = 1847.5196939516068
    const shap = { dist_to_nearest_school_m: mean }
    const f = fundamentalsScoreFromShap(shap)
    expect(Number.isFinite(f)).toBe(true)
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThanOrEqual(20)
    expect(f).toBeCloseTo(5, 0)
  })

  it('same school/MRT fundamentals independent of transaction_year magnitude', () => {
    const base = {
      primary_school_quality_1km_weighted: 800,
      dist_to_mrt_m: 6100
    }
    const a = fundamentalsScoreFromShap({
      transaction_year: 100_000,
      ...base
    })
    const b = fundamentalsScoreFromShap({
      transaction_year: 250_000,
      ...base
    })
    expect(a).toBe(b)
  })
})
