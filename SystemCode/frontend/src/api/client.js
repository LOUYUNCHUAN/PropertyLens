import axios from 'axios'
import { parseChatSseComplete, createChatSseStreamParser } from '../lib/chatSse.js'

/** In dev, prefer same-origin + Vite proxy so /api hits the backend reliably. */
function apiBaseURL() {
  const env = import.meta.env.VITE_API_BASE_URL
  if (env != null && String(env).trim() !== '') return String(env).trim()
  if (import.meta.env.DEV) return ''
  return 'http://localhost:8000'
}

const API = axios.create({
  baseURL: apiBaseURL(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

export const apiLogs = []

API.interceptors.request.use((config) => {
  const tok =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('hdb_token')
      : null
  if (tok) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${tok}`
  }
  apiLogs.push({
    ts: new Date().toISOString(),
    type: 'request',
    method: config.method?.toUpperCase(),
    url: `${config.baseURL || ''}${config.url || ''}`,
    data: config.data
  })
  return config
})

API.interceptors.response.use(
  (response) => {
    apiLogs.push({
      ts: new Date().toISOString(),
      type: 'response',
      status: response.status,
      url: response.config.url,
      data: response.data
    })
    return response
  },
  (error) => {
    apiLogs.push({
      ts: new Date().toISOString(),
      type: 'error',
      message: error.message,
      url: error.config?.url,
      status: error.response?.status
    })
    return Promise.reject(error)
  }
)

export const predictPrice = (data) =>
  API.post('/api/predict', data).then((r) => r.data)

export const getSHAP = (data) =>
  API.post('/api/explain/shap', { flat: data }).then((r) => r.data)

/** Composite TreeSHAP over the full hybrid stack (XGB+LGB+RF, Ridge excluded). */
export const getCompositeSHAP = (data) =>
  API.post('/api/explain/composite-shap', { flat: data }).then((r) => r.data)

export const getLIME = (data) =>
  API.post('/api/explain/lime', { flat: data }).then((r) => r.data)

export const getCBR = (data, k = 5) =>
  API.post('/api/cbr/similar', { flat: data, k }).then((r) => r.data)

export const explainBuyerView = (data, k = 30) =>
  API.post('/api/explain/buyer-view', { flat: data, k }).then((r) => r.data)

export const getCounterfactual = (payload) =>
  API.post('/api/counterfactual', payload).then((r) => r.data)

/** Multipart upload: interior photo + base price → condition-adjusted price. */
export const adjustPriceWithPhoto = (file, basePrice) => {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('base_price', String(basePrice))
  return API.post('/api/predict/condition-photo', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000
  }).then((r) => r.data)
}

export const getModelMeta = () =>
  API.get('/api/model-meta').then((r) => r.data)

export const getTownSummary = () =>
  API.get('/api/analytics/town-summary').then((r) => r.data)

export const getGlobalSHAP = (cluster_id, source = 'composite') =>
  API.get('/api/analytics/global-shap', {
    params: {
      ...(cluster_id == null || cluster_id === '' ? {} : { cluster_id }),
      source
    }
  }).then((r) => r.data)

export const getTrends = (town) =>
  API.get('/api/analytics/trends', { params: town ? { town } : {} }).then(
    (r) => r.data
  )

export const getRecentTransactions = ({ limit = 15, town } = {}) =>
  API.get('/api/analytics/recent-transactions', {
    params: { limit, ...(town ? { town } : {}) }
  }).then((r) => r.data)

export const getRules = () =>
  API.get('/api/rules').then((r) => r.data)

/** Constraint check (Apriori + optional surrogate when flat is sent). */
export const validateListing = (body) =>
  API.post('/api/validate-listing', body).then((r) => r.data)

/** DB-backed auth (JWT). */
export const loginApi = (username, password) =>
  API.post('/api/auth/login', { username, password }, { timeout: 15000 }).then(
    (r) => r.data
  )

export const registerApi = (username, password, display_name) =>
  API.post(
    '/api/auth/register',
    { username, password, display_name },
    { timeout: 15000 }
  ).then((r) => r.data)

export const getAuthMe = () =>
  API.get('/api/auth/me').then((r) => r.data)

export const patchAuthMe = (body) =>
  API.patch('/api/auth/me', body).then((r) => r.data)

export const changePasswordApi = (current_password, new_password) =>
  API.post('/api/auth/change-password', { current_password, new_password }).then(
    (r) => r.data
  )

export const getNeo4jKb = () =>
  API.get('/api/debug/neo4j-kb').then((r) => r.data)

export const getPropertySearchGraph = () =>
  API.get('/api/debug/property-search-graph').then((r) => r.data)

export const getPolicyImpact = (town) =>
  API.get(`/api/kb/policy-impact/${encodeURIComponent(town)}`).then((r) => r.data)

export const geocodeAddress = (query) =>
  API.get('/api/geocode', { params: { q: query } }).then((r) => r.data)

export const getNearbyAmenities = (lat, lng, radiusM = 2000) =>
  API.get('/api/nearby', { params: { lat, lng, radius_m: radiusM } }).then((r) => r.data)

/** Persist a successful estimate (SQLite user history MVP). */
export const savePredictionHistory = (body) =>
  API.post('/api/history/prediction', body).then((r) => r.data)

export const getPredictionHistory = (username, limit = 20) =>
  API.get('/api/history/predictions', { params: { username, limit } }).then(
    (r) => r.data
  )

/** Wishlist / shortlist (per username; extension + Buyer). */
export const saveWishlistItem = (body) =>
  API.post('/api/wishlist/items', body).then((r) => r.data)

export const listWishlistItems = (username, limit = 50) =>
  API.get('/api/wishlist/items', { params: { username, limit } }).then(
    (r) => r.data
  )

export const getWishlistItem = (id, username) =>
  API.get(`/api/wishlist/items/${id}`, { params: { username } }).then(
    (r) => r.data
  )

export const deleteWishlistItem = (id, username) =>
  API.delete(`/api/wishlist/items/${id}`, { params: { username } }).then(
    (r) => r.data
  )

/**
 * Natural-language filter + sort over saved shortlist (Ollama → JSON plan on server).
 * Optional: mrt_max_dist_m / highway_min_dist_m (meters) override compiled constraints.
 * Long timeout: server may call Ollama for up to 60s.
 */
export const nlSearchShortlist = (username, query, limit = 80, opts = {}) =>
  API.post(
    '/api/wishlist/nl-search',
    { username, query, limit, ...opts },
    { timeout: 120000 }
  ).then((r) => r.data)

export const sendChat = async (payload) => {
  const res = await API.post('/api/chat', payload, { responseType: 'text' })
  return parseChatSseComplete(res.data || '')
}

/**
 * Streaming property-search chat (Layer 06 style).
 *
 * Callbacks:
 *   onStatus(string)
 *   onLog({level, text})
 *   onParams(obj)
 *   onToken(piece)
 *   onDone()
 *   onError(Error)
 */
export const streamPropertySearchChat = (payload, callbacks = {}) => {
  const { onStatus, onToken, onDone, onError, onLog, onParams } = callbacks
  const base = apiBaseURL()
  const url = base
    ? `${String(base).replace(/\/$/, '')}/api/property-search-chat`
    : '/api/property-search-chat'
  const headers = { 'Content-Type': 'application/json' }
  // streamPropertySearchChat uses raw fetch() (not the axios `API` instance),
  // so the global Authorization interceptor at client.js:20-28 does not fire.
  // Attach the JWT manually so backend tools that scope by username (e.g. the
  // shortlist projection in property_search_chat.py) see the right user.
  const tok =
    typeof localStorage !== 'undefined' ? localStorage.getItem('hdb_token') : null
  if (tok) headers.Authorization = `Bearer ${tok}`
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), 180000)

  const decodeSseText = (s) =>
    String(s || '')
      .replaceAll('\\\\', '\\')
      .replaceAll('\\n', '\n')

  const parser = createChatSseStreamParser((event) => {
    if (event === '[DONE]') return
    const logMatch = /^\[LOG\](.*?)\|(.*)\[\/LOG\]$/.exec(event)
    if (logMatch) {
      onLog?.({ level: logMatch[1], text: decodeSseText(logMatch[2]) })
      return
    }
    const statusMatch = /^\[STATUS\](.*)\[\/STATUS\]$/.exec(event)
    if (statusMatch) {
      onStatus?.(statusMatch[1])
      return
    }
    const paramsMatch = /^\[PARAMS\]([\s\S]*)\[\/PARAMS\]$/.exec(event)
    if (paramsMatch) {
      try {
        const obj = JSON.parse(paramsMatch[1])
        onParams?.(obj)
      } catch {
        /* ignore */
      }
      return
    }
    onToken?.(decodeSseText(event))
  })

  ;(async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal
      })
      if (!res.ok) {
        const raw = await res.text()
        let msg = raw
        try {
          const j = JSON.parse(raw)
          msg = (typeof j.detail === 'string' && j.detail) || j.message || raw
        } catch {
          /* use raw */
        }
        throw new Error(msg || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.flush()
      onDone?.()
    } catch (e) {
      if (e?.name !== 'AbortError') onError?.(e)
    } finally {
      clearTimeout(tid)
    }
  })()

  return ctrl
}

/** Example body for /api/predict — PropertyGuru demo listing (1 Lorong Lew Lian; see BuyerView defaults). */
export const SAMPLE_FLAT = {
  block: '1',
  street_name: 'LORONG LEW LIAN',
  town: 'SERANGOON',
  flat_type: '3 ROOM',
  floor_area_sqm: 64,
  storey_range: '07 TO 09',
  lease_commence_date: 1978,
  sale_month: '2026-04',
  storey_mid: 8,
  remaining_lease_years: 52,
  year: 2026,
  month_num: 4,
  dist_nearest_mrt_km: 0.5,
  is_mature_estate: 0,
  dist_nearest_primary_school_km: 0.5,
  dist_nearest_top_school_km: 1.5,
  dist_nearest_hawker_km: 0.3,
  dist_nearest_market_km: 0.5,
  mrt_count_within_1km: 1,
  primary_schools_within_1km: 2,
  primary_schools_within_2km: 5,
  top_school_within_1km: 0,
  top_school_within_2km: 0,
  hawkers_within_500m: 1
}

export const api = API
export default API

