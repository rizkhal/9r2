import path from 'node:path'
import app from './index'
import type { Bindings } from './env'

// The SPA is built to apps/web/dist and served from the same origin as the API,
// so the session cookie stays same-origin and no CORS is needed.
const dist = path.join(import.meta.dir, '..', '..', 'web', 'dist')

/** These paths always hit the Hono app; everything else is a static asset. */
function isApi(pathname: string) {
  return (
    pathname === '/health' ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/public' ||
    pathname.startsWith('/public/')
  )
}

function bindings(): Bindings {
  return {
    SESSION_SECRET: process.env.SESSION_SECRET ?? '',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? '',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? '',
    SEED_BUCKETS: process.env.SEED_BUCKETS,
    ENVIRONMENT: process.env.ENVIRONMENT,
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  // Resolve inside dist only; anything outside (or missing) falls back to the SPA shell.
  const rel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const target = path.join(dist, rel)
  if (target.startsWith(dist)) {
    const file = Bun.file(target)
    if (rel && (await file.exists())) {
      const immutable = rel.startsWith('assets/')
      return new Response(file, {
        headers: { 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
      })
    }
  }
  const index = Bun.file(path.join(dist, 'index.html'))
  if (await index.exists()) return new Response(index, { headers: { 'cache-control': 'no-cache' } })
  return new Response('Not found', { status: 404 })
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8788),
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (isApi(pathname)) return app.fetch(req, bindings())
    if (req.method !== 'GET' && req.method !== 'HEAD') return app.fetch(req, bindings())
    return serveStatic(pathname)
  },
})

console.log(`9r2 listening on http://${server.hostname}:${server.port}`)
