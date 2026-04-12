import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
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
import ShortlistView from './views/ShortlistView.jsx'
import AccountView from './views/AccountView.jsx'

function ProtectedLayout({ children }) {
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn) return <Navigate to="/login" />
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className="ml-[260px] flex min-h-screen min-w-0 flex-1 flex-col">
        <AppHeader />
        {/* shrink-0: main height follows page content; avoids a viewport-tall <main> + nested scroll from flex-1 */}
        <main className="min-w-0 shrink-0 px-8 pb-8 pt-6">{children}</main>
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
