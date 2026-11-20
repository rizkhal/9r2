/** One root-level JSON file holding every CF access key this tool mints. */
import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export type KeyEntry = {
  key: string
  email?: string
  userId?: string
  accountId: string
  accountName: string
  bucket: string
  jurisdiction: string
  endpoint: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
  tokenId?: string
  tokenName?: string
  expiresOn?: string | null
  status: 'ok' | 'error'
  error?: string
  createdAt: string
}

export type KeyStore = { updatedAt: string; entries: KeyEntry[] }

export const DEFAULT_OUT = fileURLToPath(new URL('../../cf-access-keys.json', import.meta.url))

export async function readStore(path = DEFAULT_OUT): Promise<KeyStore> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as KeyStore
    return { updatedAt: parsed.updatedAt ?? '', entries: Array.isArray(parsed.entries) ? parsed.entries : [] }
  } catch {
    return { updatedAt: '', entries: [] }
  }
}

export async function upsertEntry(entry: KeyEntry, path = DEFAULT_OUT): Promise<KeyStore> {
  const store = await readStore(path)
  const others = store.entries.filter((item) => item.key !== entry.key)
  const next: KeyStore = {
    updatedAt: new Date().toISOString(),
    entries: [...others, entry].sort((a, b) => a.key.localeCompare(b.key)),
  }
  const temp = `${path}.tmp`
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await chmod(temp, 0o600)
  await rename(temp, path)
  return next
}
