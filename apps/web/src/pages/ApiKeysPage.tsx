import type { ApiKeyDTO, ApiKeyScope } from '@9r2/shared'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, EmptyState, Eyebrow, Icon, Input, Panel, Tag, cx } from '../components/ui'
import { api, copyText } from '../lib/api'
import { formatDate, formatWhen } from '../lib/format'

const allScopes: { value: ApiKeyScope; label: string; hint: string }[] = [
  { value: 'files:read', label: 'Read', hint: 'List files, download content' },
  { value: 'files:write', label: 'Write', hint: 'Upload, rename, move, restore, share' },
  { value: 'files:delete', label: 'Delete', hint: 'Trash and permanently delete' },
  { value: 'storage:manage', label: 'Storage', hint: 'Add or remove storage accounts' },
]

/** The API-key surface only — session-only routes stay out of this list. */
type Endpoint = { method: string; path: string; scope: ApiKeyScope; body?: string; upload?: boolean; save?: boolean }

const endpoints: Endpoint[] = [
  { method: 'GET', path: '/api/files?folderId=&q=&status=trash', scope: 'files:read' },
  { method: 'POST', path: '/api/files', scope: 'files:write', upload: true },
  { method: 'PATCH', path: '/api/files/:id', scope: 'files:write', body: '{"name":"renamed.txt"}' },
  { method: 'DELETE', path: '/api/files/:id', scope: 'files:delete' },
  { method: 'POST', path: '/api/files/:id/restore', scope: 'files:write' },
  { method: 'DELETE', path: '/api/files/:id/permanent', scope: 'files:delete' },
  { method: 'GET', path: '/api/files/:id/content?download=1', scope: 'files:read', save: true },
  { method: 'POST', path: '/api/files/:id/move-storage', scope: 'files:write', body: '{"bucketId":"<bucket-id>"}' },
  { method: 'POST', path: '/api/files/:id/share', scope: 'files:write' },
  { method: 'GET', path: '/api/files/shared', scope: 'files:read' },
  { method: 'GET', path: '/api/folders?parentId=', scope: 'files:read' },
  { method: 'GET', path: '/api/folders/:id', scope: 'files:read' },
  { method: 'POST', path: '/api/folders', scope: 'files:write', body: '{"name":"Reports","parentId":null}' },
  { method: 'PATCH', path: '/api/folders/:id', scope: 'files:write', body: '{"name":"2026-Q1"}' },
  { method: 'DELETE', path: '/api/folders/:id', scope: 'files:write' },
  { method: 'GET', path: '/api/buckets', scope: 'files:read' },
  { method: 'GET', path: '/api/buckets/:id', scope: 'files:read' },
  {
    method: 'POST',
    path: '/api/buckets',
    scope: 'storage:manage',
    body: '{"name":"Backup","endpoint":"https://<account-id>.r2.cloudflarestorage.com","region":"auto","bucketName":"backup","accessKeyId":"<id>","secretAccessKey":"<secret>"}',
  },
  { method: 'DELETE', path: '/api/buckets/:id', scope: 'storage:manage' },
]

function curlFor(endpoint: Endpoint, origin: string) {
  const args = [`curl -X ${endpoint.method} "${origin}${endpoint.path}"`, `  -H "Authorization: Bearer $KEY"`]
  if (endpoint.body) args.push(`  -H "content-type: application/json"`, `  -d '${endpoint.body}'`)
  if (endpoint.upload) {
    args.push(`  -H "x-file-name: backup.tar.gz"`, `  -H "x-mime-type: application/gzip"`, `  --data-binary @backup.tar.gz`)
  }
  if (endpoint.save) args.push(`  -o out.bin`)
  return args.join(' \\\n')
}

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const [copiedCurl, setCopiedCurl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['files:read', 'files:write'])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const data = await api<{ apiKeys: ApiKeyDTO[] }>('/api/api-keys')
    setKeys(data.apiKeys)
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load API keys'))
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

  async function create() {
    if (!name.trim() || scopes.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const data = await api<{ secret: string }>('/api/api-keys', { body: { name: name.trim(), scopes } })
      setSecret(data.secret)
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the key')
    } finally {
      setBusy(false)
    }
  }

  function toggleScope(scope: ApiKeyScope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    )
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <div className="rise space-y-7">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">API keys</p>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Machine access
        </h1>
        <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-muted">
          Scripts and CI authenticate with{' '}
          <code className="rounded-[3px] bg-raise px-1 py-0.5 font-mono text-[11px] text-ink">
            Authorization: Bearer &lt;key&gt;
          </code>{' '}
          against the same <code className="font-mono text-[11px]">/api/files</code> routes the browser uses.
        </p>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      {secret ? (
        <Panel className="border-accent/35 bg-accent/6 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Copy this key now — it is never shown again.</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Only a hash is stored. If you lose it, revoke the key and create another.
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Done
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-control border border-line bg-surface px-2.5 py-2 font-mono text-[11.5px] text-ink">
              {secret}
            </code>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void copyText(secret)
                  .then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1800)
                  })
                  .catch(() => undefined)
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel className="p-5">
        <Eyebrow>Create a key</Eyebrow>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Name</span>
            <Input
              className="w-64"
              placeholder="CI deploy"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create()
              }}
            />
          </label>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !name.trim() || scopes.length === 0}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create key'}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {allScopes.map((scope) => {
            const on = scopes.includes(scope.value)
            return (
              <button
                key={scope.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleScope(scope.value)}
                title={scope.hint}
                className={cx(
                  'flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-[12px] transition-colors',
                  on ? 'border-accent/40 bg-accent/10 text-ink' : 'border-line text-muted hover:border-line2 hover:text-ink',
                )}
              >
                <span
                  className={cx(
                    'grid size-3.5 place-items-center rounded-[3px] border transition-colors',
                    on ? 'border-accent bg-accent text-on-accent' : 'border-line2',
                  )}
                >
                  {on ? <Icon name="check" className="size-2.5" /> : null}
                </span>
                {scope.label}
              </button>
            )
          })}
        </div>
      </Panel>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Eyebrow>Existing keys</Eyebrow>
          <span className="font-mono text-[10px] tabular-nums text-faint">
            {keys.filter((key) => !key.revokedAt).length} active
          </span>
        </div>

        <Panel className="overflow-hidden">
          {keys.length === 0 ? (
            <EmptyState
              icon="key"
              title="No API keys yet"
              body="Create one above when a script or pipeline needs to move files without a browser session."
            />
          ) : (
            <ul className="divide-y divide-line">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-4 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                      {key.name}
                      {key.revokedAt ? <Tag className="border-danger/30 text-danger">revoked</Tag> : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-faint">
                      {key.keyPrefix}… · created {formatWhen(key.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {key.scopes.map((scope) => (
                      <Tag key={scope}>{scope.replace('files:', '')}</Tag>
                    ))}
                  </div>
                  <p
                    className="w-40 shrink-0 font-mono text-[10.5px] tabular-nums text-faint"
                    title={key.lastUsedAt ? formatDate(key.lastUsedAt) : undefined}
                  >
                    {key.lastUsedAt ? `used ${formatWhen(key.lastUsedAt)}` : 'never used'}
                  </p>
                  {key.revokedAt ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return
                        void run(() => api(`/api/api-keys/${key.id}`, { method: 'DELETE' }))
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Eyebrow>Endpoints</Eyebrow>
          <span className="font-mono text-[10px] text-faint">click a route for its curl</span>
        </div>
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-line">
            {endpoints.map((endpoint) => {
              const key = endpoint.method + endpoint.path
              const open = opened === key
              const curl = curlFor(endpoint, origin)

              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpened(open ? null : key)}
                    className={cx(
                      'flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-left transition-colors hover:bg-raise',
                      open && 'bg-raise',
                    )}
                  >
                    <span className="w-11 shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-accent">
                      {endpoint.method}
                    </span>
                    <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink">
                      {endpoint.path}
                    </code>
                    <Tag className="shrink-0">{endpoint.scope}</Tag>
                    <Icon
                      name="chevron"
                      className={cx('size-3 shrink-0 text-faint transition-transform', open && 'rotate-90')}
                    />
                  </button>

                  {open ? (
                    <div className="relative border-t border-line bg-[#12100d]">
                      <pre className="overflow-x-auto p-4 pr-20 font-mono text-[11px] leading-[1.7] text-[#e9e1d5]">
                        {curl}
                      </pre>
                      <button
                        type="button"
                        onClick={() => {
                          void copyText(curl)
                            .then(() => {
                              setCopiedCurl(key)
                              window.setTimeout(() => setCopiedCurl((value) => (value === key ? null : value)), 1800)
                            })
                            .catch(() => undefined)
                        }}
                        className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-control px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#e9e1d5]/55 transition-colors hover:bg-white/10 hover:text-[#e9e1d5]"
                      >
                        <Icon name={copiedCurl === key ? 'check' : 'copy'} className="size-3" />
                        {copiedCurl === key ? 'copied' : 'copy'}
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Panel>
      </section>
    </div>
  )
}
