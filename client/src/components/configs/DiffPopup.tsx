import { diffLines } from 'diff'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

interface DiffPopupProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  oldJson: object
  newJson: object
  confirmLabel?: string
  confirming?: boolean
}

export function DiffPopup({
  open, onClose, onConfirm, oldJson, newJson,
  confirmLabel = 'Save changes', confirming = false,
}: DiffPopupProps) {
  const oldStr = JSON.stringify(oldJson, null, 2)
  const newStr = JSON.stringify(newJson, null, 2)
  const changes = diffLines(oldStr, newStr)

  // Count adds/removes
  const added   = changes.filter((c) => c.added).reduce((n, c) => n + (c.count ?? 0), 0)
  const removed = changes.filter((c) => c.removed).reduce((n, c) => n + (c.count ?? 0), 0)

  return (
    <Modal open={open} onClose={onClose} title="Review changes" width={740}>
      {/* Stats bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '8px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)', flexShrink: 0,
      }}>
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
          Diff summary:
        </span>
        {added > 0 && (
          <span style={{ fontSize: '0.77rem', color: 'var(--green)', letterSpacing: '0.04em' }}>
            +{added} line{added !== 1 ? 's' : ''}
          </span>
        )}
        {removed > 0 && (
          <span style={{ fontSize: '0.77rem', color: 'var(--red)', letterSpacing: '0.04em' }}>
            −{removed} line{removed !== 1 ? 's' : ''}
          </span>
        )}
        {added === 0 && removed === 0 && (
          <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.04em', fontStyle: 'italic' }}>
            No changes detected
          </span>
        )}
      </div>

      {/* Side-by-side diff */}
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Before */}
          <div>
            <div style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>BEFORE</div>
            <pre style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '10px 12px', fontSize: '0.77rem', lineHeight: 1.75,
              overflow: 'auto', maxHeight: 380, margin: 0, letterSpacing: '0.01em',
            }}>
              {changes.map((part, i) =>
                part.added ? null : (
                  <span
                    key={i}
                    style={{
                      color: part.removed ? 'var(--red)' : 'var(--text)',
                      background: part.removed ? 'rgba(255,95,87,0.10)' : 'transparent',
                      display: 'block',
                      borderLeft: part.removed ? '2px solid rgba(255,95,87,0.5)' : '2px solid transparent',
                      paddingLeft: 4,
                    }}
                  >
                    {part.value}
                  </span>
                )
              )}
            </pre>
          </div>

          {/* After */}
          <div>
            <div style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>AFTER</div>
            <pre style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '10px 12px', fontSize: '0.77rem', lineHeight: 1.75,
              overflow: 'auto', maxHeight: 380, margin: 0, letterSpacing: '0.01em',
            }}>
              {changes.map((part, i) =>
                part.removed ? null : (
                  <span
                    key={i}
                    style={{
                      color: part.added ? 'var(--green)' : 'var(--text)',
                      background: part.added ? 'rgba(40,200,64,0.08)' : 'transparent',
                      display: 'block',
                      borderLeft: part.added ? '2px solid rgba(40,200,64,0.5)' : '2px solid transparent',
                      paddingLeft: 4,
                    }}
                  >
                    {part.value}
                  </span>
                )
              )}
            </pre>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={confirming}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirm} disabled={confirming}>
          {confirming ? 'Saving…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
