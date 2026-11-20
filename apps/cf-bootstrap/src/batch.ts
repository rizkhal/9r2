/** Batch login + R2 access-key harvest from a list of accounts.json rows. */
import { cfClient } from './cf'
import { provision, type Jurisdiction } from './provision'
import { upsertEntry, type KeyEntry } from './store'

export type AccountRow = {
  email?: string
  user_id?: string
  api_token?: string
  token_id?: string
  error?: string
}

export type BatchOptions = {
  apiBase?: string
  bucket: string
  jurisdiction?: Jurisdiction
  name?: string
  ttlHours?: number
  r2Endpoint?: string
  tokenId?: string
  out?: string
  limit?: number
  log?: (message: string) => void
}

export type BatchSummary = { ok: number; failed: number; noAccounts: number; skipped: number }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function runBatch(rows: AccountRow[], options: BatchOptions): Promise<BatchSummary> {
  const log = options.log ?? (() => {})
  const summary: BatchSummary = { ok: 0, failed: 0, noAccounts: 0, skipped: 0 }
  const usable = rows.filter((row) => row.api_token && !(row.error ?? '').trim())

  summary.skipped = rows.length - usable.length
  log(`Input: ${rows.length} rows, ${usable.length} with a token and no error, ${summary.skipped} skipped.`)

  const selected = options.limit ? usable.slice(0, options.limit) : usable
  for (const [index, row] of selected.entries()) {
    const label = row.email ?? row.user_id ?? `row-${index}`
    const token = row.api_token!
    try {
      const cf = cfClient(token, options.apiBase)
      const verified = await cf.verify()
      const accounts = await cf.accounts()
      log(`[${index + 1}/${selected.length}] ${label}: login ${verified.status}, ${accounts.length} account(s)`)
      if (accounts.length === 0) {
        summary.noAccounts++
        await upsertEntry(
          {
            key: `${label}:no-account:${options.bucket}`,
            email: row.email,
            userId: row.user_id,
            accountId: '',
            accountName: '',
            bucket: options.bucket,
            jurisdiction: options.jurisdiction ?? 'default',
            endpoint: '',
            region: 'auto',
            status: 'error',
            error: 'Token verified but /accounts returned 0 accounts',
            createdAt: new Date().toISOString(),
          },
          options.out,
        )
        continue
      }

      for (const account of accounts) {
        try {
          const result = await provision({
            token,
            apiBase: options.apiBase,
            accountId: account.id,
            bucket: options.bucket,
            jurisdiction: options.jurisdiction,
            name: options.name,
            ttlHours: options.ttlHours,
            r2Endpoint: options.r2Endpoint,
            tokenId: row.token_id ?? options.tokenId,
          })
          await upsertEntry(
            {
              key: `${label}:${account.id}:${options.bucket}`,
              email: row.email,
              userId: row.user_id,
              accountId: account.id,
              accountName: account.name,
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
            options.out,
          )
          summary.ok++
          log(`  ${account.name}: bucket ${result.bucket.name}, access key ${result.credentials.accessKeyId}`)
        } catch (error) {
          summary.failed++
          await upsertEntry(
            {
              key: `${label}:${account.id}:${options.bucket}`,
              email: row.email,
              userId: row.user_id,
              accountId: account.id,
              accountName: account.name,
              bucket: options.bucket,
              jurisdiction: options.jurisdiction ?? 'default',
              endpoint: '',
              region: 'auto',
              status: 'error',
              error: message(error),
              createdAt: new Date().toISOString(),
            },
            options.out,
          )
          log(`  ${account.name}: FAILED ${message(error)}`)
        }
      }
    } catch (error) {
      summary.failed++
      await upsertEntry(
        {
          key: `${label}:login-error:${options.bucket}`,
          email: row.email,
          userId: row.user_id,
          accountId: '',
          accountName: '',
          bucket: options.bucket,
          jurisdiction: options.jurisdiction ?? 'default',
          endpoint: '',
          region: 'auto',
          status: 'error',
          error: `login failed: ${message(error)}`,
          createdAt: new Date().toISOString(),
        },
        options.out,
      )
      log(`[${index + 1}/${selected.length}] ${label}: LOGIN FAILED ${message(error)}`)
    }
  }
  return summary
}
