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
        const lines = para.split('\n')
        const bulletLines = lines.filter((l) => l.trim().startsWith('- '))
        const hasBullets = bulletLines.length > 0

        if (hasBullets) {
          return (
            <ul
              key={idx}
              style={{
                paddingLeft: '1.25rem',
                margin: idx > 0 ? '0.35rem 0 0' : 0
              }}
            >
              {bulletLines.map((l, i) => (
                <li key={i} style={{ fontSize: '0.9em' }}>
                  {renderInline(l.replace(/^-+\s*/, ''))}
                </li>
              ))}
            </ul>
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
            {renderInline(para)}
          </p>
        )
      })}
    </div>
  )
}

