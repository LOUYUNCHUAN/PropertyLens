import { useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const TYPE_COLORS = {
  Town: '#22c55e',
  MRT: '#3b82f6',
  School: '#8b5cf6',
  Policy: '#f59e0b',
  Region: '#ec4899',
  Rule: '#6b7280',
}

export default function Neo4jGraph({ nodes = [], links = [], error }) {
  const graphData = useMemo(() => {
    if (!nodes.length) return { nodes: [], links: [] }
    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({
        source: l.source,
        target: l.target,
        type: l.type,
        dist_km: l.dist_km,
        impact: l.impact,
      })),
    }
  }, [nodes, links])

  if (error) {
    return (
      <div
        style={{
          height: 420,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          color: '#6b7280',
          fontSize: 14,
        }}
      >
        Neo4j KB not available: {error}
      </div>
    )
  }

  if (!nodes.length) {
    return (
      <div
        style={{
          height: 420,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          color: '#6b7280',
          fontSize: 14,
        }}
      >
        No KB data
      </div>
    )
  }

  return (
    <div style={{ height: 420, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#fff' }}>
      <ForceGraph2D
        graphData={graphData}
        nodeId="id"
        nodeLabel={(n) => `${n.label || n.id} (${n.type})`}
        nodeColor={(n) => TYPE_COLORS[n.type] || '#9ca3af'}
        linkColor={() => '#d1d5db'}
        linkWidth={1}
        nodeRelSize={4}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.label || node.id
          const fontSize = 12 / globalScale
          ctx.font = `${fontSize}px Sans-Serif`
          const textWidth = ctx.measureText(label).width
          const bgrPadding = 2
          const typeColor = TYPE_COLORS[node.type] || '#9ca3af'
          ctx.fillStyle = typeColor
          ctx.beginPath()
          ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI)
          ctx.fill()
          ctx.fillStyle = '#111827'
          ctx.fillText(label, node.x + 6, node.y + fontSize / 2)
        }}
      />
    </div>
  )
}
