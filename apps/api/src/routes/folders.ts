import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { folderCreateSchema, folderPatchSchema, type FolderDTO } from '@9r2/shared'
import { getDb } from '../db'
import { buckets, files, folders } from '../db/schema'
import type { AppEnv } from '../env'
import { readJson } from '../lib/http'
import { requireScope } from '../middleware/auth'
import { fileSelection, toFileDTO } from './files'

export const folderRoutes = new Hono<AppEnv>()

const folderColumns = { id: folders.id, name: folders.name, parentId: folders.parentId, createdAt: folders.createdAt }

folderRoutes.get('/', requireScope('files:read'), async (c) => {
  // `?parentId=<id>` lists one level, `?parentId=` lists the root, no param lists every folder.
  const parentId = c.req.query('parentId')
  const filters = [eq(folders.userId, c.get('user').id), isNull(folders.deletedAt)]
  if (parentId !== undefined) filters.push(parentId === '' ? isNull(folders.parentId) : eq(folders.parentId, parentId))

  const rows = await getDb(c.env.DB).select(folderColumns).from(folders).where(and(...filters))

  const result: FolderDTO[] = rows
  return c.json({ folders: result })
})

/** One folder with its child folders and files, so a script needs a single call. */
folderRoutes.get('/:id', requireScope('files:read'), async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get('user').id
  const id = c.req.param('id')

  const rows = await db
    .select(folderColumns)
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId), isNull(folders.deletedAt)))
    .limit(1)
  const folder = rows[0]
  if (!folder) throw new HTTPException(404, { message: 'Folder not found.' })

  const children = await db
    .select(folderColumns)
    .from(folders)
    .where(and(eq(folders.userId, userId), eq(folders.parentId, id), isNull(folders.deletedAt)))

  const fileRows = await db
    .select(fileSelection)
    .from(files)
    .innerJoin(buckets, eq(buckets.id, files.bucketId))
    .where(and(eq(files.userId, userId), eq(files.folderId, id), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt))

  return c.json({ folder, folders: children, files: fileRows.map(toFileDTO) })
})

folderRoutes.post('/', requireScope('files:write'), async (c) => {
  const body = await readJson(c, folderCreateSchema)
  const db = getDb(c.env.DB)
  const userId = c.get('user').id

  if (body.parentId) {
    const parent = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.parentId), eq(folders.userId, userId), isNull(folders.deletedAt)))
      .limit(1)
    if (!parent[0]) throw new HTTPException(404, { message: 'Parent folder not found.' })
  }

  const folder: FolderDTO = {
    id: crypto.randomUUID(),
    name: body.name,
    parentId: body.parentId ?? null,
    createdAt: Date.now(),
  }
  await db.insert(folders).values({ ...folder, userId })
  return c.json({ folder }, 201)
})

folderRoutes.patch('/:id', requireScope('files:write'), async (c) => {
  const body = await readJson(c, folderPatchSchema)
  const db = getDb(c.env.DB)
  const userId = c.get('user').id
  const id = c.req.param('id')

  const rows = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId), isNull(folders.deletedAt)))
    .limit(1)
  if (!rows[0]) throw new HTTPException(404, { message: 'Folder not found.' })
  if (body.parentId) {
    if (body.parentId === id) throw new HTTPException(400, { message: 'A folder cannot be its own parent.' })
    const parent = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.parentId), eq(folders.userId, userId), isNull(folders.deletedAt)))
      .limit(1)
    if (!parent[0]) throw new HTTPException(404, { message: 'Parent folder not found.' })
  }

  await db
    .update(folders)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
    })
    .where(eq(folders.id, id))

  return c.json({ status: 'ok' })
})

folderRoutes.delete('/:id', requireScope('files:write'), async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get('user').id
  const id = c.req.param('id')

  const rows = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId), isNull(folders.deletedAt)))
    .limit(1)
  if (!rows[0]) throw new HTTPException(404, { message: 'Folder not found.' })

  await db.update(folders).set({ deletedAt: Date.now() }).where(eq(folders.id, id))
  await db.update(folders).set({ parentId: null }).where(and(eq(folders.parentId, id), eq(folders.userId, userId)))
  await db.update(files).set({ folderId: null }).where(and(eq(files.folderId, id), eq(files.userId, userId)))

  return c.json({ status: 'ok' })
})
