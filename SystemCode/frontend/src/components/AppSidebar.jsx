import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Home,
  LineChart,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'

import { cn } from '@/lib/utils'
import BrandMark from '@/components/BrandMark.jsx'

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
      { name: 'Ask AI', href: '/insights/property-search' }
    ]
  },
  {
    name: 'Debug',
    href: '/debug',
    icon: Bug
  }
]

export default function AppSidebar({ collapsed = false, onToggle }) {
  const pathname = useLocation().pathname

  const workspacePaths = ['/buyer', '/seller', '/shortlist']
  const insightsPaths = ['/analysis', '/insights/property-search']

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
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out',
        collapsed ? 'w-[64px]' : 'w-[260px]'
      )}
    >
      {/* Collapse / expand toggle — sits on the right edge of the sidebar */}
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute -right-3 bottom-6 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-muted-foreground shadow-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      <div className="flex h-full flex-col">
        <Link
          to="/dashboard"
          className={cn(
            'flex h-[4.5rem] items-center transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
            collapsed ? 'justify-center px-0' : 'gap-3 px-5'
          )}
          aria-label="PropertyLens — go to dashboard"
        >
          <BrandMark variant="sidebar" />
          {!collapsed && (
            <div className="min-w-0 text-left">
              <div className="font-display text-base font-semibold tracking-tight text-sidebar-foreground">
                PropertyLens
              </div>
              <div className="text-xs leading-snug text-muted-foreground">Fair, explainable pricing</div>
            </div>
          )}
        </Link>

        <nav
          className={cn(
            'flex-1 overflow-y-auto overflow-x-hidden py-2',
            collapsed ? 'px-2' : 'px-3'
          )}
        >
          <div className="space-y-0.5">
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
                    title={collapsed ? item.name : undefined}
                    className={({ isActive: navActive }) =>
                      cn(
                        'relative flex items-center rounded-lg text-sm font-medium transition-all duration-200',
                        collapsed
                          ? 'justify-center px-2 py-2.5'
                          : 'justify-between px-3 py-2.5',
                        navActive
                          ? 'bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )
                    }
                  >
                    <div className={cn('flex items-center', collapsed ? '' : 'gap-3')}>
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0',
                          isSelfActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                      {!collapsed && <span>{item.name}</span>}
                    </div>
                  </NavLink>
                )
              }

              const isWorkspace = item.name === 'Workspace'
              const open = isWorkspace ? workspaceOpen : insightsOpen
              const setOpen = isWorkspace ? setWorkspaceOpen : setInsightsOpen

              const handleGroupClick = () => {
                if (collapsed) {
                  // Clicking a group icon in collapsed mode: expand the sidebar
                  // AND open this group so the user doesn't also need to click
                  // twice. Matches VSCode / Notion collapsed-sidebar behavior.
                  onToggle?.()
                  setOpen(true)
                } else {
                  setOpen((o) => !o)
                }
              }

              return (
                <div key={item.name}>
                  <button
                    type="button"
                    onClick={handleGroupClick}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      'flex w-full items-center rounded-lg text-left text-sm font-medium transition-all duration-200',
                      collapsed
                        ? 'justify-center px-2 py-2.5'
                        : 'justify-between px-3 py-2.5',
                      isActive
                        ? 'bg-primary/15 text-primary ring-1 ring-primary/15'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                    aria-expanded={collapsed ? false : open}
                  >
                    <div className={cn('flex items-center', collapsed ? '' : 'gap-3')}>
                      {Icon && (
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0',
                            isGroupActive ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                      )}
                      {!collapsed && <span>{item.name}</span>}
                    </div>
                    {!collapsed && (
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                          open ? 'rotate-0' : '-rotate-90',
                          isGroupActive && open && 'text-primary'
                        )}
                      />
                    )}
                  </button>

                  {!collapsed && open && item.children && (
                    <div className="ml-9 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                      {item.children.map((child) => (
                        <NavLink
                          key={child.href}
                          to={child.href}
                          className={({ isActive: navActive }) =>
                            cn(
                              'block rounded-md px-3 py-2 text-sm transition-colors',
                              navActive
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:text-sidebar-foreground'
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
