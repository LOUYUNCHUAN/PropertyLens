import {
  assessMatch,
  humanizeConditions,
  humanizeOutcome
} from '@/lib/buyerExplain.js'
import { formatConfidenceBandK } from '@/lib/formatPrice.js'

/** Normalize outcome strings from rules / humanizeOutcome for display. */
export function humanizePriceBand(raw) {
  const s = String(raw || '').toLowerCase()
  if (s.includes('budget')) return 'budget range (under $350k)'
  if (s.includes('premium')) return 'premium range (above $550k)'
  if (s.includes('mid')) return 'mid range (about $350k–$500k)'
  return 'a typical market band for this profile'
}

export function confidenceLevelFromBand(low, high) {
  const range = Number(high) - Number(low)
  if (!Number.isFinite(range)) return 'Medium'
  if (range < 60000) return 'High'
  if (range < 120000) return 'Medium'
  return 'Low'
}

export function confidenceBandTooltip(level, low, high) {
  const band = formatConfidenceBandK(low, high)
  if (level === 'High') {
    return `Narrow 95% band (${band}): the model is relatively confident for flats similar to yours.`
  }
  if (level === 'Medium') {
    return `Medium-width band (${band}): fewer very similar recent sales in the data — use the full range as a guide and cross-check comparables.`
  }
  return `Wide band (${band}): higher uncertainty; compare with recent sales and professional advice.`
}

export function humanizeAprioriWarning(v) {
  if (!v) return ''
  const msg = String(v.message || '').trim()
  if (v.expected != null && v.actual != null) {
    const exp = String(v.expected)
    const act = String(v.actual)
    if (v.source === 'surrogate') {
      return `${msg ? `${msg} ` : ''}The model bracket centres around ${exp}; your ask lines up closer to ${act}.`
    }
    return `${msg ? `${msg} ` : ''}For this pattern we usually see around ${exp}; your listing is framed closer to ${act}.`
  }
  return msg || 'This check flagged a mismatch with typical market patterns.'
}

/**
 * @returns {{ icon: string, type: 'info'|'warn'|'ok', title: string, body: string }[]}
 */
export function buildSignalCards(
  primaryApriori,
  surrogateRule,
  predictedPrice,
  askingPrice
) {
  const cards = []
  const fmt = (n) => `$${Math.round(Number(n)).toLocaleString()}`

  if (primaryApriori) {
    const condText = humanizeConditions(primaryApriori.if_conditions)
    const outcomePhrase = humanizeOutcome(primaryApriori.then)
    const expectedBand = humanizePriceBand(outcomePhrase)

    if (askingPrice != null && Number.isFinite(askingPrice)) {
      const matchPhrase = assessMatch(
        askingPrice,
        predictedPrice,
        primaryApriori
      )
      const fits = String(matchPhrase).includes('fits')
      cards.push({
        icon: fits ? '📊' : '⚠️',
        type: fits ? 'ok' : 'warn',
        title: 'Market pattern (Apriori)',
        body: `Flats with ${condText || 'this profile'} often trade in ${expectedBand}. Your asking price ${matchPhrase}.`
      })
    } else {
      cards.push({
        icon: '📊',
        type: 'info',
        title: 'Market pattern (Apriori)',
        body: `Flats with ${condText || 'this profile'} often align with ${expectedBand}. Add an asking price in the next step to see how your listing compares to this pattern.`
      })
    }
  }

  if (surrogateRule && surrogateRule.then_price != null) {
    cards.push({
      icon: '🌿',
      type: 'info',
      title: 'Model rule (surrogate)',
      body: `Among ${(surrogateRule.samples || 0).toLocaleString()} similar transactions, a typical level is around ${fmt(surrogateRule.then_price)}.`
    })
  }

  if (!primaryApriori && !surrogateRule) {
    cards.push({
      icon: 'ℹ️',
      type: 'info',
      title: 'Patterns',
      body: 'No strong Apriori or surrogate match for this exact combination — lean on the AI estimate and comparable sales in the following steps.'
    })
  }

  return cards
}

export function sellerAprioriViolated(
  primaryApriori,
  askingPrice,
  predictedPrice,
  cspResult
) {
  const apViol = cspResult?.apriori?.violations?.length
  if (apViol) return true
  if (!primaryApriori || askingPrice == null || !Number.isFinite(askingPrice)) {
    return false
  }
  const m = assessMatch(askingPrice, predictedPrice, primaryApriori)
  return !String(m).includes('fits')
}
