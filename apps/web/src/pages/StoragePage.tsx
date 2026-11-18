import type { BucketDTO, RoutingMode, StorageDTO } from '@9r2/shared'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { btn, input } from '../components/FileTable'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'

const GB = 1024 * 1024 * 1024

const modes: { value: RoutingMode; label: string; hint: string }[] = [
  { value: 'most_available', label: 'Most free space', hint: 'Uploads go to the account with the most room left.' },
  { value: 'round_robin', label: 'Round robin', hint: 'Uploads rotate evenly across eligible accounts.' },
  { value: 'priority', label: 'Priority order', hint: 'Uploads try accounts in the order below, top first.' },
]

type FormState = {
  name: string
  preset: 'r2' | 's3'
  accountId: string
  endpoint: string
  region: string
  bucketName: string
  accessKeyId: string
  secretAccessKey: string
  quotaGb: string
}

const emptyForm: FormState = {
  name: '',
  preset: 'r2',
  accountId: '',
  endpoint: '',
  region: 'auto',
  bucketName: '',
  accessKeyId: '',
  secretAccessKey: '',
  quotaGb: '',
}

export function StoragePage() {
  const [data, setData] = useState<StorageDTO | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    const storage = await api<StorageDTO>('/api/storage')
    setData(storage)
    const ids = storage.buckets.map((bucket) => bucket.id)
    const known = storage.routing.priorityBucketIds.filter((id) => ids.includes(id))
    setOrder([...known, ...ids.filter((id) => !known.includes(id))])
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load storage'))
  }, [load])

  async function run(work: () => Promise<unknown>) {
    setError(null)
    try {
      await work()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  function saveMode(mode: RoutingMode) {
    void run(() => api('/api/storage/policy', { method: 'PUT', body: { mode, priorityBucketIds: order } }))
  }

  function moveBucket(id: string, delta: number) {
    const index = order.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= order.length) return
    const next = [...order]
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(target, 0, moved)
    setOrder(next)
    void run(() => api('/api/storage/policy', { method: 'PUT', body: { mode: data?.routing.mode, priorityBucketIds: next } }))
  }

  function saveQuota(bucket: BucketDTO, gb: string) {
    const quotaBytes = gb.trim() === '' ? null : Math.round(Number(gb) * GB)
    if (quotaBytes !== null && (!Number.isFinite(quotaBytes) || quotaBytes < 0)) return
    void run(() => api(`/api/storage/buckets/${bucket.id}`, { method: 'PATCH', body: { quotaBytes } }))
  }

  function payload() {
    const endpoint =
      form.preset === 'r2'
        ? `https://${form.accountId.trim()}.r2.cloudflarestorage.com`
        : form.endpoint.trim()
    return {
      name: form.name.trim(),
      endpoint,
      region: form.preset === 'r2' ? 'auto' : form.region.trim() || 'auto',
      bucketName: form.bucketName.trim(),
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: form.secretAccessKey.trim(),
      quotaBytes: form.quotaGb.trim() === '' ? null : Math.round(Number(form.quotaGb) * GB),
    }
  }

  async function testConnection() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api<{ ok: boolean; message: string }>('/api/storage/accounts/test', { body: payload() })
      setNotice(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setBusy(false)
    }
  }

  async function addAccount(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api('/api/storage/accounts', { body: payload() })
      setForm(emptyForm)
      setShowForm(false)
      setNotice('Storage account added.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the account')
    } finally {
      setBusy(false)
    }
  }

  function removeAccount(bucket: BucketDTO) {
    if (!window.confirm(`Remove "${bucket.name}"? Its files must be deleted first.`)) return
    void run(() => api(`/api/storage/accounts/${bucket.id}`, { method: 'DELETE' }))
  }

  const orderedBuckets = order
    .map((id) => data?.buckets.find((bucket) => bucket.id === id))
    .filter((bucket): bucket is BucketDTO => Boolean(bucket))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
          <p className="text-sm text-slate-500">Every connected account, combined space, and where new uploads land.</p>
        </div>
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          onClick={() => setShowForm((open) => !open)}
        >
          {showForm ? 'Cancel' : 'Add storage account'}
        </button>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}
      {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{notice}</p> : null}

      {showForm ? (
        <form onSubmit={addAccount} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">New storage account</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input className={input} placeholder="Backup account" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Type</span>
              <select className={input} value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value as 'r2' | 's3' })}>
                <option value="r2">Cloudflare R2 (another account)</option>
                <option value="s3">Other S3-compatible storage</option>
              </select>
            </label>

            {form.preset === 'r2' ? (
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block font-medium">Cloudflare account ID</span>
                <input
                  className={input}
                  placeholder="023e105f4ecef8ad9ca31a8372d0c353"
                  value={form.accountId}
                  onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                  required
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Dashboard → R2 → Manage R2 API Tokens. Endpoint becomes https://&lt;account-id&gt;.r2.cloudflarestorage.com
                </span>
              </label>
            ) : (
              <>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium">Endpoint</span>
                  <input className={input} placeholder="https://s3.us-west-002.backblazeb2.com" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} required />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Region</span>
                  <input className={input} placeholder="auto" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
                </label>
              </>
            )}

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Bucket name</span>
              <input className={input} placeholder="my-bucket" value={form.bucketName} onChange={(e) => setForm({ ...form, bucketName: e.target.value })} required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Quota (GB, blank = unlimited)</span>
              <input className={input} inputMode="decimal" value={form.quotaGb} onChange={(e) => setForm({ ...form, quotaGb: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Access key ID</span>
              <input className={input} autoComplete="off" value={form.accessKeyId} onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })} required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Secret access key</span>
              <input className={input} type="password" autoComplete="new-password" value={form.secretAccessKey} onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value })} required />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
              {busy ? 'Working…' : 'Add account'}
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => void testConnection()}>
              Test connection
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Credentials are encrypted with the deployment secret and only used server-side. Reads and writes go through the Worker.
          </p>
        </form>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-500">Used</p>
              <p className="mt-1 text-2xl font-semibold">{formatBytes(data.totalUsedBytes)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-500">Quota</p>
              <p className="mt-1 text-2xl font-semibold">{formatBytes(data.totalQuotaBytes)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-500">Accounts</p>
              <p className="mt-1 text-2xl font-semibold">{data.buckets.length}</p>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Storage accounts</h2>
            {orderedBuckets.length === 0 ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                No storage accounts yet. Add one above, or declare an R2 binding in wrangler.jsonc.
              </p>
            ) : null}
            <div className="space-y-2">
              {orderedBuckets.map((bucket, index) => (
                <div key={bucket.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {index + 1}. {bucket.name}
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {bucket.kind === 's3' ? 'S3' : 'binding'}
                        </span>
                      </p>
                      <p className="truncate font-mono text-xs text-slate-500">{bucket.endpoint ?? bucket.binding}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" className={btn} onClick={() => moveBucket(bucket.id, -1)} disabled={index === 0}>
                        Up
                      </button>
                      <button
                        type="button"
                        className={btn}
                        onClick={() => moveBucket(bucket.id, 1)}
                        disabled={index === orderedBuckets.length - 1}
                      >
                        Down
                      </button>
                      {bucket.kind === 's3' ? (
                        <button type="button" className={btn} onClick={() => removeAccount(bucket)}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="h-2 min-w-40 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full bg-indigo-500"
                        style={{
                          width: bucket.quotaBytes ? `${Math.min(100, (bucket.usedBytes / bucket.quotaBytes) * 100)}%` : '0%',
                        }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {formatBytes(bucket.usedBytes)} of {formatBytes(bucket.quotaBytes)} used
                    </p>
                    <label className="flex items-center gap-2 text-xs text-slate-500">
                      Quota (GB)
                      <input
                        key={`${bucket.id}-${bucket.quotaBytes}`}
                        className={`${input} w-24 px-2 py-1`}
                        defaultValue={bucket.quotaBytes === null ? '' : String(bucket.quotaBytes / GB)}
                        placeholder="unlimited"
                        onBlur={(event) => saveQuota(bucket, event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Upload routing</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {modes.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => saveMode(mode.value)}
                  className={`rounded-lg border p-3 text-left ${
                    data.routing.mode === mode.value
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900'
                  }`}
                >
                  <p className="text-sm font-medium">{mode.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{mode.hint}</p>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
    </div>
  )
}
