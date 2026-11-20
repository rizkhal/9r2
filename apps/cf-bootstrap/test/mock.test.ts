import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { runBatch } from '../src/batch'
import { provision } from '../src/provision'
import { readStore, upsertEntry } from '../src/store'

const ACCOUNT_ID = 'a'.repeat(32)
const TOKEN_VALUE = 'cfp_mock_token_value'

type State = {
  server: Server
  base: string
  calls: { method: string; url: string; body?: any; headers: Record<string, string | string[] | undefined> }[]
  createdBuckets: Set<string>
}

async function mockCloudflare(existingBuckets: string[] = []): Promise<State> {
  const calls: State['calls'] = []
  const createdBuckets = new Set(existingBuckets)
  const groups = [
    {
      id: 'grp-bucket-write',
      name: 'Workers R2 Storage Bucket Item Write',
      is_selectable: true,
      scopes: ['com.cloudflare.edge.r2.bucket'],
    },
    {
      id: 'grp-account-write',
      name: 'Workers R2 Storage Write',
      is_selectable: true,
      scopes: ['com.cloudflare.api.account'],
    },
  ]

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString('utf8')
    let body: any
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      body = raw
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const auth = String(req.headers.authorization ?? '')
    calls.push({ method: req.method ?? '', url: url.pathname + url.search, body, headers: req.headers })

    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (url.pathname.startsWith('/client/v4') && auth === 'Bearer bad-token') {
      return json(401, { success: false, errors: [{ code: 9100, message: 'invalid token' }] })
    }
    if (url.pathname === '/client/v4/user/tokens/verify') {
      return json(200, { success: true, result: { id: 'verify', status: 'active' } })
    }
    if (url.pathname === '/client/v4/accounts') {
      const accounts = auth === 'Bearer zero-token' ? [] : [{ id: ACCOUNT_ID, name: 'Mock Account' }]
      return json(200, { success: true, result: accounts })
    }
    if (url.pathname.startsWith(`/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/`)) {
      const name = decodeURIComponent(url.pathname.split('/').pop() ?? '')
      if (!createdBuckets.has(name)) {
        return json(404, { success: false, errors: [{ code: 10007, message: 'bucket not found' }] })
      }
      return json(200, { success: true, result: { name } })
    }
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets` && req.method === 'POST') {
      createdBuckets.add(body.name)
      return json(200, { success: true, result: { name: body.name, jurisdiction: 'default' } })
    }
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/tokens/permission_groups`) {
      const name = url.searchParams.get('name')
      return json(200, { success: true, result: name ? groups.filter((g) => g.name === name) : groups })
    }
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/tokens` && req.method === 'POST') {
      return json(200, {
        success: true,
        result: { id: 'mock-access-key-id', value: TOKEN_VALUE, name: body.name },
      })
    }
    if (url.pathname === '/mock-bucket/__9r2_probe__') {
      if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256')) {
        return json(403, { error: 'unsigned' })
      }
      return json(404, { error: 'NoSuchKey' })
    }
    return json(404, { success: false, errors: [{ code: 0, message: `unhandled ${url.pathname}` }] })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  return { server, base: `http://127.0.0.1:${address.port}`, calls, createdBuckets }
}

async function tempOut() {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', '9r2-cf-test-'))
  return join(dir, 'keys.json')
}

test('provision creates bucket, mints keys, and verifies the S3 signature', async () => {
  const mock = await mockCloudflare()
  try {
    const result = await provision({
      token: 'bootstrap-token',
      apiBase: `${mock.base}/client/v4`,
      r2Endpoint: mock.base,
      accountId: ACCOUNT_ID,
      bucket: 'mock-bucket',
    })

    assert.equal(result.bucket.created, true)
    assert.equal(result.credentials.accessKeyId, 'mock-access-key-id')
    assert.equal(
      result.credentials.secretAccessKey,
      createHash('sha256').update(TOKEN_VALUE, 'utf8').digest('hex'),
    )
    assert.equal(result.probe, 'ok')

    const tokenCall = mock.calls.find((c) => c.method === 'POST' && c.url.endsWith('/tokens'))
    assert.ok(tokenCall)
    assert.deepEqual(Object.keys(tokenCall.body.policies[0].resources), [
      `com.cloudflare.edge.r2.bucket.${ACCOUNT_ID}_default_mock-bucket`,
    ])
    assert.equal(tokenCall.body.policies[0].permission_groups[0].id, 'grp-bucket-write')

    const probe = mock.calls.find((c) => c.url === '/mock-bucket/__9r2_probe__')
    assert.ok(probe)
    assert.match(String(probe.headers.authorization), /^AWS4-HMAC-SHA256/)
    assert.equal(mock.calls.some((c) => c.url === '/api/buckets'), false)
  } finally {
    mock.server.close()
  }
})

test('reuses an existing bucket', async () => {
  const mock = await mockCloudflare(['mock-bucket'])
  try {
    const result = await provision({
      token: 'bootstrap-token',
      apiBase: `${mock.base}/client/v4`,
      r2Endpoint: mock.base,
      accountId: ACCOUNT_ID,
      bucket: 'mock-bucket',
    })
    assert.equal(result.bucket.created, false)
    assert.equal(mock.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/r2/buckets')).length, 0)
  } finally {
    mock.server.close()
  }
})

test('direct mode uses a dashboard token id and skips token minting', async () => {
  const mock = await mockCloudflare()
  try {
    const result = await provision({
      token: 'dashboard-token-value',
      tokenId: 'dashboard-token-id',
      apiBase: `${mock.base}/client/v4`,
      r2Endpoint: mock.base,
      accountId: ACCOUNT_ID,
      bucket: 'mock-bucket',
    })
    assert.equal(result.credentials.accessKeyId, 'dashboard-token-id')
    assert.equal(
      result.credentials.secretAccessKey,
      createHash('sha256').update('dashboard-token-value', 'utf8').digest('hex'),
    )
    assert.equal(result.token.name, 'dashboard-r2-mock-bucket')
    assert.equal(mock.calls.some((c) => c.method === 'POST' && c.url.endsWith('/tokens')), false)
    assert.equal(mock.calls.some((c) => c.url.includes('permission_groups')), false)
  } finally {
    mock.server.close()
  }
})

test('batch writes ok / no-account / login-error / skipped entries to one file', async () => {
  const mock = await mockCloudflare()
  const out = await tempOut()
  try {
    const summary = await runBatch(
      [
        { email: 'good@example.com', user_id: 'u-good', api_token: 'good-token' },
        { email: 'bad@example.com', user_id: 'u-bad', api_token: 'bad-token' },
        { email: 'zero@example.com', user_id: 'u-zero', api_token: 'zero-token' },
        { email: 'skip@example.com', user_id: 'u-skip', api_token: '', error: 'Rate-limited' },
      ],
      {
        apiBase: `${mock.base}/client/v4`,
        r2Endpoint: mock.base,
        bucket: 'mock-bucket',
        out,
      },
    )

    assert.deepEqual(summary, { ok: 1, failed: 1, noAccounts: 1, skipped: 1 })
    const store = await readStore(out)
    assert.equal(store.entries.length, 3)
    const ok = store.entries.find((e) => e.email === 'good@example.com')
    assert.equal(ok?.status, 'ok')
    assert.equal(ok?.accessKeyId, 'mock-access-key-id')
    assert.equal(
      ok?.secretAccessKey,
      createHash('sha256').update(TOKEN_VALUE, 'utf8').digest('hex'),
    )
    assert.match(ok?.error ?? '', /^$/)
    assert.match(store.entries.find((e) => e.email === 'zero@example.com')?.error ?? '', /0 accounts/)
    assert.match(store.entries.find((e) => e.email === 'bad@example.com')?.error ?? '', /login failed/)
    assert.equal((await stat(out)).mode & 0o777, 0o600)
  } finally {
    mock.server.close()
  }
})

test('upsert dedupes by key', async () => {
  const out = await tempOut()
  const base = {
    key: 'same:key',
    accountId: 'a',
    accountName: 'A',
    bucket: 'b',
    jurisdiction: 'default',
    endpoint: 'https://example.com',
    region: 'auto',
    status: 'ok' as const,
    createdAt: new Date().toISOString(),
  }
  await upsertEntry({ ...base, accessKeyId: 'first' }, out)
  await upsertEntry({ ...base, accessKeyId: 'second' }, out)
  const store = await readStore(out)
  assert.equal(store.entries.length, 1)
  assert.equal(store.entries[0].accessKeyId, 'second')
})
