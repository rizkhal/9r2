import type { FileDTO } from '@9r2/shared'
import { useCallback, useEffect, useState } from 'react'
import { FileTable, btn } from '../components/FileTable'
import { api } from '../lib/api'

export function TrashPage() {
  const [files, setFiles] = useState<FileDTO[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await api<{ files: FileDTO[] }>('/api/files?status=trash')
    setFiles(data.files)
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load trash'))
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
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-sm text-slate-500">Deleted files keep using bucket space until you delete them permanently.</p>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}

      <FileTable
        files={files}
        empty="Trash is empty."
        actions={(file) => (
          <>
            <button
              type="button"
              className={btn}
              onClick={() => void run(() => api(`/api/files/${file.id}/restore`, { method: 'POST' }))}
            >
              Restore
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                if (!window.confirm(`Delete "${file.name}" permanently? This removes it from storage.`)) return
                void run(() => api(`/api/files/${file.id}/permanent`, { method: 'DELETE' }))
              }}
            >
              Delete forever
            </button>
          </>
        )}
      />
    </div>
  )
}
