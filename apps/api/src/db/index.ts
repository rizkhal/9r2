import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

export type Db = ReturnType<typeof drizzleClient>

function drizzleClient() {
  return drizzle(new SQL(process.env.DATABASE_URL as string), { schema })
}

let instance: Db | null = null

/** A single pooled client for the process. Built lazily so import order never matters. */
export function getDb(): Db {
  if (!instance) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.')
    instance = drizzleClient()
  }
  return instance
}
