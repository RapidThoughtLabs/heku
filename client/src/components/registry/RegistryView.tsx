import { useState } from 'react'
import { useRegistry } from '@/hooks/useRegistry'
import { RegistryBrowse } from './RegistryBrowse'
import { RegistryDetail } from './RegistryDetail'
import type { RegistryConfigMeta } from '@/types/registry'

type SubPage = 'browse' | 'detail'

export function RegistryView() {
  const [subPage, setSubPage] = useState<SubPage>('browse')
  const [selectedConfig, setSelectedConfig] = useState<RegistryConfigMeta | null>(null)

  const {
    configs,
    featured,
    loading,
    error,
    total,
    searchParams,
    search,
    loadPopular,
    loadRecent,
    install,
    uninstall,
    isInstalled,
    getUpdateInfo,
    checkUpdates,
  } = useRegistry()

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
        isInstalled={isInstalled(selectedConfig.slug)}
        updateInfo={getUpdateInfo(selectedConfig.slug)}
        onInstall={install}
        onUninstall={uninstall}
        onBack={handleBack}
      />
    )
  }

  return (
    <RegistryBrowse
      configs={configs}
      featured={featured}
      loading={loading}
      error={error}
      total={total}
      searchParams={searchParams}
      onSearch={search}
      onLoadPopular={loadPopular}
      onLoadRecent={loadRecent}
      onRefetch={() => void checkUpdates()}
      isInstalled={isInstalled}
      getUpdateInfo={getUpdateInfo}
      onSelect={handleSelect}
    />
  )
}
