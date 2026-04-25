/** Round to nearest S$1,000 and show as S$372k – S$485k (buyer-facing, avoids false precision). */
export function formatConfidenceBandK(low, high) {
  const a = Math.round(Number(low) / 1000)
  const b = Math.round(Number(high) / 1000)
  return `S$${a}k – S$${b}k`
}

/** Full precision Singapore-dollar price for emphasis rows (e.g. bar values, asking price). */
export function formatPrice(n) {
  const v = Math.round(Number(n) || 0)
  return `S$${v.toLocaleString('en-SG')}`
}
