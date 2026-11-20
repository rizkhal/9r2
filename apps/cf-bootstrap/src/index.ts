/** 9r2 Cloudflare bootstrap CLI — login + R2 access keys, output to one root JSON. */
import { readFile } from 'node:fs/promises'
import { cfClient } from './cf'
import { loadToken, promptSecret, saveToken } from './config'
import { runBatch, type AccountRow } from './batch'
import { provision, R2_JURISDICTIONS, type Jurisdiction } from './provision'
import { DEFAULT_OUT, upsertEntry } from './store'

type Flags = Map<string, string | true>

function parseArgs(args: string[]): Flags {
  const flags: Flags = new Map()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq !== -1) flags.set(arg.slice(2, eq), arg.slice(eq + 1))
    else if (args[i + 1] && !args[i + 1].startsWith('--')) flags.set(arg.slice(2), args[++i])
    else flags.set(arg.slice(2), true)
  }
  return flags
}

function str(flags: Flags, name: string, fallback?: string): string | undefined {
  const value = flags.get(name)
  return typeof value === 'string' ? value : fallback
}

const HELP = `9r2 Cloudflare bootstrap — login + R2 access keys

Commands:
  login       verify + save a bootstrap token locally (hidden prompt, or CF_API_TOKEN)
  accounts    list accounts visible to the saved token
  provision   single account: create/reuse bucket, mint keys, write to the root JSON
  batch       many accounts: read accounts.json, login each token, mint keys, write to the root JSON

Flags:
  --api-base <url>      Cloudflare API base (default https://api.cloudflare.com/client/v4)
  --account <id>        account id for single provision (auto if the token sees one)
  --input <path>        batch input file (default ./accounts.json)
  --out <path>          output JSON (default <repo>/cf-access-keys.json)
  --limit <n>           process only the first n usable rows (batch)
  --bucket <name>       R2 bucket name (default 9r2-storage)
  --name <name>         token name / label
  --jurisdiction <j>    default | eu | us | fedramp | fedramp-high
  --ttl-hours <n>       optional expiry for the minted CF token
  --token-id <id>       dashboard token id: use its R2 token directly, skip minting

Environment:
  CF_API_TOKEN      bootstrap token, avoids the hidden prompt
  CF_BOOTSTRAP_HOME where the local token file lives
  CF_R2_ENDPOINT    override the S3 endpoint (local mocks)
`

function jurisdictionOf(flags: Flags): Jurisdiction {
  const value = str(flags, 'jurisdiction', 'default') as Jurisdiction
  if (!R2_JURISDICTIONS.includes(value)) {
    throw new Error(`Invalid jurisdiction ${value}. Use one of: ${R2_JURISDICTIONS.join(', ')}`)
  }
  return value
}

function log(message: string) {
  process.stderr.write(`${message}\n`)
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const flags = parseArgs(rest)
  const apiBase = str(flags, 'api-base')

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP)
    return
  }

  if (command === 'login') {
    const token = process.env.CF_API_TOKEN ?? str(flags, 'token') ?? (await promptSecret())
    const cf = cfClient(token, apiBase)
    const verified = await cf.verify()
    const accounts = await cf.accounts()
    const file = await saveToken(token)
    process.stdout.write(`Token status: ${verified.status}\nSaved: ${file} (mode 0600)\nAccounts: ${accounts.length}\n`)
    for (const account of accounts) process.stdout.write(`  ${account.id}  ${account.name}\n`)
    process.stdout.write(
      'Bootstrap token needs: Account > Account API Tokens > Edit + Workers R2 Storage Write.\n' +
        'Wrangler OAuth tokens do not carry those scopes (checked with wrangler whoami --json).\n',
    )
    return
  }

  if (command === 'accounts') {
    const cf = cfClient(process.env.CF_API_TOKEN ?? (await loadToken()), apiBase)
    for (const account of await cf.accounts()) process.stdout.write(`${account.id}\t${account.name}\n`)
    return
  }

  const out = str(flags, 'out', DEFAULT_OUT)!
  const bucket = str(flags, 'bucket', '9r2-storage')!
  const jurisdiction = jurisdictionOf(flags)
  const ttlHours = str(flags, 'ttl-hours') ? Number(str(flags, 'ttl-hours')) : undefined

  if (command === 'provision') {
    const token = process.env.CF_API_TOKEN ?? (await loadToken())
    const result = await provision({
      token,
      apiBase,
      accountId: str(flags, 'account'),
      bucket,
      jurisdiction,
      name: str(flags, 'name'),
      ttlHours,
      tokenId: str(flags, 'token-id'),
      r2Endpoint: str(flags, 'r2-endpoint') ?? process.env.CF_R2_ENDPOINT,
      log,
    })
    await upsertEntry(
      {
        key: `${result.account.id}:${bucket}`,
        accountId: result.account.id,
        accountName: result.account.name,
        bucket: result.bucket.name,
        jurisdiction: result.bucket.jurisdiction,
        endpoint: result.bucket.endpoint,
        region: 'auto',
        accessKeyId: result.credentials.accessKeyId,
        secretAccessKey: result.credentials.secretAccessKey,
        tokenId: result.token.id,
        tokenName: result.token.name,
        expiresOn: result.token.expiresOn,
        status: 'ok',
        createdAt: new Date().toISOString(),
      },
      out,
    )
    process.stdout.write(`Account:       ${result.account.name} (${result.account.id})\n`)
    process.stdout.write(`Bucket:        ${result.bucket.name} (${result.bucket.jurisdiction}, created=${result.bucket.created})\n`)
    process.stdout.write(`Access key id: ${result.credentials.accessKeyId}\n`)
    process.stdout.write(`S3 probe:      ${result.probe}\n`)
    process.stdout.write(`Output:        ${out}\n`)
    return
  }

  if (command === 'batch') {
    const input = str(flags, 'input', 'accounts.json')!
    const rows = JSON.parse(await readFile(input, 'utf8')) as AccountRow[]
    const summary = await runBatch(rows, {
      apiBase,
      bucket,
      jurisdiction,
      name: str(flags, 'name'),
      ttlHours,
      tokenId: str(flags, 'token-id'),
      r2Endpoint: str(flags, 'r2-endpoint') ?? process.env.CF_R2_ENDPOINT,
      out,
      limit: str(flags, 'limit') ? Number(str(flags, 'limit')) : undefined,
      log,
    })
    process.stdout.write(
      `Rows: ${rows.length} | ok: ${summary.ok} | failed: ${summary.failed} | ` +
        `no accounts: ${summary.noAccounts} | skipped: ${summary.skipped}\nOutput: ${out}\n`,
    )
    return
  }

  throw new Error(`Unknown command: ${command}. Run without arguments for help.`)
}

main().catch((error: unknown) => {
  process.stderr.write(`cf-bootstrap: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
