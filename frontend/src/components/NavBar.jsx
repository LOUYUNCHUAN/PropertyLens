import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const TABS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/discover', label: 'Explore' },
  { path: '/shortlist', label: 'Shortlist' },
  { path: '/buyer', label: 'Buyer' },
  { path: '/seller', label: 'Seller' },
  { path: '/analysis', label: 'Insights' },
  { path: '/ask-ai', label: 'Ask AI' },
]

export default function NavBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { username, logout } = useAuth()

  return (
    <nav
      style={{
        background: 'var(--bg-sidebar)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 40
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '10px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background:
                'linear-gradient(135deg, var(--green-500), var(--green-600))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 16,
              boxShadow: '0 10px 20px rgba(34,197,94,0.4)'
            }}
          >
            P
          </div>
          <div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600
              }}
            >
              PropertyLens
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)'
              }}
            >
              Fair, explainable pricing for every flat
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flex: 1,
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              background: '#f3f4f6',
              padding: 4,
              borderRadius: '999px',
              display: 'flex',
              gap: 4
            }}
          >
            {TABS.map((tab) => {
              const active = location.pathname === tab.path
              return (
                <button
                  key={tab.path}
                  type="button"
                  onClick={() => navigate(tab.path)}
                  style={{
                    borderRadius: '999px',
                    border: 'none',
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#111827' : '#6b7280',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--text-secondary)'
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '999px',
                background: 'var(--green-500)'
              }}
            />
            API live
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 8px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: '#f9fafb'
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '999px',
                background: '#e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12
              }}
            >
              {username?.[0]?.toUpperCase() || 'U'}
            </div>
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)'
              }}
            >
              {username || 'user'}
            </span>
            <button
              type="button"
              onClick={() => {
                logout()
                navigate('/login')
              }}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 11,
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
