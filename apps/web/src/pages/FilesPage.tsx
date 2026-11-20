import type { BucketSummaryDTO, FileDTO, FolderDTO } from '@9r2/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTable } from '../components/FileTable'
import {
  Alert,
  Bar,
  Button,
  EmptyState,
  Icon,
  Input,
  Menu,
  Panel,
  cx,
  type MenuEntry,
} from '../components/ui'
import { api, copyText, uploadFile } from '../lib/api'

type UploadTask = { id: string; name: string; progress: number; error: string | null }

export function FilesPage() {
  const [folders, setFolders] = useState<FolderDTO[]>([])
  const [files, setFiles] = useState<FileDTO[]>([])
  const [buckets, setBuckets] = useState<BucketSummaryDTO[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [uploads, setUploads] = useState<UploadTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const loadFolders = useCallback(async () => {
    const data = await api<{ folders: FolderDTO[] }>('/api/folders')
    setFolders(data.folders)
  }, [])

  const loadFiles = useCallback(async () => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    else if (currentFolderId) params.set('folderId', currentFolderId)
    const data = await api<{ files: FileDTO[] }>(`/api/files?${params.toString()}`)
    setFiles(data.files)
  }, [currentFolderId, query])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim()), 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    loadFolders().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load folders'))
    api<{ buckets: BucketSummaryDTO[] }>('/api/buckets')
      .then((data) => setBuckets(data.buckets))
      .catch(() => undefined)
  }, [loadFolders])

  useEffect(() => {
    loadFiles().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load files'))
  }, [loadFiles])

  useEffect(() => {
    if (currentFolderId && !folders.some((folder) => folder.id === currentFolderId)) setCurrentFolderId(null)
  }, [folders, currentFolderId])

  const breadcrumb = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    const chain: FolderDTO[] = []
    let id = currentFolderId
    while (id) {
      const folder = byId.get(id)
      if (!folder) break
      chain.unshift(folder)
      id = folder.parentId
    }
    return chain
  }, [folders, currentFolderId])

  const childFolders = useMemo(
    () => folders.filter((folder) => folder.parentId === currentFolderId),
    [folders, currentFolderId],
  )

  async function act(work: () => Promise<unknown>) {
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function createFolder() {
    const name = window.prompt('Folder name')
    if (!name?.trim()) return
    await act(async () => {
      await api('/api/folders', { body: { name: name.trim(), parentId: currentFolderId } })
      await loadFolders()
    })
  }

  async function deleteFolder(folder: FolderDTO) {
    if (!window.confirm(`Delete "${folder.name}"? Files inside move back to All files.`)) return
    await act(async () => {
      await api(`/api/folders/${folder.id}`, { method: 'DELETE' })
      await Promise.all([loadFolders(), loadFiles()])
    })
  }

  async function upload(picked: FileList | null) {
    if (!picked?.length) return
    for (const file of Array.from(picked)) {
      const id = crypto.randomUUID()
      setUploads((tasks) => [...tasks, { id, name: file.name, progress: 0, error: null }])
      try {
        await uploadFile(file, currentFolderId, (progress) => {
          setUploads((tasks) => tasks.map((task) => (task.id === id ? { ...task, progress } : task)))
        }).promise
        setUploads((tasks) => tasks.filter((task) => task.id !== id))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setUploads((tasks) => tasks.map((task) => (task.id === id ? { ...task, error: message } : task)))
      }
    }
    await act(loadFiles)
  }

  async function share(file: FileDTO) {
    await act(async () => {
      const { url } = await api<{ url: string }>(`/api/files/${file.id}/share`, { method: 'POST' })
      try {
        await copyText(url)
        setNotice(`Share link copied — ${url}`)
      } catch {
        setNotice(`Share link — ${url}`)
      }
    })
  }

  async function rename(file: FileDTO) {
    const name = window.prompt('New name', file.name)
    if (!name?.trim() || name.trim() === file.name) return
    await act(async () => {
      await api(`/api/files/${file.id}`, { method: 'PATCH', body: { name: name.trim() } })
      await loadFiles()
    })
  }

  async function move(file: FileDTO, folderId: string | null) {
    await act(async () => {
      await api(`/api/files/${file.id}`, { method: 'PATCH', body: { folderId } })
      await loadFiles()
    })
  }

  async function moveStorage(file: FileDTO, bucketId: string) {
    if (!bucketId || bucketId === file.bucketId) return
    const target = buckets.find((bucket) => bucket.id === bucketId)
    if (!window.confirm(`Move "${file.name}" to ${target?.name ?? 'that storage account'}? It is deleted from ${file.bucketName}.`)) return
    await act(async () => {
      await api(`/api/files/${file.id}/move-storage`, { body: { bucketId } })
      await loadFiles()
    })
  }

  async function toggleStar(file: FileDTO) {
    await act(async () => {
      await api(`/api/files/${file.id}`, { method: 'PATCH', body: { starred: !file.starred } })
      await loadFiles()
    })
  }

  async function trash(file: FileDTO) {
    await act(async () => {
      await api(`/api/files/${file.id}`, { method: 'DELETE' })
      await loadFiles()
    })
  }

  function download(file: FileDTO) {
    window.location.href = `/api/files/${file.id}/content?download=1`
  }

  function menuItems(file: FileDTO): MenuEntry[] {
    const entries: MenuEntry[] = [
      {
        label: 'Open in new tab',
        icon: 'external',
        onSelect: () => window.open(`/api/files/${file.id}/content`, '_blank', 'noopener'),
      },
      { label: 'Download', icon: 'download', onSelect: () => download(file) },
      { label: 'Copy share link', icon: 'link', onSelect: () => void share(file) },
      'separator',
      { label: 'Rename', icon: 'pencil', onSelect: () => void rename(file) },
      {
        label: 'Move to folder',
        icon: 'folder',
        children: [
          { label: 'All files (root)', onSelect: () => void move(file, null) },
          ...folders
            .filter((folder) => folder.id !== file.folderId)
            .map((folder) => ({ label: folder.name, onSelect: () => void move(file, folder.id) })),
        ],
      },
    ]

    if (buckets.length > 1) {
      entries.push({
        label: 'Move to storage',
        icon: 'database',
        children: buckets
          .filter((bucket) => bucket.id !== file.bucketId)
          .map((bucket) => ({ label: bucket.name, onSelect: () => void moveStorage(file, bucket.id) })),
      })
    }

    entries.push('separator', {
      label: 'Move to trash',
      icon: 'trash',
      danger: true,
      onSelect: () => void trash(file),
    })
    return entries
  }

  const failed = uploads.filter((task) => task.error !== null)
  const placeName = query ? 'Search results' : breadcrumb[breadcrumb.length - 1]?.name ?? 'All files'

  return (
    <div
      className="relative space-y-7"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void upload(event.dataTransfer.files)
      }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-panel border border-dashed border-accent bg-canvas/85 backdrop-blur-[2px]">
          <div className="text-center">
            <Icon name="upload" className="mx-auto size-6 text-accent" />
            <p className="mt-2.5 text-[13px] font-medium text-ink">
              Drop to upload to {placeName.toLowerCase()}
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
              multiple files supported
            </p>
          </div>
        </div>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            {placeName}
          </h1>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-faint">
            {files.length} {files.length === 1 ? 'file' : 'files'}
            {!query && childFolders.length > 0 ? ` · ${childFolders.length} folders` : ''}
            {query ? ` · matching “${query}”` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
            />
            <Input
              ref={searchRef}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search files"
              aria-label="Search files"
              className="w-56 pl-8 pr-12 sm:w-64"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1 font-mono text-[9.5px] text-faint">
              ⌘K
            </kbd>
          </div>
          <Button type="button" onClick={() => void createFolder()}>
            <Icon name="plus" className="size-3.5" />
            New folder
          </Button>
          <Button type="button" variant="primary" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" className="size-3.5" />
            Upload
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void upload(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="notice">{notice}</Alert> : null}

      {breadcrumb.length > 0 && !query ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-faint">
          <button
            type="button"
            onClick={() => setCurrentFolderId(null)}
            className="rounded-[4px] px-1 py-0.5 transition-colors hover:bg-raise hover:text-ink"
          >
            all files
          </button>
          {breadcrumb.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1.5">
              <span className="text-line2">/</span>
              <button
                type="button"
                onClick={() => setCurrentFolderId(folder.id)}
                className={cx(
                  'rounded-[4px] px-1 py-0.5 transition-colors hover:bg-raise hover:text-ink',
                  index === breadcrumb.length - 1 && 'text-ink',
                )}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {childFolders.length > 0 && !query ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {childFolders.map((folder) => (
            <div
              key={folder.id}
              className="group flex items-center gap-2.5 rounded-panel border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line2 hover:bg-raise"
            >
              <Icon name="folder" className="size-4 text-muted" />
              <button
                type="button"
                onClick={() => setCurrentFolderId(folder.id)}
                title={folder.name}
                className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink transition-colors hover:text-accent"
              >
                {folder.name}
              </button>
              <button
                type="button"
                onClick={() => void deleteFolder(folder)}
                title="Delete folder"
                className="rounded-[4px] p-1 text-faint opacity-0 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Icon name="close" className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Panel className="overflow-hidden">
        <FileTable
          files={files}
          onToggleStar={(file) => void toggleStar(file)}
          empty={
            query ? (
              <EmptyState
                icon="search"
                title={`Nothing matches “${query}”`}
                body="Try a shorter search, or clear it to see everything in this folder."
                action={
                  <Button type="button" onClick={() => setSearchInput('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="upload"
                title="This folder is empty"
                body="Drop files anywhere on this page, or pick them from your computer."
                action={
                  <Button type="button" variant="primary" onClick={() => fileInput.current?.click()}>
                    <Icon name="upload" className="size-3.5" />
                    Choose files
                  </Button>
                }
              />
            )
          }
          actions={(file) => (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-faint hover:text-ink"
                title="Download"
                aria-label={`Download ${file.name}`}
                onClick={() => download(file)}
              >
                <Icon name="download" className="size-3.5" />
              </Button>
              <Menu items={menuItems(file)} label={`Actions for ${file.name}`} />
            </>
          )}
        />
      </Panel>

      {uploads.length > 0 ? (
        <div className="pop fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-3 shadow-[0_24px_60px_-24px_rgba(30,20,12,0.5)]">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Uploading {uploads.length - failed.length} of {uploads.length}
            </p>
            <button
              type="button"
              onClick={() => setUploads([])}
              className="rounded-[4px] p-1 text-faint transition-colors hover:bg-raise hover:text-ink"
              title="Dismiss"
            >
              <Icon name="close" className="size-3" />
            </button>
          </div>
          <div className="space-y-2">
            {uploads.map((task) => (
              <div key={task.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11.5px] text-ink" title={task.name}>
                    {task.name}
                  </span>
                  <span
                    className={cx(
                      'shrink-0 font-mono text-[10px] tabular-nums',
                      task.error ? 'text-danger' : 'text-faint',
                    )}
                  >
                    {task.error ?? `${Math.round(task.progress * 100)}%`}
                  </span>
                </div>
                <Bar value={task.progress} className="mt-1" />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
