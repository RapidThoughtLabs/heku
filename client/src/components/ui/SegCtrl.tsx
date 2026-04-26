interface SegCtrlProps<T extends string> {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function SegCtrl<T extends string>({ options, value, onChange }: SegCtrlProps<T>) {
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg)',
        border: '1px solid var(--border2)',
        borderRadius: 6,
        padding: 2,
        gap: 2,
        flexShrink: 0,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '4px 11px',
            fontSize: 10,
            borderRadius: 4,
            border: 'none',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            transition: 'all 0.15s',
            userSelect: 'none',
            fontFamily: "'JetBrains Mono', monospace",
            background: value === opt.value ? 'var(--accent)' : 'transparent',
            color: value === opt.value ? 'var(--accent-txt)' : 'var(--text-dim)',
            fontWeight: value === opt.value ? 600 : 400,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
