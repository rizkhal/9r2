import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    routingMode: text('routing_mode').notNull().default('most_available'),
    roundRobinCursor: integer('round_robin_cursor').notNull().default(0),
    priorityBucketIds: text('priority_bucket_ids').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('sessions_token_idx').on(t.tokenHash)],
)

/** One row per storage account a user may upload to.
 *  kind 'binding' — a wrangler R2 binding, resolved through env[binding].
 *  kind 's3'      — any S3-compatible endpoint; binding holds a synthetic `s3:<id>` placeholder. */
export const buckets = sqliteTable(
  'buckets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('binding'),
    binding: text('binding').notNull(),
    name: text('name').notNull(),
    bucketName: text('bucket_name'),
    endpoint: text('endpoint'),
    region: text('region'),
    accessKeyIdEncrypted: text('access_key_id_encrypted'),
    secretAccessKeyEncrypted: text('secret_access_key_encrypted'),
    quotaBytes: integer('quota_bytes'),
    priority: integer('priority').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('buckets_user_binding_idx').on(t.userId, t.binding)],
)

/** Keys are shown once and stored hashed; the prefix is for identifying a key in the UI. */
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').notNull().default('[]'),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.keyHash), index('api_keys_user_idx').on(t.userId)],
)

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('folders_user_parent_idx').on(t.userId, t.parentId)],
)

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id),
    folderId: text('folder_id'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** SHA-256 of the content, filled on upload. Null for rows stored before hashing existed. */
    sha256: text('sha256'),
    starredAt: integer('starred_at'),
    deletedAt: integer('deleted_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('files_user_folder_idx').on(t.userId, t.folderId), index('files_user_deleted_idx').on(t.userId, t.deletedAt)],
)

export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('shares_token_idx').on(t.tokenHash), index('shares_file_idx').on(t.fileId)],
)
