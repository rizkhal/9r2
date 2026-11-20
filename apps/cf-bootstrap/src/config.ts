import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const localDir = process.env.CF_BOOTSTRAP_HOME ?? fileURLToPath(new URL('../.local/', import.meta.url))

export function paths() {
  return {
    localDir,
    config: join(localDir, 'config.json'),
    result: join(localDir, 'last-provision.json'),
    storageAccount: join(localDir, '9r2-storage-account.json'),
  }
}

async function writePrivate(file: string, contents: string) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await chmod(dirname(file), 0o700)
  await writeFile(file, contents, { mode: 0o600 })
  await chmod(file, 0o600)
}

export async function saveToken(token: string) {
  const file = paths().config
  await writePrivate(file, `${JSON.stringify({ token, savedAt: new Date().toISOString() }, null, 2)}\n`)
  return file
}

export async function loadToken(): Promise<string> {
  const file = paths().config
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { token?: string }
    if (!parsed.token) throw new Error('missing token')
    return parsed.token
  } catch {
    throw new Error(`No saved bootstrap token. Run \`bun apps/cf-bootstrap/src/index.ts login\` first (or set CF_API_TOKEN).`)
  }
}

export async function saveOutputs(
  result: unknown,
  storageAccount: unknown,
): Promise<{ result: string; storageAccount: string }> {
  const p = paths()
  await writePrivate(p.result, `${JSON.stringify(result, null, 2)}\n`)
  await writePrivate(p.storageAccount, `${JSON.stringify(storageAccount, null, 2)}\n`)
  return { result: p.result, storageAccount: p.storageAccount }
}

/** Reads a secret without echoing it. Non-TTY callers must use CF_API_TOKEN. */
export async function promptSecret(prompt = 'Cloudflare API token: '): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    throw new Error('Interactive TTY required. Set CF_API_TOKEN instead of pasting it into a pipe.')
  }
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  process.stdout.write(prompt)

  let value = ''
  const redraw = () => process.stdout.write(`\r\u001b[2K${prompt}${'*'.repeat(value.length)}`)

  return await new Promise<string>((resolve, reject) => {
    const finish = (callback: () => void) => {
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw ?? false)
      stdin.pause()
      process.stdout.write('\n')
      callback()
    }
    const onData = (chunk: string) => {
      if (chunk === '\u0003') {
        finish(() => reject(new Error('Cancelled.')))
      } else if (chunk === '\r' || chunk === '\n') {
        finish(() => resolve(value))
      } else if (chunk === '\u007f' || chunk === '\b') {
        value = value.slice(0, -1)
        redraw()
      } else if (!chunk.startsWith('\u001b')) {
        value += chunk
        redraw()
      }
    }
    stdin.on('data', onData)
  })
}

export function openBrowser(url: string) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    // The URL is printed by the caller, so a missing opener is not fatal.
  }
}
