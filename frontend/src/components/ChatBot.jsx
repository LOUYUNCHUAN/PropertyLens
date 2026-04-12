import { useState, useRef } from 'react'
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

  async function sendMessage(e, overrideText) {
    if (e && e.preventDefault) e.preventDefault()

    const text = (overrideText ?? input).trim()
    if (!text) return

    const userText = text
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: userText }])

    // Basic entity extraction from the question
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
      const res = await fetch(`${baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, history: historyPayload }),
        signal: controllerRef.current.signal
      })

      if (!res.ok || !res.body) throw new Error('Chat request failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let answer = ''

      setMessages((prev) => [...prev, { role: 'assistant', text: '' }])

      const parser = createChatSseStreamParser((payload) => {
        if (payload === '[DONE]') return
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
        answer += payload
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

      // Attach simple entity chips once complete
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
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: '999px',
          border: 'none',
          background: 'var(--green-500)',
          color: '#fff',
          boxShadow: '0 10px 25px rgba(34,197,94,0.55)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          animation: 'pulse 2.2s infinite'
        }}
      >
        ?
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 96,
            width: 'min(calc(100vw - 32px), 400px)',
            maxWidth: 'min(calc(100vw - 32px), 400px)',
            maxHeight: 'min(520px, calc(100vh - 120px))',
            background: 'var(--bg-card)',
            borderRadius: 20,
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 50,
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                Ask HDB ResaleXAI
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)'
                }}
              >
                Local LLM + rules / SHAP context
              </div>
            </div>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-muted)'
              }}
            >
              beta
            </span>
          </div>

          <div
            style={{
              padding: '8px 12px',
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--border)'
            }}
          >
            {[
              'Why is this flat priced this way?',
              'Show rules for 4-room in Bedok',
              'What impacts price near MRT?'
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  sendMessage(null, q)
                }}
                style={{
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  padding: '4px 8px',
                  fontSize: 11,
                  background: '#f9fafb',
                  cursor: 'pointer'
                }}
              >
                {q}
              </button>
            ))}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: '10px 12px',
              overflowX: 'hidden',
              overflowY: 'auto',
              fontSize: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                  maxWidth: '100%',
                  minWidth: 0,
                  width: m.role === 'assistant' ? '100%' : 'auto'
                }}
              >
                <div
                  style={{
                    maxWidth: m.role === 'user' ? 'min(100%, 16rem)' : '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                    background:
                      m.role === 'user' ? 'var(--green-500)' : 'var(--bg-card)',
                    color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                    padding: '8px 10px',
                    borderRadius:
                      m.role === 'user'
                        ? '14px 14px 2px 14px'
                        : '14px 14px 14px 2px',
                    border:
                      m.role === 'user'
                        ? 'none'
                        : '1px solid rgba(148, 163, 184, 0.5)'
                  }}
                >
                  {m.role === 'assistant' ? (
                    <ChatMarkdown text={m.text} />
                  ) : (
                    m.text
                  )}
                </div>
                {m.role === 'assistant' && (m.sources || m.entities) && (
                  <div
                    style={{
                      marginTop: 4,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 4
                    }}
                  >
                    {m.sources?.map((s) => (
                      <span
                        key={s}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: 'var(--blue-100)',
                          color: 'var(--blue-500)'
                        }}
                      >
                        {s}
                      </span>
                    ))}
                    {m.entities?.towns?.map((t) => (
                      <span
                        key={`town-${t}`}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: '#e5e7eb',
                          color: '#374151'
                        }}
                      >
                        Town: {t}
                      </span>
                    ))}
                    {m.entities?.flatType && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: '#e5e7eb',
                          color: '#374151'
                        }}
                      >
                        Flat type: {m.entities.flatType}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)'
                }}
              >
                Typing<span style={{ animation: 'blink 1.2s infinite' }}>…</span>
              </div>
            )}
          </div>

          <form
            onSubmit={sendMessage}
            style={{
              padding: '10px 12px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 8
            }}
          >
            <input
              className="input-base"
              placeholder="Ask about HDB resale…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ paddingInline: 16 }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  )
}

