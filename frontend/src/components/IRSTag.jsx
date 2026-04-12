const TAG_STYLES = {
  'Model-Based': { bg: '#4a7c6f', color: '#ffffff' },
  'Rule-Based': { bg: '#fef3e2', color: '#c8791a' },
  CBR: { bg: '#e8f2fa', color: '#1a5f9a' },
  'Constraint-Based': { bg: '#fdecea', color: '#c0392b' },
  Uncertainty: { bg: '#f3e8ff', color: '#6d28d9' },
  Recommender: { bg: '#e8f2ef', color: '#4a7c6f' }
}

export default function IRSTag({ type }) {
  const style = TAG_STYLES[type] || { bg: '#e8e4de', color: '#4a4540' }
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        fontSize: '10px',
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: '20px',
        letterSpacing: '0.03em',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        textTransform: 'uppercase'
      }}
    >
      {type}
    </span>
  )
}

