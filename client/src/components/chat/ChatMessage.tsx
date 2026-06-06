import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText } from 'lucide-react'
import type { ChatMessage as ChatMessageType, ToolCallResult } from '@/lib/chat-engine'
import { ToolCallBlock } from './ToolCallBlock'

type ChatMessageWithResults = ChatMessageType & { _results?: Record<string, ToolCallResult> }

// Parse <attached-file name="...">...</attached-file> blocks out of message content
function parseUserContent(raw: string): { files: { name: string; content: string }[]; text: string } {
  const files: { name: string; content: string }[] = []
  const filePattern = /<attached-file name="([^"]+)">([\s\S]*?)<\/attached-file>/g
  const text = raw.replace(filePattern, (_match, name: string, content: string) => {
    files.push({ name, content: content.trim() })
    return ''
  }).trim()
  return { files, text }
}

function AttachedFileCard({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false)
  const lineCount = content.split('\n').length

  return (
    <div
      style={{
        border: '1px solid hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.25)',
        borderRadius: 6,
        marginBottom: 6,
        overflow: 'hidden',
        background: 'hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.05)',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '5px 8px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <FileText size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', flexShrink: 0 }}>
          {lineCount} lines
        </span>
        {open
          ? <ChevronDown size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        }
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: '6px 10px 8px',
            fontSize: '0.85rem',
            color: 'var(--text-mid)',
            lineHeight: 1.55,
            overflowX: 'auto',
            borderTop: '1px solid var(--border)',
            maxHeight: 240,
            overflowY: 'auto',
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {content}
        </pre>
      )}
    </div>
  )
}

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const msg = message as ChatMessageWithResults

  // Tool messages are internal history only — never rendered
  if (msg.role === 'tool') return null

  // System messages as horizontal rule with text
  if (msg.role === 'system') {
    return (
      <div
        style={{
          fontSize: '0.77rem',
          color: 'var(--text-dim)',
          textAlign: 'center',
          padding: '10px 0',
          letterSpacing: '0.08em',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        {msg.content}
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
    )
  }

  // User messages — parse out any attached file blocks
  if (msg.role === 'user') {
    const { files, text } = parseUserContent(msg.content ?? '')
    return (
      <div
        style={{
          fontSize: '0.92rem',
          color: 'var(--text)',
          lineHeight: 1.65,
          padding: '6px 0',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <ChevronRight
          size={11}
          style={{ color: 'var(--accent)', paddingTop: 2, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {files.map((f) => (
            <AttachedFileCard key={f.name} name={f.name} content={f.content} />
          ))}
          {text && (
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {text}
            </span>
          )}
        </div>
      </div>
    )
  }

  // Assistant messages — tool call blocks + text content
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0
  return (
    <div>
      {msg.toolCalls?.map((tc) => (
        <ToolCallBlock
          key={tc.id}
          toolCall={tc}
          result={msg._results?.[tc.id]}
        />
      ))}
      {msg.content && (
        <div
          style={{
            fontSize: '0.92rem',
            color: 'var(--text-mid)',
            lineHeight: 1.7,
            padding: '6px 0 6px 21px',
            borderLeft: hasToolCalls ? '2px solid var(--border)' : 'none',
            marginLeft: hasToolCalls ? 2 : 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {msg.content}
          {msg.isStreaming && (
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 13,
                background: 'var(--accent)',
                opacity: 0.8,
                marginLeft: 2,
                verticalAlign: 'text-bottom',
                animation: 'cursorBlink 0.9s steps(1) infinite',
                borderRadius: 1,
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
