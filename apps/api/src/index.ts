import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './env'
import { errorCodes } from './lib/http'
import { apiKeyRoutes } from './routes/api-keys'
import { authRoutes } from './routes/auth'
import { bucketRoutes } from './routes/buckets'
import { fileRoutes } from './routes/files'
import { folderRoutes } from './routes/folders'
import { publicRoutes } from './routes/public'
import { storageRoutes } from './routes/storage'

const app = new Hono<AppEnv>()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/api/auth', authRoutes)
app.route('/api/api-keys', apiKeyRoutes)
app.route('/api/buckets', bucketRoutes)
app.route('/api/files', fileRoutes)
app.route('/api/folders', folderRoutes)
app.route('/api/storage', storageRoutes)
app.route('/public', publicRoutes)

app.notFound((c) => c.json({ code: 'NOT_FOUND', message: 'Route not found.' }, 404))

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ code: errorCodes[error.status] ?? 'ERROR', message: error.message }, error.status)
  }
  console.error('Unhandled error:', error)
  return c.json({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' }, 500)
})

export default app
