import type { FileDTO, FolderDTO, StorageDTO } from '@9r2/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTable, btn, input } from '../components/FileTable'
import { api, copyText, uploadFile } from '../lib/api'

type UploadTask = { id: string; name: string; progress: number; error: string | null }

export function FilesPage() {
  const [folders, setFolders] = useState<FolderDTO[]>([])
  const [files, setFiles] = useState<FileDTO[]>([])
  const [buckets, setBuckets] = useState<StorageDTO['buckets']>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [uploads, setUploads] = useState<UploadTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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
    loadFolders().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load folders'))
    api<StorageDTO>('/api/storage')
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
        setNotice(`Share link copied: ${url}`)
      } catch {
        setNotice(`Share link: ${url}`)
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

  const partial = uploads.filter((task) => task.error !== null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">All files</h1>
          <p className="text-sm text-slate-500">
            {query ? `Search results for “${query}”` : breadcrumb.length === 0 ? 'Root folder' : breadcrumb.map((folder) => folder.name).join(' / ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${input} w-56`}
            placeholder="Search files…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button type="button" className={btn} onClick={() => void createFolder()}>
            New folder
          </button>
          <button
            type="button"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
            onClick={() => fileInput.current?.click()}
          >
            Upload
          </button>
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
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}
      {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{notice}</p> : null}

      {breadcrumb.length > 0 ? (
        <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
          <button type="button" className="hover:text-indigo-600" onClick={() => setCurrentFolderId(null)}>
            All files
          </button>
          {breadcrumb.map((folder) => (
            <span key={folder.id} className="flex items-center gap-1">
              <span>/</span>
              <button type="button" className="hover:text-indigo-600" onClick={() => setCurrentFolderId(folder.id)}>
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {childFolders.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {childFolders.map((folder) => (
            <div key={folder.id} className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-indigo-600"
                onClick={() => setCurrentFolderId(folder.id)}
                title={folder.name}
              >
                📁 {folder.name}
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                onClick={() => void deleteFolder(folder)}
                title="Delete folder"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {uploads.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          {uploads.map((task) => (
            <div key={task.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{task.name}</span>
                <span className={task.error ? 'text-red-600' : 'text-slate-500'}>
                  {task.error ?? `${Math.round(task.progress * 100)}%`}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                <div
                  className={`h-full ${task.error ? 'bg-red-500' : 'bg-indigo-500'}`}
                  style={{ width: `${Math.round(task.progress * 100)}%` }}
                />
              </div>
            </div>
          ))}
          {partial.length > 0 ? (
            <button type="button" className={btn} onClick={() => setUploads([])}>
              Clear failed uploads
            </button>
          ) : null}
        </div>
      ) : null}

      <FileTable
        files={files}
        empty={query ? 'No files match your search.' : 'No files yet. Upload something to get started.'}
        actions={(file) => (
          <>
            <a className={btn} href={`/api/files/${file.id}/content`} target="_blank" rel="noreferrer">
              Open
            </a>
            <a className={btn} href={`/api/files/${file.id}/content?download=1`}>
              Download
            </a>
            <button type="button" className={btn} onClick={() => void share(file)}>
              Share
            </button>
            <button type="button" className={btn} onClick={() => void rename(file)}>
              Rename
            </button>
            <select
              className="rounded-md border border-slate-200 bg-transparent px-1.5 py-1 text-xs dark:border-slate-700"
              value={file.folderId ?? ''}
              onChange={(event) => void move(file, event.target.value || null)}
              title="Move to folder"
            >
              <option value="">Root</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            {buckets.length > 1 ? (
              <select
                className="rounded-md border border-slate-200 bg-transparent px-1.5 py-1 text-xs dark:border-slate-700"
                value={file.bucketId}
                onChange={(event) => void moveStorage(file, event.target.value)}
                title="Move to storage account"
              >
                {buckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="button" className={btn} onClick={() => void toggleStar(file)} title="Star">
              {file.starred ? 'Unstar' : 'Star'}
            </button>
            <button type="button" className={btn} onClick={() => void trash(file)}>
              Trash
            </button>
          </>
        )}
      />
    </div>
  )
}
