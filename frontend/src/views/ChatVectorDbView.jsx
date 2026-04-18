import { useEffect, useRef, useState } from 'react'
import { streamRagChat } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { ChatMarkdown } from '../components/ChatMarkdown.jsx'

const SUGGESTIONS = [
  'Is $580k fair for a 4-room flat in Tampines?',
  'What amenities are near Bedok North?',
  'What is on my shortlist?',
  'Show similar past sales for my saved listing'
]

const STATUS_LABEL = {
  retrieving: 'Retrieving context from vector DB…',
  no_retrieval: 'Skipped retrieval (no index-worthy query)',
  generating: 'Generating answer with Ollama…',
  done: 'Done',
  error: 'Error'
}

const LEVEL_COLOR = {
  info: 'var(--blue-sg)',
  warn: '#b45309',
  error: '#9b2c2c',
  debug: 'var(--ink-muted)',
  client: 'var(--primary)'
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour12: false })
    + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function formatSource(s) {
  if (typeof s === 'string') return s
  if (s && typeof s === 'object') {
    const src = s.source ?? ''
    const town = s.town ? ` · ${s.town}` : ''
    return `[${s.i ?? '?'}] ${src}${town}`
  }
  return String(s)
}

export default function ChatVectorDbView() {
  const { username } = useAuth()
  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [intent, setIntent] = useState(null)
  const [liveSources, setLiveSources] = useState([])
  const [liveAnswer, setLiveAnswer] = useState('')
  const [tokenCount, setTokenCount] = useState(0)
  const [logs, setLogs] = useState([])
  const [tab, setTab] = useState('log')
  const [llm, setLlm] = useState(() => {
    if (typeof localStorage === 'undefined') return 'ollama'
    return localStorage.getItem('rag_llm') || 'ollama'
  })
  const ctrlRef = useRef(null)
  const logEndRef = useRef(null)
  const logBoxRef = useRef(null)
  const chatBoxRef = useRef(null)

  useEffect(() => {
    if (tab !== 'log') return
    const el = logBoxRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs, tab])

  useEffect(() => {
    const el = chatBoxRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) el.scrollTop = el.scrollHeight
  }, [history, liveAnswer, loading])

  const pushLog = (level, text) => {
    setLogs((prev) => [...prev, { ts: new Date(), level, text }])
  }

  const resetStreamState = () => {
    setStatus(null)
    setIntent(null)
    setLiveSources([])
    setLiveAnswer('')
    setTokenCount(0)
  }

  const handleSend = (message) => {
    if (!message.trim() || loading) return
    const priorHistory = history
    setHistory([...history, { role: 'user', content: message }])
    setInput('')
    setLoading(true)
    resetStreamState()
    setStatus('retrieving')
    pushLog('client', `→ POST /api/rag-chat  ${JSON.stringify({ msg: message.slice(0, 60) })}`)

    let answerBuf = ''
    let sourcesBuf = []

    ctrlRef.current = streamRagChat(
      { message, history: priorHistory, username: username || undefined, llm },
      {
        onIntent: (i) => {
          setIntent(i)
          pushLog('info', `intent=${i}`)
        },
        onLog: ({ level, text }) => pushLog(level, text),
        onStatus: (s) => {
          setStatus(s)
          pushLog('debug', `status=${s}`)
        },
        onSources: (arr) => {
          sourcesBuf = arr
          setLiveSources(arr)
        },
        onToken: (t) => {
          answerBuf += t
          setLiveAnswer(answerBuf)
          setTokenCount((n) => n + 1)
        },
        onDone: () => {
          setHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: answerBuf || '(No reply text received.)',
              sources: sourcesBuf
            }
          ])
          setStatus('done')
          setLiveAnswer('')
          setLoading(false)
          pushLog('client', '✓ stream closed')
        },
        onError: (e) => {
          setHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `**Error:** ${e?.message || 'Request failed'}`,
              sources: []
            }
          ])
          setStatus('error')
          setLoading(false)
          pushLog('error', `client error: ${e?.message || 'Request failed'}`)
        }
      }
    )
  }

  const handleCancel = () => {
    ctrlRef.current?.abort()
    setLoading(false)
    setStatus(null)
    pushLog('client', '⨯ aborted')
  }

  const handleClearLog = () => setLogs([])

  const handleLlmChange = (next) => {
    setLlm(next)
    if (typeof localStorage !== 'undefined') localStorage.setItem('rag_llm', next)
    pushLog('client', `LLM switched to ${next}`)
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)] min-w-0 h-full min-h-0">
      <section className="card flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
        <div className="section-label">Ask AI (beta) · VectorDB</div>
        <p className="text-xs text-[color:var(--ink-muted)] mb-2">
          Pinecone-backed hybrid RAG with optional model prediction, CBR comps,
          SHAP, and your saved shortlist. The <strong>first</strong> reply can take a few
          minutes while encoders load; later messages are faster.
        </p>
        <div
          ref={chatBoxRef}
          className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto space-y-3 pr-1"
        >
          {history.length === 0 && (
            <div className="text-xs text-[color:var(--ink-muted)] mb-3">
              Ask about HDB resale, amenities, or your shortlist. Try:
            </div>
          )}
          {history.length === 0 &&
            SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSend(s)}
                className="text-xs px-3 py-2 mb-2 rounded-full border border-[color:var(--border)] bg-[color:var(--sage-pale)] hover:bg-[color:var(--sage-light)] text-left"
              >
                {s}
              </button>
            ))}

          {history.map((m, i) => (
            <div
              key={i}
              className="flex min-w-0 w-full"
              style={{
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: '6px'
              }}
            >
              <div
                className="min-w-0 overflow-hidden"
                style={{
                  maxWidth: m.role === 'user' ? 'min(85%, 20rem)' : '100%',
                  background:
                    m.role === 'user' ? 'var(--primary)' : 'var(--sage-pale)',
                  color:
                    m.role === 'user' ? 'var(--primary-foreground)' : 'var(--ink)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                  borderRadius:
                    m.role === 'user' ? '16px 0 16px 16px' : '0 16px 16px 16px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  boxShadow: m.role === 'user' ? 'var(--shadow-sm)' : 'none'
                }}
              >
                {m.role === 'assistant' ? (
                  <ChatMarkdown text={m.content} />
                ) : (
                  m.content
                )}
                {m.role === 'assistant' && m.sources?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.sources.map((s, j) => (
                      <span
                        key={j}
                        className="px-2 py-0.5 rounded-full bg-[color:var(--blue-light)] text-[10px] text-[color:var(--blue-sg)]"
                      >
                        {formatSource(s)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && liveAnswer && (
            <div className="flex w-full" style={{ justifyContent: 'flex-start' }}>
              <div
                className="min-w-0 overflow-hidden"
                style={{
                  maxWidth: '100%',
                  background: 'var(--sage-pale)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: '0 16px 16px 16px',
                  padding: '8px 12px',
                  fontSize: '13px'
                }}
              >
                <ChatMarkdown text={liveAnswer} />
                <span
                  className="inline-block w-2 h-3 align-baseline ml-1"
                  style={{ background: 'var(--ink-muted)', animation: 'pulse 1s infinite' }}
                />
              </div>
            </div>
          )}

          {loading && !liveAnswer && <LoadingSpinner label={STATUS_LABEL[status] || 'Thinking…'} />}
        </div>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            handleSend(input)
          }}
        >
          <div className="flex items-center gap-2 text-[11px] text-[color:var(--ink-muted)]">
            <span>LLM:</span>
            <div className="inline-flex rounded-full border border-[color:var(--border)] overflow-hidden">
              {['ollama', 'gemini'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleLlmChange(opt)}
                  disabled={loading}
                  className="px-3 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: llm === opt ? 'var(--primary)' : 'transparent',
                    color:
                      llm === opt ? 'var(--primary-foreground)' : 'var(--ink-muted)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading && llm !== opt ? 0.5 : 1
                  }}
                >
                  {opt === 'ollama' ? 'Ollama (local)' : 'Gemini 2.5 Flash'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              className="input-base"
              placeholder="Ask about HDB resale, amenities, or your shortlist…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            {loading ? (
              <button type="button" className="btn-secondary" onClick={handleCancel}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn-primary">Send</button>
            )}
          </div>
        </form>
      </section>

      <section className="flex flex-col h-full min-h-0">
        <div
          className="card flex flex-col flex-1 min-h-0"
          style={{ padding: '14px' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setTab('log')}
                className="px-3 py-1 rounded"
                style={{
                  background: tab === 'log' ? 'var(--primary)' : 'transparent',
                  color: tab === 'log' ? 'var(--primary-foreground)' : 'var(--ink-muted)',
                  border: tab === 'log' ? 'none' : '1px solid var(--border)',
                  fontWeight: 600
                }}
              >
                Log {logs.length > 0 && <span className="opacity-70">· {logs.length}</span>}
              </button>
              <button
                type="button"
                onClick={() => setTab('sources')}
                className="px-3 py-1 rounded"
                style={{
                  background: tab === 'sources' ? 'var(--primary)' : 'transparent',
                  color: tab === 'sources' ? 'var(--primary-foreground)' : 'var(--ink-muted)',
                  border: tab === 'sources' ? 'none' : '1px solid var(--border)',
                  fontWeight: 600
                }}
              >
                Sources {liveSources.length > 0 && <span className="opacity-70">· {liveSources.length}</span>}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[color:var(--ink-muted)]">
              {intent && (
                <span
                  className="px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--blue-light)', color: 'var(--blue-sg)', fontWeight: 600 }}
                >
                  {intent}
                </span>
              )}
              {loading && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: 'var(--primary)', animation: 'pulse 1s infinite' }}
                  />
                  live
                </span>
              )}
              {tab === 'log' && logs.length > 0 && !loading && (
                <button
                  type="button"
                  onClick={handleClearLog}
                  className="hover:underline"
                >
                  clear
                </button>
              )}
            </div>
          </div>

          {tab === 'log' ? (
            <div
              ref={logBoxRef}
              className="flex-1 min-h-0 overflow-y-auto rounded font-mono"
              style={{
                background: '#0f172a',
                color: '#e2e8f0',
                padding: '10px 12px',
                fontSize: '11.5px',
                lineHeight: 1.55
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: '#64748b' }}>Waiting for request…</div>
              ) : (
                <>
                  {logs.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words">
                      <span style={{ color: '#64748b' }}>{fmtTime(l.ts)}</span>{' '}
                      <span style={{ color: LEVEL_COLOR[l.level] || '#e2e8f0', fontWeight: 600 }}>
                        {l.level.padEnd(5)}
                      </span>{' '}
                      <span>{l.text}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {liveSources.length === 0 ? (
                <div className="text-xs text-[color:var(--ink-muted)]">
                  No sources yet. Send a question to fetch retrieved chunks.
                </div>
              ) : (
                <div className="space-y-2">
                  {liveSources.map((s, j) => {
                    const full = s.text || s.snippet || ''
                    const hasMore = full.length >= 1500
                    return (
                      <details
                        key={j}
                        className="text-[11px] rounded"
                        style={{
                          background: 'var(--sage-pale)',
                          border: '1px solid var(--border)',
                          color: 'var(--ink)'
                        }}
                      >
                        <summary
                          className="flex justify-between items-center p-2 cursor-pointer"
                          style={{ listStyle: 'none' }}
                        >
                          <span className="font-medium truncate">
                            [{s.i}] {s.source || '?'}
                            {s.town ? ` · ${s.town}` : ''}
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            {typeof s.score === 'number' && (
                              <span className="text-[color:var(--ink-muted)] mono">
                                {s.score.toFixed(3)}
                              </span>
                            )}
                            <span className="text-[color:var(--ink-muted)]">▸</span>
                          </span>
                        </summary>
                        <div className="px-2 pb-2 pt-0">
                          {full ? (
                            <>
                              <div
                                className="text-[color:var(--ink)] whitespace-pre-wrap"
                                style={{ lineHeight: 1.45, fontSize: '11px' }}
                              >
                                {full}
                              </div>
                              <div className="flex gap-3 mt-1.5 text-[10px]">
                                <button
                                  type="button"
                                  className="text-[color:var(--blue-sg)] hover:underline"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    navigator.clipboard?.writeText(full)
                                  }}
                                >
                                  Copy
                                </button>
                                {hasMore && (
                                  <span className="text-[color:var(--ink-muted)]">
                                    (truncated at 1500 chars)
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="text-[color:var(--ink-muted)] italic">
                              No text in metadata.
                            </div>
                          )}
                        </div>
                      </details>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tokenCount > 0 && (
            <div className="mt-2 text-[11px] text-[color:var(--ink-muted)] flex gap-3">
              <span>tokens: {tokenCount}</span>
              {status && <span>status: {status}</span>}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
