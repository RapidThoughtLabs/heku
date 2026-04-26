import { useState, useRef } from 'react'
import { Search, RefreshCw, Loader2, PackageSearch, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { RegistryCard } from './RegistryCard'
import type { RegistryConfigMeta, RegistryUpdateInfo, RegistrySearchParams } from '@/types/registry'

const CONNECTOR_TYPES = ['http', 'cli', 'file', 'grpc', 'graphql', 'mcp'] as const
const SORT_OPTIONS: { value: RegistrySearchParams['sort_by']; label: string }[] = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'recent', label: 'Most Recent' },
  { value: 'name', label: 'Name A–Z' },
]

interface RegistryBrowseProps {
  configs: RegistryConfigMeta[]
  featured: RegistryConfigMeta[]
  loading: boolean
  error: string | null
  total: number
  searchParams: RegistrySearchParams
  onSearch: (params: Partial<RegistrySearchParams>) => void
  onLoadPopular: () => void
  onLoadRecent: () => void
  onRefetch: () => void
  isInstalled: (slug: string) => boolean
  getUpdateInfo: (slug: string) => RegistryUpdateInfo | undefined
  onSelect: (config: RegistryConfigMeta) => void
}

export function RegistryBrowse({
  configs,
  featured,
  loading,
  error,
  total,
  searchParams,
  onSearch,
  onRefetch,
  isInstalled,
  getUpdateInfo,
  onSelect,
}: RegistryBrowseProps) {
  const [searchInput, setSearchInput] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasActiveSearch = !!searchInput.trim() || !!searchParams.connector_type || !!searchParams.verified

  const handleSearchInput = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearch({ q: value || undefined })
    }, 300)
  }

  const clearSearch = () => {
    setSearchInput('')
    onSearch({ q: undefined, connector_type: undefined, verified: undefined })
  }

  const displayConfigs = hasActiveSearch ? configs : featured.length > 0 ? featured : configs

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header bar */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>registry</span> / browse
        </span>
        {loading && <Loader2 size={11} style={{ color: 'var(--text-dim)', animation: 'spin 1s linear infinite' }} />}
        <div style={{ flex: 1 }} />
        {hasActiveSearch && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {total} result{total !== 1 ? 's' : ''}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowFilters((v) => !v)} title="Filters">
          <SlidersHorizontal size={11} style={{ color: showFilters ? 'var(--accent)' : undefined }} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onRefetch} title="Refresh">
          <RefreshCw size={11} />
        </Button>
      </div>

      {/* Search bar */}
      <div style={{
        padding: '10px 16px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 5, padding: '6px 10px',
        }}>
          <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search configs… (e.g. github, postgres, openai)"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 11, color: 'var(--text)', letterSpacing: '0.03em',
              fontFamily: 'inherit',
            }}
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <X size={12} style={{ color: 'var(--text-dim)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div style={{
          padding: '8px 16px', background: 'var(--surface)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          {/* Sort */}
          <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Sort:
          </span>
          {SORT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onSearch({ sort_by: value })}
              style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${searchParams.sort_by === value ? 'var(--accent)' : 'var(--border2)'}`,
                background: searchParams.sort_by === value ? 'var(--accent-dim)' : 'transparent',
                color: searchParams.sort_by === value ? 'var(--accent)' : 'var(--text-dim)',
                letterSpacing: '0.06em', transition: 'all 0.12s',
              }}
            >
              {label}
            </button>
          ))}

          <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />

          {/* Connector type */}
          <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Type:
          </span>
          {CONNECTOR_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onSearch({ connector_type: searchParams.connector_type === type ? undefined : type })}
              style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${searchParams.connector_type === type ? 'var(--accent)' : 'var(--border2)'}`,
                background: searchParams.connector_type === type ? 'var(--accent-dim)' : 'transparent',
                color: searchParams.connector_type === type ? 'var(--accent)' : 'var(--text-dim)',
                letterSpacing: '0.06em', transition: 'all 0.12s',
              }}
            >
              {type.toUpperCase()}
            </button>
          ))}

          <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />

          {/* Verified toggle */}
          <button
            onClick={() => onSearch({ verified: searchParams.verified ? undefined : true })}
            style={{
              fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
              border: `1px solid ${searchParams.verified ? 'var(--accent)' : 'var(--border2)'}`,
              background: searchParams.verified ? 'var(--accent-dim)' : 'transparent',
              color: searchParams.verified ? 'var(--accent)' : 'var(--text-dim)',
              letterSpacing: '0.06em', transition: 'all 0.12s',
            }}
          >
            ✓ Verified only
          </button>

          {hasActiveSearch && (
            <button
              onClick={clearSearch}
              style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                border: '1px solid var(--border2)', background: 'transparent',
                color: 'var(--text-dim)', letterSpacing: '0.06em',
                marginLeft: 'auto',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Section label */}
      {!hasActiveSearch && (
        <div style={{
          padding: '14px 16px 6px', flexShrink: 0,
          fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-dim)', textTransform: 'uppercase',
        }}>
          Featured
        </div>
      )}

      {/* Results grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {error ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, padding: '60px 20px', color: 'var(--red)',
          }}>
            <PackageSearch size={28} style={{ opacity: 0.5 }} />
            <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>Failed to load registry</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>{error}</span>
            <Button size="sm" variant="ghost" onClick={onRefetch}>Retry</Button>
          </div>
        ) : loading && displayConfigs.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, padding: '60px 20px', color: 'var(--text-dim)',
          }}>
            <Loader2 size={28} style={{ opacity: 0.3, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>Loading registry…</span>
          </div>
        ) : displayConfigs.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 12, padding: '60px 20px', color: 'var(--text-dim)',
          }}>
            <PackageSearch size={28} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>No configs found</span>
            {hasActiveSearch && (
              <Button size="sm" variant="ghost" onClick={clearSearch}>Clear search</Button>
            )}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}>
            {displayConfigs.map((cfg) => (
              <RegistryCard
                key={cfg.id ?? `${cfg.namespace}/${cfg.slug}`}
                config={cfg}
                isInstalled={isInstalled(cfg.slug)}
                updateInfo={getUpdateInfo(cfg.slug)}
                onClick={() => onSelect(cfg)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
