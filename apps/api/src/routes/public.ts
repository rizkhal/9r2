import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getDb } from '../db'
import { files, shares } from '../db/schema'
import type { AppEnv } from '../env'
import { sha256Hex } from '../lib/crypto'
import { serveContent } from '../lib/stream'

export const publicRoutes = new Hono<AppEnv>()

async function findSharedFile(c: { env: AppEnv['Bindings'] }, token: string) {
  const rows = await getDb(c.env.DB)
    .select({
      id: files.id,
      key: files.key,
      name: files.name,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      createdAt: files.createdAt,
      bucketId: files.bucketId,
      deletedAt: files.deletedAt,
      expiresAt: shares.expiresAt,
    })
    .from(shares)
    .innerJoin(files, eq(files.id, shares.fileId))
    .where(and(eq(shares.tokenHash, await sha256Hex(token)), isNull(files.deletedAt)))
    .limit(1)

  const file = rows[0]
  if (!file || (file.expiresAt !== null && file.expiresAt <= Date.now())) {
    throw new HTTPException(404, { message: 'Shared file not found.' })
  }
  return file
}

publicRoutes.get('/files/:token', async (c) => {
  const file = await findSharedFile(c, c.req.param('token'))
  return c.json({
    file: { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt },
  })
})

publicRoutes.get('/files/:token/content', async (c) => {
  const file = await findSharedFile(c, c.req.param('token'))
  return serveContent(c, file, c.req.query('download') === '1' ? 'attachment' : 'inline')
})
