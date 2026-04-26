// Registry types for the web UI — mirrors shapes from src/registry/client.ts

export interface RegistryConfigMeta {
  id: string
  namespace: string
  slug: string
  name: string
  description: string
  category: string
  connector_type: string
  visibility: string
  verified: boolean
  star_count: number
  install_count: number
  deprecated: boolean
  archived: boolean
  tags: string[]
  latest_version?: {
    version: string
    status: string
    message: string
    created_at: string
  }
  created_at: string
  updated_at: string
}

export interface RegistryPaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export interface RegistrySearchParams {
  q?: string
  tags?: string
  category?: string
  connector_type?: string
  verified?: boolean
  namespace?: string
  sort_by?: 'popular' | 'recent' | 'name'
  limit?: number
  offset?: number
}

export interface RegistryUpdateInfo {
  slug: string
  installed_version: string
  latest_version: string
  severity: 'patch' | 'minor' | 'major'
  changelog: string
  breaking: boolean
}

export interface RegistryDeprecatedInfo {
  slug: string
  installed_version: string
  replacement: string
  message: string
}

export interface RegistryCheckUpdatesResponse {
  updates: RegistryUpdateInfo[]
  deprecated: RegistryDeprecatedInfo[]
  up_to_date: { slug: string; version: string }[]
}

export interface ManifestEntry {
  slug: string
  version: string
  registry: string
  installed_at: string
}

export interface Manifest {
  installed: ManifestEntry[]
}

export interface RegistrySource {
  name: string
  url: string
}

export interface RegistryStats {
  total_configs: number
  total_users: number
  total_installs: number
}

export interface RegistryUser {
  id: string
  username: string
  display_name: string
  email?: string
  bio?: string
  avatar_url?: string
  created_at: string
}

export interface RegistryAuthStatus {
  loggedIn: boolean
  user?: RegistryUser
}
