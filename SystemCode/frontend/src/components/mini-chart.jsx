import { cn } from '@/lib/utils'

export function MiniChart({ data, color = 'green', className, height = 40, showTrend = false }) {
  if (!data || data.length === 0) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const normalizedData = data.map((d) => ((d - min) / range) * 100)

  const colorMap = {
    green: '#10b981',
    red: '#ef4444',
    blue: '#3b82f6',
    amber: '#f59e0b',
    slate: '#64748b'
  }

  const strokeColor = colorMap[color] || colorMap.green

  const points = normalizedData
    .map((d, i) => {
      const x = (i / (data.length - 1)) * 100
      const y = 100 - d
      return `${x},${y}`
    })
    .join(' ')

  const trend = data[data.length - 1] - data[0]
  const trendPercent = data[0] ? ((trend / data[0]) * 100).toFixed(1) : '0'

  return (
    <div className={cn('relative flex items-end gap-3', className)}>
      <div style={{ height }} className="flex-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
          <polyline
            points={points}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {showTrend && (
        <div className="flex flex-col items-end text-right">
          <span
            className={cn('text-xs font-medium', trend >= 0 ? 'text-emerald-600' : 'text-red-600')}
          >
            {trend >= 0 ? '+' : ''}
            {trendPercent}%
          </span>
        </div>
      )}
    </div>
  )
}

export function TrendLine({ className }) {
  const chartData = [45, 48, 46, 52, 49, 55, 53, 58, 56, 62, 60, 65, 63, 68, 70]

  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min

  const points = chartData
    .map((d, i) => {
      const x = (i / (chartData.length - 1)) * 100
      const y = 100 - ((d - min) / range) * 100
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className={cn('h-16 w-32', className)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polyline
          points={points}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}
