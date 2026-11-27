import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { apiKeyCreateSchema, type ApiKeyDTO, type ApiKeyScope } from '@9r2/shared'
import { getDb } from '../db'
import { apiKeys } from '../db/schema'
import type { AppEnv } from '../env'
import { randomToken, sha256Hex } from '../lib/crypto'
import { readJson } from '../lib/http'
import { parseScopes, requireAuth } from '../middleware/auth'

export const apiKeyRoutes = new Hono<AppEnv>()

// Keys are managed from the browser only; a key must never mint another key.
apiKeyRoutes.use('*', requireAuth)

function toDTO(row: typeof apiKeys.$inferSelect): ApiKeyDTO {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: parseScopes(row.scopes) as ApiKeyScope[],
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }
}

apiKeyRoutes.get('/', async (c) => {
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, c.get('user').id))
    .orderBy(desc(apiKeys.createdAt))
  return c.json({ apiKeys: rows.map(toDTO) })
})

apiKeyRoutes.post('/', async (c) => {
  const body = await readJson(c, apiKeyCreateSchema)
  const secret = `9r2_${randomToken(32)}`
  const key = {
    id: crypto.randomUUID(),
    userId: c.get('user').id,
    name: body.name,
    keyPrefix: secret.slice(0, 12),
    keyHash: await sha256Hex(secret),
    scopes: JSON.stringify([...new Set(body.scopes)]),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: Date.now(),
  }
  await getDb().insert(apiKeys).values(key)
  // The only time the secret is ever returned.
  return c.json({ apiKey: toDTO(key), secret }, 201)
})

apiKeyRoutes.delete('/:id', async (c) => {
  const rows = await getDb()
    .update(apiKeys)
    .set({ revokedAt: Date.now() })
    .where(and(eq(apiKeys.id, c.req.param('id')), eq(apiKeys.userId, c.get('user').id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id })
  if (!rows[0]) throw new HTTPException(404, { message: 'API key not found.' })
  return c.json({ status: 'ok' })
})
