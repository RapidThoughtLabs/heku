import { create } from 'zustand'
import { useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'
import { Button } from './Button'

export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastStore {
  toasts: Toast[]
  add: (type: ToastType, message: string) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (type, message) => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Convenience export
export const toast = {
  success: (msg: string) => useToastStore.getState().add('success', msg),
  error: (msg: string) => useToastStore.getState().add('error', msg),
  info: (msg: string) => useToastStore.getState().add('info', msg),
}

const icons = {
  success: <CheckCircle size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />,
  error: <XCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />,
  info: <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />,
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(onRemove, 4000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [onRemove])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        fontSize: 12,
        color: 'var(--text-mid)',
        letterSpacing: '0.03em',
        lineHeight: 1.4,
        animation: 'toastIn 0.2s ease forwards',
        minWidth: 240,
        maxWidth: 360,
      }}
    >
      {icons[toast.type]}
      <span style={{ flex: 1 }}>{toast.message}</span>
      <Button variant="icon" size="xs" onClick={onRemove} aria-label="Dismiss">
        <X size={12} />
      </Button>
    </div>
  )
}

export function Toaster() {
  const { toasts, remove } = useToastStore()

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'all' }}>
          <ToastItem toast={t} onRemove={() => remove(t.id)} />
        </div>
      ))}
    </div>
  )
}
