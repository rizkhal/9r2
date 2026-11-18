import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { buckets, files, users } from '../db/schema'
import type { BucketConfig } from '../env'

export type BucketUsage = {
  id: string
  kind: string
  binding: string | null
  name: string
  bucketName: string | null
  endpoint: string | null
  region: string | null
  accessKeyIdEncrypted: string | null
  secretAccessKeyEncrypted: string | null
  priority: number
  quotaBytes: number | null
  usedBytes: number
  availableBytes: number | null
}

/** Usage is the sum of stored objects. Permanent deletes remove the row *and* the R2 object. */
export async function loadBuckets(db: Db, userId: string): Promise<BucketUsage[]> {
  const rows = await db.select().from(buckets).where(eq(buckets.userId, userId)).orderBy(buckets.priority, buckets.createdAt)
  const usage = await db
    .select({ bucketId: files.bucketId, used: sql<number>`coalesce(sum(${files.sizeBytes}), 0)` })
    .from(files)
    .where(eq(files.userId, userId))
    .groupBy(files.bucketId)
  const usedByBucket = new Map(usage.map((row) => [row.bucketId, Number(row.used)]))

  return rows.map((bucket) => {
    const usedBytes = usedByBucket.get(bucket.id) ?? 0
    return {
      id: bucket.id,
      kind: bucket.kind,
      binding: bucket.binding,
      name: bucket.name,
      bucketName: bucket.bucketName,
      endpoint: bucket.endpoint,
      region: bucket.region,
      accessKeyIdEncrypted: bucket.accessKeyIdEncrypted,
      secretAccessKeyEncrypted: bucket.secretAccessKeyEncrypted,
      priority: bucket.priority,
      quotaBytes: bucket.quotaBytes,
      usedBytes,
      availableBytes: bucket.quotaBytes === null ? null : Math.max(0, bucket.quotaBytes - usedBytes),
    }
  })
}

/** Picks the bucket for a new upload, honouring the user's routing policy. */
export async function selectBucket(
  db: Db,
  userId: string,
  sizeBytes: number,
  reserved: Map<string, number> = new Map(),
): Promise<BucketUsage | null> {
  const all = await loadBuckets(db, userId)
  const eligible = all
    .map((bucket) => {
      const used = bucket.usedBytes + (reserved.get(bucket.id) ?? 0)
      return {
        ...bucket,
        effectiveAvailable: bucket.quotaBytes === null ? null : Math.max(0, bucket.quotaBytes - used),
      }
    })
    .filter((bucket) => bucket.effectiveAvailable === null || bucket.effectiveAvailable >= sizeBytes)
  if (eligible.length === 0) return null

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const policy = user[0]
  const mode = policy?.routingMode ?? 'most_available'
  const priorityIds = parseIds(policy?.priorityBucketIds)

  const byPriority = [...eligible].sort((a, b) => {
    const aIndex = priorityIds.indexOf(a.id)
    const bIndex = priorityIds.indexOf(b.id)
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
    if (aIndex !== -1) return -1
    if (bIndex !== -1) return 1
    return a.priority - b.priority
  })

  if (mode === 'priority') return byPriority[0] ?? null

  if (mode === 'round_robin') {
    const cursor = policy?.roundRobinCursor ?? 0
    const picked = byPriority[cursor % byPriority.length] ?? byPriority[0]
    await db.update(users).set({ roundRobinCursor: cursor + 1 }).where(eq(users.id, userId))
    return picked ?? null
  }

  return [...eligible].sort((a, b) => (b.effectiveAvailable ?? Infinity) - (a.effectiveAvailable ?? Infinity))[0] ?? null
}

export function parseIds(value: unknown) {
  if (typeof value !== 'string') return [] as string[]
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return [] as string[]
  }
}

/** Creates the user's bucket rows from the deployment's wrangler bindings. */
export async function seedBuckets(db: Db, userId: string, configs: BucketConfig[]) {
  if (configs.length === 0) return
  await db
    .insert(buckets)
    .values(
      configs.map((config, index) => ({
        id: crypto.randomUUID(),
        userId,
        kind: 'binding',
        binding: config.binding,
        name: config.name || config.binding,
        quotaBytes: config.quotaBytes ?? null,
        priority: index,
        createdAt: Date.now(),
      })),
    )
    .onConflictDoNothing()
}
