import type { ShareDTO } from '@9r2/shared'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, EmptyState, Glyph, Icon, Panel, cx } from '../components/ui'
import { api, copyText } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'

export function SharedPage() {
  const [shares, setShares] = useState<ShareDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

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

  async function copy(share: ShareDTO) {
    try {
      await copyText(share.url)
      setCopied(share.id)
      window.setTimeout(() => setCopied((id) => (id === share.id ? null : id)), 1800)
    } catch {
      setNotice(share.url)
    }
  }

  return (
    <div className="rise space-y-7">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Shared</p>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">Share links</h1>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
          Anyone holding one of these links can open and download the file without signing in. Revoking a link
          breaks it immediately.
        </p>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="notice">{notice}</Alert> : null}

      {shares.length === 0 ? (
        <Panel>
          <EmptyState
            icon="share"
            title="No links are active"
            body="Open the actions menu on any file and choose “Copy share link” to publish one."
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-line">
            {shares.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center gap-4 px-4 py-3.5">
                <Glyph name={share.file.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink" title={share.file.name}>
                    {share.file.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-faint">
                    {formatBytes(share.file.sizeBytes)} · shared {formatWhen(share.createdAt)}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10.5px] text-faint" title={share.url}>
                    {share.url}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => window.open(share.url, '_blank', 'noopener')}
                  >
                    <Icon name="external" className="size-3.5" />
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void copy(share)}
                    className={cx(copied === share.id && 'border-accent/40 text-accent')}
                  >
                    <Icon name={copied === share.id ? 'check' : 'copy'} className="size-3.5" />
                    {copied === share.id ? 'Copied' : 'Copy'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    title={`Revoke the link to ${share.file.name}`}
                    onClick={() => {
                      if (!window.confirm(`Revoke the link to "${share.file.name}"? It stops working immediately.`)) return
                      void run(() => api(`/api/files/${share.file.id}/share`, { method: 'DELETE' }))
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
