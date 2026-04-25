import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { cn } from './lib/utils.js'
import AppSidebar from './components/AppSidebar.jsx'
import AppHeader from './components/AppHeader.jsx'
import ChatBot from './components/ChatBot.jsx'
import LoginView from './views/LoginView.jsx'
import DashboardView from './views/DashboardView.jsx'
import BuyerView from './views/BuyerView.jsx'
import SellerView from './views/SellerView.jsx'
import AnalysisView from './views/AnalysisView.jsx'
import DebugView from './views/DebugView.jsx'
import CompareView from './views/CompareView.jsx'
import DiscoverView from './views/DiscoverView.jsx'
import AskAIView from './views/AskAIView.jsx'
import ChatVectorDbView from './views/ChatVectorDbView.jsx'
import PropertySearchAIView from './views/PropertySearchAIView.jsx'
import ShortlistView from './views/ShortlistView.jsx'
import AccountView from './views/AccountView.jsx'

function ProtectedLayout({ children }) {
  const { isLoggedIn } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('propertylens.sidebarCollapsed') === '1'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      'propertylens.sidebarCollapsed',
      sidebarCollapsed ? '1' : '0'
    )
  }, [sidebarCollapsed])

  if (!isLoggedIn) return <Navigate to="/login" />
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />
      <div
        className={cn(
          'flex h-[100dvh] min-h-0 min-w-0 flex-1 flex-col transition-[margin-left] duration-200 ease-out',
          sidebarCollapsed ? 'ml-[64px]' : 'ml-[260px]'
        )}
      >
        <AppHeader />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/25 px-8 pb-10 pt-8">
          {children}
        </main>
      </div>
      <ChatBot />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedLayout>
                <DashboardView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/buyer"
            element={
              <ProtectedLayout>
                <BuyerView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/shortlist"
            element={
              <ProtectedLayout>
                <ShortlistView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/seller"
            element={
              <ProtectedLayout>
                <SellerView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/analysis"
            element={
              <ProtectedLayout>
                <AnalysisView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/debug"
            element={
              <ProtectedLayout>
                <DebugView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/compare"
            element={
              <ProtectedLayout>
                <CompareView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/discover"
            element={
              <ProtectedLayout>
                <DiscoverView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/ask-ai"
            element={
              <ProtectedLayout>
                <AskAIView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/insights/chat-vdb"
            element={
              <ProtectedLayout>
                <ChatVectorDbView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/insights/property-search"
            element={
              <ProtectedLayout>
                <PropertySearchAIView />
              </ProtectedLayout>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedLayout>
                <AccountView />
              </ProtectedLayout>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
