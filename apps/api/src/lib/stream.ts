import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { buckets } from '../db/schema'
import type { AppEnv } from '../env'
import { providerFor, type Range } from './storage-provider'

export type StreamableFile = { key: string; name: string; mimeType: string; bucketId: string }

/** Streams an object from whichever provider owns it, through the Worker (never a presigned URL). */
export async function serveContent(
  c: Context<AppEnv>,
  file: StreamableFile,
  disposition: 'inline' | 'attachment',
) {
  const bucketRows = await getDb().select().from(buckets).where(eq(buckets.id, file.bucketId)).limit(1)
  const bucketRow = bucketRows[0]
  if (!bucketRow) throw new HTTPException(404, { message: 'Storage bucket not found.' })

  const range = parseRange(c.req.header('range'))
  const object = await providerFor(c.env, bucketRow).get(file.key, range)
  if (!object) throw new HTTPException(404, { message: 'File content not found in storage.' })

  const headers = new Headers()
  headers.set('content-type', file.mimeType)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', 'private, max-age=0')
  headers.set('content-disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
  if (object.httpEtag) headers.set('etag', object.httpEtag)

  // R2 reports a range even for a full read, so only trust it when one was asked for.
  const served = range ? object.range : undefined
  if (served && typeof served.offset === 'number' && typeof served.length === 'number') {
    headers.set('content-range', `bytes ${served.offset}-${served.offset + served.length - 1}/${object.size}`)
    headers.set('content-length', String(served.length))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set('content-length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

function parseRange(header: string | undefined): Range | undefined {
  if (!header) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return undefined
  const start = match[1] ?? ''
  const end = match[2] ?? ''
  if (start === '' && end !== '') return { suffix: Number(end) }
  if (start === '') return undefined
  const offset = Number(start)
  if (end === '') return { offset }
  const length = Number(end) - offset + 1
  return length > 0 ? { offset, length } : undefined
}
