import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Home, LineChart, Bug, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

const navigation = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard
  },
  {
    name: 'Workspace',
    href: '#',
    icon: Home,
    hasChildren: true,
    children: [
      { name: 'Buyer', href: '/buyer' },
      { name: 'Seller', href: '/seller' },
      { name: 'Shortlist', href: '/shortlist' }
    ]
  },
  {
    name: 'Insights',
    href: '#',
    icon: LineChart,
    hasChildren: true,
    children: [
      { name: 'Analytics', href: '/analysis' },
      { name: 'Ask AI', href: '/ask-ai' }
    ]
  },
  {
    name: 'Debug',
    href: '/debug',
    icon: Bug
  }
]

export default function AppSidebar() {
  const pathname = useLocation().pathname

  const workspacePaths = ['/buyer', '/seller', '/shortlist']
  const insightsPaths = ['/analysis', '/ask-ai']

  const [workspaceOpen, setWorkspaceOpen] = useState(() =>
    workspacePaths.some((p) => pathname === p)
  )
  const [insightsOpen, setInsightsOpen] = useState(() =>
    insightsPaths.some((p) => pathname === p)
  )

  useEffect(() => {
    if (workspacePaths.some((p) => pathname === p)) setWorkspaceOpen(true)
  }, [pathname])

  useEffect(() => {
    if (insightsPaths.some((p) => pathname === p)) setInsightsOpen(true)
  }, [pathname])

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-[260px] border-r border-border/50 bg-card">
      <div className="flex h-full flex-col">
        <Link
          to="/dashboard"
          className="flex h-20 items-center gap-3 px-6 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
          aria-label="PropertyLens — go to dashboard"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            P
          </div>
          <div className="min-w-0 text-left">
            <div className="font-semibold tracking-tight text-foreground">PropertyLens</div>
            <div className="text-xs leading-snug text-muted-foreground">Fair, explainable pricing</div>
          </div>
        </Link>

        <nav className="flex-1 overflow-y-auto px-4 py-2">
          <div className="space-y-1">
            {navigation.map((item) => {
              const isGroupActive =
                item.children?.some((c) => pathname === c.href) ?? false
              const isSelfActive = item.href !== '#' && pathname === item.href
              const isActive = isSelfActive || isGroupActive
              const Icon = item.icon

              if (!item.hasChildren) {
                return (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    end={item.href === '/dashboard'}
                    className={({ isActive: navActive }) =>
                      cn(
                        'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                        navActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0',
                          isSelfActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                      <span>{item.name}</span>
                    </div>
                  </NavLink>
                )
              }

              const isWorkspace = item.name === 'Workspace'
              const open = isWorkspace ? workspaceOpen : insightsOpen
              const setOpen = isWorkspace ? setWorkspaceOpen : setInsightsOpen

              return (
                <div key={item.name}>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-3">
                      {Icon && (
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0',
                            isGroupActive ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                      )}
                      <span>{item.name}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                        open ? 'rotate-0' : '-rotate-90',
                        isGroupActive && open && 'text-primary'
                      )}
                    />
                  </button>

                  {open && item.children && (
                    <div className="ml-9 mt-1 space-y-1 border-l border-border/60 pl-2">
                      {item.children.map((child) => (
                        <NavLink
                          key={child.href}
                          to={child.href}
                          className={({ isActive: navActive }) =>
                            cn(
                              'block rounded-lg px-3 py-2 text-sm transition-colors',
                              navActive
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            )
                          }
                        >
                          {child.name}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>
      </div>
    </aside>
  )
}
