const USERNAME_KEY = 'propertylens_username'

function loadUsername() {
  const input = document.getElementById('pl-username')
  chrome.storage.local.get([USERNAME_KEY], (r) => {
    input.value = r[USERNAME_KEY] || ''
  })
}

loadUsername()
document.getElementById('pl-save-username').addEventListener('click', () => {
  const v = document.getElementById('pl-username').value.trim()
  chrome.storage.local.set({ [USERNAME_KEY]: v }, () => {
    const btn = document.getElementById('pl-save-username')
    const prev = btn.textContent
    btn.textContent = 'Saved'
    setTimeout(() => {
      btn.textContent = prev
    }, 1200)
  })
})

// Health check when the popup opens
async function checkBackend() {
  const statusEl = document.getElementById('backend-status')
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('http://localhost:8000/health', {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (res.ok) {
      statusEl.innerHTML = '<span class="dot dot-green"></span>Connected'
      statusEl.style.color = '#4a7c6f'
    } else {
      throw new Error('not ok')
    }
  } catch {
    statusEl.innerHTML = '<span class="dot dot-red"></span>Offline'
    statusEl.style.color = '#c0392b'
  }
}

checkBackend()
