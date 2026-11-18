// Starts the API worker and the Vite dev server side by side.
// Runs under bun and npm alike: it calls the local binaries directly instead of
// shelling out to a package manager.
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

function run(name, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(name), args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`))))
  })
}

// wrangler dev refuses to start when the assets directory is missing.
if (!existsSync(path.join(webDir, 'dist/index.html'))) {
  console.log('Building the SPA once so the worker has an assets directory…')
  await run('vite', ['build'], webDir)
}

// Local-only sign-in; .dev.vars is gitignored.
const devVars = path.join(apiDir, '.dev.vars')
const defaults = {
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_EMAIL: 'admin@9r2.local',
  ADMIN_PASSWORD: 'change-me-local-dev',
}
const existingVars = existsSync(devVars) ? readFileSync(devVars, 'utf8') : ''
const missing = Object.entries(defaults).filter(([key]) => !existingVars.includes(`${key}=`))
if (missing.length > 0) {
  const added = missing.map(([key, value]) => `${key}=${value}`).join('\n')
  writeFileSync(devVars, existingVars ? `${existingVars.replace(/\n*$/, '\n')}${added}\n` : `${added}\n`)
  console.log(`Added missing keys to apps/api/.dev.vars: ${missing.map(([key]) => key).join(', ')}`)
  if (missing.some(([key]) => key === 'ADMIN_PASSWORD')) {
    console.log('Local sign-in: admin@9r2.local / change-me-local-dev')
  }
}

await run('wrangler', ['d1', 'migrations', 'apply', '9r2-db', '--local'], apiDir)

const apiPort = await pickApiPort()
if (apiPort !== Number(process.env.API_PORT ?? 8788)) {
  console.log(`Port ${process.env.API_PORT ?? 8788} is busy — using ${apiPort} for the API.`)
}

const procs = [
  spawn(bin('wrangler'), ['dev', '--port', String(apiPort)], {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, API_PORT: String(apiPort) },
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
