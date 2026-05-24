import { useState, useEffect } from 'react'
import { Upload, CheckCircle, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api, ApiRequestError } from '@/lib/api'
import type { ConfigSummary } from '@/types/server'

const OVERLAY_ONLY = ['mcp', 'graphql', 'grpc']

function buildPublishPayload(cfg: ConfigSummary): Record<string, unknown> {
  const raw = cfg.raw as Record<string, unknown>
  if (!OVERLAY_ONLY.includes(cfg.connector.type)) {
    return { ...raw }
  }

  const { overlays, registry_overlays, tools: _drop, ...rest } = raw
  return {
    ...rest,
    registry_overlays: (registry_overlays ?? overlays ?? {}) as Record<string, unknown>,
    tools: [],
  }
}

function Field({
  label, value, onChange, placeholder, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 4, padding: '7px 9px', fontSize: 11,
          color: 'var(--text)', fontFamily: 'inherit', outline: 'none', width: '100%',
        }}
      />
      {hint && <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.03em' }}>{hint}</span>}
    </div>
  )
}

type Phase = 'form' | 'submitting' | 'success'

interface PublishResult {
  action: 'created' | 'versioned' | 'forked'
  version: { version: string }
  config: { qualified_slug: string }
}

export interface PublishModalProps {
  open: boolean
  onClose: () => void
  cfg: ConfigSummary
}

export function PublishModal({ open, onClose, cfg }: PublishModalProps) {
  const [phase, setPhase]           = useState<Phase>('form')
  const [authUsername, setAuthUsername] = useState<string | null>(null)
  const [description, setDescription] = useState(cfg.description ?? '')
  const [category, setCategory]     = useState('')
  const [tagsRaw, setTagsRaw]       = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [message, setMessage]       = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [result, setResult]         = useState<PublishResult | null>(null)

  useEffect(() => {
    if (!open) return
    api.get<{ loggedIn: boolean; user?: { username: string } }>('/registry/auth/status')
      .then((data) => {
        if (data.loggedIn && data.user?.username) setAuthUsername(data.user.username)
      })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (open) {
      setPhase('form')
      setDescription(cfg.description ?? '')
      setCategory('')
      setTagsRaw('')
      setVisibility('public')
      setMessage('')
      setError(null)
      setResult(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cfg.id])

  const handlePublish = async () => {
    setError(null)
    setPhase('submitting')

    const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)

    try {
      const data = await api.post<PublishResult>('/registry/publish', {
        slug:        cfg.id,
        name:        cfg.name,
        description: description.trim(),
        category:    category.trim(),
        tags,
        visibility,
        message:     message.trim() || undefined,
        payload:     buildPublishPayload(cfg),
      })
      setResult(data)
      setPhase('success')
      setTimeout(onClose, 2000)
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.data?.error ?? err.message) : (err as Error).message)
      setPhase('form')
    }
  }

  const successLabel = result
    ? result.action === 'created'  ? `Published v${result.version.version}`
    : result.action === 'versioned' ? `Updated to v${result.version.version}`
    : `Forked as ${result.config.qualified_slug}`
    : 'Published'

  const isOverlayOnly = OVERLAY_ONLY.includes(cfg.connector.type)

  return (
    <Modal open={open} onClose={onClose} title={`Publish — ${cfg.name}`} width={520}>
      {phase === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 20px' }}>
          <CheckCircle size={32} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, color: 'var(--text)', letterSpacing: '0.04em' }}>{successLabel}</span>
        </div>
      )}

      {(phase === 'form' || phase === 'submitting') && (
        <>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {isOverlayOnly && (
              <div style={{
                fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)',
                border: '1px solid var(--accent)', borderRadius: 4, padding: '6px 10px',
                letterSpacing: '0.03em', lineHeight: 1.5,
              }}>
                Overlay-only publish — tool descriptions and customizations only. Connection details and tool list are not shared.
              </div>
            )}
            {authUsername && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.03em' }}>
                Publishing as <code style={{ color: 'var(--accent)' }}>@{authUsername}</code>
              </div>
            )}
            <Field label="Description" value={description} onChange={setDescription} placeholder="What does this config do?" />
            <Field label="Category" value={category} onChange={setCategory} placeholder="e.g. development, productivity, data" />
            <Field label="Tags" value={tagsRaw} onChange={setTagsRaw} placeholder="Comma-separated (optional)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Visibility</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['public', 'private'] as const).map((v) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text)' }}>
                    <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Changelog note" value={message} onChange={setMessage} placeholder="Optional note for this release" />
            {error && <div style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</div>}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'submitting'}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handlePublish()} disabled={phase === 'submitting'}>
              {phase === 'submitting'
                ? <><Loader2 size={10} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Publishing…</>
                : <><Upload size={10} style={{ marginRight: 5 }} />Publish</>
              }
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
