import type { FileDTO } from '@9r2/shared'
import type { ReactNode } from 'react'
import { formatBytes, formatDate } from '../lib/format'

export const btn =
  'rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'

export const input =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900'

export function FileTable({
  files,
  actions,
  empty,
}: {
  files: FileDTO[]
  actions: (file: FileDTO) => ReactNode
  empty?: string
}) {
  if (files.length === 0) {
    return <p className="py-12 text-center text-sm text-slate-500">{empty ?? 'No files here yet.'}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
            <th className="py-2 pr-3 font-semibold">Name</th>
            <th className="py-2 pr-3 font-semibold">Size</th>
            <th className="py-2 pr-3 font-semibold">Uploaded</th>
            <th className="py-2 pr-3 font-semibold">Bucket</th>
            <th className="py-2 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id} className="border-b border-slate-100 last:border-0 dark:border-slate-900">
              <td className="max-w-[26rem] truncate py-2.5 pr-3 font-medium" title={file.name}>
                {file.starred ? '★ ' : ''}
                {file.name}
              </td>
              <td className="py-2.5 pr-3 text-slate-500">{formatBytes(file.sizeBytes)}</td>
              <td className="py-2.5 pr-3 text-slate-500">{formatDate(file.createdAt)}</td>
              <td className="py-2.5 pr-3 text-slate-500">{file.bucketName}</td>
              <td className="py-2.5">
                <div className="flex flex-wrap items-center justify-end gap-1.5">{actions(file)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
