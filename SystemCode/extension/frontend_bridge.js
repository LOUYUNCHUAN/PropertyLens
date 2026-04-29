/**
 * PropertyLens frontend bridge
 * Runs on the local web app (http://localhost:5173) as a content script.
 *
 * Two responsibilities:
 *
 * 1. Mirror the active frontend username (localStorage.hdb_user) into
 *    chrome.storage.local under `propertylens_username` so the PropertyGuru
 *    content script saves shortlist items under whichever user is logged in.
 *
 * 2. Bridge listing photos scraped on PropertyGuru into the Buyer view. The
 *    PG content script stashes image URLs in chrome.storage.local under a
 *    short token (`pl_img_*`); the Buyer view doesn't have direct access to
 *    chrome.storage, so it postMessages a request and we reply with the
 *    payload. Only same-window postMessages are honoured (event.source check).
 */

const STORAGE_KEY = 'propertylens_username'

function syncUsername() {
  try {
    const u = String(localStorage.getItem('hdb_user') || '').trim()
    if (!u) return
    chrome.storage.local.get([STORAGE_KEY], (r) => {
      if (String(r[STORAGE_KEY] || '') !== u) {
        chrome.storage.local.set({ [STORAGE_KEY]: u })
      }
    })
  } catch {}
}

syncUsername()
window.addEventListener('storage', (e) => {
  if (e.key === 'hdb_user') syncUsername()
})
setInterval(syncUsername, 2000)

try {
  console.log('[PropertyLens-Bridge] loaded on', window.location.href)
} catch {}

// ── Image-token bridge ────────────────────────────────────────────────────
//
// The page sends:
//   window.postMessage({ source: 'propertylens-page', type: 'img-request', token })
// We reply with:
//   window.postMessage({ source: 'propertylens-bridge', type: 'img-payload', token, images, listing_url, error })

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== 'propertylens-page' || data.type !== 'img-request') {
    return
  }
  try { console.log('[PropertyLens-Bridge] img-request', data.token) } catch {}
  const token = String(data.token || '').trim()
  if (!token || !token.startsWith('pl_img_')) {
    window.postMessage(
      { source: 'propertylens-bridge', type: 'img-payload', token, error: 'invalid-token' },
      '*'
    )
    return
  }
  try {
    chrome.storage.local.get([token], (r) => {
      const entry = r && r[token]
      if (!entry) {
        window.postMessage(
          {
            source: 'propertylens-bridge',
            type: 'img-payload',
            token,
            error: 'not-found'
          },
          '*'
        )
        return
      }
      const expired = entry.expires_at && entry.expires_at < Date.now()
      if (expired) {
        chrome.storage.local.remove([token])
        window.postMessage(
          {
            source: 'propertylens-bridge',
            type: 'img-payload',
            token,
            error: 'expired'
          },
          '*'
        )
        return
      }
      window.postMessage(
        {
          source: 'propertylens-bridge',
          type: 'img-payload',
          token,
          images: Array.isArray(entry.images) ? entry.images : [],
          listing_url: entry.listing_url || null
        },
        '*'
      )
    })
  } catch (e) {
    window.postMessage(
      {
        source: 'propertylens-bridge',
        type: 'img-payload',
        token,
        error: String((e && e.message) || e)
      },
      '*'
    )
  }
})
