import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type {
  RegistryConfigMeta,
  RegistrySearchParams,
  RegistryPaginatedResponse,
  RegistryUpdateInfo,
  ManifestEntry,
  Manifest,
} from '@/types/registry'

export interface UseRegistryResult {
  // Data
  configs: RegistryConfigMeta[]
  featured: RegistryConfigMeta[]
  loading: boolean
  error: string | null
  total: number
  searchParams: RegistrySearchParams
  manifest: ManifestEntry[]
  updatesAvailable: Map<string, RegistryUpdateInfo>

  // Actions
  search: (params: Partial<RegistrySearchParams>) => void
  loadFeatured: () => Promise<void>
  loadPopular: () => Promise<void>
  loadRecent: () => Promise<void>
  install: (namespace: string, slug: string, version?: string) => Promise<void>
  uninstall: (slug: string) => Promise<void>
  isInstalled: (slug: string) => boolean
  getUpdateInfo: (slug: string) => RegistryUpdateInfo | undefined
  checkUpdates: () => Promise<void>
  refetchManifest: () => Promise<void>
}

const DEFAULT_PARAMS: RegistrySearchParams = {
  limit: 20,
  offset: 0,
  sort_by: 'popular',
}

export function useRegistry(): UseRegistryResult {
  const [configs, setConfigs] = useState<RegistryConfigMeta[]>([])
  const [featured, setFeatured] = useState<RegistryConfigMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [searchParams, setSearchParams] = useState<RegistrySearchParams>(DEFAULT_PARAMS)
  const [manifest, setManifest] = useState<ManifestEntry[]>([])
  const [updatesAvailable, setUpdatesAvailable] = useState<Map<string, RegistryUpdateInfo>>(new Map())
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setRegistryUpdateCount = useAppStore((s) => s.setRegistryUpdateCount)

  // ── Manifest ──────────────────────────────────────────────────────

  const refetchManifest = useCallback(async () => {
    try {
      const data = await api.get<Manifest>('/registry/manifest')
      setManifest(data.installed)
    } catch {
      // non-critical
    }
  }, [])

  // ── Update checking ───────────────────────────────────────────────

  const checkUpdates = useCallback(async () => {
    const currentManifest = await api.get<Manifest>('/registry/manifest').catch(() => ({ installed: [] as ManifestEntry[] }))
    if (currentManifest.installed.length === 0) return

    try {
      const result = await api.post<{
        updates: RegistryUpdateInfo[]
        deprecated: { slug: string; installed_version: string; replacement: string; message: string }[]
        up_to_date: { slug: string; version: string }[]
      }>('/registry/check-updates', {
        installed: currentManifest.installed.map((e) => ({ slug: e.slug, version: e.version })),
      })

      const map = new Map<string, RegistryUpdateInfo>()
      for (const u of result.updates) {
        map.set(u.slug, u)
      }
      setUpdatesAvailable(map)
      setRegistryUpdateCount(result.updates.length)
    } catch {
      // non-critical
    }
  }, [setRegistryUpdateCount])

  // ── Featured / browse ─────────────────────────────────────────────

  const loadFeatured = useCallback(async () => {
    try {
      const data = await api.get<RegistryConfigMeta[]>('/registry/featured?limit=12')
      setFeatured(data)
    } catch {
      // non-critical
    }
  }, [])

  const loadPopular = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<RegistryConfigMeta[]>('/registry/popular?limit=20')
      setConfigs(data)
      setTotal(data.length)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRecent = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<RegistryConfigMeta[]>('/registry/recent?limit=20')
      setConfigs(data)
      setTotal(data.length)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Search ────────────────────────────────────────────────────────

  const executeSearch = useCallback(async (params: RegistrySearchParams) => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      const data = await api.get<RegistryPaginatedResponse<RegistryConfigMeta>>(`/registry/search?${qs.toString()}`)
      setConfigs(data.data)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const search = useCallback((params: Partial<RegistrySearchParams>) => {
    const merged = { ...searchParams, ...params, offset: 0 }
    setSearchParams(merged)

    // Debounce 300ms for q changes
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      void executeSearch(merged)
    }, 300)
  }, [searchParams, executeSearch])

  // ── Install / uninstall ───────────────────────────────────────────

  const install = useCallback(async (namespace: string, slug: string, version?: string) => {
    await api.post('/registry/install', { namespace, slug, version, overwrite: true })
    await refetchManifest()
  }, [refetchManifest])

  const uninstall = useCallback(async (slug: string) => {
    await api.delete(`/registry/uninstall/${slug}`)
    await refetchManifest()
  }, [refetchManifest])

  // ── Derived ───────────────────────────────────────────────────────

  const isInstalled = useCallback((slug: string): boolean => {
    return manifest.some((e) => e.slug === slug)
  }, [manifest])

  const getUpdateInfo = useCallback((slug: string): RegistryUpdateInfo | undefined => {
    return updatesAvailable.get(slug)
  }, [updatesAvailable])

  // ── Mount ─────────────────────────────────────────────────────────

  useEffect(() => {
    void loadFeatured()
    void refetchManifest().then(() => checkUpdates())
  }, [loadFeatured, refetchManifest, checkUpdates])

  return {
    configs,
    featured,
    loading,
    error,
    total,
    searchParams,
    manifest,
    updatesAvailable,
    search,
    loadFeatured,
    loadPopular,
    loadRecent,
    install,
    uninstall,
    isInstalled,
    getUpdateInfo,
    checkUpdates,
    refetchManifest,
  }
}
