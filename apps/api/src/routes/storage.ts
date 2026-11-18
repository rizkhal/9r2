import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  bucketPatchSchema,
  policySchema,
  storageAccountSchema,
  type BucketDTO,
  type StorageDTO,
} from '@9r2/shared'
import { getDb } from '../db'
import { buckets, files, users } from '../db/schema'
import { readBucketConfig, sessionSecret, type AppEnv } from '../env'
import { encryptText } from '../lib/crypto'
import { readJson } from '../lib/http'
import { loadBuckets, parseIds, seedBuckets } from '../lib/routing'
import { checkS3Connection } from '../lib/storage-provider'
import { requireAuth } from '../middleware/auth'

export const storageRoutes = new Hono<AppEnv>()

storageRoutes.use('*', requireAuth)

storageRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get('user').id
  // Picks up buckets added to BUCKET_CONFIG after this account was created.
  await seedBuckets(db, userId, readBucketConfig(c.env.BUCKET_CONFIG))
  const list = await loadBuckets(db, userId)
  const userRows = await db
    .select({ routingMode: users.routingMode, priorityBucketIds: users.priorityBucketIds })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const bucketList: BucketDTO[] = list.map((bucket) => ({
    id: bucket.id,
    kind: bucket.kind === 's3' ? 's3' : 'binding',
    binding: bucket.binding,
    name: bucket.name,
    endpoint: bucket.endpoint,
    usedBytes: bucket.usedBytes,
    quotaBytes: bucket.quotaBytes,
    priority: bucket.priority,
  }))

  const withQuota = list.filter((bucket) => bucket.quotaBytes !== null)
  const storage: StorageDTO = {
    buckets: bucketList,
    totalUsedBytes: list.reduce((total, bucket) => total + bucket.usedBytes, 0),
    totalQuotaBytes: withQuota.length === 0 ? null : withQuota.reduce((total, bucket) => total + (bucket.quotaBytes ?? 0), 0),
    routing: {
      mode: (userRows[0]?.routingMode as StorageDTO['routing']['mode']) ?? 'most_available',
      priorityBucketIds: parseIds(userRows[0]?.priorityBucketIds),
    },
  }
  return c.json(storage)
})

/** Checks the credentials without saving anything. */
storageRoutes.post('/accounts/test', async (c) => {
  const body = await readJson(c, storageAccountSchema)
  const result = await checkS3Connection(c.env, body)
  return c.json(result, result.ok ? 200 : 400)
})

/** Adds an S3-compatible storage account, e.g. another Cloudflare account's R2. */
storageRoutes.post('/accounts', async (c) => {
  const body = await readJson(c, storageAccountSchema)
  const db = getDb(c.env.DB)
  const userId = c.get('user').id

  const check = await checkS3Connection(c.env, body)
  if (!check.ok) throw new HTTPException(400, { message: check.message })

  const existing = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.userId, userId), eq(buckets.endpoint, body.endpoint), eq(buckets.bucketName, body.bucketName)))
    .limit(1)
  if (existing[0]) throw new HTTPException(409, { message: 'That bucket is already connected.' })

  const secret = sessionSecret(c.env)
  const current = await loadBuckets(db, userId)
  const id = crypto.randomUUID()

  await db.insert(buckets).values({
    id,
    userId,
    kind: 's3',
    binding: `s3:${id}`,
    name: body.name,
    bucketName: body.bucketName,
    endpoint: body.endpoint.replace(/\/+$/, ''),
    region: body.region,
    accessKeyIdEncrypted: await encryptText(secret, body.accessKeyId),
    secretAccessKeyEncrypted: await encryptText(secret, body.secretAccessKey),
    quotaBytes: body.quotaBytes ?? null,
    priority: current.length,
    createdAt: Date.now(),
  })

  return c.json({ id }, 201)
})

storageRoutes.delete('/accounts/:id', async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get('user').id
  const id = c.req.param('id')

  const rows = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.id, id), eq(buckets.userId, userId)))
    .limit(1)
  const bucket = rows[0]
  if (!bucket) throw new HTTPException(404, { message: 'Storage account not found.' })
  if (bucket.kind !== 's3') {
    throw new HTTPException(400, { message: 'Buckets configured in wrangler.jsonc cannot be removed here.' })
  }

  // Removing the row would orphan its objects, so require an empty bucket.
  const [used] = await db.select({ id: files.id }).from(files).where(and(eq(files.bucketId, id), eq(files.userId, userId))).limit(1)
  if (used) throw new HTTPException(409, { message: 'Move or delete this account\'s files before removing it.' })

  await db.delete(buckets).where(and(eq(buckets.id, id), eq(buckets.userId, userId)))
  return c.json({ status: 'ok' })
})

storageRoutes.patch('/buckets/:id', async (c) => {
  const body = await readJson(c, bucketPatchSchema)
  await getDb(c.env.DB)
    .update(buckets)
    .set({
      ...(body.quotaBytes !== undefined ? { quotaBytes: body.quotaBytes } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
    })
    .where(and(eq(buckets.id, c.req.param('id')), eq(buckets.userId, c.get('user').id)))
  return c.json({ status: 'ok' })
})

storageRoutes.put('/policy', async (c) => {
  const body = await readJson(c, policySchema)
  await getDb(c.env.DB)
    .update(users)
    .set({ routingMode: body.mode, priorityBucketIds: JSON.stringify(body.priorityBucketIds) })
    .where(eq(users.id, c.get('user').id))
  return c.json({ status: 'ok' })
})
