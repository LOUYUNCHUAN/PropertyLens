import { useEffect, useRef, useState } from 'react'
import { ChatMarkdown } from '../components/ChatMarkdown.jsx'
import { streamPropertySearchChat } from '../api/client.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'

const SUGGESTIONS = [
  'Find a 4-room flat in Bishan near famous schools under $900k',
  '3-room flat near MRT in Toa Payoh under $500k',
  'Show me flats within 1km of Nanyang Primary School',
  'Large 5-room flat with long lease, affordable price, away from highway noise',
  '3-room flat in Bishan under $100k',
  'Find a 4-room flat near Tampines with famous school and MRT access'
]

export default function PropertySearchAIView() {
  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [params, setParams] = useState(null)
  const [liveAnswer, setLiveAnswer] = useState('')
  const ctrlRef = useRef(null)
  const chatBoxRef = useRef(null)

  useEffect(() => {
    const el = chatBoxRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) el.scrollTop = el.scrollHeight
  }, [history, liveAnswer, loading])

  const resetStreamState = () => {
    setStatus(null)
    setParams(null)
    setLiveAnswer('')
  }

  const handleSend = (message) => {
    const msg = String(message || '').trim()
    if (!msg || loading) return

    // Include prior assistant params in the history payload so the backend can
    // make follow-ups conversational (carry over weights/filters).
    const priorHistory = history
    setHistory([...history, { role: 'user', content: msg }])
    setInput('')
    setLoading(true)
    resetStreamState()
    setStatus('starting')

    let answerBuf = ''
    let paramsBuf = null
    ctrlRef.current?.abort()
    ctrlRef.current = streamPropertySearchChat(
      { message: msg, history: priorHistory },
      {
        onStatus: (s) => setStatus(s),
        onParams: (p) => {
          paramsBuf = p
          setParams(p)
        },
        onToken: (t) => {
          answerBuf += t
          setLiveAnswer(answerBuf)
        },
        onDone: () => {
          setHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: answerBuf || '(No reply text received.)',
              params: paramsBuf
            }
          ])
          setLiveAnswer('')
          setLoading(false)
          setStatus('done')
        },
        onError: (e) => {
          setHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `**Error:** ${e?.message || 'Request failed'}`,
              params: null
            }
          ])
          setLoading(false)
          setStatus('error')
        }
      }
    )
  }

  const handleCancel = () => {
    ctrlRef.current?.abort()
    setLoading(false)
    setStatus(null)
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)] min-w-0 h-full min-h-0">
      <section className="card flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
        <div className="section-label">Ask AI</div>
        <p className="text-xs text-[color:var(--ink-muted)] mb-2">
          Natural-language property search over the Neo4j property graph (Layer 06 weighted ranking).
        </p>

        <div
          ref={chatBoxRef}
          className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto space-y-3 pr-1"
        >
          {history.length === 0 && (
            <div className="text-xs text-[color:var(--ink-muted)] mb-3">
              Try one of these:
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
              className={
                m.role === 'user'
                  ? 'flex max-w-full min-w-0 flex-col items-end'
                  : 'flex max-w-full min-w-0 w-full flex-col items-stretch'
              }
            >
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[min(100%,24rem)] min-w-0 overflow-hidden rounded-[14px_14px_2px_14px] bg-primary px-3 py-2 text-[13px] text-primary-foreground shadow-sm'
                    : 'max-w-full min-w-0 overflow-hidden rounded-[14px_14px_14px_2px] border border-border bg-card px-3 py-2 text-[13px] text-foreground'
                }
              >
                {m.role === 'assistant' ? <ChatMarkdown text={m.content} /> : m.content}
              </div>
            </div>
          ))}

          {loading && (
            <>
              <LoadingSpinner label={status ? `Working… (${status})` : 'Working…'} />
              {liveAnswer && (
                <div className="card p-3">
                  <ChatMarkdown text={liveAnswer} />
                </div>
              )}
            </>
          )}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            handleSend(input)
          }}
        >
          <input
            className="input-base"
            placeholder="e.g. 4-room in Tampines under $700k near MRT"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            Send
          </button>
          {loading && (
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </form>
      </section>

      <section className="space-y-3">
        <div className="card">
          <div className="section-label mb-2">What this feature needs</div>
          <ul className="text-xs text-[color:var(--ink-muted)] space-y-1">
            <li>• Ollama running locally (model: {import.meta.env.VITE_OLLAMA_MODEL || 'gemma3'}).</li>
            <li>• Neo4j configured in backend env and loaded with Layer 06 Property graph.</li>
          </ul>
        </div>
        {params && (
          <div className="card">
            <div className="section-label mb-2">Inferred params (debug)</div>
            <pre className="text-xs whitespace-pre-wrap text-[color:var(--ink-muted)]">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  )
}

