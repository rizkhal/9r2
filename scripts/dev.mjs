// Starts the Bun API and the Vite dev server side by side against a local Postgres.
// Runs under node or bun: it calls the local binaries directly instead of a package manager.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = path.join(root, 'apps/api')
const webDir = path.join(root, 'apps/web')
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** Port 8788 is a preference, not a promise: this machine runs other servers there. */
async function pickApiPort() {
  const preferred = Number(process.env.API_PORT ?? 8788)
  const start = Number.isSafeInteger(preferred) && preferred > 0 ? preferred : 8788
  for (let port = start; port < start + 20; port++) {
    if (await isFree(port)) return port
  }
  throw new Error(`No free port between ${start} and ${start + 19}. Set API_PORT to something else.`)
}

// Local-only config; .env is gitignored. A stable SESSION_SECRET survives restarts.
const envFile = path.join(root, '.env')
const defaults = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://9r2:9r2@127.0.0.1:5433/9r2',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_EMAIL: 'admin@9r2.local',
  ADMIN_PASSWORD: 'change-me-local-dev',
}
const existingEnv = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
const missing = Object.entries(defaults).filter(([key]) => !existingEnv.includes(`${key}=`))
if (missing.length > 0) {
  const added = missing.map(([key, value]) => `${key}=${value}`).join('\n')
  writeFileSync(envFile, existingEnv ? `${existingEnv.replace(/\n*$/, '\n')}${added}\n` : `${added}\n`)
  console.log(`Added missing keys to .env: ${missing.map(([key]) => key).join(', ')}`)
  if (missing.some(([key]) => key === 'ADMIN_PASSWORD')) {
    console.log('Local sign-in: admin@9r2.local / change-me-local-dev')
  }
}
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
}

// Postgres has to be reachable; docker-compose.dev.yml brings one up.
console.log('Applying migrations…')
const migrate = spawn('bun', ['src/migrate.ts'], { cwd: apiDir, stdio: 'inherit', env: process.env })
const migrateCode = await new Promise((resolve) => migrate.on('exit', resolve))
if (migrateCode !== 0) {
  console.error('\nMigrations failed. Is Postgres up? Try: docker compose -f docker-compose.dev.yml up -d')
  process.exit(migrateCode ?? 1)
}

const apiPort = await pickApiPort()
if (apiPort !== Number(process.env.API_PORT ?? 8788)) {
  console.log(`Port ${process.env.API_PORT ?? 8788} is busy — using ${apiPort} for the API.`)
}

const procs = [
  spawn('bun', ['--watch', 'src/server.ts'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(apiPort) },
  }),
  // Vite reads API_PORT to build its proxy target, so it follows the port chosen above.
  spawn(bin('vite'), [], { cwd: webDir, stdio: 'inherit', env: { ...process.env, API_PORT: String(apiPort) } }),
]

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const proc of procs) proc.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
for (const proc of procs) {
  proc.on('exit', (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1)
  })
}
