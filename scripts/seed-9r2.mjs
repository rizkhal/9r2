#!/usr/bin/env node
/** Seed 9r2 with the R2 accounts collected by cf-dashboard. */
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const KEY_FILE = path.resolve(ROOT, arg('key-file', 'apps/api/.9r2-key'))
const STORE = path.resolve(ROOT, arg('store', 'cf-access-keys.json'))
const API = arg('api', 'https://drive.lamaaulabs.com')
const PATH = arg('path', '/api/buckets')
const QUOTA_GB = Number(arg('quota-gb', '10'))
const QUOTA_BYTES = Math.round(QUOTA_GB * 1024 * 1024 * 1024)
const LIMIT = arg('limit') ? Number(arg('limit')) : undefined

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const key = (await fs.readFile(KEY_FILE, 'utf8')).trim()
const store = JSON.parse(await fs.readFile(STORE, 'utf8'))
const entries = (store.entries ?? []).filter((e) => e.status === 'ok' && e.accessKeyId && e.secretAccessKey)
const list = LIMIT ? entries.slice(0, LIMIT) : entries
log('seeding', list.length, 'accounts, quota', QUOTA_GB, 'GB')

let ok = 0, dup = 0, fail = 0
for (const [i, e] of list.entries()) {
  const payload = {
    name: String(e.email ?? e.accountId).slice(0, 80),
    endpoint: e.endpoint || `https://${e.accountId}.r2.cloudflarestorage.com`,
    region: e.region || 'auto',
    bucketName: e.bucket,
    accessKeyId: e.accessKeyId,
    secretAccessKey: e.secretAccessKey,
    quotaBytes: QUOTA_BYTES,
  }
  try {
    const res = await fetch(`${API}${PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 201) { ok++; log(i + 1, '/', list.length, 'OK', e.accountId) }
    else if (res.status === 409) { dup++; log(i + 1, '/', list.length, 'DUP', e.accountId) }
    else { fail++; log(i + 1, '/', list.length, 'FAIL', res.status, body.code ?? '', String(body.message ?? '').slice(0, 120)) }
  } catch (err) {
    fail++
    log(i + 1, '/', list.length, 'FAIL', String(err?.message ?? err).slice(0, 160))
  }
  await delay(250)
}
log('done', JSON.stringify({ ok, dup, fail, total: list.length }))
