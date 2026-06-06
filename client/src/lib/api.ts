import type { ApiError } from '@/types/server'

// ── API Error ──────────────────────────────────────────────────────

export class ApiRequestError extends Error {
  status: number
  data: ApiError

  constructor(status: number, data: ApiError) {
    super(data.error || `HTTP ${status}`)
    this.name = 'ApiRequestError'
    this.status = status
    this.data = data
  }
}

// ── Base URL ───────────────────────────────────────────────────────
// In dev, the Vite proxy rewrites /api → localhost:3456 so apiBase stays ''.
// In production (hosted console), the user's local bridge must be targeted
// explicitly. We persist the URL in localStorage so it survives page reloads.

const STORAGE_KEY = 'mcp_one_bridge_url'

function normalizeBase(url: string): string {
  return url.replace(/\/$/, '').replace('://localhost:', '://127.0.0.1:')
}

let apiBase: string = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeBase(stored) : ''
  } catch {
    return ''
  }
})()

export function setApiBase(url: string): void {
  apiBase = normalizeBase(url)
  try { localStorage.setItem(STORAGE_KEY, apiBase) } catch { /* ignore */ }
}

/** Derive bridge URL (port 3456) from MCP endpoint URL (port 3333).
 *  Normalises `localhost` → `127.0.0.1` to avoid Windows IPv6 resolution issues:
 *  on Windows, `localhost` can resolve to ::1 while the bridge only binds to 0.0.0.0 (IPv4). */
export function deriveBridgeUrl(mcpUrl: string): string {
  try {
    const u = new URL(mcpUrl)
    u.port = '3456'
    u.pathname = ''
    if (u.hostname === 'localhost') u.hostname = '127.0.0.1'
    return u.origin
  } catch {
    return 'http://127.0.0.1:3456'
  }
}

// ── Core Fetch Wrapper ─────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${apiBase}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let data: ApiError
    try {
      data = (await res.json()) as ApiError
    } catch {
      data = { error: res.statusText }
    }
    throw new ApiRequestError(res.status, data)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

// ── Typed API Surface ─────────────────────────────────────────────

export const api = {
  get:    <T>(path: string)                  => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown)   => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown)   => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body: unknown)   => request<T>('PATCH',  path, body),
  delete: <T>(path: string)                  => request<T>('DELETE', path),
}
