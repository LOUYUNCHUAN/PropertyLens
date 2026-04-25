import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ComparePanel } from '../components/ComparePanel.jsx'

export default function CompareView() {
  const { state } = useLocation()
  const navigate = useNavigate()

  const {
    listingPrice: initialListingPrice,
    predictedPrice,
    confidenceLow,
    confidenceHigh,
    flatDetails,
    flatForm,
    comparables,
    shapValues: initialShapValues,
  } = state || {}

  const [listingPrice, setListingPrice] = useState(initialListingPrice || null)
  const [listingInput, setListingInput] = useState(
    initialListingPrice ? String(initialListingPrice) : ''
  )

  if (!state || !predictedPrice) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 40px', color: '#6b7280' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
          No comparison data
        </div>
        <div style={{ fontSize: '13px', marginBottom: '20px' }}>
          Use the Buyer page to estimate a flat&apos;s value — comparison appears below the
          estimate on Buyer, or open Buyer and run Estimate first.
        </div>
        <button
          type="button"
          onClick={() => navigate('/buyer')}
          style={{
            background: '#22c55e',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            padding: '10px 20px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          ← Go to Buyer
        </button>
      </div>
    )
  }

  return (
    <ComparePanel
      showBackButton
      onBack={() => navigate('/buyer')}
      predictedPrice={predictedPrice}
      confidenceLow={confidenceLow}
      confidenceHigh={confidenceHigh}
      flatDetails={flatDetails}
      flatForm={flatForm}
      comparables={comparables}
      initialShapValues={initialShapValues}
      listingPrice={listingPrice}
      setListingPrice={setListingPrice}
      listingInput={listingInput}
      setListingInput={setListingInput}
    />
  )
}
