import { useState } from 'react'
import { sendChat } from '../api/client.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { ChatMarkdown } from '../components/ChatMarkdown.jsx'

const SUGGESTIONS = [
  'What drives HDB prices in Bishan?',
  'Which flat type has the best value?',
  'How did 2022 cooling measures affect prices?',
  'What are the top pricing patterns?'
]

export default function AskAIView() {
  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSend = async (message) => {
    if (!message.trim()) return
    const newHistory = [...history, { role: 'user', content: message }]
    setHistory(newHistory)
    setInput('')
    setLoading(true)
    try {
      const res = await sendChat({ message, history: newHistory })
      setHistory((prev) => [
        ...prev,
        { role: 'assistant', content: res.answer, sources: res.sources }
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)] min-w-0">
      <section className="card flex flex-col h-[min(480px,calc(100vh-8rem))] min-w-0 overflow-hidden">
        <div className="section-label">Ask HDB ResaleXAI</div>
        <div className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto space-y-3 pr-1">
          {history.length === 0 && (
            <div className="text-xs text-[color:var(--ink-muted)] mb-3">
              Ask natural language questions about HDB prices, rules and
              patterns. Try:
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
                justifyContent:
                  m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: '6px'
              }}
            >
              <div
                className="min-w-0 overflow-hidden"
                style={{
                  maxWidth: m.role === 'user' ? 'min(85%, 20rem)' : '100%',
                  background:
                    m.role === 'user' ? 'var(--sage)' : 'var(--warm-white)',
                  color: m.role === 'user' ? 'white' : 'var(--ink)',
                  borderRadius:
                    m.role === 'user'
                      ? '16px 0 16px 16px'
                      : '0 16px 16px 16px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  boxShadow:
                    m.role === 'user' ? 'var(--shadow-sm)' : 'none'
                }}
              >
                {m.role === 'assistant' ? (
                  <ChatMarkdown text={m.content} />
                ) : (
                  m.content
                )}
                {m.role === 'assistant' && m.sources && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.sources.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 rounded-full bg-[color:var(--blue-light)] text-[10px] text-[color:var(--blue-sg)]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <LoadingSpinner label="Thinking..." />}
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
            placeholder="Ask about HDB prices, rules, or factors…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Send
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="card">
          <div className="section-label mb-2">What this chat can do</div>
          <ul className="text-xs text-[color:var(--ink-muted)] space-y-1">
            <li>• Explain what drives prices in a town or for a flat type.</li>
            <li>
              • Summarise pricing patterns from historical transactions (Apriori
              rules).
            </li>
            <li>• Describe top SHAP features for the model.</li>
            <li>• Help interpret the Buyer / Seller / Analyst views.</li>
          </ul>
        </div>
      </section>
    </div>
  )
}

