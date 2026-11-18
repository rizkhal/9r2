import type { ShareDTO } from '@9r2/shared'
import { useCallback, useEffect, useState } from 'react'
import { btn } from '../components/FileTable'
import { api, copyText } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'

export function SharedPage() {
  const [shares, setShares] = useState<ShareDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await api<{ shares: ShareDTO[] }>('/api/files/shared')
    setShares(data.shares)
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load shared links'))
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared links</h1>
        <p className="text-sm text-slate-500">Anyone with one of these links can view and download the file.</p>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}
      {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{notice}</p> : null}

      {shares.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No shared links yet. Use Share on any file.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-900 dark:border-slate-800">
          {shares.map((share) => (
            <li key={share.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{share.file.name}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(share.file.sizeBytes)} · shared {formatDate(share.createdAt)}
                </p>
                <p className="mt-1 break-all text-xs text-slate-400">{share.url}</p>
              </div>
              <div className="flex gap-1.5">
                <a className={btn} href={share.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    void copyText(share.url)
                      .then(() => setNotice('Link copied.'))
                      .catch(() => setNotice(share.url))
                  }}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => void run(() => api(`/api/files/${share.file.id}/share`, { method: 'DELETE' }))}
                >
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
