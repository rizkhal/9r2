import { HTTPException } from 'hono/http-exception'

export type Bindings = {
  DB: D1Database
  LOGIN_RATE_LIMITER: RateLimit
  SESSION_SECRET: string
  /** Single-account login: no registration. Set both as wrangler secrets. */
  ADMIN_EMAIL: string
  ADMIN_PASSWORD: string
  BUCKET_CONFIG: string
  MAX_UPLOAD_BYTES?: string
  ENVIRONMENT?: string
}

export type SessionUser = { id: string; name: string; email: string }

export type ApiKeyContext = { id: string; scopes: string[] }

export type AppEnv = {
  Bindings: Bindings
  Variables: { user: SessionUser; apiKey?: ApiKeyContext }
}

export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type BucketConfig = { binding: string; name: string; quotaBytes?: number | null }

/** Reads the bucket list from wrangler vars. Bad JSON means no buckets, not a crash. */
export function readBucketConfig(raw: string | undefined): BucketConfig[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is BucketConfig =>
        typeof item === 'object' && item !== null && typeof (item as BucketConfig).binding === 'string',
    )
  } catch {
    return []
  }
}

export function getR2(env: Bindings, binding: string): R2Bucket | null {
  const bucket = (env as unknown as Record<string, unknown>)[binding]
  return bucket ? (bucket as R2Bucket) : null
}

export function maxUploadBytes(env: Bindings): number {
  const value = Number(env.MAX_UPLOAD_BYTES ?? 0)
  // Workers caps request bodies at 100 MB on the Free/Pro plans.
  return Number.isFinite(value) && value > 0 ? value : 100 * 1024 * 1024
}

export function sessionSecret(env: Bindings): string {
  if (!env.SESSION_SECRET) {
    throw new HTTPException(500, { message: 'SESSION_SECRET is not configured for this deployment.' })
  }
  return env.SESSION_SECRET
}

/** The only account this deployment has. Missing values are a config error, not a login failure. */
export function adminCredentials(env: Bindings): { email: string; password: string } {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new HTTPException(500, {
      message: 'ADMIN_EMAIL and ADMIN_PASSWORD must be set (wrangler secret put, or .dev.vars locally).',
    })
  }
  return { email: env.ADMIN_EMAIL.trim().toLowerCase(), password: env.ADMIN_PASSWORD }
}
