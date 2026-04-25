import IRSTag from './IRSTag.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import { formatConfidenceBandK } from '@/lib/formatPrice.js'

function LoadingSkeleton() {
  return (
    <div className="card flex flex-col items-center gap-4">
      <div className="h-3 w-40 bg-[color:var(--sage-pale)] rounded-full" />
      <div className="h-10 w-56 bg-[color:var(--sage-pale)] rounded-full" />
      <div className="h-3 w-64 bg-[color:var(--sage-pale)] rounded-full" />
      <LoadingSpinner label="Computing price estimate..." />
    </div>
  )
}

export default function PriceCard({ prediction, isLoading }) {
  if (isLoading) return <LoadingSkeleton />
  if (!prediction) return null

  const {
    predicted_price,
    confidence_low,
    confidence_high,
    price_per_sqm,
    r2,
    model_used,
    ensemble_detail,
    debug,
  } = prediction
  const fmt = (n) => `$${Math.round(n).toLocaleString()}`

  let showEnsemble = false
  let ensembleLine = ''

  if (
    model_used === 'xgboost_normalised_ensemble' &&
    ensemble_detail &&
    typeof ensemble_detail.full_model_pred === 'number' &&
    typeof ensemble_detail.normalised_model_pred === 'number'
  ) {
    const full = ensemble_detail.full_model_pred
    const norm = ensemble_detail.normalised_model_pred
    const relDiff = Math.abs(norm - full) / Math.max(full, 1)
    if (relDiff > 0.15) {
      showEnsemble = true
      const ratio = ensemble_detail.predicted_ratio
      const median = ensemble_detail.national_median_used
      ensembleLine = `Normalised estimate: flat is worth ${
        typeof ratio === 'number' ? ratio.toFixed(2) : '—'
      }× the current market median${
        typeof median === 'number' ? ` ($${median.toLocaleString()})` : ''
      }. Full model: $${full.toLocaleString()} · Normalised: $${norm.toLocaleString()} · Blend: ${
        typeof ensemble_detail.norm_weight === 'number'
          ? Math.round(ensemble_detail.norm_weight * 100)
          : 0
      }% normalised.`
    }
  }

  return (
    <div className="card text-center" style={{ padding: '32px' }}>
      <div className="section-label justify-center">
        Estimated Resale Price
        <IRSTag type="Model-Based" />
      </div>
      <div
        className="serif"
        style={{
          fontSize: '48px',
          fontWeight: 400,
          color: 'var(--ink)',
          lineHeight: 1.1,
          margin: '8px 0'
        }}
      >
        {fmt(predicted_price)}
      </div>
      <div
        style={{
          color: 'var(--ink-muted)',
          fontSize: '13px',
          marginBottom: '16px'
        }}
      >
        95% confidence: {formatConfidenceBandK(confidence_low, confidence_high)}
      </div>
      {showEnsemble && (
        <div
          style={{
            fontSize: '12px',
            color: '#6b7280',
            marginBottom: '14px',
            textAlign: 'left'
          }}
        >
          ⓘ {ensembleLine}
        </div>
      )}
      <div
        style={{
          display: 'inline-flex',
          gap: '24px',
          background: 'var(--sage-pale)',
          borderRadius: '8px',
          padding: '10px 20px',
          fontSize: '13px'
        }}
      >
        <span>
          <strong className="mono">
            {`$${Math.round(price_per_sqm).toLocaleString()}`}
          </strong>{' '}
          <span style={{ color: 'var(--ink-muted)' }}>/ sqm</span>
        </span>
        {typeof r2 === 'number' && (
          <span>
            <strong className="mono">R² {r2.toFixed(4)}</strong>{' '}
            <span style={{ color: 'var(--ink-muted)' }}>test accuracy</span>
          </span>
        )}
      </div>
      {debug && (
        <div
          className="text-left mt-4 pt-4 border-t border-[color:var(--sage-pale)]"
          style={{ fontSize: '11px', color: 'var(--ink-muted)', lineHeight: 1.5 }}
        >
          <div className="section-label justify-start mb-1" style={{ fontSize: '10px' }}>
            Model lookup (debug)
          </div>
          {typeof debug.lookup_matched === 'boolean' && (
            <div>
              <span className="text-[color:var(--ink)]">Address row match:</span>{' '}
              {debug.lookup_matched ? 'yes' : 'no'}
            </div>
          )}
          {debug.matched_address_key != null && debug.matched_address_key !== '' && (
            <div className="break-all">
              <span className="text-[color:var(--ink)]">Matched key:</span> {debug.matched_address_key}
            </div>
          )}
          {debug.imputation_note && (
            <div className="mt-1">{debug.imputation_note}</div>
          )}
          {typeof debug.cluster_id === 'number' && (
            <div>
              <span className="text-[color:var(--ink)]">Cluster:</span> {debug.cluster_id}
            </div>
          )}
          {debug.feature_table_csv && (
            <div className="break-all mt-1 opacity-90" title={debug.feature_table_csv}>
              <span className="text-[color:var(--ink)]">Feature CSV:</span> {debug.feature_table_csv}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

