import { useEffect, useRef, useState } from 'react'
import { Copy, Plug } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import type { McpTool } from '@/types/server'
import { countJsonTokens, formatTokenCount } from './lib/token-count'

const FALLBACK_NAMESPACED: McpTool[] = [
  { name: 'heku.list_configs', description: '[heku] List all installed MCP configs with their connector types and tool counts', inputSchema: { type: 'object', properties: {} }, configId: 'heku' },
  { name: 'heku.list_tools', description: '[heku] List all tools for a specific config', inputSchema: { type: 'object', properties: { config_id: { type: 'string' } }, required: ['config_id'] }, configId: 'heku' },
  { name: 'heku.search', description: '[heku] Search for tools across all installed configs by intent or keyword', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, configId: 'heku' },
]

const FALLBACK_FLAT: McpTool[] = [
  { name: 'list_configs', description: '[heku] List all installed MCP configs with their connector types and tool counts', inputSchema: { type: 'object', properties: {} }, configId: 'heku' },
  { name: 'list_tools', description: '[heku] List all tools for a specific config', inputSchema: { type: 'object', properties: { config_id: { type: 'string' } }, required: ['config_id'] }, configId: 'heku' },
  { name: 'search', description: '[heku] Search for tools across all installed configs by intent or keyword', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, configId: 'heku' },
  { name: 'invoke', description: '[heku] Directly invoke any heku tool by its qualified name', inputSchema: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['tool'] }, configId: 'heku' },
]

function toHandshakeShape(tools: McpTool[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

interface HandshakeCardProps {
  onTokenCounts?: (flat: number, namespaced: number) => void
}

export function HandshakeCard({ onTokenCounts }: HandshakeCardProps) {
  const [flatTools, setFlatTools] = useState<McpTool[]>([])
  const [namespacedTools, setNamespacedTools] = useState<McpTool[]>([])
  const [loading, setLoading] = useState(true)
  const [isFallback, setIsFallback] = useState(false)
  const [activeTab, setActiveTab] = useState<'flat' | 'namespaced'>('flat')
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    Promise.all([
      api.get<McpTool[]>('/tools/manifest?style=flat'),
      api.get<McpTool[]>('/tools/manifest?style=namespaced'),
    ])
      .then(([flat, namespaced]) => {
        const flatResult = flat.length > 0 ? flat : FALLBACK_FLAT
        const namespacedResult = namespaced.length > 0 ? namespaced : FALLBACK_NAMESPACED
        setFlatTools(flatResult)
        setNamespacedTools(namespacedResult)
        setIsFallback(flat.length === 0 && namespaced.length === 0)
      })
      .catch(() => {
        setFlatTools(FALLBACK_FLAT)
        setNamespacedTools(FALLBACK_NAMESPACED)
        setIsFallback(true)
      })
      .finally(() => setLoading(false))
  }, [])

  const flatHandshake = toHandshakeShape(flatTools)
  const namespacedHandshake = toHandshakeShape(namespacedTools)
  const flatTokens = countJsonTokens(flatHandshake)
  const namespacedTokens = countJsonTokens(namespacedHandshake)

  useEffect(() => {
    onTokenCounts?.(flatTokens, namespacedTokens)
  }, [flatTokens, namespacedTokens, onTokenCounts])

  const activeTools = activeTab === 'flat' ? flatHandshake : namespacedHandshake
  const activeTokens = activeTab === 'flat' ? flatTokens : namespacedTokens
  const jsonText = JSON.stringify(activeTools, null, 2)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(jsonText)
      toast.success(`Copied · tools/list (${activeTab})`)
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

  const tabStyle = (tab: 'flat' | 'namespaced'): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: '0.77rem',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.06em',
    cursor: 'pointer',
    border: 'none',
    borderRadius: 3,
    background: activeTab === tab ? 'var(--accent)' : 'transparent',
    color: activeTab === tab ? 'var(--bg)' : 'var(--text-dim)',
    transition: 'all 0.12s',
  })

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface)',
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
        <Plug size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--text)', letterSpacing: '0.04em' }}>
          tools/list handshake
        </span>
        <Badge variant="offline">HANDSHAKE · tools/list</Badge>
        {isFallback && <Badge variant="warn">offline fallback</Badge>}

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', padding: 2, borderRadius: 4, border: '1px solid var(--border)' }}>
          <button style={tabStyle('flat')} onClick={() => setActiveTab('flat')}>flat</button>
          <button style={tabStyle('namespaced')} onClick={() => setActiveTab('namespaced')}>namespaced</button>
        </div>

        <div style={{ flex: 1 }} />

        <span
          style={{
            fontSize: '0.69rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-dim)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {formatTokenCount(activeTokens)} tok
        </span>
        <Button size="xs" variant="ghost" onClick={handleCopy} title={`Copy ${activeTab} handshake JSON`}>
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
        {activeTab === 'flat'
          ? <>Flat style: meta-tools are advertised without prefix — used by Claude, Cursor, and other clients that disallow dots in tool names.</>
          : <>Namespaced style: meta-tools use the <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.77rem' }}>heku.*</code> prefix — standard for bespoke and enterprise clients.</>
        }
      </div>

      {/* Token comparison badge */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '6px 14px 0',
          fontSize: '0.69rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
        }}
      >
        <span style={{ color: activeTab === 'flat' ? 'var(--accent)' : 'var(--text-dim)' }}>
          flat: {formatTokenCount(flatTokens)} tok ({flatTools.length} tools)
        </span>
        <span>·</span>
        <span style={{ color: activeTab === 'namespaced' ? 'var(--accent)' : 'var(--text-dim)' }}>
          namespaced: {formatTokenCount(namespacedTokens)} tok ({namespacedTools.length} tools)
        </span>
      </div>

      {/* JSON body */}
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
          whiteSpace: 'pre',
          opacity: loading ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        {loading ? '// loading...' : jsonText}
      </pre>
    </div>
  )
}
