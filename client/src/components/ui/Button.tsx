import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'cancel' | 'icon' | 'nav' | 'link'
  size?: 'xs' | 'sm' | 'md' | 'pill'
  children: ReactNode
}

const SIZE_STYLES: Record<string, React.CSSProperties> = {
  xs:   { width: 22, height: 22, fontSize: '0.77rem', padding: 0, borderRadius: 4 },
  sm:   { padding: '7px 14px', fontSize: '0.77rem' },
  md:   { padding: '9px 18px', fontSize: '0.85rem' },
  pill: { padding: '9px 22px', fontSize: '0.85rem', borderRadius: 9999 },
}

function getVariantStyles(variant: string, hovered: boolean, disabled: boolean): React.CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--accent)',
        color: 'var(--accent-txt)',
        border: 'none',
        borderRadius: 9999,
        fontWeight: 700,
        letterSpacing: '0.04em',
        ...(hovered && !disabled ? { filter: 'brightness(1.25)', boxShadow: 'var(--glow)' } : {}),
      }
    case 'ghost':
      return {
        background: hovered && !disabled ? 'var(--accent-dim)' : 'transparent',
        color: hovered && !disabled ? 'var(--accent)' : 'var(--text-dim)',
        border: `1px solid ${hovered && !disabled ? 'var(--accent)' : 'var(--border2)'}`,
        borderRadius: 9999,
        letterSpacing: '0.04em',
      }
    case 'cancel':
      return {
        background: hovered && !disabled ? 'hsla(0,75%,55%,0.08)' : 'transparent',
        color: hovered && !disabled ? 'hsl(0,75%,72%)' : 'hsla(0,75%,65%,0.8)',
        border: `1px solid ${hovered && !disabled ? 'hsla(0,75%,55%,0.9)' : 'hsla(0,75%,55%,0.4)'}`,
        borderRadius: 9999,
        letterSpacing: '0.04em',
      }
    case 'icon':
      return {
        background: hovered && !disabled ? 'var(--accent-dim)' : 'transparent',
        color: hovered && !disabled ? 'var(--accent)' : 'var(--text-dim)',
        border: `1px solid ${hovered && !disabled ? 'var(--accent)' : 'var(--border2)'}`,
        borderRadius: 4,
      }
    case 'nav':
      return {
        background: hovered && !disabled ? 'var(--surface2)' : 'transparent',
        color: hovered && !disabled ? 'var(--text)' : 'var(--text-dim)',
        border: 'none',
        borderRadius: 4,
        letterSpacing: '0.04em',
        width: '100%',
        justifyContent: 'flex-start',
      }
    case 'link':
      return {
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        padding: 0,
        color: 'var(--accent)',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
        opacity: hovered && !disabled ? 0.75 : 1,
      }
    default:
      return {}
  }
}

export function Button({
  variant = 'ghost',
  size = 'md',
  children,
  style,
  disabled,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ButtonProps) {
  const [hovered, setHovered] = useState(false)

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    transition: 'all 0.15s',
    userSelect: 'none',
    opacity: disabled ? 0.4 : 1,
    outline: 'none',
    flexShrink: 0,
  }

  const sizeStyle = SIZE_STYLES[size] || SIZE_STYLES.md
  const variantStyle = getVariantStyles(variant, hovered, !!disabled)

  return (
    <button
      disabled={disabled}
      style={{ ...baseStyle, ...sizeStyle, ...variantStyle, ...style }}
      onMouseEnter={(e) => {
        setHovered(true)
        onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        onMouseLeave?.(e)
      }}
      {...props}
    >
      {children}
    </button>
  )
}
