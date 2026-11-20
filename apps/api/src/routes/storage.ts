import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  bucketPatchSchema,
  policySchema,
  storageAccountSchema,
  type BucketDTO,
  type StorageDTO,
} from '@9r2/shared'
import { getDb } from '../db'
import { buckets, users } from '../db/schema'
import { readBucketConfig, type AppEnv } from '../env'
import { readJson } from '../lib/http'
import { loadBuckets, parseIds, seedBuckets } from '../lib/routing'
import { createStorageAccount, removeStorageAccount } from '../lib/storage-accounts'
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
  const id = await createStorageAccount(c.env, getDb(c.env.DB), c.get('user').id, body)
  return c.json({ id }, 201)
})

storageRoutes.delete('/accounts/:id', async (c) => {
  await removeStorageAccount(getDb(c.env.DB), c.get('user').id, c.req.param('id'))
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
