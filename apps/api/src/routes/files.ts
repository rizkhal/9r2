import { createHash } from 'node:crypto'
import { and, desc, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { filePatchSchema, moveStorageSchema, type FileDTO, type ShareDTO } from '@9r2/shared'
import { getDb } from '../db'
import { buckets, files, folders, shares } from '../db/schema'
import { sessionSecret, type AppEnv } from '../env'
import { decryptText, encryptText, randomToken, sha256Hex } from '../lib/crypto'
import { readJson } from '../lib/http'
import { selectBucket } from '../lib/routing'
import { providerFor } from '../lib/storage-provider'
import { serveContent } from '../lib/stream'
import { requireScope } from '../middleware/auth'

export const fileRoutes = new Hono<AppEnv>()


type FileRow = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string | null
  folderId: string | null
  bucketId: string
  bucketName: string
  starredAt: number | null
  deletedAt: number | null
  createdAt: number
}

export const fileSelection = {
  id: files.id,
  name: files.name,
  mimeType: files.mimeType,
  sizeBytes: files.sizeBytes,
  sha256: files.sha256,
  folderId: files.folderId,
  bucketId: files.bucketId,
  bucketName: buckets.name,
  starredAt: files.starredAt,
  deletedAt: files.deletedAt,
  createdAt: files.createdAt,
}

export function toFileDTO(row: FileRow): FileDTO {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    folderId: row.folderId,
    bucketId: row.bucketId,
    bucketName: row.bucketName,
    starred: row.starredAt !== null,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  }
}

async function findFile(userId: string, fileId: string, includeDeleted = false) {
  const rows = await getDb()
    .select({ ...fileSelection, key: files.key, userId: files.userId })
    .from(files)
    .innerJoin(buckets, eq(buckets.id, files.bucketId))
    .where(and(eq(files.id, fileId), eq(files.userId, userId), includeDeleted ? undefined : isNull(files.deletedAt)))
    .limit(1)
  const file = rows[0]
  if (!file) throw new HTTPException(404, { message: 'File not found.' })
  return file
}

fileRoutes.get('/', requireScope('files:read'), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const status = c.req.query('status')
  const folderId = c.req.query('folderId')
  const search = c.req.query('q')?.trim()

  const filters = [eq(files.userId, userId)]
  if (status === 'trash') {
    filters.push(isNotNull(files.deletedAt))
  } else {
    filters.push(isNull(files.deletedAt))
    if (folderId) filters.push(eq(files.folderId, folderId))
  }
  if (search) filters.push(ilike(files.name, `%${search}%`))

  const rows = await db
    .select(fileSelection)
    .from(files)
    .innerJoin(buckets, eq(buckets.id, files.bucketId))
    .where(and(...filters))
    .orderBy(desc(files.createdAt))
    .limit(500)

  return c.json({ files: rows.map(toFileDTO) })
})

// Registered before `/:id` so the literal path wins.
fileRoutes.get('/shared', requireScope('files:read'), async (c) => {
  const db = getDb()
  const rows = await db
    .select({ share: shares, file: fileSelection })
    .from(shares)
    .innerJoin(files, eq(files.id, shares.fileId))
    .innerJoin(buckets, eq(buckets.id, files.bucketId))
    .where(and(eq(shares.userId, c.get('user').id), isNull(files.deletedAt)))
    .orderBy(desc(shares.createdAt))
    .limit(200)

  const origin = new URL(c.req.url).origin
  const result: ShareDTO[] = []
  for (const row of rows) {
    if (row.share.expiresAt !== null && row.share.expiresAt <= Date.now()) continue
    const token = await decryptText(sessionSecret(c.env), row.share.tokenEncrypted)
    result.push({
      id: row.share.id,
      url: `${origin}/f/${token}`,
      createdAt: row.share.createdAt,
      file: toFileDTO(row.file),
    })
  }
  return c.json({ shares: result })
})

fileRoutes.post('/', requireScope('files:write'), async (c) => {
  const db = getDb()
  const user = c.get('user')

  const sizeHeader = c.req.header('content-length')
  const sizeBytes = Number(sizeHeader)
  if (!sizeHeader || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new HTTPException(411, { message: 'Content-Length header is required.' })
  }

  let name = ''
  try {
    name = decodeURIComponent(c.req.header('x-file-name') ?? '').trim()
  } catch {
    name = ''
  }
  if (!name) throw new HTTPException(400, { message: 'x-file-name header is required.' })

  const mimeType = c.req.header('x-mime-type') || 'application/octet-stream'
  const folderId = c.req.header('x-folder-id') || null

  if (folderId) {
    const owned = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.userId, user.id), isNull(folders.deletedAt)))
      .limit(1)
    if (!owned[0]) throw new HTTPException(404, { message: 'Target folder not found.' })
  }

  const body = c.req.raw.body
  if (!body) throw new HTTPException(400, { message: 'Request body is required.' })

  const bucket = await selectBucket(db, user.id, sizeBytes)
  if (!bucket) throw new HTTPException(409, { message: 'No storage account has enough space for this file.' })

  const provider = providerFor(c.env, bucket)

  const id = crypto.randomUUID()
  const key = `${user.id}/${id}`

  // Hash the bytes in the same pass that streams them to storage; no tee, no buffering.
  const hash = createHash('sha256')
  const tapped = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hash.update(chunk)
        controller.enqueue(chunk)
      },
    }),
  )

  let storedSize: number
  try {
    storedSize = await provider.put(key, tapped, mimeType, sizeBytes)
  } catch (error) {
    await provider.delete(key).catch(() => undefined)
    throw error
  }
  const sha256 = hash.digest('hex')

  // The declared size is client-controlled; trust what the provider actually stored.
  if (storedSize !== sizeBytes) {
    await provider.delete(key).catch(() => undefined)
    throw new HTTPException(400, { message: 'Uploaded size did not match the declared Content-Length.' })
  }

  const now = Date.now()
  try {
    await db.insert(files).values({
      id,
      userId: user.id,
      bucketId: bucket.id,
      folderId,
      key,
      name,
      mimeType,
      sizeBytes,
      sha256,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    await provider.delete(key).catch(() => undefined)
    throw error
  }

  return c.json(
    {
      file: toFileDTO({
        id,
        name,
        mimeType,
        sizeBytes,
        sha256,
        folderId,
        bucketId: bucket.id,
        bucketName: bucket.name,
        starredAt: null,
        deletedAt: null,
        createdAt: now,
      }),
    },
    201,
  )
})

fileRoutes.patch('/:id', requireScope('files:write'), async (c) => {
  const body = await readJson(c, filePatchSchema)
  const db = getDb()
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'))

  if (body.folderId) {
    const owned = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.folderId), eq(folders.userId, user.id), isNull(folders.deletedAt)))
      .limit(1)
    if (!owned[0]) throw new HTTPException(404, { message: 'Target folder not found.' })
  }

  await db
    .update(files)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      ...(body.starred !== undefined ? { starredAt: body.starred ? Date.now() : null } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(files.id, file.id), eq(files.userId, user.id)))

  const updated = await findFile(user.id, file.id)
  return c.json({ file: toFileDTO(updated) })
})

fileRoutes.delete('/:id', requireScope('files:delete'), async (c) => {
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'))
  await getDb()
    .update(files)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(files.id, file.id), eq(files.userId, user.id)))
  return c.json({ status: 'ok' })
})

fileRoutes.post('/:id/restore', requireScope('files:write'), async (c) => {
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'), true)
  await getDb()
    .update(files)
    .set({ deletedAt: null, updatedAt: Date.now() })
    .where(and(eq(files.id, file.id), eq(files.userId, user.id)))
  return c.json({ status: 'ok' })
})

fileRoutes.delete('/:id/permanent', requireScope('files:delete'), async (c) => {
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'), true)

  const bucketRows = await getDb().select().from(buckets).where(eq(buckets.id, file.bucketId)).limit(1)
  const bucketRow = bucketRows[0]
  if (bucketRow) await providerFor(c.env, bucketRow).delete(file.key).catch(() => undefined)

  await getDb().delete(files).where(and(eq(files.id, file.id), eq(files.userId, user.id)))
  return c.json({ status: 'ok' })
})

fileRoutes.get('/:id/content', requireScope('files:read'), async (c) => {
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'))
  return serveContent(c, file, c.req.query('download') === '1' ? 'attachment' : 'inline')
})

/** Copy the object into another storage account, repoint the row, then drop the old copy. */
fileRoutes.post('/:id/move-storage', requireScope('files:write'), async (c) => {
  const body = await readJson(c, moveStorageSchema)
  const db = getDb()
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'))

  if (file.bucketId === body.bucketId) throw new HTTPException(400, { message: 'File is already in that storage account.' })

  const targetRows = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.id, body.bucketId), eq(buckets.userId, user.id)))
    .limit(1)
  const target = targetRows[0]
  if (!target) throw new HTTPException(404, { message: 'Target storage account not found.' })

  if (target.quotaBytes !== null) {
    const used = await db
      .select({ used: sql<number>`coalesce(sum(${files.sizeBytes}), 0)` })
      .from(files)
      .where(and(eq(files.userId, user.id), eq(files.bucketId, target.id)))
    if (Number(used[0]?.used ?? 0) + file.sizeBytes > target.quotaBytes) {
      throw new HTTPException(409, { message: 'Target storage account does not have enough free space.' })
    }
  }

  const sourceRows = await db.select().from(buckets).where(eq(buckets.id, file.bucketId)).limit(1)
  const source = sourceRows[0]
  if (!source) throw new HTTPException(404, { message: 'Source storage account not found.' })

  const object = await providerFor(c.env, source).get(file.key)
  if (!object?.body) throw new HTTPException(404, { message: 'File content not found in storage.' })

  const storedSize = await providerFor(c.env, target).put(file.key, object.body, file.mimeType, file.sizeBytes)
  if (storedSize !== file.sizeBytes) {
    await providerFor(c.env, target).delete(file.key).catch(() => undefined)
    throw new HTTPException(502, { message: 'Copied size did not match; nothing was moved.' })
  }

  await db
    .update(files)
    .set({ bucketId: target.id, updatedAt: Date.now() })
    .where(and(eq(files.id, file.id), eq(files.userId, user.id)))

  // Only after the row points at the new copy. A failure here leaves an orphan, never a lost file.
  await providerFor(c.env, source).delete(file.key).catch((error) => {
    console.error('move-storage: old copy not deleted', file.id, error)
  })

  return c.json({ status: 'ok', bucketId: target.id, bucketName: target.name })
})

fileRoutes.post('/:id/share', requireScope('files:write'), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'))

  const existing = await db
    .select()
    .from(shares)
    .where(and(eq(shares.fileId, file.id), eq(shares.userId, user.id)))
    .orderBy(desc(shares.createdAt))
    .limit(1)

  const active = existing[0]
  if (active && (active.expiresAt === null || active.expiresAt > Date.now())) {
    const token = await decryptText(sessionSecret(c.env), active.tokenEncrypted)
    return c.json({ url: `${new URL(c.req.url).origin}/f/${token}` })
  }

  const token = randomToken()
  await db.insert(shares).values({
    id: crypto.randomUUID(),
    userId: user.id,
    fileId: file.id,
    tokenHash: await sha256Hex(token),
    tokenEncrypted: await encryptText(sessionSecret(c.env), token),
    createdAt: Date.now(),
  })

  return c.json({ url: `${new URL(c.req.url).origin}/f/${token}` }, 201)
})

fileRoutes.delete('/:id/share', requireScope('files:write'), async (c) => {
  const user = c.get('user')
  const file = await findFile(user.id, c.req.param('id'))
  await getDb().delete(shares).where(and(eq(shares.fileId, file.id), eq(shares.userId, user.id)))
  return c.json({ status: 'ok' })
})
