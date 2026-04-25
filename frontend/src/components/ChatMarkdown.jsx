export function ChatMarkdown({ text }) {
  if (!text) return null

  // Split into paragraphs on blank lines
  const paragraphs = String(text).split(/\n{2,}/g)

  function renderInline(inline) {
    const parts = []
    let remaining = inline

    // Simple parser for **bold** and `code`
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(inline)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={parts.length}>
            {inline.slice(lastIndex, match.index)}
          </span>
        )
      }
      const token = match[0]
      if (token.startsWith('**')) {
        parts.push(
          <strong key={parts.length}>{token.slice(2, -2)}</strong>
        )
      } else if (token.startsWith('`')) {
        parts.push(
          <code
            key={parts.length}
            style={{
              fontSize: '0.85em',
              background: '#f3f4f6',
              padding: '1px 4px',
              borderRadius: 4
            }}
          >
            {token.slice(1, -1)}
          </code>
        )
      }
      lastIndex = match.index + token.length
    }

    if (lastIndex < inline.length) {
      parts.push(
        <span key={parts.length}>{inline.slice(lastIndex)}</span>
      )
    }
    return parts
  }

  return (
    <div
      className="chat-markdown"
      style={{
        lineHeight: 1.5,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        minWidth: 0,
        maxWidth: '100%'
      }}
    >
      {paragraphs.map((para, idx) => {
        const trimmed = String(para || '').trim()
        const lines = trimmed.split('\n').filter((l) => l.trim() !== '')

        // Headings: support # / ## / ### (common in LLM replies)
        const h3 = /^###\s+(.*)$/.exec(trimmed)
        const h2 = /^##\s+(.*)$/.exec(trimmed)
        const h1 = /^#\s+(.*)$/.exec(trimmed)
        if (h3 || h2 || h1) {
          const content = (h3?.[1] || h2?.[1] || h1?.[1] || '').trim()
          const Tag = h1 ? 'h2' : h2 ? 'h3' : 'h4'
          return (
            <Tag
              key={idx}
              style={{
                margin: idx === 0 ? 0 : '0.5rem 0 0',
                fontSize: h1 ? '1.0em' : h2 ? '0.95em' : '0.92em',
                fontWeight: 700
              }}
            >
              {renderInline(content)}
            </Tag>
          )
        }

        // Unordered list: - item OR * item
        const ulLines = lines.filter((l) => /^\s*[-*]\s+/.test(l))
        if (ulLines.length > 0) {
          return (
            <ul
              key={idx}
              style={{
                paddingLeft: '1.25rem',
                margin: idx > 0 ? '0.35rem 0 0' : 0
              }}
            >
              {ulLines.map((l, i) => (
                <li key={i} style={{ fontSize: '0.9em' }}>
                  {renderInline(l.replace(/^\s*[-*]\s+/, ''))}
                </li>
              ))}
            </ul>
          )
        }

        // Ordered list: 1. item
        const olLines = lines.filter((l) => /^\s*\d+\.\s+/.test(l))
        if (olLines.length > 0) {
          return (
            <ol
              key={idx}
              style={{
                paddingLeft: '1.25rem',
                margin: idx > 0 ? '0.35rem 0 0' : 0
              }}
            >
              {olLines.map((l, i) => (
                <li key={i} style={{ fontSize: '0.9em' }}>
                  {renderInline(l.replace(/^\s*\d+\.\s+/, ''))}
                </li>
              ))}
            </ol>
          )
        }

        return (
          <p
            key={idx}
            style={{
              margin: idx === 0 ? 0 : '0.35rem 0 0',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              maxWidth: '100%'
            }}
          >
            {renderInline(trimmed)}
          </p>
        )
      })}
    </div>
  )
}

