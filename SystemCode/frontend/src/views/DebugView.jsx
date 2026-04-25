import { useEffect, useState } from 'react'
import { apiLogs, getPropertySearchGraph, api } from '../api/client.js'
import PropertySearchGraph from '../components/PropertySearchGraph.jsx'

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

function fmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtNum(v, digits = 0) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
}

export default function DebugView() {
  const [health, setHealth] = useState(null)
  const [psGraph, setPsGraph] = useState({
    ok: false,
    stats: null,
    nodes: [],
    links: [],
    sample_properties: [],
    error: null,
  })

  useEffect(() => {
    api.get('/health')
      .then((r) => setHealth(r.data))
      .catch(() => setHealth({ status: 'error' }))

    getPropertySearchGraph()
      .then((data) => {
        if (data?.ok) {
          setPsGraph({
            ok: true,
            stats: data.stats || null,
            nodes: data.nodes || [],
            links: data.links || [],
            sample_properties: data.sample_properties || [],
            error: null,
          })
        } else {
          setPsGraph({
            ok: false,
            stats: null,
            nodes: [],
            links: [],
            sample_properties: [],
            error: data?.error || 'Property search graph unavailable.',
          })
        }
      })
      .catch((err) =>
        setPsGraph({
          ok: false,
          stats: null,
          nodes: [],
          links: [],
          sample_properties: [],
          error: err?.message || 'Failed to load property search graph',
        })
      )
  }, [])

  const { stats, nodes, links, sample_properties: samples, error } = psGraph
  const towns = nodes.filter((n) => n.type === 'Town')
  const schools = nodes.filter((n) => n.type === 'FamousSchool')

  return (
    <div style={{ display: 'grid', gap: 24, minWidth: 0, width: '100%' }}>
      <section className="card">
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
      </section>

      <section className="card">
        <div className="section-label">Property Search AI · Neo4j</div>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Graph powering the Property Search AI chatbot. Nodes are Towns and Famous Schools;
          Property nodes are aggregated as counts. Edges show how many flats in a town are within
          ~2 km of each famous school.
        </p>

        {stats ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
              fontSize: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <div style={{ color: '#6b7280' }}>Properties</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtNum(stats.property_count)}</div>
            </div>
            <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <div style={{ color: '#6b7280' }}>Towns</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtNum(stats.town_count)}</div>
            </div>
            <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <div style={{ color: '#6b7280' }}>Famous schools</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtNum(stats.famous_school_count)}</div>
            </div>
            <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <div style={{ color: '#6b7280' }}>NEAREST rels</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtNum(stats.nearest_rel_count)}</div>
            </div>
            <div style={{ padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <div style={{ color: '#6b7280' }}>NEAR rels (≤2 km)</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtNum(stats.near_rel_count)}</div>
            </div>
          </div>
        ) : null}

        <div style={{ marginBottom: 24 }}>
          <PropertySearchGraph nodes={nodes} links={links} error={error} />
        </div>

        <div
          style={{
            display: 'grid',
            gap: 24,
            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
              Towns ({towns.length})
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Town</th>
                    <th style={thStyle}>Flats</th>
                    <th style={thStyle}>Avg resale price</th>
                    <th style={thStyle}>Avg MRT distance</th>
                  </tr>
                </thead>
                <tbody>
                  {towns.length === 0 && (
                    <tr><td colSpan={4} style={tdStyle}>No data</td></tr>
                  )}
                  {towns.map((t) => (
                    <tr key={t.id}>
                      <td style={tdStyle}>{t.label}</td>
                      <td style={tdStyle}>{fmtNum(t.property_count)}</td>
                      <td style={tdStyle}>{fmtMoney(t.avg_resale_price)}</td>
                      <td style={tdStyle}>
                        {t.avg_dist_to_mrt_m != null ? `${fmtNum(t.avg_dist_to_mrt_m, 0)} m` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
              Famous schools ({schools.length})
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>School</th>
                    <th style={thStyle}>Flats with this as nearest</th>
                    <th style={thStyle}>Flats within ~2 km</th>
                  </tr>
                </thead>
                <tbody>
                  {schools.length === 0 && (
                    <tr><td colSpan={3} style={tdStyle}>No data</td></tr>
                  )}
                  {schools.map((s) => (
                    <tr key={s.id}>
                      <td style={tdStyle}>{s.label}</td>
                      <td style={tdStyle}>{fmtNum(s.nearest_property_count)}</td>
                      <td style={tdStyle}>{fmtNum(s.near_property_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details style={{ gridColumn: '1 / -1' }}>
            <summary
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#374151',
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              Sample properties ({samples.length})
            </summary>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Address</th>
                    <th style={thStyle}>Town</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Price</th>
                    <th style={thStyle}>score_mrt</th>
                    <th style={thStyle}>score_famous_school</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.length === 0 && (
                    <tr><td colSpan={6} style={tdStyle}>No sample rows</td></tr>
                  )}
                  {samples.map((s, i) => (
                    <tr key={`${s.address_key}-${i}`}>
                      <td style={tdStyle}>{s.address_key}</td>
                      <td style={tdStyle}>{s.town}</td>
                      <td style={tdStyle}>{s.flat_type}</td>
                      <td style={tdStyle}>{fmtMoney(s.resale_price)}</td>
                      <td style={tdStyle}>{fmtNum(s.score_mrt, 1)}</td>
                      <td style={tdStyle}>{fmtNum(s.score_famous_school, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <div className="section-label">Live API log (last 40)</div>
        <div
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            overflowX: 'hidden',
            fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace',
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
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
