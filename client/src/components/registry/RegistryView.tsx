import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useRegistry } from '@/hooks/useRegistry'
import { useAppStore } from '@/stores/app-store'
import { RegistryBrowse } from './RegistryBrowse'
import { RegistryDetail } from './RegistryDetail'
import type { RegistryConfigMeta, RegistrySource } from '@/types/registry'

const LS_KEY = 'mcp-one:registry:selectedSource'

export function RegistryView() {
  const selectedRegistry  = useAppStore((s) => s.registrySource)
  const subPage           = useAppStore((s) => s.registrySubPage)
  const selectedConfig    = useAppStore((s) => s.registrySelectedConfig)
  const setRegistrySource = useAppStore((s) => s.setRegistrySource)
  const setSubPage        = useAppStore((s) => s.setRegistrySubPage)
  const setSelectedConfig = useAppStore((s) => s.setRegistrySelectedConfig)
  const availableSources  = useAppStore((s) => s.registryAvailableSources)
  const setAvailableSources = useAppStore((s) => s.setRegistryAvailableSources)

  useEffect(() => {
    api.get<RegistrySource[]>('/registry/sources').then((sources) => {
      setAvailableSources(sources)
      const stored = localStorage.getItem(LS_KEY)
      if (stored && !sources.find((s) => s.name === stored)) {
        handleSelectRegistry('default')
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelectRegistry = (name: string) => {
    localStorage.setItem(LS_KEY, name)
    setRegistrySource(name)
  }

  const {
    results,
    featured,
    loading,
    error,
    total,
    filters,
    isInstalled,
    getUpdateInfo,
    setFilter,
    clearFilters,
    checkUpdates,
    install,
    uninstall,
  } = useRegistry({ registry: selectedRegistry })

  const handleSelect = (config: RegistryConfigMeta) => {
    setSelectedConfig(config)
    setSubPage('detail')
  }

  const handleBack = () => {
    setSubPage('browse')
    setSelectedConfig(null)
  }

  if (subPage === 'detail' && selectedConfig) {
    return (
      <RegistryDetail
        config={selectedConfig}
        registry={selectedRegistry}
        isInstalled={isInstalled(selectedConfig.qualified_slug)}
        updateInfo={getUpdateInfo(selectedConfig.qualified_slug)}
        onInstall={install}
        onUninstall={uninstall}
        onBack={handleBack}
      />
    )
  }

  return (
    <RegistryBrowse
      results={results}
      featured={featured}
      loading={loading}
      error={error}
      total={total}
      filters={filters}
      selectedRegistry={selectedRegistry}
      availableSources={availableSources}
      onSelectRegistry={handleSelectRegistry}
      onSetFilter={setFilter}
      onClearFilters={clearFilters}
      onRefetch={() => void checkUpdates()}
      isInstalled={isInstalled}
      getUpdateInfo={getUpdateInfo}
      onSelect={handleSelect}
    />
  )
}
