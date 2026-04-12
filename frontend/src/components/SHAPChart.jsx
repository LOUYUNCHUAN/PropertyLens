import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer
} from 'recharts'

const HIDDEN_FEATURES = ['lat', 'lng', 'lon', 'latitude', 'longitude', 'years_since_2000']

export default function SHAPChart({ shapValues, maxFeatures = 12 }) {
  if (!shapValues?.length) return null

  const data = shapValues
    .filter((f) => !HIDDEN_FEATURES.includes(f.feature))
    .slice(0, maxFeatures)
    .map((f) => ({
      name: f.feature.replace(/_/g, ' '),
      value: f.shap_value,
      raw: f.feature_value
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const height = Math.max(300, data.length * 28)

  return (
    <div>
      <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 160, right: 40, top: 8, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            horizontal={false}
          />
          <XAxis
            type="number"
            tickFormatter={(v) =>
              `$${Math.round(Math.abs(v) / 1000).toLocaleString()}k`
            }
            tick={{
              fontSize: 11,
              fill: 'var(--ink-muted)',
              fontFamily: 'JetBrains Mono, monospace'
            }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={155}
            tick={{
              fontSize: 11,
              fill: 'var(--ink-light)',
              fontFamily: 'DM Sans, system-ui, sans-serif'
            }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => [
              `${value > 0 ? '+' : ''}$${Math.round(value).toLocaleString()}`,
              'SHAP impact'
            ]}
            contentStyle={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontFamily: 'DM Sans',
              fontSize: '12px'
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.value >= 0 ? '#4a7c6f' : '#c0392b'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
      <p
        className="mt-2 text-xs leading-relaxed"
        style={{ color: 'var(--ink-muted)' }}
      >
        Bars show how much each factor adds or subtracts from the estimate in dollars.{' '}
        <strong>Transaction year</strong> (or sale timing) reflects broad market conditions, not a
        defect in the flat.
      </p>
    </div>
  )
}

