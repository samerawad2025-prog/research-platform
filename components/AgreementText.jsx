'use client'

// Renders an agreement file from docs/legal/, as served by
// /api/submissions/terms (hash-checked on the server), using the minimal
// parser in lib/submission/agreementMarkdown.js. React elements only: no
// HTML string from anywhere is ever injected.

import { useMemo } from 'react'
import { parseAgreement } from '../lib/submission/agreementMarkdown'

function Line({ parts }) {
  return parts.map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>))
}

export default function AgreementText({ text, className }) {
  const blocks = useMemo(() => parseAgreement(text || ''), [text])
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          // The file's own # heading sits inside the form's section, so
          // levels start at h3.
          const Tag = `h${Math.min(b.level + 2, 6)}`
          return <Tag key={i}>{b.text}</Tag>
        }
        if (b.type === 'ul') {
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}><Line parts={item} /></li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Line parts={line} />
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
