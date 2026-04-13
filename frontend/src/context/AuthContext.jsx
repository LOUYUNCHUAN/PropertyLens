import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { getAuthMe } from '../api/client.js'

const AuthContext = createContext(null)

const TOKEN_KEY = 'hdb_token'
const USER_KEY = 'hdb_user'
const DISPLAY_KEY = 'hdb_display_name'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [username, setUsername] = useState(
    () => localStorage.getItem(USER_KEY) || ''
  )
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(DISPLAY_KEY) || ''
  )

  const isLoggedIn = Boolean(token)

  const applySession = useCallback((accessToken, user, name) => {
    localStorage.setItem(TOKEN_KEY, accessToken)
    localStorage.setItem(USER_KEY, user)
    if (name != null && name !== '') {
      localStorage.setItem(DISPLAY_KEY, name)
    } else {
      localStorage.removeItem(DISPLAY_KEY)
    }
    setToken(accessToken)
    setUsername(user)
    setDisplayName(name || '')
  }, [])

  const login = useCallback(
    (accessToken, user, name) => {
      applySession(accessToken, user, name ?? '')
    },
    [applySession]
  )

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(DISPLAY_KEY)
    localStorage.removeItem('hdb_auth')
    setToken(null)
    setUsername('')
    setDisplayName('')
  }, [])

  const refreshProfile = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) return
    const me = await getAuthMe()
    setUsername(me.username)
    localStorage.setItem(USER_KEY, me.username)
    setDisplayName(me.display_name || '')
    if (me.display_name) {
      localStorage.setItem(DISPLAY_KEY, me.display_name)
    } else {
      localStorage.removeItem(DISPLAY_KEY)
    }
  }, [])

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) return
    getAuthMe()
      .then((me) => {
        setUsername(me.username)
        localStorage.setItem(USER_KEY, me.username)
        setDisplayName(me.display_name || '')
        if (me.display_name) {
          localStorage.setItem(DISPLAY_KEY, me.display_name)
        } else {
          localStorage.removeItem(DISPLAY_KEY)
        }
      })
      .catch(() => {
        logout()
      })
  }, [logout])

  const value = useMemo(
    () => ({
      isLoggedIn,
      token,
      username,
      displayName,
      setDisplayName,
      login,
      logout,
      applySession,
      refreshProfile
    }),
    [
      isLoggedIn,
      token,
      username,
      displayName,
      login,
      logout,
      applySession,
      refreshProfile
    ]
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
