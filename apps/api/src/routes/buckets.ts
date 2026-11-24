import type { BucketSummaryDTO } from '@9r2/shared'
import { storageAccountSchema } from '@9r2/shared'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getDb } from '../db'
import type { AppEnv } from '../env'
import { readJson } from '../lib/http'
import { loadBuckets } from '../lib/routing'
import { bucketSummary, createStorageAccount, removeStorageAccount } from '../lib/storage-accounts'
import { requireScope } from '../middleware/auth'

export const bucketRoutes = new Hono<AppEnv>()

/** Readable with an API key so a script can find the ids that move-storage takes. */
bucketRoutes.get('/', requireScope('files:read'), async (c) => {
  const list = await loadBuckets(getDb(), c.get('user').id)
  const buckets: BucketSummaryDTO[] = list.map(bucketSummary)
  return c.json({ buckets })
})

bucketRoutes.get('/:id', requireScope('files:read'), async (c) => {
  const list = await loadBuckets(getDb(), c.get('user').id)
  const bucket = list.find((item) => item.id === c.req.param('id'))
  if (!bucket) throw new HTTPException(404, { message: 'Storage account not found.' })
  return c.json({ bucket: bucketSummary(bucket) })
})

/** Adds an S3-compatible storage account. `storage:manage` is opt-in per key: it can
 *  point uploads at storage the key holder controls. */
bucketRoutes.post('/', requireScope('storage:manage'), async (c) => {
  const body = await readJson(c, storageAccountSchema)
  const id = await createStorageAccount(c.env, getDb(), c.get('user').id, body)
  return c.json({ id }, 201)
})

bucketRoutes.delete('/:id', requireScope('storage:manage'), async (c) => {
  await removeStorageAccount(getDb(), c.get('user').id, c.req.param('id'))
  return c.json({ status: 'ok' })
})
