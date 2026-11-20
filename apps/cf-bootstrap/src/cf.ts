/** Minimal Cloudflare v4 API client: only the calls the bootstrap tool needs. */
export type CfAccount = { id: string; name: string }
export type CfPermissionGroup = {
  id: string
  name: string
  is_selectable?: boolean
  scopes?: string[]
}
export type CfTokenResult = { id: string; value?: string; name?: string }
export type CfBucket = { name: string; jurisdiction?: string; creation_date?: string }

export class CfApiError extends Error {
  constructor(
    readonly status: number,
    readonly errors: unknown[],
    message: string,
  ) {
    super(message)
    this.name = 'CfApiError'
  }
}

function describe(body: any, status: number): string {
  const errors = Array.isArray(body?.errors) ? body.errors : []
  const detail = errors
    .map((e: any) => `${e.code ?? ''} ${e.message ?? ''}`.trim())
    .filter(Boolean)
    .join('; ')
  return detail || `Cloudflare API returned ${status}`
}

export function cfClient(token: string, apiBase = 'https://api.cloudflare.com/client/v4') {
  const base = apiBase.replace(/\/+$/, '')

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')

    const res = await fetch(`${base}${path}`, { ...init, headers })
    let body: any = null
    try {
      body = await res.json()
    } catch {
      // Non-JSON error pages are reported with the status code below.
    }
    if (!res.ok || body?.success === false) {
      throw new CfApiError(res.status, body?.errors ?? [], describe(body, res.status))
    }
    return body.result as T
  }

  function bucketHeaders(jurisdiction: string): HeadersInit {
    return jurisdiction && jurisdiction !== 'default'
      ? { 'cf-r2-jurisdiction': jurisdiction }
      : {}
  }

  return {
    verify: () => api<{ id: string; status: string }>('/user/tokens/verify'),
    accounts: () => api<CfAccount[]>('/accounts'),

    async getBucket(accountId: string, bucket: string, jurisdiction = 'default'): Promise<CfBucket | null> {
      const res = await fetch(
        `${base}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}`,
        { headers: { Authorization: `Bearer ${token}`, ...bucketHeaders(jurisdiction) } },
      )
      if (res.status === 404) return null
      let body: any = null
      try {
        body = await res.json()
      } catch {
        // handled below
      }
      if (!res.ok || body?.success === false) {
        throw new CfApiError(res.status, body?.errors ?? [], describe(body, res.status))
      }
      return body.result as CfBucket
    },

    createBucket(accountId: string, bucket: string, jurisdiction = 'default') {
      return api<CfBucket>(`/accounts/${accountId}/r2/buckets`, {
        method: 'POST',
        headers: bucketHeaders(jurisdiction),
        body: JSON.stringify({ name: bucket }),
      })
    },

    permissionGroups(accountId: string, name?: string) {
      const query = name ? `?name=${encodeURIComponent(name)}` : ''
      return api<CfPermissionGroup[]>(`/accounts/${accountId}/tokens/permission_groups${query}`)
    },

    createToken(accountId: string, payload: unknown) {
      return api<CfTokenResult>(`/accounts/${accountId}/tokens`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
  }
}
