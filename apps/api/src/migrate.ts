import path from 'node:path'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { getDb } from './db'

/** Applies pending migrations, then exits. Run at container start before the server. */
const folder = path.join(import.meta.dir, '..', 'migrations')
await migrate(getDb(), { migrationsFolder: folder })
console.log('migrations applied')
process.exit(0)
