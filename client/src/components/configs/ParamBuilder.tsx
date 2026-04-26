import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface ParamRow {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  location: 'body' | 'path' | 'query' | 'header' | ''
  description: string
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
  const setParam = (id: string, partial: Partial<ParamRow>) =>
    onChange(params.map((p) => (p.id === id ? { ...p, ...partial } : p)))
  const removeParam = (id: string) => onChange(params.filter((p) => p.id !== id))
  const addParam = () => onChange([...params, newParam()])

  const cols = showLocation
    ? '1fr 76px 76px 36px 1fr 26px'
    : '1fr 76px 36px 1fr 26px'

  const headers = showLocation
    ? ['NAME', 'TYPE', 'LOCATION', 'REQ', 'DESCRIPTION', '']
    : ['NAME', 'TYPE', 'REQ', 'DESCRIPTION', '']

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

      {params.map((p) => (
        <div
          key={p.id}
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
          <Button variant="icon" size="xs" onClick={() => removeParam(p.id)} title="Remove parameter">
            <Trash2 size={10} />
          </Button>
        </div>
      ))}

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
