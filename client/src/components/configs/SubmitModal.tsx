import { useState, useEffect } from 'react'
import { GitPullRequest, CheckCircle, Clock, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api, ApiRequestError } from '@/lib/api'
import type { ConfigSummary } from '@/types/server'

function buildSubmitPayload(cfg: ConfigSummary): Record<string, unknown> {
  const raw = cfg.raw as Record<string, unknown>
  const { registry_overlays: _legacy, ...rest } = raw
  return rest
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
      <label style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 4, padding: '7px 9px', fontSize: '0.85rem',
          color: 'var(--text)', fontFamily: 'inherit', outline: 'none', width: '100%',
          resize: 'vertical',
        }}
      />
      {hint && <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.03em' }}>{hint}</span>}
    </div>
  )
}

type Phase = 'form' | 'submitting' | 'success'

interface SubmitResult {
  action: 'published_directly' | 'submission_pending' | 'submission_auto_merged'
  approvals_needed: number
}

export interface SubmitModalProps {
  open: boolean
  onClose: () => void
  cfg: ConfigSummary
  target: string
}

export function SubmitModal({ open, onClose, cfg, target }: SubmitModalProps) {
  const [phase, setPhase]     = useState<Phase>('form')
  const [message, setMessage] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<SubmitResult | null>(null)

  useEffect(() => {
    if (open) {
      setPhase('form')
      setMessage('')
      setError(null)
      setResult(null)
    }
  }, [open])

  const handleSubmit = async () => {
    if (!message.trim()) {
      setError('A description of your changes is required')
      return
    }
    setError(null)
    setPhase('submitting')

    try {
      const data = await api.post<SubmitResult>('/registry/submit', {
        target,
        payload: buildSubmitPayload(cfg),
        message: message.trim(),
      })
      setResult(data)
      setPhase('success')
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.data?.error ?? err.message) : (err as Error).message)
      setPhase('form')
    }
  }

  const successLabel = result
    ? result.action === 'published_directly'      ? 'Merged directly'
    : result.action === 'submission_auto_merged'  ? 'Auto-merged'
    : `Submitted — awaiting ${result.approvals_needed} approval${result.approvals_needed !== 1 ? 's' : ''}`
    : 'Submitted'

  const isPending = result?.action === 'submission_pending'

  return (
    <Modal open={open} onClose={onClose} title={`Submit changes — ${cfg.name}`} width={520}>
      {phase === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 20px' }}>
          {isPending
            ? <Clock size={32} style={{ color: 'var(--text-dim)' }} />
            : <CheckCircle size={32} style={{ color: 'var(--accent)' }} />
          }
          <span style={{ fontSize: '1rem', color: 'var(--text)', letterSpacing: '0.04em' }}>{successLabel}</span>
          <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.03em' }}>
            Submitting to <code style={{ color: 'var(--accent)' }}>{target}</code>
          </span>
        </div>
      )}

      {(phase === 'form' || phase === 'submitting') && (
        <>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.03em' }}>
              Proposing changes to <code style={{ color: 'var(--accent)' }}>{target}</code>
            </div>
            <Field
              label="What changed"
              value={message}
              onChange={setMessage}
              placeholder="Describe what you changed and why…"
              hint="Required — the maintainer will see this when reviewing your submission."
            />
            {error && <div style={{ fontSize: '0.77rem', color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</div>}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'submitting'}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handleSubmit()} disabled={phase === 'submitting'}>
              {phase === 'submitting'
                ? <><Loader2 size={10} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Submitting…</>
                : <><GitPullRequest size={10} style={{ marginRight: 5 }} />Submit changes</>
              }
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
