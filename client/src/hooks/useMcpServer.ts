import { useEffect, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type { ConfigSummary, HealthResponse, McpTool } from '@/types/server'

const POLL_INTERVAL_MS = 5_000

export function useMcpServer() {
  const { setServerStatus, setToolCount, setTools, setConfigs } = useAppStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const fetchHealth = useCallback(async () => {
    try {
      const health = await api.get<HealthResponse>('/health')
      if (!mountedRef.current) return

      // Map MCP status → app store status
      const status =
        health.mcpStatus === 'connected'
          ? 'online'
          : health.mcpStatus === 'connecting'
          ? 'connecting'
          : 'offline'

      setServerStatus(status)
      setToolCount(health.toolCount)
    } catch {
      if (!mountedRef.current) return
      setServerStatus('offline')
      setToolCount(0)
    }
  }, [setServerStatus, setToolCount])

  const fetchTools = useCallback(async () => {
    try {
      const tools = await api.get<McpTool[]>('/tools')
      if (!mountedRef.current) return
      setTools(tools)
    } catch {
      if (!mountedRef.current) return
      setTools([])
    }
  }, [setTools])

  const fetchConfigs = useCallback(async () => {
    try {
      const configs = await api.get<ConfigSummary[]>('/configs')
      if (!mountedRef.current) return
      setConfigs(configs)
    } catch {
      // non-fatal — connector badges just won't show
    }
  }, [setConfigs])

  const poll = useCallback(async () => {
    await Promise.allSettled([fetchHealth(), fetchTools(), fetchConfigs()])
    if (mountedRef.current) {
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
    }
  }, [fetchHealth, fetchTools, fetchConfigs])

  useEffect(() => {
    mountedRef.current = true
    void poll()

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [poll])
}
