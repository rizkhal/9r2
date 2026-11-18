import type { ApiKeyDTO, ApiKeyScope } from '@9r2/shared'
import { useCallback, useEffect, useState } from 'react'
import { btn, input } from '../components/FileTable'
import { api, copyText } from '../lib/api'
import { formatDate } from '../lib/format'

const allScopes: { value: ApiKeyScope; label: string; hint: string }[] = [
  { value: 'files:read', label: 'Read', hint: 'List files, download content' },
  { value: 'files:write', label: 'Write', hint: 'Upload, rename, move, restore, share' },
  { value: 'files:delete', label: 'Delete', hint: 'Trash and permanently delete' },
]

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-slate-500">
          Scripts and CI can use these instead of the browser session. Send
          <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">Authorization: Bearer &lt;key&gt;</code>
          to the same <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">/api/files</code> routes.
        </p>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}

      {secret ? (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Copy this key now — it is never shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs dark:bg-slate-900">{secret}</code>
            <button
              type="button"
              className={btn}
              onClick={() => {
                void copyText(secret).catch(() => undefined)
              }}
            >
              Copy
            </button>
            <button type="button" className={btn} onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Create a key</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input
              className={`${input} w-56`}
              placeholder="CI deploy"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !name.trim() || scopes.length === 0}
            onClick={() => void create()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {allScopes.map((scope) => (
            <label
              key={scope.value}
              className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${
                scopes.includes(scope.value)
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={scopes.includes(scope.value)}
                onChange={() => toggleScope(scope.value)}
              />
              <span>
                <span className="block text-sm font-medium">{scope.label}</span>
                <span className="block text-xs text-slate-500">{scope.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Existing keys</h2>
        {keys.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No API keys yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                  <th className="p-3 font-semibold">Name</th>
                  <th className="p-3 font-semibold">Key</th>
                  <th className="p-3 font-semibold">Scopes</th>
                  <th className="p-3 font-semibold">Last used</th>
                  <th className="p-3 font-semibold">Created</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-slate-100 last:border-0 dark:border-slate-900">
                    <td className="p-3 font-medium">
                      {key.name}
                      {key.revokedAt ? (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:bg-red-950 dark:text-red-300">
                          revoked
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-500">{key.keyPrefix}…</td>
                    <td className="p-3 text-xs text-slate-500">{key.scopes.join(', ')}</td>
                    <td className="p-3 text-xs text-slate-500">{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'never'}</td>
                    <td className="p-3 text-xs text-slate-500">{formatDate(key.createdAt)}</td>
                    <td className="p-3 text-right">
                      {key.revokedAt ? null : (
                        <button
                          type="button"
                          className={btn}
                          onClick={() => {
                            if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return
                            void run(() => api(`/api/api-keys/${key.id}`, { method: 'DELETE' }))
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Examples</h2>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{`# upload
curl -X POST ${origin}/api/files \\
  -H "Authorization: Bearer $KEY" \\
  -H "x-file-name: backup.tar.gz" \\
  -H "x-mime-type: application/gzip" \\
  --data-binary @backup.tar.gz

# list, then download
curl -H "Authorization: Bearer $KEY" "${origin}/api/files"
curl -H "Authorization: Bearer $KEY" -o out.bin \\
  "${origin}/api/files/<id>/content?download=1"

# move a file to another storage account
curl -X POST ${origin}/api/files/<id>/move-storage \\
  -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"bucketId":"<bucket-id>"}'

# trash, then delete forever
curl -X DELETE -H "Authorization: Bearer $KEY" "${origin}/api/files/<id>"
curl -X DELETE -H "Authorization: Bearer $KEY" "${origin}/api/files/<id>/permanent"`}</pre>
      </section>
    </div>
  )
}
