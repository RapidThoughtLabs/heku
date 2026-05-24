import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type {
  RegistryConfigMeta,
  RegistryPaginatedResponse,
  RegistryUpdateInfo,
  ManifestEntry,
  Manifest,
  RegistryFilters,
} from '@/types/registry'

export type { RegistryFilters }

export interface UseRegistryResult {
  results: RegistryConfigMeta[]
  featured: RegistryConfigMeta[]
  loading: boolean
  error: string | null
  total: number
  filters: RegistryFilters
  manifest: ManifestEntry[]
  updatesAvailable: Map<string, RegistryUpdateInfo>

  setFilter: (patch: Partial<RegistryFilters>) => void
  clearFilters: () => void
  install: (args: {
    namespace: string
    slug: string
    connector_type: string
    version?: string
    overwrite?: boolean
  }) => Promise<void>
  uninstall: (qualifiedSlug: string) => Promise<void>
  isInstalled: (slug: string) => boolean
  getUpdateInfo: (slug: string) => RegistryUpdateInfo | undefined
  checkUpdates: () => Promise<void>
  refetchManifest: () => Promise<void>
}

function buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const q = qs.toString()
  return q ? `${path}?${q}` : path
}

export function useRegistry({ registry }: { registry: string }): UseRegistryResult {
  // Persistent state from the store
  const results          = useAppStore((s) => s.registryResults)
  const featured         = useAppStore((s) => s.registryFeatured)
  const total            = useAppStore((s) => s.registryTotal)
  const filters          = useAppStore((s) => s.registryFilters)
  const manifest         = useAppStore((s) => s.registryManifest)
  const updatesAvailable = useAppStore((s) => s.registryUpdates)
  const bootstrapped     = useAppStore((s) => s.registryBootstrapped)

  const setResults         = useAppStore((s) => s.setRegistryResults)
  const setFeatured        = useAppStore((s) => s.setRegistryFeatured)
  const patchFilters       = useAppStore((s) => s.patchRegistryFilters)
  const clearFilters       = useAppStore((s) => s.clearRegistryFilters)
  const setManifest        = useAppStore((s) => s.setRegistryManifest)
  const setUpdates         = useAppStore((s) => s.setRegistryUpdates)
  const setBootstrapped    = useAppStore((s) => s.setRegistryBootstrapped)
  const setUpdateCount     = useAppStore((s) => s.setRegistryUpdateCount)
  const bumpConfigsRevision = useAppStore((s) => s.bumpConfigsRevision)

  // Ephemeral — don't need to survive navigation
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount, note whether we already have cached results so the search effect
  // can skip the initial fetch when returning to the page.
  const skipInitialSearch = useRef(bootstrapped && results.length > 0)

  // ── Manifest ──────────────────────────────────────────────────────

  const refetchManifest = useCallback(async () => {
    try {
      const data = await api.get<Manifest>('/registry/manifest')
      setManifest(data.installed)
    } catch {
      // non-critical
    }
  }, [setManifest])

  // ── Update checking ───────────────────────────────────────────────

  const checkUpdates = useCallback(async () => {
    const currentManifest = await api
      .get<Manifest>('/registry/manifest')
      .catch(() => ({ installed: [] as ManifestEntry[] }))
    const forThisRegistry = currentManifest.installed.filter((e) => e.registry === registry)
    if (forThisRegistry.length === 0) return

    try {
      const result = await api.post<{
        updates: RegistryUpdateInfo[]
        deprecated: { slug: string; installed_version: string; replacement: string; message: string }[]
        up_to_date: { slug: string; version: string }[]
      }>(buildUrl('/registry/check-updates', { registry }), {
        installed: forThisRegistry.map((e) => ({ slug: e.slug, version: e.version })),
      })

      const map = new Map<string, RegistryUpdateInfo>()
      for (const u of result.updates) map.set(u.slug, u)
      setUpdates(map)
      setUpdateCount(result.updates.length)
    } catch {
      // non-critical
    }
  }, [registry, setUpdates, setUpdateCount])

  // ── Search ────────────────────────────────────────────────────────

  const executeSearch = useCallback(async (currentFilters: RegistryFilters) => {
    setLoading(true)
    setError(null)
    try {
      const url = buildUrl('/registry/search', {
        registry,
        q:              currentFilters.q,
        sort_by:        currentFilters.sort_by,
        connector_type: currentFilters.connector_type,
        verified:       currentFilters.verified,
        limit:          20,
        offset:         0,
      })
      const data = await api.get<RegistryPaginatedResponse<RegistryConfigMeta>>(url)
      setResults(
        Array.isArray(data?.data) ? data.data : [],
        typeof data?.total === 'number' ? data.total : 0,
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [registry, setResults])

  // ── Bootstrap: fetch featured + manifest only on first visit ──────

  useEffect(() => {
    if (bootstrapped) return

    void (async () => {
      try {
        const url  = buildUrl('/registry/featured', { registry, limit: 12 })
        const data = await api.get<RegistryConfigMeta[]>(url)
        setFeatured(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('[registry] featured fetch failed:', err)
      }

      await refetchManifest()
      await checkUpdates()
      setBootstrapped()
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry])

  // ── Debounced search ─────────────────────────────────────────────
  // Skips on the first render if returning to a cached page (same filters,
  // results already in the store). Fires normally on every subsequent change.

  useEffect(() => {
    if (skipInitialSearch.current) {
      skipInitialSearch.current = false
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void executeSearch(filters), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, registry])

  // ── Filter actions ────────────────────────────────────────────────

  const setFilter = useCallback((patch: Partial<RegistryFilters>) => {
    patchFilters(patch)
  }, [patchFilters])

  // ── Install / uninstall ───────────────────────────────────────────

  const install = useCallback(async (args: {
    namespace: string
    slug: string
    connector_type: string
    version?: string
    overwrite?: boolean
  }) => {
    await api.post('/registry/install', {
      namespace:      args.namespace,
      slug:           args.slug,
      connector_type: args.connector_type,
      version:        args.version,
      overwrite:      args.overwrite ?? false,
      registry,
    })
    await refetchManifest()
    bumpConfigsRevision()
  }, [registry, refetchManifest, bumpConfigsRevision])

  const uninstall = useCallback(async (qualifiedSlug: string) => {
    const withoutNs  = qualifiedSlug.replace(/^@[^/]+\//, '')
    const colonIdx   = withoutNs.indexOf(':')
    const compoundId = colonIdx === -1
      ? withoutNs
      : `${withoutNs.slice(0, colonIdx)}-${withoutNs.slice(colonIdx + 1)}`
    await api.delete(`/registry/uninstall/${compoundId}?registry=${encodeURIComponent(registry)}`)
    await refetchManifest()
    bumpConfigsRevision()
  }, [registry, refetchManifest, bumpConfigsRevision])

  // ── Derived ───────────────────────────────────────────────────────

  const isInstalled = useCallback((slug: string): boolean => {
    return manifest.some((e) => e.slug === slug)
  }, [manifest])

  const getUpdateInfo = useCallback((slug: string): RegistryUpdateInfo | undefined => {
    return updatesAvailable.get(slug)
  }, [updatesAvailable])

  return {
    results,
    featured,
    loading,
    error,
    total,
    filters,
    manifest,
    updatesAvailable,
    setFilter,
    clearFilters,
    install,
    uninstall,
    isInstalled,
    getUpdateInfo,
    checkUpdates,
    refetchManifest,
  }
}
