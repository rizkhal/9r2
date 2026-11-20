import type { BucketDTO, RoutingMode, StorageDTO } from '@9r2/shared'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Alert,
  Bar,
  Button,
  Eyebrow,
  Field,
  Icon,
  Input,
  Panel,
  Tag,
  cx,
} from '../components/ui'
import { api, copyText } from '../lib/api'
import { formatBytes } from '../lib/format'

const GB = 1024 * 1024 * 1024

const modes: { value: RoutingMode; label: string; hint: string }[] = [
  { value: 'most_available', label: 'Most free space', hint: 'Uploads go to the account with the most room left.' },
  { value: 'round_robin', label: 'Round robin', hint: 'Uploads rotate evenly across eligible accounts.' },
  { value: 'priority', label: 'Priority order', hint: 'Uploads try accounts in the order listed, top first.' },
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
    void run(() =>
      api('/api/storage/policy', { method: 'PUT', body: { mode: data?.routing.mode, priorityBucketIds: next } }),
    )
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

  const usedRatio = data && data.totalQuotaBytes ? data.totalUsedBytes / data.totalQuotaBytes : 0

  return (
    <div className="rise space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Storage</p>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            Accounts &amp; routing
          </h1>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
            Every connected bucket, the space they share, and the order new uploads fill them.
          </p>
        </div>
        <Button type="button" variant={showForm ? 'quiet' : 'primary'} onClick={() => setShowForm((open) => !open)}>
          <Icon name={showForm ? 'close' : 'plus'} className="size-3.5" />
          {showForm ? 'Cancel' : 'Add account'}
        </Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="notice">{notice}</Alert> : null}

      {showForm ? (
        <Panel className="rise p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <Eyebrow>New storage account</Eyebrow>
            <span className="font-mono text-[10px] text-faint">credentials encrypted at rest</span>
          </div>

          <form onSubmit={addAccount} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  placeholder="Backup account"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Type">
                <select
                  className="h-9 w-full rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
                  value={form.preset}
                  onChange={(e) => setForm({ ...form, preset: e.target.value as 'r2' | 's3' })}
                >
                  <option value="r2">Cloudflare R2 (another account)</option>
                  <option value="s3">Other S3-compatible storage</option>
                </select>
              </Field>

              {form.preset === 'r2' ? (
                <Field
                  className="sm:col-span-2"
                  label="Cloudflare account ID"
                  hint="Dashboard → R2 → Manage R2 API Tokens. The endpoint becomes https://<account-id>.r2.cloudflarestorage.com"
                >
                  <Input
                    placeholder="023e105f4ecef8ad9ca31a8372d0c353"
                    value={form.accountId}
                    onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                    required
                  />
                </Field>
              ) : (
                <>
                  <Field className="sm:col-span-2" label="Endpoint">
                    <Input
                      placeholder="https://s3.us-west-002.backblazeb2.com"
                      value={form.endpoint}
                      onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Region">
                    <Input
                      placeholder="auto"
                      value={form.region}
                      onChange={(e) => setForm({ ...form, region: e.target.value })}
                    />
                  </Field>
                </>
              )}

              <Field label="Bucket name">
                <Input
                  placeholder="my-bucket"
                  value={form.bucketName}
                  onChange={(e) => setForm({ ...form, bucketName: e.target.value })}
                  required
                />
              </Field>
              <Field label="Quota" hint="Leave blank for unlimited.">
                <Input
                  inputMode="decimal"
                  placeholder="GB"
                  value={form.quotaGb}
                  onChange={(e) => setForm({ ...form, quotaGb: e.target.value })}
                />
              </Field>
              <Field label="Access key ID">
                <Input
                  autoComplete="off"
                  value={form.accessKeyId}
                  onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
                  required
                />
              </Field>
              <Field label="Secret access key">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.secretAccessKey}
                  onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value })}
                  required
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Working…' : 'Add account'}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void testConnection()}>
                Test connection
              </Button>
              <p className="ml-auto max-w-[42ch] text-[11px] leading-relaxed text-faint">
                Keys are encrypted with the deployment secret and only used server-side. All reads and writes go
                through the Worker.
              </p>
            </div>
          </form>
        </Panel>
      ) : null}

      {data ? (
        <>
          <Panel className="grid gap-px overflow-hidden bg-line sm:grid-cols-[1.5fr_1fr_1fr]">
            <div className="bg-surface p-5">
              <Eyebrow>Used across accounts</Eyebrow>
              <p className="mt-2 font-mono text-[30px] font-medium leading-none tracking-[-0.03em] tabular-nums text-ink">
                {formatBytes(data.totalUsedBytes)}
              </p>
              <Bar value={usedRatio} className="mt-4" />
              <p className="mt-2 font-mono text-[10.5px] tabular-nums text-faint">
                {data.totalQuotaBytes
                  ? `${(usedRatio * 100).toFixed(usedRatio < 0.1 ? 1 : 0)}% of ${formatBytes(data.totalQuotaBytes)}`
                  : 'no quota set'}
              </p>
            </div>
            <div className="bg-surface p-5">
              <Eyebrow>Total quota</Eyebrow>
              <p className="mt-2 font-mono text-[20px] font-medium tracking-[-0.02em] tabular-nums text-ink">
                {formatBytes(data.totalQuotaBytes)}
              </p>
              <p className="mt-2 font-mono text-[10.5px] text-faint">sum of per-account limits</p>
            </div>
            <div className="bg-surface p-5">
              <Eyebrow>Accounts</Eyebrow>
              <p className="mt-2 font-mono text-[20px] font-medium tracking-[-0.02em] tabular-nums text-ink">
                {data.buckets.length}
              </p>
              <p className="mt-2 font-mono text-[10.5px] text-faint">
                {data.buckets.filter((bucket) => bucket.kind === 's3').length} S3 ·{' '}
                {data.buckets.filter((bucket) => bucket.kind === 'binding').length} bound
              </p>
            </div>
          </Panel>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Eyebrow>Storage accounts</Eyebrow>
              <span className="font-mono text-[10px] text-faint">top to bottom = priority</span>
            </div>

            {orderedBuckets.length === 0 ? (
              <Panel className="p-5">
                <p className="text-[12.5px] leading-relaxed text-muted">
                  No storage accounts yet. Add one above, or declare an R2 binding in wrangler.jsonc.
                </p>
              </Panel>
            ) : (
              <Panel className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {orderedBuckets.map((bucket, index) => {
                    const ratio = bucket.quotaBytes ? bucket.usedBytes / bucket.quotaBytes : 0
                    return (
                      <li key={bucket.id} className="px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[6px] border border-line bg-raise font-mono text-[10px] tabular-nums text-muted">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                                {bucket.name}
                                <Tag>{bucket.kind === 's3' ? 'S3' : 'binding'}</Tag>
                              </p>
                              <p className="truncate font-mono text-[10.5px] text-faint">
                                {bucket.endpoint ?? bucket.binding}
                              </p>
                              <button
                                type="button"
                                onClick={() => void copyText(bucket.id).catch(() => undefined)}
                                title="Copy bucket id"
                                className="mt-0.5 flex max-w-full items-center gap-1.5 rounded-[3px] font-mono text-[10px] text-faint transition-colors hover:text-accent"
                              >
                                <span className="truncate">{bucket.id}</span>
                                <Icon name="copy" className="size-3" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              title="Move up"
                              aria-label={`Move ${bucket.name} up`}
                              disabled={index === 0}
                              onClick={() => moveBucket(bucket.id, -1)}
                            >
                              <Icon name="up" className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              title="Move down"
                              aria-label={`Move ${bucket.name} down`}
                              disabled={index === orderedBuckets.length - 1}
                              onClick={() => moveBucket(bucket.id, 1)}
                            >
                              <Icon name="down" className="size-3.5" />
                            </Button>
                            {bucket.kind === 's3' ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                title={`Remove ${bucket.name}`}
                                aria-label={`Remove ${bucket.name}`}
                                onClick={() => removeAccount(bucket)}
                                className="text-faint hover:bg-danger-soft hover:text-danger"
                              >
                                <Icon name="trash" className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3 pl-0 sm:pl-10">
                          <Bar value={ratio} className="min-w-40 flex-1" />
                          <p className="font-mono text-[10.5px] tabular-nums text-muted">
                            {formatBytes(bucket.usedBytes)} / {formatBytes(bucket.quotaBytes)}
                          </p>
                          <label className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
                            quota
                            <Input
                              key={`${bucket.id}-${bucket.quotaBytes}`}
                              defaultValue={bucket.quotaBytes === null ? '' : String(bucket.quotaBytes / GB)}
                              placeholder="∞"
                              aria-label={`Quota in GB for ${bucket.name}`}
                              className="h-7 w-16 px-2 text-center font-mono text-[11px] tabular-nums"
                              onBlur={(event) => saveQuota(bucket, event.target.value)}
                            />
                            GB
                          </label>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
            )}
          </section>

          <section className="space-y-3">
            <Eyebrow>Upload routing</Eyebrow>
            <div className="overflow-hidden rounded-panel border border-line bg-surface">
              {modes.map((mode, index) => {
                const active = data.routing.mode === mode.value
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => saveMode(mode.value)}
                    aria-pressed={active}
                    className={cx(
                      'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raise',
                      index > 0 && 'border-t border-line',
                    )}
                  >
                    <span
                      className={cx(
                        'mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
                        active ? 'border-accent' : 'border-line2',
                      )}
                    >
                      {active ? <span className="size-[7px] rounded-full bg-accent" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{mode.label}</span>
                      <span className="block text-[12px] leading-relaxed text-muted">{mode.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        </>
      ) : (
        <div className="space-y-3">
          <div className="h-[104px] animate-pulse rounded-panel border border-line bg-raise/60" />
          <div className="h-40 animate-pulse rounded-panel border border-line bg-raise/60" />
        </div>
      )}
    </div>
  )
}
