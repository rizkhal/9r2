import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { folderCreateSchema, folderPatchSchema, type FolderDTO } from '@9r2/shared'
import { getDb } from '../db'
import { files, folders } from '../db/schema'
import type { AppEnv } from '../env'
import { readJson } from '../lib/http'
import { requireAuth } from '../middleware/auth'

export const folderRoutes = new Hono<AppEnv>()

folderRoutes.use('*', requireAuth)

folderRoutes.get('/', async (c) => {
  const rows = await getDb(c.env.DB)
    .select({ id: folders.id, name: folders.name, parentId: folders.parentId, createdAt: folders.createdAt })
    .from(folders)
    .where(and(eq(folders.userId, c.get('user').id), isNull(folders.deletedAt)))

  const result: FolderDTO[] = rows
  return c.json({ folders: result })
})

folderRoutes.post('/', async (c) => {
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

folderRoutes.patch('/:id', async (c) => {
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

folderRoutes.delete('/:id', async (c) => {
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
