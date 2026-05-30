import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface ParamRow {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  location: 'body' | 'path' | 'query' | 'header' | ''
  description: string
  advanced?: string      // raw JSON: { properties?, items?, enum?, format? }
  advancedError?: string // set when advanced is present but unparseable
}

export function newParam(): ParamRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: '',
    type: 'string',
    required: false,
    location: 'body',
    description: '',
  }
}

// ── Shared (de)serializers ────────────────────────────────────────────

export function paramRowToConfig(p: ParamRow): Record<string, unknown> {
  const param: Record<string, unknown> = {
    name: p.name,
    type: p.type,
    required: p.required,
    description: p.description,
  }
  if (p.location) param.location = p.location

  if (p.advanced && p.advanced.trim()) {
    try {
      const nested = JSON.parse(p.advanced) as Record<string, unknown>
      if (nested.properties) param.properties = nested.properties
      if (nested.items) param.items = nested.items
      if (Array.isArray(nested.enum)) param.enum = nested.enum
      if (nested.format) param.format = nested.format
    } catch {
      // invalid JSON — skip nested fields; advancedError should block save
    }
  }

  return param
}

export function configToParamRow(p: Record<string, unknown>): ParamRow {
  const picked: Record<string, unknown> = {}
  if (p.properties) picked.properties = p.properties
  if (p.items) picked.items = p.items
  if (Array.isArray(p.enum)) picked.enum = p.enum
  if (p.format) picked.format = p.format

  const hasNested = Object.keys(picked).length > 0

  return {
    id: Math.random().toString(36).slice(2),
    name: (p.name as string) || '',
    type: (p.type as ParamRow['type']) || 'string',
    required: Boolean(p.required),
    location: (p.location as ParamRow['location']) || '',
    description: (p.description as string) || '',
    ...(hasNested ? { advanced: JSON.stringify(picked, null, 2) } : {}),
  }
}

// ── Component ─────────────────────────────────────────────────────────

interface ParamBuilderProps {
  params: ParamRow[]
  onChange: (params: ParamRow[]) => void
  showLocation?: boolean
}

const PARAM_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const
const PARAM_LOCATIONS = ['body', 'path', 'query', 'header'] as const

const cellInput: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  padding: '4px 6px',
  fontSize: 10,
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
  letterSpacing: '0.01em',
}

export function ParamBuilder({ params, onChange, showLocation = false }: ParamBuilderProps) {
  const [advancedOpen, setAdvancedOpen] = useState<Set<string>>(new Set())

  const setParam = (id: string, partial: Partial<ParamRow>) =>
    onChange(params.map((p) => (p.id === id ? { ...p, ...partial } : p)))
  const removeParam = (id: string) => {
    setAdvancedOpen((prev) => { const next = new Set(prev); next.delete(id); return next })
    onChange(params.filter((p) => p.id !== id))
  }
  const addParam = () => onChange([...params, newParam()])

  const toggleAdvanced = (id: string) =>
    setAdvancedOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const cols = showLocation
    ? '1fr 76px 76px 36px 1fr 26px 26px'
    : '1fr 76px 36px 1fr 26px 26px'

  const headers = showLocation
    ? ['NAME', 'TYPE', 'LOCATION', 'REQ', 'DESCRIPTION', '', '']
    : ['NAME', 'TYPE', 'REQ', 'DESCRIPTION', '', '']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {/* Header always visible so columns are predictable */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 4,
          padding: '3px 6px 5px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {headers.map((h, i) => (
          <span key={i} style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>{h}</span>
        ))}
      </div>

      {params.map((p) => {
        const autoOpen = p.type === 'object' || p.type === 'array'
        const showPanel = autoOpen || advancedOpen.has(p.id)
        const panelActive = showPanel

        return (
          <div key={p.id}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: cols,
                gap: 4,
                alignItems: 'center',
                padding: '2px 0',
              }}
            >
              <input
                style={cellInput}
                value={p.name}
                onChange={(e) => setParam(p.id, { name: e.target.value })}
                placeholder="param_name"
              />
              <select
                style={{ ...cellInput, cursor: 'pointer' }}
                value={p.type}
                onChange={(e) => setParam(p.id, { type: e.target.value as ParamRow['type'] })}
              >
                {PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {showLocation && (
                <select
                  style={{ ...cellInput, cursor: 'pointer' }}
                  value={p.location}
                  onChange={(e) => setParam(p.id, { location: e.target.value as ParamRow['location'] })}
                >
                  {PARAM_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={(e) => setParam(p.id, { required: e.target.checked })}
                  style={{ accentColor: 'var(--accent)', width: 12, height: 12, cursor: 'pointer' }}
                />
              </div>
              <input
                style={cellInput}
                value={p.description}
                onChange={(e) => setParam(p.id, { description: e.target.value })}
                placeholder="Description…"
              />
              <button
                onClick={() => toggleAdvanced(p.id)}
                title="Advanced: nested schema, enum, format"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  color: panelActive ? 'var(--accent)' : 'var(--text-dim)',
                  padding: '2px 4px',
                  borderRadius: 3,
                  letterSpacing: '-0.02em',
                }}
              >
                {'{}'}
              </button>
              <Button variant="icon" size="xs" onClick={() => removeParam(p.id)} title="Remove parameter">
                <Trash2 size={10} />
              </Button>
            </div>

            {showPanel && (
              <div style={{ paddingLeft: 4, paddingBottom: 4, paddingTop: 2 }}>
                <textarea
                  value={p.advanced ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    let advancedError: string | undefined
                    if (val.trim()) {
                      try { JSON.parse(val) } catch { advancedError = 'Invalid JSON' }
                    }
                    setParam(p.id, { advanced: val || undefined, advancedError })
                  }}
                  placeholder={'{\n  "properties": {\n    "key": { "type": "string", "description": "…" }\n  }\n}'}
                  rows={5}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    background: 'var(--surface)',
                    border: `1px solid ${p.advancedError ? 'rgba(255,95,87,0.5)' : 'var(--border)'}`,
                    borderRadius: 4,
                    padding: '6px 8px',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--text)',
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box',
                    letterSpacing: '0.01em',
                    lineHeight: 1.5,
                  }}
                />
                {p.advancedError && (
                  <span style={{ fontSize: 9, color: 'var(--red)', letterSpacing: '0.03em' }}>
                    {p.advancedError}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}

      <button
        onClick={addParam}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 9px', background: 'transparent',
          border: '1px dashed var(--border2)', borderRadius: 4,
          color: 'var(--text-dim)', fontSize: 9, cursor: 'pointer',
          letterSpacing: '0.05em', transition: 'all 0.12s', width: 'fit-content',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget).style.color = 'var(--accent)'
          ;(e.currentTarget).style.borderColor = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget).style.color = 'var(--text-dim)'
          ;(e.currentTarget).style.borderColor = 'var(--border2)'
        }}
      >
        <Plus size={9} />
        Add parameter
      </button>
    </div>
  )
}
