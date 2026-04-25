const fmt = (n) => `$${Math.round(n).toLocaleString()}`

export default function CbrDivergenceWarning({ cbrCheck, predictedPrice }) {
  if (
    !cbrCheck ||
    !cbrCheck.flag ||
    cbrCheck.cbr_sample_size < 3
  ) return null

  const { cbr_median, cbr_sample_size, divergence_pct, direction } = cbrCheck
  const isHigher = direction === 'cbr_higher'
  const sign = isHigher ? '+' : ''

  return (
    <div style={{
      background: '#fffbeb',
      border: '1px solid #f59e0b',
      borderLeft: '4px solid #f59e0b',
      borderRadius: '12px',
      padding: '16px 20px',
      marginTop: '8px',
    }}>
      {/* Header */}
      <div style={{ fontWeight: 700, color: '#92400e', fontSize: '14px', marginBottom: '12px' }}>
        ⚠️ Model Caution — Recent Sales Suggest {isHigher ? 'Higher' : 'Lower'} Prices
      </div>

      {/* Three-column stat row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: '12px', marginBottom: '12px',
        background: 'white', borderRadius: '8px', padding: '12px 16px',
      }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            ML Estimate
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#374151' }}>
            {fmt(predictedPrice)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            CBR Median ({cbr_sample_size} recent sales)
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a' }}>
            {fmt(cbr_median)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Difference
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#d97706' }}>
            {sign}{divergence_pct}% {isHigher ? 'higher' : 'lower'}
          </div>
        </div>
      </div>

      {/* Body text */}
      <div style={{ fontSize: '13px', color: '#78350f', lineHeight: 1.6 }}>
        {cbrCheck.flag_reason}
      </div>

      {/* Tip */}
      <div style={{ fontSize: '12px', color: '#92400e', marginTop: '8px', fontStyle: 'italic' }}>
        💡 Use the Similar Past Sales section below as a cross-check.
      </div>
    </div>
  )
}
