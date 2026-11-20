import { and, eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { BucketSummaryDTO, storageAccountSchema } from '@9r2/shared'
import type { z } from 'zod'
import type { Db } from '../db'
import { buckets, files } from '../db/schema'
import { sessionSecret, type AppEnv } from '../env'
import { encryptText } from './crypto'
import { loadBuckets, type BucketUsage } from './routing'
import { checkS3Connection } from './storage-provider'

export type StorageAccountInput = z.infer<typeof storageAccountSchema>

/** What an API key may see: enough to pick a bucket id, never the credentials. */
export function bucketSummary(bucket: BucketUsage): BucketSummaryDTO {
  return {
    id: bucket.id,
    name: bucket.name,
    kind: bucket.kind === 's3' ? 's3' : 'binding',
    usedBytes: bucket.usedBytes,
    quotaBytes: bucket.quotaBytes,
    priority: bucket.priority,
  }
}

/** Verifies the credentials, then stores them encrypted. Shared by the browser and API-key routes. */
export async function createStorageAccount(
  env: AppEnv['Bindings'],
  db: Db,
  userId: string,
  body: StorageAccountInput,
) {
  const check = await checkS3Connection(env, body)
  if (!check.ok) throw new HTTPException(400, { message: check.message })

  const existing = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.userId, userId), eq(buckets.endpoint, body.endpoint), eq(buckets.bucketName, body.bucketName)))
    .limit(1)
  if (existing[0]) throw new HTTPException(409, { message: 'That bucket is already connected.' })

  const secret = sessionSecret(env)
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

  return id
}

export async function removeStorageAccount(db: Db, userId: string, id: string) {
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
  const [used] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.bucketId, id), eq(files.userId, userId)))
    .limit(1)
  if (used) throw new HTTPException(409, { message: "Move or delete this account's files before removing it." })

  await db.delete(buckets).where(and(eq(buckets.id, id), eq(buckets.userId, userId)))
}
