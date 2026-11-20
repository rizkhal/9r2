#!/usr/bin/env node
/** Wipe 9r2 data with an API key: files -> folders -> S3 storage accounts. */
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const KEY_FILE = path.resolve(ROOT, arg('key-file', 'apps/api/.9r2-key'))
const API = arg('api', 'https://drive.lamaaulabs.com').replace(/\/+$/, '')
const APPLY = !process.argv.includes('--dry-run')

const key = (await fs.readFile(KEY_FILE, 'utf8')).trim()
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function api(p, options = {}) {
  const res = await fetch(`${API}${p}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const [files, trash, folders, buckets] = await Promise.all([
  api('/api/files'),
  api('/api/files?status=trash'),
  api('/api/folders'),
  api('/api/buckets'),
])
const allFiles = [...(files.body.files ?? []), ...(trash.body.files ?? [])]
const allFolders = folders.body.folders ?? []
const s3Buckets = (buckets.body.buckets ?? []).filter((b) => b.kind === 's3')
const binding = (buckets.body.buckets ?? []).filter((b) => b.kind !== 's3')

log('FOUND', JSON.stringify({
  files: allFiles.length,
  trash: (trash.body.files ?? []).length,
  folders: allFolders.length,
  s3Buckets: s3Buckets.length,
  bindingBuckets: binding.length,
  fileBytes: allFiles.reduce((n, f) => n + f.sizeBytes, 0),
}))
if (!APPLY) { log('dry-run only'); process.exit(0) }

let deletedFiles = 0, deletedFolders = 0, deletedBuckets = 0, failed = 0
for (const f of allFiles) {
  const r = await api(`/api/files/${f.id}/permanent`, { method: 'DELETE' })
  if (r.status === 200 || r.status === 204) deletedFiles++
  else { failed++; log('FAIL file', r.status, r.body.code ?? '') }
}
log('files deleted', deletedFiles)

for (const f of allFolders) {
  const r = await api(`/api/folders/${f.id}`, { method: 'DELETE' })
  if (r.status === 200 || r.status === 204) deletedFolders++
  else { failed++; log('FAIL folder', r.status, r.body.code ?? '') }
}
log('folders deleted', deletedFolders)

for (const b of s3Buckets) {
  const r = await api(`/api/buckets/${b.id}`, { method: 'DELETE' })
  if (r.status === 200 || r.status === 204) deletedBuckets++
  else { failed++; log('FAIL bucket', r.status, r.body.code ?? '', String(r.body.message ?? '').slice(0, 80)) }
}
log('s3 buckets deleted', deletedBuckets)

const after = await Promise.all([api('/api/files'), api('/api/files?status=trash'), api('/api/folders'), api('/api/buckets')])
log('AFTER', JSON.stringify({
  files: (after[0].body.files ?? []).length,
  trash: (after[1].body.files ?? []).length,
  folders: (after[2].body.folders ?? []).length,
  buckets: (after[3].body.buckets ?? []).length,
  failed,
}))
