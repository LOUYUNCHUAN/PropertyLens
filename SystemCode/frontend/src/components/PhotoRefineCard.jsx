import { useEffect, useRef, useState } from 'react'
import { adjustPriceWithPhoto } from '@/api/client.js'
import LoadingSpinner from './LoadingSpinner.jsx'

const TIER_COLORS = {
  Excellent: { bg: '#e6f7ec', fg: '#0f6b3c' },
  Good: { bg: '#edf5ea', fg: '#2d6a2d' },
  Average: { bg: '#f1f1f1', fg: '#555' },
  Poor: { bg: '#fdecec', fg: '#9b2c2c' },
  'Very Poor': { bg: '#fcd9d9', fg: '#7a1d1d' }
}

const fmt = (n) => `$${Math.round(n).toLocaleString()}`

export default function PhotoRefineCard({ basePrice, onResult }) {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleFile = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setError('Please select an image file (JPEG or PNG).')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Image too large — keep it under 10 MB.')
      return
    }
    setError(null)
    setResult(null)
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const handleScore = async () => {
    if (!file || basePrice == null) return
    setLoading(true)
    setError(null)
    try {
      const data = await adjustPriceWithPhoto(file, basePrice)
      setResult(data)
      onResult?.(data)
    } catch (e) {
      const detail = e?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : e?.message || 'Scoring failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
    onResult?.(null)
  }

  const tier = result?.tier_label || 'Average'
  const tierColor = TIER_COLORS[tier] || TIER_COLORS.Average
  const adjPct = result?.adjustment_pct ?? 0
  const adjColor = adjPct > 0 ? '#0f6b3c' : adjPct < 0 ? '#9b2c2c' : '#666'
  const scorePct = Math.max(0, Math.min(100, (result?.condition_score ?? 0) * 10))

  return (
    <div
      className="card"
      style={{
        padding: '24px',
        borderLeft: '4px solid #10b981',
        background: 'linear-gradient(180deg, #ecfdf5 0%, var(--bg-card, #ffffff) 60%)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '8px' }}>
        <span style={{ fontSize: 20 }} aria-hidden>📸</span>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#065f46' }}>
          Just renovated? Refine with a photo
        </div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--ink-muted)', marginBottom: '16px' }}>
        Upload one interior photo (living room, kitchen, bedroom). We score its furnishing
        condition and apply a ±10% adjustment — a well-presented flat can lift your estimate by
        tens of thousands.
      </div>

      <div
        style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'flex-start'
        }}
      >
        <div style={{ flex: '0 0 220px' }}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Interior preview"
              style={{
                width: '220px',
                height: '165px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: '1px solid var(--sage-pale)'
              }}
            />
          ) : (
            <label
              htmlFor="photo-refine-input"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '220px',
                height: '165px',
                border: '2px dashed var(--sage-pale)',
                borderRadius: '8px',
                background: 'var(--sage-pale)',
                color: 'var(--ink-muted)',
                fontSize: '13px',
                textAlign: 'center',
                cursor: 'pointer',
                padding: '12px'
              }}
            >
              Drop a photo here<br />or click to select
            </label>
          )}
          <input
            id="photo-refine-input"
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ display: previewUrl ? 'block' : 'none', marginTop: '8px', fontSize: '12px' }}
          />
        </div>

        <div style={{ flex: '1 1 260px', minWidth: '260px' }}>
          {!result && !loading && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleScore}
                disabled={!file}
              >
                Score photo
              </button>
              {file && (
                <button type="button" className="btn-secondary" onClick={handleReset}>
                  Clear
                </button>
              )}
            </div>
          )}

          {loading && <LoadingSpinner label="Scoring photo..." />}

          {error && (
            <div
              style={{
                background: '#fdecec',
                color: '#9b2c2c',
                padding: '10px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                marginTop: '8px'
              }}
            >
              {error}
            </div>
          )}

          {result && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    color: 'var(--ink-muted)',
                    marginBottom: '4px'
                  }}
                >
                  <span>Condition score</span>
                  <span className="mono">{result.condition_score.toFixed(2)} / 10</span>
                </div>
                <div
                  style={{
                    background: 'var(--sage-pale)',
                    height: '8px',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${scorePct}%`,
                      height: '100%',
                      background: tierColor.fg,
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: tierColor.bg,
                    color: tierColor.fg,
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                >
                  {tier}
                </span>
                <span
                  style={{
                    color: adjColor,
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                >
                  {adjPct > 0 ? '+' : ''}
                  {adjPct.toFixed(1)}%
                </span>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                  Base price: <span className="mono">{fmt(result.base_price)}</span>
                </div>
                <div
                  className="serif"
                  style={{
                    fontSize: '28px',
                    fontWeight: 400,
                    color: 'var(--ink)',
                    lineHeight: 1.1,
                    marginTop: '2px'
                  }}
                >
                  {fmt(result.adjusted_price)}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                  Adjusted price
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" onClick={handleReset}>
                  Reset
                </button>
              </div>

              {result.model_meta?.val_mae != null && (
                <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                  Model: EfficientNet-B0 · val MAE {result.model_meta.val_mae.toFixed(2)}
                  {result.model_meta.training_date
                    ? ` · trained ${result.model_meta.training_date}`
                    : ''}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
