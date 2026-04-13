import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { loginApi, registerApi } from '../api/client.js'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ThemeToggle from '@/components/ThemeToggle.jsx'
import BrandMark from '@/components/BrandMark.jsx'

export default function LoginView() {
  const { isLoggedIn, login } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/dashboard', { replace: true })
    }
  }, [isLoggedIn, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const u = String(username).trim()
    const p = String(password)
    if (!u || !p) {
      setError('Enter username and password.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const data = await loginApi(u, p)
        login(data.access_token, data.username, data.display_name ?? '')
      } else {
        if (p.length < 4) {
          setError('Password must be at least 4 characters.')
          setLoading(false)
          return
        }
        const data = await registerApi(
          u,
          p,
          displayName.trim() || undefined
        )
        login(data.access_token, data.username, data.display_name ?? '')
      }
      navigate('/dashboard', { replace: true })
    } catch (err) {
      let msg =
        err?.response?.data?.detail ||
        err?.message ||
        'Request failed. Is the API running?'
      if (err?.code === 'ECONNABORTED' || err?.message === 'Network Error') {
        msg =
          'Cannot reach the API. Start the backend (e.g. uvicorn in backend/) on port 8000, then try again.'
      }
      if (Array.isArray(msg)) {
        msg = msg.map((m) => m?.msg || JSON.stringify(m)).join(' ')
      }
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="hero-mesh relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-[420px] border-border/80 bg-card/95 shadow-lg ring-1 ring-border/60 backdrop-blur-sm dark:ring-white/10">
        <CardHeader className="space-y-4">
          <div className="flex flex-col items-center gap-4 text-center sm:items-start sm:text-left">
            <span className="sr-only">PropertyLens</span>
            <BrandMark variant="hero" />
            <div>
              <CardTitle className="font-display text-display-sm">
                {mode === 'login' ? 'Welcome back' : 'Create an account'}
              </CardTitle>
              <CardDescription className="mt-2 text-base">
                {mode === 'login'
                  ? 'Sign in with your PropertyLens account.'
                  : 'Register to save shortlists and history to your account.'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your_username"
                autoComplete="username"
              />
              {mode === 'register' && (
                <p className="text-[11px] text-muted-foreground">
                  3–128 characters: lowercase letters, digits, . _ -
                </p>
              )}
            </div>
            {mode === 'register' && (
              <div className="grid gap-2">
                <Label htmlFor="displayName">Display name (optional)</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How we greet you"
                  autoComplete="name"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'login' ? '••••' : 'At least 4 characters'}
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full font-semibold" disabled={loading}>
              {loading
                ? '…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t border-border pt-4">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError('')
            }}
          >
            {mode === 'login'
              ? 'Need an account? Sign up'
              : 'Already have an account? Sign in'}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Demo account (after first API start): username{' '}
            <strong className="text-foreground">user</strong> · password{' '}
            <strong className="text-foreground">1234</strong>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
