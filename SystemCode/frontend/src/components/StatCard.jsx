export default function StatCard({ label, value, change }) {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: 0.06
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600
        }}
      >
        {value}
      </div>
      {change && (
        <div
          style={{
            fontSize: 12,
            color: change.startsWith('-') ? 'var(--red-500)' : 'var(--green-600)'
          }}
        >
          {change}
        </div>
      )}
    </div>
  )
}

