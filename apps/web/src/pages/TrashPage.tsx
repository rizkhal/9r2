import type { FileDTO } from '@9r2/shared'
import { useCallback, useEffect, useState } from 'react'
import { FileTable } from '../components/FileTable'
import { Alert, Button, EmptyState, Icon, Panel } from '../components/ui'
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
    <div className="rise space-y-7">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Trash</p>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">Deleted files</h1>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
          Nothing here is removed from storage yet — trashed files keep occupying quota until you delete them
          permanently.
        </p>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <Panel className="overflow-hidden">
        <FileTable
          files={files}
          empty={
            <EmptyState
              icon="trash"
              title="Trash is empty"
              body="Files you move to trash land here, still taking up space until you clear them."
            />
          }
          actions={(file) => (
            <>
              <Button
                type="button"
                size="sm"
                title={`Restore ${file.name}`}
                onClick={() => void run(() => api(`/api/files/${file.id}/restore`, { method: 'POST' }))}
              >
                <Icon name="restore" className="size-3.5" />
                Restore
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => {
                  if (!window.confirm(`Delete "${file.name}" permanently? This removes it from storage.`)) return
                  void run(() => api(`/api/files/${file.id}/permanent`, { method: 'DELETE' }))
                }}
              >
                Delete forever
              </Button>
            </>
          )}
        />
      </Panel>
    </div>
  )
}
