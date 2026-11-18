import type { PublicFileDTO } from '@9r2/shared'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
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
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{file?.name ?? 'Shared file'}</h1>
          {file ? (
            <p className="text-sm text-slate-500">
              {formatBytes(file.sizeBytes)} · uploaded {formatDate(file.createdAt)}
            </p>
          ) : null}
        </div>
        <a
          href={`${base}?download=1`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Download
        </a>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}

      {file ? <Preview mimeType={file.mimeType} src={base} name={file.name} /> : null}

      <p className="pt-4 text-center text-xs text-slate-400">Shared with 9r2</p>
    </div>
  )
}

function Preview({ mimeType, src, name }: { mimeType: string; src: string; name: string }) {
  if (mimeType.startsWith('image/')) {
    return <img src={src} alt={name} className="max-h-[75vh] w-full rounded-lg object-contain" />
  }
  if (mimeType.startsWith('video/')) {
    return <video src={src} controls className="max-h-[75vh] w-full rounded-lg bg-black" />
  }
  if (mimeType.startsWith('audio/')) {
    return <audio src={src} controls className="w-full" />
  }
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
    return <iframe src={src} title={name} className="h-[75vh] w-full rounded-lg border border-slate-200 dark:border-slate-800" />
  }
  return (
    <p className="rounded-lg border border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-800">
      No preview for this file type. Use Download.
    </p>
  )
}
