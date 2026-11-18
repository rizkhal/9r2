import { HTTPException } from 'hono/http-exception'
import type { ZodType } from 'zod'

/** Parses a JSON body against a shared schema, turning failures into a 400. */
export async function readJson<T>(c: { req: { json: () => Promise<unknown> } }, schema: ZodType<T>): Promise<T> {
  const json = await c.req.json().catch(() => null)
  const result = schema.safeParse(json ?? {})
  if (!result.success) {
    throw new HTTPException(400, { message: result.error.issues[0]?.message ?? 'Invalid request body.' })
  }
  return result.data
}

export const errorCodes: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  411: 'LENGTH_REQUIRED',
  413: 'PAYLOAD_TOO_LARGE',
  416: 'RANGE_NOT_SATISFIABLE',
  500: 'INTERNAL_ERROR',
  502: 'STORAGE_ERROR',
  503: 'STORAGE_UNAVAILABLE',
}
