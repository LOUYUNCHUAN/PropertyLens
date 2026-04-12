import { describe, it, expect } from 'vitest'
import {
  INVESTOR_STABLE_FEATURES,
  investorFundamentalsSignal,
  investorScore,
  investorTag,
  commuterScore,
  commuterTag
} from './personas.js'

const baseInvestorSnap = {
  listing_price: 400_000,
  model_estimate: 400_000,
  cbr_matches: [{ match_score: 50 }],
  shap_values: {}
}

describe('INV-1 stableFeatures mall key', () => {
  it('does not use invalid dist_to_nearest_mall_m in stable list', () => {
    expect(INVESTOR_STABLE_FEATURES).not.toContain('dist_to_nearest_mall_m')
    expect(INVESTOR_STABLE_FEATURES).toContain('mall_weighted_access_3km')
  })

  it('investorScore increases when mall_weighted_access_3km is the only extra stable SHAP', () => {
    const withoutMall = {
      ...baseInvestorSnap,
      shap_values: {
        transaction_year: 50_000,
        primary_school_quality_1km_weighted: 400
      }
    }
    const withMall = {
      ...baseInvestorSnap,
      shap_values: {
        ...withoutMall.shap_values,
        mall_weighted_access_3km: 10_102
      }
    }
    expect(investorScore(withMall)).toBeGreaterThan(investorScore(withoutMall))
  })
})

describe('INV-2 normalized investor fundamentals', () => {
  const richStableSnap = {
    ...baseInvestorSnap,
    shap_values: {
      transaction_year: 114_626,
      primary_school_quality_1km_weighted: 800,
      dist_to_mrt_m: 6108,
      floor_area_sqm: 60_854,
      lease_remaining_years: 39_477,
      mall_weighted_access_3km: 10_102
    }
  }

  it('fundamentalsSignal not collapsed to ~0 when transaction_year is huge but stables are typical', () => {
    const sig = investorFundamentalsSignal(richStableSnap)
    expect(sig).toBeGreaterThan(0.05)
  })

  it('fundamentalsSignal changes modestly when only transaction_year raw magnitude changes', () => {
    const a = investorFundamentalsSignal({
      ...richStableSnap,
      shap_values: { ...richStableSnap.shap_values, transaction_year: 80_000 }
    })
    const b = investorFundamentalsSignal({
      ...richStableSnap,
      shap_values: { ...richStableSnap.shap_values, transaction_year: 150_000 }
    })
    expect(Math.abs(a - b)).toBeLessThan(0.35)
    expect(a).toBeGreaterThan(0.05)
    expect(b).toBeGreaterThan(0.05)
  })
})

describe('INV-3 investorTag by fundamentalsSignal', () => {
  it('shows fundamentals-driven when signal high', () => {
    const snap = {
      ...baseInvestorSnap,
      shap_values: {
        primary_school_quality_1km_weighted: 2400,
        dist_to_mrt_m: 18_000,
        floor_area_sqm: 120_000,
        lease_remaining_years: 80_000,
        mall_weighted_access_3km: 20_000,
        transaction_year: 30_000
      }
    }
    expect(investorTag(snap)).toContain('✓ fundamentals-driven')
  })

  it('shows mixed drivers in middle band', () => {
    const snap = {
      ...baseInvestorSnap,
      shap_values: {
        primary_school_quality_1km_weighted: 400,
        dist_to_mrt_m: 3054,
        floor_area_sqm: 30_427,
        lease_remaining_years: 19_738,
        mall_weighted_access_3km: 5051,
        transaction_year: 229_252
      }
    }
    const sig = investorFundamentalsSignal(snap)
    expect(sig).toBeGreaterThan(0.1)
    expect(sig).toBeLessThanOrEqual(0.3)
    expect(investorTag(snap)).toContain('~ mixed drivers')
  })

  it('shows timing dominant when signal is low', () => {
    const snap = {
      ...baseInvestorSnap,
      shap_values: {
        transaction_year: 500_000,
        primary_school_quality_1km_weighted: 50
      }
    }
    expect(investorFundamentalsSignal(snap)).toBeLessThanOrEqual(0.1)
    expect(investorTag(snap)).toContain('⚠️ Market timing dominant')
    expect(investorTag(snap)).toContain('normalized')
  })
})

describe('COM-1 commuter MRT sign', () => {
  it('higher score when dist_to_mrt_m SHAP is positive vs negative (all else equal)', () => {
    const positive = { shap_values: { dist_to_mrt_m: 3000 } }
    const negative = { shap_values: { dist_to_mrt_m: -3000 } }
    expect(commuterScore(positive)).toBeGreaterThan(commuterScore(negative))
  })
})

describe('COM-2 commuter highway term removed', () => {
  it('score depends only on MRT SHAP; highway SHAP does not change score', () => {
    const base = { shap_values: { dist_to_mrt_m: 1000 } }
    const withHighwayNeg = {
      shap_values: { dist_to_mrt_m: 1000, dist_to_highway_m: -5000 }
    }
    const withHighwayPos = {
      shap_values: { dist_to_mrt_m: 1000, dist_to_highway_m: 5000 }
    }
    expect(commuterScore(base)).toBe(commuterScore(withHighwayNeg))
    expect(commuterScore(base)).toBe(commuterScore(withHighwayPos))
  })

  it('commuterTag still works', () => {
    const snap = {
      shap_values: { dist_to_mrt_m: 1 },
      nearby: { mrt: [{ name: 'NS1', dist_m: 300 }] }
    }
    expect(commuterTag(snap)).toMatch(/NS1/)
  })
})
