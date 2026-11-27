import { HTTPException } from 'hono/http-exception'

/** Values arrive from the process environment (filled in per request by server.ts). */
export type Bindings = {
  SESSION_SECRET: string
  ADMIN_EMAIL: string
  ADMIN_PASSWORD: string
  /** JSON array of S3 accounts seeded for a new account, so a fresh install has storage. */
  SEED_BUCKETS?: string
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

export type SeedBucket = {
  name?: string
  endpoint: string
  region?: string
  bucketName: string
  accessKeyId: string
  secretAccessKey: string
  quotaBytes?: number | null
}

/** Reads the seed list from SEED_BUCKETS. Bad JSON means no seeds, not a crash. */
export function readSeedBuckets(raw: string | undefined): SeedBucket[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SeedBucket =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SeedBucket).endpoint === 'string' &&
        typeof (item as SeedBucket).bucketName === 'string' &&
        typeof (item as SeedBucket).accessKeyId === 'string' &&
        typeof (item as SeedBucket).secretAccessKey === 'string',
    )
  } catch {
    return []
  }
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
      message: 'ADMIN_EMAIL and ADMIN_PASSWORD must be set (environment variables, or .env locally).',
    })
  }
  return { email: env.ADMIN_EMAIL.trim().toLowerCase(), password: env.ADMIN_PASSWORD }
}
