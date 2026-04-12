import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { patchAuthMe, changePasswordApi } from '../api/client.js'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function AccountView() {
  const { username, displayName, refreshProfile, applySession } = useAuth()
  const [nameField, setNameField] = useState('')
  const [usernameField, setUsernameField] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [profileMsg, setProfileMsg] = useState(null)
  const [profileErr, setProfileErr] = useState(null)
  const [pwMsg, setPwMsg] = useState(null)
  const [pwErr, setPwErr] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    setNameField(displayName || '')
  }, [displayName])

  useEffect(() => {
    setUsernameField(username || '')
  }, [username])

  async function saveProfile(e) {
    e.preventDefault()
    setSavingProfile(true)
    setProfileErr(null)
    setProfileMsg(null)
    try {
      const nextDisplay = nameField.trim() || null
      const nextUser = usernameField.trim().toLowerCase()
      const patch = {}
      const prevDisplay = displayName || null
      if (nextDisplay !== prevDisplay) {
        patch.display_name = nextDisplay
      }
      if (nextUser && nextUser !== username) {
        patch.username = nextUser
      }
      if (Object.keys(patch).length === 0) {
        setProfileMsg('No changes to save.')
        setSavingProfile(false)
        return
      }
      const res = await patchAuthMe(patch)
      if (res.access_token) {
        applySession(res.access_token, res.username, res.display_name ?? '')
      } else {
        await refreshProfile()
      }
      setProfileMsg('Profile updated.')
    } catch (e) {
      const detail = e?.response?.data?.detail
      setProfileErr(
        typeof detail === 'string'
          ? detail
          : detail
            ? JSON.stringify(detail)
            : e?.message || 'Update failed'
      )
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(e) {
    e.preventDefault()
    setSavingPw(true)
    setPwErr(null)
    setPwMsg(null)
    if (newPw.length < 4) {
      setPwErr('New password must be at least 4 characters.')
      setSavingPw(false)
      return
    }
    if (newPw !== confirmPw) {
      setPwErr('New password and confirmation do not match.')
      setSavingPw(false)
      return
    }
    try {
      await changePasswordApi(currentPw, newPw)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setPwMsg('Password updated.')
    } catch (e) {
      const detail = e?.response?.data?.detail
      setPwErr(
        typeof detail === 'string'
          ? detail
          : e?.message || 'Could not change password'
      )
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account</h2>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-mono text-foreground">{username}</span>.
          Changing your login username updates shortlist and prediction history for this
          account.
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>
            Display name is shown in the header. Username is used for API shortlist keys
            and must stay in sync with the browser extension if you use it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="acc-display">Display name</Label>
              <Input
                id="acc-display"
                value={nameField}
                onChange={(e) => setNameField(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="acc-user">Username (login)</Label>
              <Input
                id="acc-user"
                value={usernameField}
                onChange={(e) => setUsernameField(e.target.value)}
                autoComplete="username"
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                3–128 characters: lowercase letters, digits, . _ -
              </p>
            </div>
            {profileMsg && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                {profileMsg}
              </p>
            )}
            {profileErr && (
              <p className="text-sm text-destructive">{profileErr}</p>
            )}
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>
            Use your current password to set a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="acc-cur">Current password</Label>
              <Input
                id="acc-cur"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="acc-new">New password</Label>
              <Input
                id="acc-new"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="acc-confirm">Confirm new password</Label>
              <Input
                id="acc-confirm"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {pwMsg && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">{pwMsg}</p>
            )}
            {pwErr && <p className="text-sm text-destructive">{pwErr}</p>}
            <Button type="submit" variant="secondary" disabled={savingPw}>
              {savingPw ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
