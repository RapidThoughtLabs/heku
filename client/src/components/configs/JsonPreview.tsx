import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface JsonPreviewProps {
  json: object
  maxHeight?: number
}

export function JsonPreview({ json, maxHeight = 420 }: JsonPreviewProps) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(json, null, 2)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface3)',
      }}>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>JSON PREVIEW</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          style={copied ? { color: 'var(--green)', borderColor: 'rgba(40,200,64,0.4)' } : {}}
        >
          {copied ? <Check size={9} style={{ marginRight: 4 }} /> : <Copy size={9} style={{ marginRight: 4 }} />}
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>

      {/* JSON content */}
      <pre style={{
        padding: '12px 14px',
        fontSize: 10,
        lineHeight: 1.75,
        color: 'var(--text)',
        overflowY: 'auto',
        maxHeight,
        margin: 0,
        letterSpacing: '0.01em',
      }}>
        {text}
      </pre>
    </div>
  )
}
