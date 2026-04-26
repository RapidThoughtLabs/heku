interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="relative flex-shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: 36,
        height: 20,
        background: checked ? 'var(--accent)' : 'var(--border2)',
        borderRadius: 10,
        border: 'none',
        transition: 'background 0.2s',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          background: checked ? 'var(--accent-txt)' : 'var(--text-dim)',
          borderRadius: '50%',
          transition: 'left 0.2s, background 0.2s',
          display: 'block',
        }}
      />
    </button>
  )
}
