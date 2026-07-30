import { useState, useEffect, useRef } from 'react'
import { Copy, Check } from 'lucide-react'
import { api, setApiBase, deriveBridgeUrl } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SegCtrl } from '@/components/ui/SegCtrl'
import type { ConnectResponse } from '@/types/server'

// ── localStorage helpers ───────────────────────────────────────────

const STORAGE_KEY = 'mcp_one_recents'
const MAX_RECENTS = 10

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveRecent(endpoint: string): void {
  const recents = [endpoint, ...loadRecents().filter((r) => r !== endpoint)].slice(0, MAX_RECENTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recents))
}

// ── Install commands ────────────────────────────────────────────────

const ASCII_ROWS = [
  '      ___           ___           ___           ___     ',
  '     /__/\\         /  /\\         /__/|         /__/\\    ',
  '     \\  \\:\\       /  /:/_       |  |:|         \\  \\:\\   ',
  '      \\__\\:\\     /  /:/ /\\      |  |:|          \\  \\:\\  ',
  '  ___ /  /::\\   /  /:/ /:/_   __|  |:|      ___  \\  \\:\\ ',
  ' /__/\\  /:/\\:\\ /__/:/ /:/ /\\ /__/\\_|:|____ /__/\\  \\__\\:\\',
  ' \\  \\:\\/:/__\\/ \\  \\:\\/:/ /:/ \\  \\:\\/:::::/ \\  \\:\\ /  /:/',
  '  \\  \\::/       \\  \\::/ /:/   \\  \\::/~~~~   \\  \\:\\  /:/ ',
  '   \\  \\:\\        \\  \\:\\/:/     \\  \\:\\        \\  \\:\\/:/  ',
  '    \\  \\:\\        \\  \\::/       \\  \\:\\        \\  \\::/   ',
  '     \\__\\/         \\__\\/         \\__\\/         \\__\\/    ',
]

type InstallTab = 'npm' | 'npx'

const INSTALL_COMMANDS: Record<InstallTab, string[]> = {
  npm: ['npm i -g @rapidthoughtlabs/heku', 'heku start --http'],
  npx: ['npx @rapidthoughtlabs/heku start --http'],
}

const FOOTER_LINKS = [
  { label: 'Docs', href: 'https://www.rapidthoughtlabs.com/docs/heku' },
  { label: 'Website', href: 'https://www.rapidthoughtlabs.com/products/heku' },
  { label: 'heku hub', href: 'https://app.rapidthoughtlabs.space' },
]

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      onClick={copy}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy() } }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontSize: '0.92rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text-dim)' }}>$ </span>{command}
      </span>
      {copied
        ? <Check size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
        : <Copy size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────

// When the console is served from a remote host, the Vite proxy isn't available.
// We derive the bridge URL from the MCP endpoint and set it silently — no field needed.
const IS_REMOTE = !['localhost', '127.0.0.1'].includes(window.location.hostname)

export function ServerConnect() {
  const { setConnectedEndpoint } = useAppStore()
  const [endpoint, setEndpoint] = useState('http://localhost:3333')
  const [recents, setRecents]   = useState<string[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [installTab, setInstallTab] = useState<InstallTab>('npm')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecents(loadRecents())
    inputRef.current?.focus()
  }, [])

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    const url = endpoint.trim()
    if (!url) return

    setLoading(true)
    setError(null)

    try {
      if (IS_REMOTE) setApiBase(deriveBridgeUrl(url))
      await api.post<ConnectResponse>('/connect', { endpoint: url })
      saveRecent(url)
      setConnectedEndpoint(url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function selectRecent(url: string) {
    setEndpoint(url)
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      overflowY: 'auto',
      background: 'var(--bg)',
      padding: '48px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>

        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1 style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>heku</h1>
          <pre
            aria-hidden="true"
            style={{
              fontFamily: "'DM Mono', 'Fira Mono', monospace",
              fontSize: 'clamp(0.52rem, 1.9vw, 0.72rem)',
              lineHeight: 1.2,
              color: 'var(--accent)',
              margin: '0 0 24px',
              letterSpacing: '0.02em',
              userSelect: 'none',
            }}
          >
            {ASCII_ROWS.map((row, i) => (
              <span
                key={i}
                className="ascii-row"
                style={{
                  display: 'block',
                  animation: 'asciiRowUp 0.32s ease-out both',
                  animationDelay: `${i * 32}ms`,
                }}
              >
                {row}
              </span>
            ))}
          </pre>
          <div style={{
            fontSize: '2rem',
            color: 'var(--text)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}>
            Connect to a server
          </div>
          <div style={{ fontSize: '0.92rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Point the console at any running heku instance.
          </div>
        </div>

        {/* Connect form */}
        <form onSubmit={handleConnect}>
          <div style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block',
              fontSize: '0.8rem',
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
              marginBottom: 7,
              textTransform: 'uppercase',
            }}>
              Server endpoint
            </label>
            <input
              ref={inputRef}
              list="mcp-recents"
              type="url"
              value={endpoint}
              onChange={(e) => { setEndpoint(e.target.value); setError(null) }}
              placeholder="http://localhost:3333"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: 'var(--surface)',
                border: `1px solid ${error ? 'var(--red)' : 'var(--border2)'}`,
                borderRadius: 6,
                color: 'var(--text)',
                fontSize: '1.05rem',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => {
                if (!error) e.currentTarget.style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                if (!error) e.currentTarget.style.borderColor = 'var(--border2)'
              }}
            />
            {/* Native browser autocomplete datalist */}
            <datalist id="mcp-recents">
              {recents.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontSize: '0.88rem',
              color: 'var(--red)',
              marginBottom: 12,
              padding: '9px 11px',
              background: 'rgba(255,95,87,0.08)',
              border: '1px solid rgba(255,95,87,0.2)',
              borderRadius: 4,
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !endpoint.trim()}
            style={{
              width: '100%',
              padding: '11px 16px',
              background: loading ? 'var(--accent-dim)' : 'var(--accent)',
              color: loading ? 'var(--accent)' : 'var(--accent-txt)',
              border: 'none',
              borderRadius: 6,
              fontSize: '1rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
              opacity: !endpoint.trim() ? 0.4 : 1,
            }}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>

        {/* Recent endpoints */}
        {recents.length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div style={{
              fontSize: '0.8rem',
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Recent
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recents.map((r) => (
                <button
                  key={r}
                  onClick={() => selectRecent(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: 'transparent',
                    border: '1px solid transparent',
                    borderRadius: 4,
                    color: 'var(--text-mid)',
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface2)'
                    e.currentTarget.style.color = 'var(--text)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--text-mid)'
                  }}
                >
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>◆</span>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No instance running? Install commands */}
        <div style={{ marginTop: 28 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <span style={{
              fontSize: '0.8rem',
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
            }}>
              No instance running?
            </span>
            <SegCtrl
              options={[{ value: 'npm', label: 'npm' }, { value: 'npx', label: 'npx' }]}
              value={installTab}
              onChange={setInstallTab}
            />
          </div>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 4,
          }}>
            {INSTALL_COMMANDS[installTab].map((cmd) => (
              <CommandLine key={cmd} command={cmd} />
            ))}
          </div>
        </div>

        {/* Footer links */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginTop: 26,
        }}>
          {FOOTER_LINKS.map(({ label, href }, i) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {i > 0 && <span style={{ color: 'var(--border2)', fontSize: '0.7rem' }}>·</span>}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-dim)',
                  textDecoration: 'none',
                  letterSpacing: '0.03em',
                  transition: 'color 0.15s ease, text-shadow 0.22s ease',
                }}
                onMouseEnter={(e) => {
                  const t = e.currentTarget
                  t.style.color = 'var(--accent)'
                  t.style.textShadow = '0 0 6px var(--accent), 0 0 14px var(--accent), 0 0 28px var(--accent)'
                }}
                onMouseLeave={(e) => {
                  const t = e.currentTarget
                  t.style.color = 'var(--text-dim)'
                  t.style.textShadow = ''
                }}
              >
                {label}
              </a>
            </span>
          ))}
        </div>

      </div>
    </div>
  )
}
