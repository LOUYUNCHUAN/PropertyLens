import { useEffect, useState } from 'react'
import { apiLogs, getNeo4jKb, api } from '../api/client.js'
import Neo4jGraph from '../components/Neo4jGraph.jsx'

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
}
const thStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#6b7280',
  borderBottom: '2px solid #e5e7eb',
  background: '#f9fafb',
}
const tdStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid #e5e7eb',
}

export default function DebugView() {
  const [health, setHealth] = useState(null)
  const [neo4j, setNeo4j] = useState(null)
  const [neo4jKb, setNeo4jKb] = useState({ nodes: [], links: [], error: null })

  useEffect(() => {
    api.get('/health')
      .then((r) => setHealth(r.data))
      .catch(() => setHealth({ status: 'error' }))

    api.get('/api/analytics/global-shap')
      .then(() => setNeo4j('ok'))
      .catch(() => setNeo4j('error'))

    getNeo4jKb()
      .then((data) => setNeo4jKb({ nodes: data.nodes || [], links: data.links || [], error: data.error || null }))
      .catch((err) => setNeo4jKb({ nodes: [], links: [], error: err.message || 'Failed to load KB' }))
  }, [])

  const { nodes, links, error } = neo4jKb

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16
        }}
      >
        <div className="card">
          <div className="section-label">API / model health</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div>
              Backend /health:{' '}
              <strong>{health ? String(health.status || 'unknown') : 'checking…'}</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              Full model:{' '}
              <span>
                ✅ loaded (R² {health?.r2?.toFixed ? health.r2.toFixed(4) : '—'}
                , RMSE ${health?.rmse?.toLocaleString?.() || '—'}
                , MAPE {health?.mape_pct ?? '—'}%)
              </span>
            </div>
            <div>
              Normalised model:{' '}
              <span>
                {health?.normalised_model_loaded ? '✅ loaded (ensemble active)' : '⏸ not loaded'}
              </span>
            </div>
            <div>
              Ensemble type:{' '}
              <span>{health?.ensemble_type || '—'}</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="section-label">Neo4j / analytics smoke</div>
          <div style={{ fontSize: 14 }}>
            Global SHAP endpoint:{' '}
            <strong>{neo4j ? String(neo4j) : 'checking…'}</strong>
          </div>
        </div>
      </section>

      {/* Neo4j Knowledge Base — Graph + Tables */}
      <section className="card">
        <div className="section-label">Neo4j Knowledge Base</div>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Graph and tabular view of towns, MRTs, schools, policies, regions, and rules.
        </p>
        <div style={{ marginBottom: 24 }}>
          <Neo4jGraph nodes={nodes} links={links} error={error} />
        </div>

        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>Nodes</div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Id</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Label</th>
                    <th style={thStyle}>Extra</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.length === 0 && (
                    <tr><td colSpan={4} style={tdStyle}>No data</td></tr>
                  )}
                  {nodes.map((n, i) => (
                    <tr key={n.id || i}>
                      <td style={tdStyle}>{n.id}</td>
                      <td style={tdStyle}>{n.type}</td>
                      <td style={tdStyle}>{n.label}</td>
                      <td style={tdStyle}>
                        {n.region != null && `region: ${n.region}`}
                        {n.median_price != null && ` median: $${Number(n.median_price).toLocaleString()}`}
                        {n.year != null && ` year: ${n.year}`}
                        {n.dist_km != null && ` dist_km: ${n.dist_km}`}
                        {n.confidence != null && ` conf: ${Number(n.confidence).toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>Relationships</div>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Target</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Props</th>
                  </tr>
                </thead>
                <tbody>
                  {links.length === 0 && (
                    <tr><td colSpan={4} style={tdStyle}>No data</td></tr>
                  )}
                  {links.map((l, i) => (
                    <tr key={`${l.source}-${l.target}-${l.type}-${i}`}>
                      <td style={tdStyle}>{l.source}</td>
                      <td style={tdStyle}>{l.target}</td>
                      <td style={tdStyle}>{l.type}</td>
                      <td style={tdStyle}>
                        {l.dist_km != null && `dist_km: ${l.dist_km}`}
                        {l.impact != null && ` impact: ${l.impact}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-label">Live API log (last 40)</div>
        <div
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace'
          }}
        >
          {[...apiLogs]
            .slice(-40)
            .reverse()
            .map((entry, idx) => (
              <div
                key={idx}
                style={{
                  padding: '4px 0',
                  borderBottom: '1px dashed #e5e7eb'
                }}
              >
                <div>
                  <span style={{ color: '#9ca3af' }}>{entry.ts}</span>{' '}
                  <strong>{entry.type.toUpperCase()}</strong>{' '}
                  {entry.method && <span>{entry.method}</span>}{' '}
                  {entry.status && <span>({entry.status})</span>}
                </div>
                {entry.url && <div>{entry.url}</div>}
                {entry.message && (
                  <div style={{ color: '#ef4444' }}>{entry.message}</div>
                )}
              </div>
            ))}
          {!apiLogs.length && (
            <div style={{ color: 'var(--text-secondary)' }}>
              No API activity yet in this session.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

