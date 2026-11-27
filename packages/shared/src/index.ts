import { z } from 'zod'

/** Storage routing is per user: which bucket a new upload lands in. */
export const routingModeSchema = z.enum(['most_available', 'round_robin', 'priority'])
export type RoutingMode = z.infer<typeof routingModeSchema>

export const loginSchema = z.object({
  // Not `.email()`: the address is whatever ADMIN_EMAIL holds, and a valid-looking
  // one is not required to compare two strings.
  email: z.string().trim().min(1).max(191),
  password: z.string().min(1).max(200),
})

export const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().nullable().optional(),
})

export const folderPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().nullable().optional(),
})

export const filePatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: z.string().nullable().optional(),
  starred: z.boolean().optional(),
})

export const bucketPatchSchema = z.object({
  quotaBytes: z.number().int().nonnegative().nullable().optional(),
  priority: z.number().int().optional(),
})

export const apiKeyScopes = ['files:read', 'files:write', 'files:delete', 'storage:manage'] as const
export type ApiKeyScope = (typeof apiKeyScopes)[number]

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(apiKeyScopes)).min(1),
})

export const moveStorageSchema = z.object({ bucketId: z.string().min(1) })

/** Batch presign: mint download URLs for several files in one call. */
export const presignBatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  expires: z.number().int().positive().max(3600).optional(),
})

/** A storage account added from the UI: any S3-compatible endpoint. */
export const storageAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  endpoint: z.string().trim().url().max(300),
  region: z.string().trim().min(1).max(64).default('auto'),
  bucketName: z.string().trim().min(1).max(191),
  accessKeyId: z.string().trim().min(1).max(200),
  secretAccessKey: z.string().trim().min(1).max(400),
  quotaBytes: z.number().int().nonnegative().nullable().optional(),
})

export const policySchema = z.object({
  mode: routingModeSchema,
  priorityBucketIds: z.array(z.string()).max(50),
})

export type UserDTO = { id: string; name: string; email: string }

export type FileDTO = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  /** SHA-256 of the content. Null for files stored before hashing existed. */
  sha256: string | null
  folderId: string | null
  bucketId: string
  bucketName: string
  starred: boolean
  deletedAt: number | null
  createdAt: number
}

export type FolderDTO = {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export type BucketDTO = {
  id: string
  kind: 'binding' | 's3'
  binding: string | null
  name: string
  endpoint: string | null
  usedBytes: number
  quotaBytes: number | null
  priority: number
}

/** What an API key may see: enough to pick a bucket id, nothing about credentials. */
export type BucketSummaryDTO = {
  id: string
  name: string
  kind: 'binding' | 's3'
  usedBytes: number
  quotaBytes: number | null
  priority: number
}

export type StorageDTO = {
  buckets: BucketDTO[]
  totalUsedBytes: number
  totalQuotaBytes: number | null
  routing: { mode: RoutingMode; priorityBucketIds: string[] }
}

export type ShareDTO = {
  id: string
  url: string
  createdAt: number
  file: FileDTO
}

export type PublicFileDTO = {
  name: string
  mimeType: string
  sizeBytes: number
  createdAt: number
}

export type ApiKeyDTO = {
  id: string
  name: string
  keyPrefix: string
  scopes: ApiKeyScope[]
  lastUsedAt: number | null
  revokedAt: number | null
  createdAt: number
}
