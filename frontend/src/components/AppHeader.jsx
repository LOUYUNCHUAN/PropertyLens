import { useLocation, useNavigate } from 'react-router-dom'
import { Search, Bell, Settings } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const PATH_TITLES = {
  '/dashboard': 'Dashboard',
  '/discover': 'Explore',
  '/shortlist': 'Shortlist',
  '/buyer': 'Buyer',
  '/seller': 'Seller',
  '/compare': 'Compare',
  '/analysis': 'Analytics',
  '/ask-ai': 'Ask AI',
  '/debug': 'Debug',
  '/account': 'Account'
}

function titleForPath(pathname) {
  if (PATH_TITLES[pathname]) return PATH_TITLES[pathname]
  const base = pathname.split('/')[1]
  if (base && PATH_TITLES[`/${base}`]) return PATH_TITLES[`/${base}`]
  return 'PropertyLens'
}

export default function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const { username, displayName, logout } = useAuth()
  const title = titleForPath(location.pathname)

  return (
    <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between border-b border-border/50 bg-background px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>

      <div className="flex items-center gap-2">
        <span className="mr-2 hidden items-center gap-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
          <span className="h-2 w-2 rounded-full bg-primary" />
          API live
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Account settings"
          onClick={() => navigate('/account')}
        >
          <Settings className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </Button>

        <div className="ml-2 flex items-center gap-2 border-l border-border pl-4">
          <Avatar className="h-10 w-10 ring-2 ring-border">
            <AvatarFallback className="bg-muted font-medium text-muted-foreground">
              {(displayName || username)?.[0]?.toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 flex-col sm:flex">
            <span className="max-w-[120px] truncate text-sm font-medium text-foreground">
              {displayName || username || 'user'}
            </span>
            <button
              type="button"
              onClick={() => {
                logout()
                navigate('/login')
              }}
              className="text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
