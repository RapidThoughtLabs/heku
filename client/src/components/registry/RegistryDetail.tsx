import { useState } from 'react'
import { ArrowLeft, Star, Download, ShieldCheck, Loader2, Package, Tag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/components/ui/Toast'
import type { RegistryConfigMeta, RegistryUpdateInfo } from '@/types/registry'

const CONNECTOR_LABELS: Record<string, string> = {
  http: 'HTTP', cli: 'CLI', file: 'File', grpc: 'gRPC', graphql: 'GraphQL', mcp: 'MCP',
}

const SEVERITY_COLORS: Record<string, string> = {
  patch: 'var(--accent)',
  minor: 'var(--yellow)',
  major: 'var(--red)',
}

interface RegistryDetailProps {
  config: RegistryConfigMeta
  isInstalled: boolean
  updateInfo?: RegistryUpdateInfo
  onInstall: (namespace: string, slug: string, version?: string) => Promise<void>
  onUninstall: (slug: string) => Promise<void>
  onBack: () => void
}

export function RegistryDetail({
  config,
  isInstalled,
  updateInfo,
  onInstall,
  onUninstall,
  onBack,
}: RegistryDetailProps) {
  const [installing, setInstalling] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)

  const handleInstall = async (version?: string) => {
    setInstalling(true)
    try {
      await onInstall(config.namespace, config.slug, version)
      toast.success(`Installed ${config.name}`)
    } catch (err) {
      toast.error(`Install failed: ${(err as Error).message}`)
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    setUninstalling(true)
    try {
      await onUninstall(config.slug)
      toast.success(`Uninstalled ${config.name}`)
    } catch (err) {
      toast.error(`Uninstall failed: ${(err as Error).message}`)
    } finally {
      setUninstalling(false)
    }
  }

  const connectorLabel = CONNECTOR_LABELS[config.connector_type] ?? config.connector_type

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header bar */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft size={12} style={{ marginRight: 5 }} />
          Back
        </Button>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>registry</span> / {config.namespace} / {config.slug}
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 720 }}>
        {/* Title section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Package size={22} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                  {config.name}
                </h2>
                {config.verified && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ShieldCheck size={14} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.06em', fontWeight: 600 }}>VERIFIED</span>
                  </span>
                )}
                {config.deprecated && <Badge variant="warn">deprecated</Badge>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                {config.namespace}/{config.slug}
              </div>
            </div>
          </div>

          {config.description && (
            <p style={{
              margin: '0 0 16px', fontSize: 13, color: 'var(--text-mid)',
              lineHeight: 1.65, letterSpacing: '0.02em',
            }}>
              {config.description}
            </p>
          )}

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)', fontSize: 11 }}>
              <Star size={12} /> {config.star_count.toLocaleString()} stars
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)', fontSize: 11 }}>
              <Download size={12} /> {config.install_count.toLocaleString()} installs
            </span>
            <span style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 99,
              background: 'var(--surface2)', color: 'var(--text-dim)', letterSpacing: '0.06em',
            }}>
              {connectorLabel}
            </span>
            {config.category && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 99,
                background: 'var(--surface2)', color: 'var(--text-dim)', letterSpacing: '0.06em',
              }}>
                {config.category}
              </span>
            )}
          </div>
        </div>

        {/* Update banner */}
        {updateInfo && (
          <div style={{
            padding: '12px 16px', borderRadius: 6, marginBottom: 20,
            background: 'rgba(254,188,46,0.06)', border: '1px solid rgba(254,188,46,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: SEVERITY_COLORS[updateInfo.severity] ?? 'var(--yellow)',
                textTransform: 'uppercase',
              }}>
                {updateInfo.severity} update available
              </span>
              {updateInfo.breaking && <Badge variant="error">breaking</Badge>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {updateInfo.installed_version} → {updateInfo.latest_version}
              {updateInfo.changelog && (
                <span style={{ marginLeft: 8 }}>· {updateInfo.changelog}</span>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
          {!isInstalled && (
            <Button variant="primary" onClick={() => void handleInstall()} disabled={installing}>
              {installing
                ? <><Loader2 size={12} style={{ marginRight: 6, animation: 'spin 1s linear infinite' }} />Installing…</>
                : <>Install {config.latest_version?.version ? `v${config.latest_version.version}` : ''}</>
              }
            </Button>
          )}
          {isInstalled && updateInfo && (
            <Button variant="primary" onClick={() => void handleInstall(updateInfo.latest_version)} disabled={installing}>
              {installing
                ? <><Loader2 size={12} style={{ marginRight: 6, animation: 'spin 1s linear infinite' }} />Updating…</>
                : <>Update to v{updateInfo.latest_version}</>
              }
            </Button>
          )}
          {isInstalled && !updateInfo && (
            <Button variant="ghost" disabled style={{ opacity: 0.6, cursor: 'default' }}>
              ✓ Installed
            </Button>
          )}
          {isInstalled && (
            <Button variant="ghost" onClick={() => void handleUninstall()} disabled={uninstalling}>
              {uninstalling
                ? <><Loader2 size={12} style={{ marginRight: 6, animation: 'spin 1s linear infinite' }} />Removing…</>
                : 'Uninstall'
              }
            </Button>
          )}
        </div>

        {/* Version info */}
        {config.latest_version && (
          <div style={{
            padding: '12px 16px', borderRadius: 6, marginBottom: 20,
            background: 'var(--surface)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
              Latest Version
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                v{config.latest_version.version}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {new Date(config.latest_version.created_at).toLocaleDateString()}
              </span>
              {config.latest_version.message && (
                <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  {config.latest_version.message}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tags */}
        {config.tags.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-dim)',
              textTransform: 'uppercase', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <Tag size={9} /> Tags
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {config.tags.map((tag) => (
                <span key={tag} style={{
                  fontSize: 10, padding: '3px 10px', borderRadius: 99,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                  letterSpacing: '0.06em',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
