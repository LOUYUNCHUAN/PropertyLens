/**
 * PropertyLens frontend bridge
 * Runs on the local web app (http://localhost:5173) and mirrors the active
 * frontend username (localStorage.hdb_user) into chrome.storage.local under
 * `propertylens_username`, so the PropertyGuru content script saves shortlist
 * items under whichever user is currently logged in.
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
