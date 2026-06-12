import { useRef } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { countTokens, formatTokenCount } from './lib/token-count'

interface ComposedPromptCardProps {
  composedText: string
  flatHandshakeTokens: number
  namespacedHandshakeTokens: number
}

export function ComposedPromptCard({ composedText, flatHandshakeTokens, namespacedHandshakeTokens }: ComposedPromptCardProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const promptTokens = countTokens(composedText)
  const flatTotal = promptTokens + flatHandshakeTokens
  const namespacedTotal = promptTokens + namespacedHandshakeTokens

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(composedText)
      toast.success('Copied · composed system prompt')
    } catch {
      const pre = preRef.current
      if (pre) {
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(pre)
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.85rem', color: 'var(--text)', letterSpacing: '0.04em', flex: 1 }}>
          Composed system prompt
        </span>

        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '0.69rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text-dim)',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}
          >
            prompt {formatTokenCount(promptTokens)}
          </span>
          <span style={{ fontSize: '0.69rem', color: 'var(--border)' }}>+</span>
          <span
            style={{
              fontSize: '0.69rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--accent)',
              background: 'var(--accent-dim)',
              padding: '1px 6px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
            }}
            title="Total tokens (flat style)"
          >
            Σ flat {formatTokenCount(flatTotal)}
          </span>
          <span
            style={{
              fontSize: '0.69rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text-dim)',
              background: 'var(--bg)',
              padding: '1px 6px',
              borderRadius: 3,
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}
            title="Total tokens (namespaced style)"
          >
            Σ ns {formatTokenCount(namespacedTotal)}
          </span>
        </div>

        <Button size="xs" variant="ghost" onClick={handleCopy} title="Copy composed prompt">
          <Copy size={11} />
        </Button>
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: '0.77rem',
          color: 'var(--text-dim)',
          padding: '6px 14px 0',
          letterSpacing: '0.02em',
          lineHeight: 1.5,
        }}
      >
        All layers joined with <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.77rem' }}>---</code> separators, variables substituted. This is the exact text sent as the system message at the start of each conversation.
      </div>

      {/* Content */}
      <pre
        ref={preRef}
        style={{
          margin: 0,
          padding: '10px 14px 14px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.85rem',
          lineHeight: 1.7,
          color: 'var(--text-mid)',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {composedText || '// select a template'}
      </pre>

      {/* Footer disclaimer */}
      <div
        style={{
          fontSize: '0.69rem',
          color: 'var(--text-dim)',
          padding: '0 14px 10px',
          letterSpacing: '0.04em',
          opacity: 0.6,
        }}
      >
        Token counts approximated via cl100k_base (OpenAI tokenizer). Actual provider counts may differ ±10–20%.
      </div>
    </div>
  )
}
