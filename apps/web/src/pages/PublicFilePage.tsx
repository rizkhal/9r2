import type { PublicFileDTO } from '@9r2/shared'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Button, Glyph, Icon } from '../components/ui'
import { api } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'

export function PublicFilePage() {
  const { token } = useParams()
  const [file, setFile] = useState<PublicFileDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api<{ file: PublicFileDTO }>(`/public/files/${token}`)
      .then((data) => setFile(data.file))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'File not found'))
  }, [token])

  const base = `/public/files/${token}/content`

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-4 px-5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-semibold tracking-[-0.02em]">9r2</span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-faint">shared file</span>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              window.location.href = `${base}?download=1`
            }}
          >
            <Icon name="download" className="size-3.5" />
            Download
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 py-8">
        <div className="rise">
          {error ? <Alert>{error}</Alert> : null}

          {file ? (
            <div className="mb-6 flex items-center gap-3">
              <Glyph name={file.name} />
              <div className="min-w-0">
                <h1 className="truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{file.name}</h1>
                <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-faint">
                  {formatBytes(file.sizeBytes)} · uploaded {formatDate(file.createdAt)}
                </p>
              </div>
            </div>
          ) : null}

          {file ? <Preview mimeType={file.mimeType} src={base} name={file.name} /> : null}
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-5 py-4">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint">
            shared link · no account required
          </p>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint">9r2 storage</p>
        </div>
      </footer>
    </div>
  )
}

function Preview({ mimeType, src, name }: { mimeType: string; src: string; name: string }) {
  if (mimeType.startsWith('image/')) {
    return (
      <div className="grid place-items-center rounded-panel border border-line bg-surface p-3">
        <img src={src} alt={name} className="max-h-[72vh] w-full rounded-[8px] object-contain" />
      </div>
    )
  }
  if (mimeType.startsWith('video/')) {
    return <video src={src} controls className="max-h-[72vh] w-full rounded-panel border border-line bg-black" />
  }
  if (mimeType.startsWith('audio/')) {
    return (
      <div className="rounded-panel border border-line bg-surface p-6">
        <audio src={src} controls className="w-full" />
      </div>
    )
  }
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
    return (
      <iframe
        src={src}
        title={name}
        className="h-[74vh] w-full rounded-panel border border-line bg-surface"
      />
    )
  }
  return (
    <div className="rounded-panel border border-dashed border-line2 px-6 py-16 text-center">
      <p className="text-[13px] font-medium text-ink">No preview for this file type</p>
      <p className="mt-1 text-[12px] text-muted">Use Download to save it to your device.</p>
    </div>
  )
}
