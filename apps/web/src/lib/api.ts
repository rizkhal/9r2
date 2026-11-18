export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }
  return data as T
}

export type UploadHandle = { promise: Promise<void>; abort: () => void }

/** XHR instead of fetch because only XHR reports upload progress. */
export function uploadFile(
  file: File,
  folderId: string | null,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', '/api/files')
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
    xhr.setRequestHeader('x-mime-type', file.type || 'application/octet-stream')
    if (folderId) xhr.setRequestHeader('x-folder-id', folderId)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      try {
        const body: unknown = JSON.parse(xhr.responseText)
        reject(new Error(typeof body === 'object' && body && 'message' in body ? String(body.message) : 'Upload failed'))
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    xhr.send(file)
  })

  return { promise, abort: () => xhr.abort() }
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}
