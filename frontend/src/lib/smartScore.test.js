import { describe, it, expect } from 'vitest'
import {
  aprioriViolationCount,
  computeScoreComponents,
  sumComponents,
  getBadge,
  smartScoreComplete,
  smartScoreBreakdownTitle,
  generateReason,
  priceVsModelScore,
  compAgreementScore,
  leaseQualityScore
} from './smartScore.js'

const emptySnap = {
  listing_price: null,
  model_estimate: null,
  cbr_matches: [],
  shap_values: {},
  remaining_lease_years: null
}

describe('SS-1 neutral fallbacks', () => {
  it('aprioriViolationCount returns null without apriori block', () => {
    expect(aprioriViolationCount(null)).toBeNull()
    expect(aprioriViolationCount({})).toBeNull()
    expect(aprioriViolationCount({ apriori: { violation_count: 2 } })).toBe(2)
  })

  it('all missing inputs: zeros, incomplete badge, no padding', () => {
    const c = computeScoreComponents(emptySnap, null)
    expect(c.priceScore).toBe(0)
    expect(c.compScore).toBe(0)
    expect(c.leaseScore).toBe(0)
    expect(c.presence).toEqual({ price: false, comps: false, lease: false })
    const score = sumComponents(c)
    expect(score).toBe(0)
    expect(smartScoreComplete(c)).toBe(false)
    expect(getBadge(score, { complete: false }).label).toBe('Incomplete')
  })

  it('breakdown title shows dashes and partial prefix when incomplete', () => {
    const c = computeScoreComponents(emptySnap, null)
    const t = smartScoreBreakdownTitle(c)
    expect(t).toContain('Partial score — some inputs missing.')
    expect(t).toContain('—')
  })
})

describe('SS-2 Price vs model pillar', () => {
  it('peaks at -5% below model and respects confidence', () => {
    const snap = {
      listing_price: 475_000,
      model_estimate: 500_000,
      confidence_low: 480_000,
      confidence_high: 520_000
    }
    const { score, present, gap } = priceVsModelScore(snap)
    expect(present).toBe(true)
    expect(gap).toBeCloseTo(-0.05, 3)
    // 8% band → confTrust = 0.92 → ~46
    expect(score).toBeGreaterThan(40)
    expect(score).toBeLessThanOrEqual(50)
  })

  it('hits zero around +15% over model', () => {
    const snap = {
      listing_price: 575_000,
      model_estimate: 500_000
    }
    const { score } = priceVsModelScore(snap)
    expect(score).toBe(0)
  })

  it('wide confidence band shrinks the score', () => {
    const tight = priceVsModelScore({
      listing_price: 500_000,
      model_estimate: 500_000,
      confidence_low: 495_000,
      confidence_high: 505_000
    })
    const wide = priceVsModelScore({
      listing_price: 500_000,
      model_estimate: 500_000,
      confidence_low: 400_000,
      confidence_high: 600_000
    })
    expect(wide.score).toBeLessThan(tight.score)
    expect(wide.confTrust).toBeCloseTo(0.6, 1)
  })

  it('missing listing or predicted: not present', () => {
    expect(priceVsModelScore({ listing_price: null, model_estimate: 500_000 }).present).toBe(false)
    expect(priceVsModelScore({ listing_price: 500_000, model_estimate: 0 }).present).toBe(false)
  })
})

describe('SS-3 Comp agreement pillar', () => {
  it('comps agree → high score', () => {
    const snap = {
      listing_price: 500_000,
      cbr_matches: [
        { resale_price: 495_000 },
        { resale_price: 505_000 },
        { resale_price: 500_000 }
      ]
    }
    const { score, present, usableComps } = compAgreementScore(snap)
    expect(present).toBe(true)
    expect(usableComps).toBe(3)
    expect(score).toBeCloseTo(35, 0)
  })

  it('listing well above comps → low score', () => {
    const snap = {
      listing_price: 600_000,
      cbr_matches: [
        { resale_price: 500_000 },
        { resale_price: 505_000 },
        { resale_price: 495_000 }
      ]
    }
    const { score } = compAgreementScore(snap)
    expect(score).toBeLessThan(15)
  })

  it('few comps soft-penalty', () => {
    const snap = {
      listing_price: 500_000,
      cbr_matches: [{ resale_price: 500_000 }]
    }
    const { score, usableComps } = compAgreementScore(snap)
    expect(usableComps).toBe(1)
    expect(score).toBeCloseTo(35 / 3, 1)
  })

  it('no resale prices: not present', () => {
    const snap = {
      listing_price: 500_000,
      cbr_matches: [{ match_score: 90 }, { match_score: 88 }]
    }
    const { present, score } = compAgreementScore(snap)
    expect(present).toBe(false)
    expect(score).toBe(0)
  })
})

describe('SS-4 Lease quality pillar', () => {
  it('95-year lease → 15', () => {
    expect(leaseQualityScore({ remaining_lease_years: 95 }).score).toBe(15)
  })
  it('60-year lease → 10', () => {
    expect(leaseQualityScore({ remaining_lease_years: 60 }).score).toBeCloseTo(10, 1)
  })
  it('40-year lease → 5', () => {
    expect(leaseQualityScore({ remaining_lease_years: 40 }).score).toBeCloseTo(5, 1)
  })
  it('25-year lease → 0', () => {
    expect(leaseQualityScore({ remaining_lease_years: 25 }).score).toBe(0)
  })
  it('missing lease: not present', () => {
    expect(leaseQualityScore({ remaining_lease_years: null }).present).toBe(false)
  })
})

describe('SS-5 flags', () => {
  it('apriori violations surface as flag, not a score deduction', () => {
    const snap = {
      listing_price: 500_000,
      model_estimate: 500_000,
      cbr_matches: [
        { resale_price: 500_000 },
        { resale_price: 500_000 },
        { resale_price: 500_000 }
      ],
      remaining_lease_years: 90
    }
    const clean = computeScoreComponents(snap, 0)
    const dirty = computeScoreComponents(snap, 3)
    expect(sumComponents(clean)).toBe(sumComponents(dirty))
    expect(dirty.flags.apriori).toBe(3)
    expect(clean.flags.apriori).toBe(0)
  })

  it('few-comps flag set when usable comps < 3', () => {
    const snap = {
      listing_price: 500_000,
      model_estimate: 500_000,
      cbr_matches: [{ resale_price: 500_000 }],
      remaining_lease_years: 90
    }
    const c = computeScoreComponents(snap, 0)
    expect(c.flags.fewComps).toBe(true)
  })
})

describe('SS-6 badge thresholds', () => {
  it('strong deal at ≥75', () => {
    expect(getBadge(75).label).toBe('Strong deal')
    expect(getBadge(74).label).toBe('Fair')
  })
  it('overpriced below 50', () => {
    expect(getBadge(49).label).toBe('Overpriced')
    expect(getBadge(50).label).toBe('Fair')
  })
})

describe('SS-7 generateReason', () => {
  it('avoids false claims when all presence flags are false', () => {
    const c = computeScoreComponents(emptySnap, null)
    const text = generateReason(emptySnap, c)
    expect(text).toContain('Listing vs model comparison unavailable.')
    expect(text).toContain('No comparable sales available.')
  })
})
