import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type { ConfigSummary } from '@/types/server'

export interface UseConfigsResult {
  configs: ConfigSummary[]
  loading: boolean
  error: string | null
  refetch: () => void
  createConfig: (data: unknown) => Promise<void>
  updateConfig: (id: string, data: unknown) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
}

export function useConfigs(): UseConfigsResult {
  const [configs, setConfigs] = useState<ConfigSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const toolCount = useAppStore((s) => s.toolCount)
  const configsRevision = useAppStore((s) => s.configsRevision)
  const prevToolCountRef = useRef<number | null>(null)

  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<ConfigSummary[]>('/configs')
      setConfigs(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchConfigs()
  }, [fetchConfigs])

  // Re-fetch when mcp-one discovers new tools (e.g. after GraphQL introspection)
  // so toolCount shown on config cards reflects the runtime count, not the file count.
  useEffect(() => {
    if (prevToolCountRef.current !== null && prevToolCountRef.current !== toolCount) {
      void fetchConfigs()
    }
    prevToolCountRef.current = toolCount
  }, [toolCount, fetchConfigs])

  // Re-fetch after any registry install/uninstall so the configs tab stays in sync.
  const prevRevisionRef = useRef<number | null>(null)
  useEffect(() => {
    if (prevRevisionRef.current !== null && prevRevisionRef.current !== configsRevision) {
      void fetchConfigs()
    }
    prevRevisionRef.current = configsRevision
  }, [configsRevision, fetchConfigs])

  const createConfig = useCallback(
    async (data: unknown) => {
      await api.post('/configs', data)
      await fetchConfigs()
    },
    [fetchConfigs],
  )

  const updateConfig = useCallback(
    async (id: string, data: unknown) => {
      await api.put(`/configs/${id}`, data)
      await fetchConfigs()
    },
    [fetchConfigs],
  )

  const deleteConfig = useCallback(
    async (id: string) => {
      await api.delete(`/configs/${id}`)
      await fetchConfigs()
    },
    [fetchConfigs],
  )

  return {
    configs,
    loading,
    error,
    refetch: fetchConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
  }
}
