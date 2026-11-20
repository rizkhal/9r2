import type { FileDTO } from '@9r2/shared'
import type { ReactNode } from 'react'
import { formatBytes, formatDate, formatWhen } from '../lib/format'
import { Glyph, Icon, cx } from './ui'

function StarButton({ file, onToggle }: { file: FileDTO; onToggle: (file: FileDTO) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(file)}
      aria-pressed={file.starred}
      title={file.starred ? 'Remove star' : 'Star this file'}
      className={cx(
        'grid size-6 shrink-0 place-items-center rounded-[5px] transition',
        file.starred ? 'text-accent' : 'text-faint opacity-0 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Icon name="star" className="size-3.5" filled={file.starred} />
    </button>
  )
}

export function FileTable({
  files,
  actions,
  empty,
  onToggleStar,
}: {
  files: FileDTO[]
  actions: (file: FileDTO) => ReactNode
  empty?: ReactNode
  onToggleStar?: (file: FileDTO) => void
}) {
  if (files.length === 0) return <>{empty}</>

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint">
              Name
            </th>
            <th className="hidden px-3 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint md:table-cell">
              Size
            </th>
            <th className="hidden px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint lg:table-cell">
              Uploaded
            </th>
            <th className="hidden px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint xl:table-cell">
              Storage
            </th>
            <th className="w-px px-3 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr
              key={file.id}
              className="group border-b border-line transition-colors last:border-b-0 hover:bg-raise/60"
            >
              <td className="px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Glyph name={file.name} />
                  <div className="min-w-0">
                    <a
                      href={`/api/files/${file.id}/content`}
                      target="_blank"
                      rel="noreferrer"
                      title={file.name}
                      className="block truncate text-[13px] font-medium text-ink transition-colors hover:text-accent"
                    >
                      {file.name}
                    </a>
                    <p className="font-mono text-[10.5px] text-faint md:hidden">
                      {formatBytes(file.sizeBytes)} · {formatWhen(file.createdAt)}
                    </p>
                  </div>
                  {onToggleStar ? <StarButton file={file} onToggle={onToggleStar} /> : null}
                </div>
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11.5px] tabular-nums text-muted md:table-cell">
                {formatBytes(file.sizeBytes)}
              </td>
              <td
                className="hidden whitespace-nowrap px-3 py-2.5 text-[12px] text-muted lg:table-cell"
                title={formatDate(file.createdAt)}
              >
                {formatWhen(file.createdAt)}
              </td>
              <td className="hidden px-3 py-2.5 xl:table-cell">
                <span className="inline-block max-w-[16rem] truncate rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                  {file.bucketName}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                  {actions(file)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
