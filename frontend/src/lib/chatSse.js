/**
 * SSE from /api/chat: lines are "data: <payload>".
 * TCP chunks must not split lines — buffer until '\n'.
 */

export function parseChatSseComplete(raw) {
  let answer = ''
  let sources = []
  if (!raw) return { answer, sources }

  const lines = String(raw).split(/\r?\n/)
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trimStart()
    if (!payload || payload === '[DONE]') continue
    if (payload.startsWith('[SOURCES]')) {
      const match = payload.match(/\[SOURCES\](.*)\[\/SOURCES\]/)
      if (match?.[1]) {
        try {
          const parsed = JSON.parse(match[1])
          if (Array.isArray(parsed)) sources = parsed
        } catch {
          /* ignore */
        }
      }
      continue
    }
    answer += payload
  }
  return { answer, sources }
}

/**
 * Incremental parser: call push(chunkDecodedString), then flush() when stream ends.
 */
export function createChatSseStreamParser(onPayload) {
  let buffer = ''

  function push(chunk) {
    buffer += chunk
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl === -1) break
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trimStart()
      if (payload) onPayload(payload)
    }
  }

  function flush() {
    if (buffer.length) {
      const line = buffer.replace(/\r$/, '')
      buffer = ''
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trimStart()
        if (payload) onPayload(payload)
      }
    }
  }

  return { push, flush }
}
