import { describe, it, expect } from 'vitest'
import {
  investorScore,
  investorTag,
  familyScore,
  commuterScore,
  commuterTag
} from './personas.js'

describe('FAM-1 family ranks by real nearby schools', () => {
  it('closer nearest school beats farther nearest school', () => {
    const close = { nearby: { school: [{ name: 'A', dist_m: 200 }] } }
    const far = { nearby: { school: [{ name: 'B', dist_m: 1200 }] } }
    expect(familyScore(close)).toBeGreaterThan(familyScore(far))
  })

  it('more schools within 1km beats fewer when nearest is the same', () => {
    const few = {
      nearby: { school: [{ name: 'A', dist_m: 400 }] }
    }
    const many = {
      nearby: {
        school: [
          { name: 'A', dist_m: 400 },
          { name: 'B', dist_m: 600 },
          { name: 'C', dist_m: 800 },
          { name: 'D', dist_m: 950 }
        ]
      }
    }
    expect(familyScore(many)).toBeGreaterThan(familyScore(few))
  })

  it('no schools nearby → 0', () => {
    expect(familyScore({ nearby: { school: [] } })).toBe(0)
    expect(familyScore({ nearby: null })).toBe(0)
    expect(familyScore({})).toBe(0)
  })
})

describe('COM-1 commuter ranks by real nearby MRT/LRT', () => {
  it('closer nearest MRT beats farther nearest MRT', () => {
    const close = { nearby: { mrt: [{ name: 'A', dist_m: 200 }] } }
    const far = { nearby: { mrt: [{ name: 'B', dist_m: 1000 }] } }
    expect(commuterScore(close)).toBeGreaterThan(commuterScore(far))
  })

  it('more stations within 1km beats fewer when nearest is the same', () => {
    const few = { nearby: { mrt: [{ name: 'A', dist_m: 400 }] } }
    const many = {
      nearby: {
        mrt: [
          { name: 'A', dist_m: 400 },
          { name: 'B', dist_m: 700 }
        ],
        lrt: [{ name: 'L1', dist_m: 900 }]
      }
    }
    expect(commuterScore(many)).toBeGreaterThan(commuterScore(few))
  })

  it('no MRT/LRT nearby → 0', () => {
    expect(commuterScore({ nearby: { mrt: [], lrt: [] } })).toBe(0)
    expect(commuterScore({ nearby: null })).toBe(0)
    expect(commuterScore({})).toBe(0)
  })

  it('commuterTag uses nearest MRT from nearby', () => {
    const snap = { nearby: { mrt: [{ name: 'NS1', dist_m: 300 }] } }
    expect(commuterTag(snap)).toMatch(/NS1/)
  })
})

describe('INV-1 investor uses Smart Score (deal quality)', () => {
  const baseSnap = {
    listing_price: 500_000,
    model_estimate: 500_000,
    cbr_matches: [
      { resale_price: 500_000 },
      { resale_price: 500_000 },
      { resale_price: 500_000 }
    ],
    remaining_lease_years: 90,
    shap_values: {}
  }

  it('a real bargain ranks higher than a fair-priced flat', () => {
    const bargain = { ...baseSnap, listing_price: 460_000 }
    expect(investorScore(bargain)).toBeGreaterThan(investorScore(baseSnap))
  })

  it('an overpriced flat ranks lower than a fair-priced flat', () => {
    const overpriced = { ...baseSnap, listing_price: 575_000 }
    expect(investorScore(overpriced)).toBeLessThan(investorScore(baseSnap))
  })

  it('investorTag shows price gap and comp position', () => {
    const tag = investorTag({ ...baseSnap, listing_price: 460_000 })
    expect(tag).toContain('below model')
  })
})
