import { useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const TYPE_COLORS = {
  Town: '#22c55e',
  FamousSchool: '#8b5cf6',
}

function nodeCount(n) {
  if (n?.type === 'Town') return Number(n.property_count) || 0
  if (n?.type === 'FamousSchool') return Number(n.near_property_count) || 0
  return 0
}

function nodeSuffix(n) {
  const c = nodeCount(n)
  if (n?.type === 'Town') return c ? `${c} flats` : 'no flats'
  if (n?.type === 'FamousSchool') return c ? `${c} nearby` : 'none nearby'
  return ''
}

export default function PropertySearchGraph({ nodes = [], links = [], error }) {
  const graphData = useMemo(() => {
    if (!nodes.length) return { nodes: [], links: [] }
    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({
        source: l.source,
        target: l.target,
        type: l.type,
        weight: l.weight,
      })),
    }
  }, [nodes, links])

  const maxWeight = useMemo(() => {
    let m = 0
    for (const l of links) {
      const w = Number(l.weight) || 0
      if (w > m) m = w
    }
    return m || 1
  }, [links])

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
          padding: 24,
          textAlign: 'center',
        }}
      >
        {error}
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
        No graph data
      </div>
    )
  }

  return (
    <div style={{ height: 460, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#fff' }}>
      <ForceGraph2D
        graphData={graphData}
        nodeId="id"
        nodeLabel={(n) => `${n.label} (${n.type}) · ${nodeSuffix(n)}`}
        nodeVal={(n) => Math.max(1, Math.sqrt(nodeCount(n)))}
        nodeColor={(n) => TYPE_COLORS[n.type] || '#9ca3af'}
        linkColor={() => '#d1d5db'}
        linkWidth={(l) => 0.5 + 2.5 * ((Number(l.weight) || 0) / maxWeight)}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const radius = Math.max(3, Math.sqrt(nodeCount(node)) * 0.9)
          const color = TYPE_COLORS[node.type] || '#9ca3af'
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
          ctx.fill()

          const label = `${node.label} · ${nodeSuffix(node)}`
          const fontSize = 11 / globalScale
          ctx.font = `${fontSize}px Sans-Serif`
          ctx.fillStyle = '#111827'
          ctx.fillText(label, node.x + radius + 2, node.y + fontSize / 2)
        }}
      />
    </div>
  )
}
