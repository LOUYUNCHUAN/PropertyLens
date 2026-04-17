import axios from 'axios'
import { parseChatSseComplete } from '../lib/chatSse.js'

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

export const getLIME = (data) =>
  API.post('/api/explain/lime', { flat: data }).then((r) => r.data)

export const getCBR = (data, k = 5) =>
  API.post('/api/cbr/similar', { flat: data, k }).then((r) => r.data)

export const getCounterfactual = (payload) =>
  API.post('/api/counterfactual', payload).then((r) => r.data)

export const getModelMeta = () =>
  API.get('/api/model-meta').then((r) => r.data)

export const getTownSummary = () =>
  API.get('/api/analytics/town-summary').then((r) => r.data)

export const getGlobalSHAP = (cluster_id) =>
  API.get('/api/analytics/global-shap', {
    params:
      cluster_id == null || cluster_id === ''
        ? {}
        : { cluster_id }
  }).then((r) => r.data)

export const getTrends = (town) =>
  API.get('/api/analytics/trends', { params: town ? { town } : {} }).then(
    (r) => r.data
  )

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

export const sendChat = async (payload) => {
  const res = await API.post('/api/chat', payload, { responseType: 'text' })
  return parseChatSseComplete(res.data || '')
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

