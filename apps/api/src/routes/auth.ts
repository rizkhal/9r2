import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { loginSchema } from '@9r2/shared'
import { getDb } from '../db'
import { sessions, users } from '../db/schema'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  adminCredentials,
  readBucketConfig,
  type AppEnv,
} from '../env'
import { randomToken, sha256Hex } from '../lib/crypto'
import { readJson } from '../lib/http'
import { seedBuckets } from '../lib/routing'
import { sessionUser } from '../middleware/auth'

export const authRoutes = new Hono<AppEnv>()

async function startSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken()
  await getDb(c.env.DB).insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: Date.now(),
  })
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    secure: new URL(c.req.url).protocol === 'https:',
  })
}

/** There is one account; its row is created on first sign-in so file FKs always resolve. */
async function ensureAdminUser(env: AppEnv['Bindings'], email: string) {
  const db = getDb(env.DB)
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (rows[0]) return rows[0]

  const user = { id: crypto.randomUUID(), email, name: 'Administrator', createdAt: Date.now() }
  await db.insert(users).values(user)
  await seedBuckets(db, user.id, readBucketConfig(env.BUCKET_CONFIG))
  return user
}

async function sameValue(a: string, b: string) {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)])
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}

authRoutes.post('/login', async (c) => {
  const body = await readJson(c, loginSchema)
  const admin = adminCredentials(c.env)

  const emailMatches = body.email.trim().toLowerCase() === admin.email
  const passwordMatches = await sameValue(body.password, admin.password)
  if (!emailMatches || !passwordMatches) {
    throw new HTTPException(401, { message: 'Invalid email or password.' })
  }

  const user = await ensureAdminUser(c.env, admin.email)
  await startSession(c, user.id)
  await seedBuckets(getDb(c.env.DB), user.id, readBucketConfig(c.env.BUCKET_CONFIG))
  return c.json({ user: { id: user.id, name: user.name, email: user.email } })
})

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    await getDb(c.env.DB).delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)))
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ status: 'ok' })
})

authRoutes.get('/me', async (c) => {
  const user = await sessionUser(c.env, getCookie(c, SESSION_COOKIE))
  if (!user) throw new HTTPException(401, { message: 'Authentication required.' })
  return c.json({ user })
})
