/**
 * Verdict logic for the Buyer pricing comparison card (Direction B).
 *
 * 6 bands over delta = (asking - aiEstimate) / aiEstimate * 100:
 *   < -7       → Great deal      (good)
 *   -7 to -2   → Below market    (good)
 *   -2 to 2    → Fair price      (good)
 *   2 to 5     → Close to market (neutral)
 *   5 to 10    → Above market    (warn)
 *   ≥ 10       → Overpriced      (bad)
 *
 * Each band resolves to a tone, which maps to a Tailwind palette
 * (emerald / amber / rose / slate) used by the banner + pill.
 */

export const VERDICT_STATES = [
  { id: 'steal', label: 'Great deal', icon: 'sparkles', tone: 'good', min: -Infinity, max: -7 },
  { id: 'below', label: 'Below market', icon: 'trending-down', tone: 'good', min: -7, max: -2 },
  { id: 'fair', label: 'Fair price', icon: 'thumbs-up', tone: 'good', min: -2, max: 2 },
  { id: 'close', label: 'Close to market', icon: 'circle-dot', tone: 'neutral', min: 2, max: 5 },
  { id: 'above', label: 'Above market', icon: 'trending-up', tone: 'warn', min: 5, max: 10 },
  { id: 'overpriced', label: 'Overpriced', icon: 'flag', tone: 'bad', min: 10, max: Infinity }
]

/**
 * Tailwind class bundles per tone. The card uses them for:
 *   banner  — outer background / border / left-accent
 *   pill    — small verdict chip inside the banner
 *   accent  — strong color for icon / border-left stripe
 */
export const TONE_STYLES = {
  good: {
    banner: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900',
    accent: 'border-l-emerald-500',
    pillBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200',
    iconFg: 'text-emerald-700 dark:text-emerald-400'
  },
  neutral: {
    banner: 'bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-800',
    accent: 'border-l-slate-400',
    pillBg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    iconFg: 'text-slate-700 dark:text-slate-300'
  },
  warn: {
    banner: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
    accent: 'border-l-amber-500',
    pillBg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
    iconFg: 'text-amber-700 dark:text-amber-300'
  },
  bad: {
    banner: 'bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900',
    accent: 'border-l-rose-500',
    pillBg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
    iconFg: 'text-rose-700 dark:text-rose-300'
  }
}

export function pickVerdict(asking, aiEstimate) {
  const a = Number(asking)
  const ai = Number(aiEstimate)
  if (!Number.isFinite(a) || !Number.isFinite(ai) || ai <= 0) {
    const fair = VERDICT_STATES[2]
    return { ...fair, delta: 0, styles: TONE_STYLES[fair.tone] }
  }
  const delta = ((a - ai) / ai) * 100
  const state = VERDICT_STATES.find((s) => delta >= s.min && delta < s.max) || VERDICT_STATES[2]
  return { ...state, delta, styles: TONE_STYLES[state.tone] }
}
