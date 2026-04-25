import { useEffect, useRef, useState } from 'react'
import { ChatMarkdown } from './ChatMarkdown.jsx'
import { TOWNS } from '../constants/towns.js'
import { api } from '../api/client.js'
import { createChatSseStreamParser } from '../lib/chatSse.js'

export default function ChatBot() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const controllerRef = useRef(null)
  const chatBoxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const el = chatBoxRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) el.scrollTop = el.scrollHeight
  }, [messages, loading, open])

  async function sendMessage(e, overrideText) {
    if (e && e.preventDefault) e.preventDefault()

    const text = (overrideText ?? input).trim()
    if (!text) return

    const userText = text
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: userText }])

    const lower = userText.toLowerCase()
    const towns = TOWNS.filter((t) =>
      lower.includes(t.toLowerCase().replace('/', ' '))
    )
    let flatType = null
    const ftMatch = lower.match(/([1-5])\s*[- ]?room/)
    if (ftMatch) flatType = `${ftMatch[1]} ROOM`

    setLoading(true)
    const newMessages = [...messages, { role: 'user', text: userText }]
    const historyPayload = newMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    }))
    controllerRef.current?.abort()
    controllerRef.current = new AbortController()

    try {
      const baseURL = api.defaults.baseURL || 'http://localhost:8000'
      const tok =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('hdb_token')
          : null
      const headers = { 'Content-Type': 'application/json' }
      if (tok) headers.Authorization = `Bearer ${tok}`

      const res = await fetch(`${baseURL}/api/property-search-chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: userText, history: historyPayload }),
        signal: controllerRef.current.signal
      })

      if (!res.ok || !res.body) throw new Error('Chat request failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let answer = ''

      setMessages((prev) => [...prev, { role: 'assistant', text: '' }])

      const decodeSseText = (s) =>
        String(s || '')
          .replaceAll('\\\\', '\\')
          .replaceAll('\\n', '\n')

      const parser = createChatSseStreamParser((payload) => {
        if (payload === '[DONE]') return
        if (payload.startsWith('[LOG]')) return
        if (payload.startsWith('[STATUS]')) return
        if (payload.startsWith('[PARAMS]')) return
        if (payload.startsWith('[SOURCES]')) {
          const match = payload.match(/\[SOURCES\](.*)\[\/SOURCES\]/)
          if (match?.[1]) {
            try {
              const parsed = JSON.parse(match[1])
              if (Array.isArray(parsed)) {
                setMessages((prev) => {
                  const i = prev.length - 1
                  if (i < 0 || prev[i].role !== 'assistant') return prev
                  const next = [...prev]
                  next[i] = { ...next[i], sources: parsed }
                  return next
                })
              }
            } catch {
              /* ignore */
            }
          }
          return
        }
        answer += decodeSseText(payload)
        setMessages((prev) => {
          const i = prev.length - 1
          if (i < 0 || prev[i].role !== 'assistant') return prev
          const next = [...prev]
          next[i] = { ...next[i], text: answer }
          return next
        })
      })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.flush()

      if (towns.length || flatType) {
        setMessages((prev) => {
          const i = prev.length - 1
          if (i < 0 || prev[i].role !== 'assistant') return prev
          const next = [...prev]
          next[i] = { ...next[i], entities: { towns, flatType } }
          return next
        })
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Sorry, something went wrong talking to the AI backend.'
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-[1100] flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-0 bg-primary text-xl font-semibold text-primary-foreground shadow-lg shadow-primary/40 animate-pulse"
        aria-label="Open chat"
      >
        ?
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-4 z-[1100] flex max-h-[min(520px,calc(100vh-120px))] w-[min(calc(100vw-32px),400px)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg ring-1 ring-white/10"
          style={{ boxSizing: 'border-box' }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Ask AI</div>
            </div>
          </div>

          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
              {[
                'Find a 4-room flat in Bishan near famous schools under $900k',
                '3-room flat near MRT in Toa Payoh under $500k',
                'Show me flats within 1km of Nanyang Primary School',
                'Large 5-room flat with long lease, affordable price, away from highway noise',
                '3-room flat in Bishan under $100k',
                'Find a 4-room flat near Tampines with famous school and MRT access'
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    sendMessage(null, q)
                  }}
                  className="cursor-pointer rounded-full border border-border bg-muted/50 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div
            ref={chatBoxRef}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-3 text-[13px]"
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={
                  m.role === 'user'
                    ? 'flex max-w-full min-w-0 flex-col items-end'
                    : 'flex max-w-full min-w-0 w-full flex-col items-stretch'
                }
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[min(100%,16rem)] min-w-0 overflow-hidden rounded-[14px_14px_2px_14px] bg-primary px-2.5 py-2 text-primary-foreground'
                      : 'max-w-full min-w-0 overflow-hidden rounded-[14px_14px_14px_2px] border border-border bg-muted/30 px-2.5 py-2 text-foreground'
                  }
                >
                  {m.role === 'assistant' ? (
                    <ChatMarkdown text={m.text} />
                  ) : (
                    m.text
                  )}
                </div>
                {m.role === 'assistant' && (m.sources || m.entities) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.sources?.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-blue-light px-1.5 py-0.5 text-[10px] text-blue-sg"
                      >
                        {s}
                      </span>
                    ))}
                    {m.entities?.towns?.map((t) => (
                      <span
                        key={`town-${t}`}
                        className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        Town: {t}
                      </span>
                    ))}
                    {m.entities?.flatType && (
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Flat type: {m.entities.flatType}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-[11px] text-muted-foreground">
                Typing<span className="animate-blink">…</span>
              </div>
            )}
          </div>

          <form
            onSubmit={sendMessage}
            className="flex gap-2 border-t border-border p-3"
          >
            <input
              className="input-base flex-1"
              placeholder="Ask about HDB resale…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary shrink-0 px-4"
              disabled={loading}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  )
}
