import { AwsClient } from 'aws4fetch'
import { HTTPException } from 'hono/http-exception'
import type { Bindings } from '../env'
import { decryptText } from './crypto'

export type BucketLike = {
  id: string
  kind: string
  binding: string | null
  bucketName: string | null
  endpoint: string | null
  region: string | null
  accessKeyIdEncrypted: string | null
  secretAccessKeyEncrypted: string | null
}

export type Range = { offset?: number; length?: number; suffix?: number }

export type StoredObject = {
  body: ReadableStream | null
  size: number
  httpEtag: string
  range?: { offset?: number; length?: number }
}

/** Both backends answer the same three calls, so callers never branch on kind. */
export type PresignOptions = {
  expiresSeconds?: number
  /** When set, the URL forces the response headers (S3 signs them into the query). */
  response?: { name: string; mimeType: string }
}

export type StorageProvider = {
  put(key: string, body: ReadableStream, contentType: string, size: number): Promise<number>
  get(key: string, range?: Range): Promise<StoredObject | null>
  delete(key: string): Promise<void>
  presign(key: string, method: 'GET' | 'PUT', options?: PresignOptions): Promise<string>
}

/** Every account is S3-compatible: an S3 endpoint reached over signed HTTP. */
export function providerFor(env: Bindings, bucket: BucketLike): StorageProvider {
  return s3Provider(env, bucket)
}

function s3Provider(env: Bindings, bucket: BucketLike): StorageProvider {
  // Credentials are encrypted at rest, so the client is built lazily and reused per request.
  const client = s3Client(env, bucket)
  const base = objectBase(bucket)

  return {
    async put(key, body, contentType, size) {
      const res = await (await client).fetch(base(key), {
        method: 'PUT',
        body,
        headers: { 'content-type': contentType, 'content-length': String(size) },
        // Node/undici streams require half-duplex; Bun ignores it.
        duplex: 'half',
      } as RequestInit)
      if (!res.ok) throw upstream(res)
      return size
    },
    async get(key, range) {
      const headers: Record<string, string> = {}
      if (range) headers.range = toRangeHeader(range)
      const res = await (await client).fetch(base(key), { headers })
      if (res.status === 404) return null
      if (!res.ok) throw upstream(res)
      return {
        body: res.body,
        size: totalSize(res),
        httpEtag: res.headers.get('etag') ?? '',
        range: res.status === 206 ? parseContentRange(res.headers.get('content-range')) : undefined,
      }
    },
    async delete(key) {
      const res = await (await client).fetch(base(key), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw upstream(res)
    },
    async presign(key, method, options = {}) {
      const expires = Math.min(Math.max(Math.floor(options.expiresSeconds ?? 300), 1), 604800)
      const url = new URL(base(key))
      // S3 reads the TTL from X-Amz-Expires; pre-setting it before signing is the supported hook.
      url.searchParams.set('X-Amz-Expires', String(expires))
      if (options.response) {
        url.searchParams.set('response-content-type', options.response.mimeType)
        url.searchParams.set(
          'response-content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(options.response.name)}`,
        )
      }
      const signed = await (await client).sign(url.toString(), { method, aws: { signQuery: true } })
      return signed.url
    },
  }
}

async function s3Client(env: Bindings, bucket: BucketLike) {
  if (!bucket.endpoint || !bucket.bucketName) {
    throw new HTTPException(503, { message: 'This storage account is missing its endpoint or bucket name.' })
  }
  if (!bucket.accessKeyIdEncrypted || !bucket.secretAccessKeyEncrypted) {
    throw new HTTPException(503, { message: 'This storage account is missing its credentials.' })
  }
  const secret = env.SESSION_SECRET
  if (!secret) throw new HTTPException(500, { message: 'SESSION_SECRET is not configured.' })

  return new AwsClient({
    accessKeyId: await decryptText(secret, bucket.accessKeyIdEncrypted),
    secretAccessKey: await decryptText(secret, bucket.secretAccessKeyEncrypted),
    service: 's3',
    region: bucket.region || 'auto',
  })
}

function objectBase(bucket: BucketLike) {
  const endpoint = (bucket.endpoint ?? '').replace(/\/+$/, '')
  const name = bucket.bucketName ?? ''
  return (key: string) => `${endpoint}/${name}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function toRangeHeader(range: Range) {
  if (range.suffix !== undefined) return `bytes=-${range.suffix}`
  if (range.length !== undefined) return `bytes=${range.offset ?? 0}-${(range.offset ?? 0) + range.length - 1}`
  return `bytes=${range.offset ?? 0}-`
}

function parseContentRange(header: string | null) {
  const match = header ? /bytes (\d+)-(\d+)\/(\d+)/.exec(header) : null
  if (!match) return undefined
  const offset = Number(match[1])
  const end = Number(match[2])
  return { offset, length: end - offset + 1 }
}

function totalSize(res: Response) {
  const match = res.headers.get('content-range') ? /\/(\d+)$/.exec(res.headers.get('content-range')!) : null
  if (match) return Number(match[1])
  return Number(res.headers.get('content-length') ?? 0)
}

function upstream(res: Response) {
  return new HTTPException(502, {
    message: `Storage returned ${res.status}. Check the bucket name, endpoint and access keys.`,
  })
}

/** Used by the "test" button before an account is saved. */
export async function checkS3Connection(
  env: Bindings,
  config: { endpoint: string; region: string; bucketName: string; accessKeyId: string; secretAccessKey: string },
): Promise<{ ok: boolean; message: string }> {
  const secret = env.SESSION_SECRET
  if (!secret) return { ok: false, message: 'SESSION_SECRET is not configured.' }

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region || 'auto',
  })
  const url = `${config.endpoint.replace(/\/+$/, '')}/${config.bucketName}/__9r2_probe__`

  try {
    const res = await client.fetch(url, { method: 'GET' })
    // 404 means the bucket is reachable and the signature was accepted.
    if (res.status === 404) return { ok: true, message: 'Connected.' }
    if (res.status === 403) return { ok: false, message: 'Access denied — check the bucket name and access keys.' }
    if (res.ok) return { ok: true, message: 'Connected.' }
    return { ok: false, message: `Storage returned ${res.status}.` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not reach the endpoint.' }
  }
}
