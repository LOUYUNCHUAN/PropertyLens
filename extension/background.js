// Minimal service worker — required by Manifest V3
chrome.runtime.onInstalled.addListener(() => {
  console.log('PropertyLens extension installed')
})
