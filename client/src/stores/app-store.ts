import { create } from 'zustand'
import type { ConfigSummary, McpTool } from '@/types/server'
import type { RegistryConfigMeta, RegistryFilters, RegistryUpdateInfo, ManifestEntry, RegistrySource } from '@/types/registry'

export type Page = 'demo' | 'configs' | 'registry' | 'experimental' | 'logs' | 'prompts'
export type AccentColor = 'purple' | 'lime' | 'blue' | 'cyan' | 'pink' | 'yellow'
export type ThemeMode = 'dark' | 'light'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ManifestStyle = 'flat' | 'namespaced'

const DEFAULT_REGISTRY_FILTERS: RegistryFilters = { sort_by: 'popular' }

interface AppState {
  // Navigation
  activePage: Page
  setActivePage: (page: Page) => void

  // Theme
  mode: ThemeMode
  accent: AccentColor
  fontSize: number
  setMode: (mode: ThemeMode) => void
  setAccent: (accent: AccentColor) => void
  setFontSize: (size: number) => void

  // Settings modal
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  // Server settings (fetched from mcp-one at runtime; reset on process restart)
  hotReload: boolean
  logLevel: LogLevel
  manifestStyle: ManifestStyle
  configWriteLock: boolean
  blockAutoInstall: boolean
  blockAutoStart: boolean
  setHotReload: (v: boolean) => void
  setLogLevel: (v: LogLevel) => void
  setManifestStyle: (v: ManifestStyle) => void
  setConfigWriteLock: (v: boolean) => void
  setBlockAutoInstall: (v: boolean) => void
  setBlockAutoStart: (v: boolean) => void

  // Server version — populated from /api/health on first connect (console/bridge)
  serverVersion: string | null
  setServerVersion: (v: string | null) => void
  // mcp-one MCP server version — populated from /api/server-settings
  mcpServerVersion: string | null
  setMcpServerVersion: (v: string | null) => void

  // MCP server connection — set by ServerConnect, gates the whole app
  connectedEndpoint: string | null
  setConnectedEndpoint: (endpoint: string | null) => void

  // MCP server status — driven by useMcpServer hook
  serverStatus: 'online' | 'offline' | 'connecting'
  toolCount: number
  tools: McpTool[]
  configs: ConfigSummary[]
  setServerStatus: (status: 'online' | 'offline' | 'connecting') => void
  setToolCount: (count: number) => void
  setTools: (tools: McpTool[]) => void
  setConfigs: (configs: ConfigSummary[]) => void

  // Registry update badge count
  registryUpdateCount: number
  setRegistryUpdateCount: (count: number) => void

  // Monotonic counter — increment after any registry install/uninstall so
  // useConfigs knows to re-fetch the config list from disk.
  configsRevision: number
  bumpConfigsRevision: () => void

  // ── Registry page cache ──────────────────────────────────────────
  // All registry state lives here so it survives navigation away and back.
  registrySource: string
  registryResults: RegistryConfigMeta[]
  registryFeatured: RegistryConfigMeta[]
  registryTotal: number
  registryFilters: RegistryFilters
  registryManifest: ManifestEntry[]
  registryUpdates: Map<string, RegistryUpdateInfo>
  registryBootstrapped: boolean   // true once first load for registrySource completes
  registryAvailableSources: RegistrySource[]
  registrySubPage: 'browse' | 'detail'
  registrySelectedConfig: RegistryConfigMeta | null

  setRegistrySource: (source: string) => void
  setRegistryAvailableSources: (sources: RegistrySource[]) => void
  setRegistryResults: (results: RegistryConfigMeta[], total: number) => void
  appendRegistryResults: (results: RegistryConfigMeta[], total: number) => void
  setRegistryFeatured: (featured: RegistryConfigMeta[]) => void
  patchRegistryFilters: (patch: Partial<RegistryFilters>) => void
  clearRegistryFilters: () => void
  setRegistryManifest: (manifest: ManifestEntry[]) => void
  setRegistryUpdates: (updates: Map<string, RegistryUpdateInfo>) => void
  setRegistryBootstrapped: () => void
  setRegistrySubPage: (subPage: 'browse' | 'detail') => void
  setRegistrySelectedConfig: (config: RegistryConfigMeta | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  activePage: 'configs',
  setActivePage: (page) => set({ activePage: page }),

  mode: 'dark',
  accent: 'purple',
  fontSize: 13,
  setMode: (mode) => set({ mode }),
  setAccent: (accent) => set({ accent }),
  setFontSize: (fontSize) => set({ fontSize }),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  hotReload: true,
  logLevel: 'info' as LogLevel,
  manifestStyle: 'flat' as ManifestStyle,
  configWriteLock: false,
  blockAutoInstall: false,
  blockAutoStart: false,
  setHotReload: (hotReload) => set({ hotReload }),
  setLogLevel: (logLevel) => set({ logLevel }),
  setManifestStyle: (manifestStyle) => set({ manifestStyle }),
  setConfigWriteLock: (configWriteLock) => set({ configWriteLock }),
  setBlockAutoInstall: (blockAutoInstall) => set({ blockAutoInstall }),
  setBlockAutoStart: (blockAutoStart) => set({ blockAutoStart }),

  serverVersion: null,
  setServerVersion: (serverVersion) => set({ serverVersion }),
  mcpServerVersion: null,
  setMcpServerVersion: (mcpServerVersion) => set({ mcpServerVersion }),

  connectedEndpoint: null,
  setConnectedEndpoint: (connectedEndpoint) => set({ connectedEndpoint }),

  serverStatus: 'connecting',
  toolCount: 0,
  tools: [],
  configs: [],
  setServerStatus: (serverStatus) => set({ serverStatus }),
  setToolCount: (toolCount) => set({ toolCount }),
  setTools: (tools) => set({ tools, toolCount: tools.length }),
  setConfigs: (configs) => set({ configs }),

  registryUpdateCount: 0,
  setRegistryUpdateCount: (registryUpdateCount) => set({ registryUpdateCount }),

  configsRevision: 0,
  bumpConfigsRevision: () => set((s) => ({ configsRevision: s.configsRevision + 1 })),

  // ── Registry page cache ──────────────────────────────────────────
  registrySource:         localStorage.getItem('mcp-one:registry:selectedSource') ?? 'default',
  registryResults:        [],
  registryFeatured:       [],
  registryTotal:          0,
  registryFilters:        DEFAULT_REGISTRY_FILTERS,
  registryManifest:       [],
  registryUpdates:        new Map(),
  registryBootstrapped:     false,
  registryAvailableSources: [],
  registrySubPage:          'browse',
  registrySelectedConfig:   null,

  setRegistryAvailableSources: (registryAvailableSources) => set({ registryAvailableSources }),
  setRegistrySource: (source) => set({
    registrySource:       source,
    registryResults:      [],
    registryFeatured:     [],
    registryTotal:        0,
    registryFilters:      DEFAULT_REGISTRY_FILTERS,
    registryUpdates:      new Map(),
    registryBootstrapped: false,
    registrySubPage:      'browse',
    registrySelectedConfig: null,
  }),
  setRegistryResults:    (registryResults, registryTotal) => set({ registryResults, registryTotal }),
  appendRegistryResults: (more, registryTotal) => set((s) => ({ registryResults: [...s.registryResults, ...more], registryTotal })),
  setRegistryFeatured: (registryFeatured) => set({ registryFeatured }),
  patchRegistryFilters: (patch) => set((s) => ({ registryFilters: { ...s.registryFilters, ...patch } })),
  clearRegistryFilters: () => set({ registryFilters: DEFAULT_REGISTRY_FILTERS }),
  setRegistryManifest:  (registryManifest) => set({ registryManifest }),
  setRegistryUpdates:   (registryUpdates) => set({ registryUpdates }),
  setRegistryBootstrapped: () => set({ registryBootstrapped: true }),
  setRegistrySubPage:   (registrySubPage) => set({ registrySubPage }),
  setRegistrySelectedConfig: (registrySelectedConfig) => set({ registrySelectedConfig }),
}))
