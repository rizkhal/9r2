import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { apiKeys, sessions, users } from '../db/schema'
import { SESSION_COOKIE, type AppEnv } from '../env'
import { sha256Hex } from '../lib/crypto'

/** Session cookie → user, or null. Shared by every auth path. */
export async function sessionUser(env: AppEnv['Bindings'], token: string | undefined) {
  if (!token) return null
  const rows = await getDb(env.DB)
    .select({ expiresAt: sessions.expiresAt, id: users.id, name: users.name, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, await sha256Hex(token)))
    .limit(1)

  const session = rows[0]
  return session && session.expiresAt > Date.now()
    ? { id: session.id, name: session.name, email: session.email }
    : null
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await sessionUser(c.env, getCookie(c, SESSION_COOKIE))
  if (!user) throw new HTTPException(401, { message: 'Authentication required.' })
  c.set('user', user)
  await next()
})

const LAST_USED_THROTTLE_MS = 5 * 60_000

/**
 * Browser session (full access) or an API key holding `scope`.
 * Keys cannot reach storage/account routes — those stay on requireAuth.
 */
export function requireScope(scope: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('authorization')

    if (!header?.startsWith('Bearer ')) {
      const user = await sessionUser(c.env, getCookie(c, SESSION_COOKIE))
      if (!user) throw new HTTPException(401, { message: 'Authentication required.' })
      c.set('user', user)
      return next()
    }

    const db = getDb(c.env.DB)
    const key = (
      await db.select().from(apiKeys).where(eq(apiKeys.keyHash, await sha256Hex(header.slice(7).trim()))).limit(1)
    )[0]
    if (!key || key.revokedAt) throw new HTTPException(401, { message: 'Invalid API key.' })

    const scopes = parseScopes(key.scopes)
    if (!scopes.includes(scope)) {
      throw new HTTPException(403, { message: `This API key lacks the ${scope} scope.` })
    }

    const owner = (await db.select().from(users).where(eq(users.id, key.userId)).limit(1))[0]
    if (!owner) throw new HTTPException(401, { message: 'Invalid API key.' })

    // A D1 write per request is wasteful; one per five minutes is plenty for "last used".
    if (!key.lastUsedAt || key.lastUsedAt < Date.now() - LAST_USED_THROTTLE_MS) {
      await db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, key.id))
    }

    c.set('user', { id: owner.id, name: owner.name, email: owner.email })
    c.set('apiKey', { id: key.id, scopes })
    return next()
  })
}

export function parseScopes(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
