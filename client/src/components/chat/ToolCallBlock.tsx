import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCallRequest, ToolCallResult } from '@/lib/chat-engine'

interface ToolCallBlockProps {
  toolCall: ToolCallRequest
  result?: ToolCallResult
}

function formatJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function isDiscoveryTool(name: string): boolean {
  return name.startsWith('one.')
}

export function ToolCallBlock({ toolCall, result }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)

  const isRunning = !result
  const isError = result?.isError ?? false
  const isDiscovery = isDiscoveryTool(toolCall.name)

  let parsedArgs: unknown
  try { parsedArgs = JSON.parse(toolCall.arguments || '{}') } catch { parsedArgs = toolCall.arguments }

  const accentColor = isRunning
    ? 'var(--accent)'
    : isError
    ? 'var(--red)'
    : 'var(--green)'

  const statusLabel = isRunning
    ? 'calling...'
    : isError
    ? 'error'
    : `${result!.durationMs}ms`

  const statusBg = isRunning
    ? 'rgba(120,80,255,0.08)'
    : isError
    ? 'rgba(255,95,87,0.1)'
    : 'rgba(40,200,64,0.1)'

  return (
    <div
      style={{
        margin: '6px 0 6px 21px',
        border: '1px solid var(--border2)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--surface)',
        opacity: isRunning ? 0.85 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <button
        onClick={() => !isRunning && setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--surface2)',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
          fontSize: 11,
          width: '100%',
          cursor: isRunning ? 'default' : 'pointer',
          border: 'none',
          outline: 'none',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            width: 3,
            alignSelf: 'stretch',
            borderRadius: 2,
            flexShrink: 0,
            background: accentColor,
            opacity: isRunning ? 0.5 : 0.7,
            marginRight: 2,
            animation: isRunning ? 'toolPulse 1.4s ease-in-out infinite' : 'none',
          }}
        />
        {!isRunning && (
          <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
        <span
          style={{
            color: isDiscovery ? 'var(--accent)' : 'var(--text)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {toolCall.name}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            letterSpacing: '0.06em',
            padding: '2px 8px',
            borderRadius: 99,
            background: statusBg,
            color: accentColor,
            fontWeight: isRunning ? 400 : 600,
            animation: isRunning ? 'toolPulse 1.4s ease-in-out infinite' : 'none',
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </button>

      {expanded && result && (
        <div style={{ background: 'var(--cell-bg)' }}>
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.12em',
                color: 'var(--text-dim)',
                marginBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              Request
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 10,
                color: 'var(--text-mid)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {formatJson(parsedArgs)}
            </pre>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.12em',
                color: isError ? 'var(--red)' : 'var(--text-dim)',
                marginBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              Response
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 10,
                color: isError ? 'hsla(0,75%,72%,0.85)' : 'var(--text-mid)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: "'JetBrains Mono', monospace",
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {formatJson(result.result)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
