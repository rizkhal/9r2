/** Creates one R2 bucket + one bucket-scoped S3 API token and verifies the S3 keys. */
import { createHash } from 'node:crypto'
import { AwsClient } from 'aws4fetch'
import { cfClient, type CfPermissionGroup } from './cf'

export const R2_JURISDICTIONS = ['default', 'eu', 'us', 'fedramp', 'fedramp-high'] as const
export type Jurisdiction = (typeof R2_JURISDICTIONS)[number]

export type ProvisionOptions = {
  token: string
  apiBase?: string
  accountId?: string
  bucket: string
  jurisdiction?: Jurisdiction
  name?: string
  quotaBytes?: number | null
  ttlHours?: number
  r2Endpoint?: string
  /** With a dashboard-made R2 token, pass its id here to skip minting a second token. */
  tokenId?: string
  log?: (message: string) => void
}

export type ProvisionResult = {
  account: { id: string; name: string }
  bucket: { name: string; jurisdiction: Jurisdiction; created: boolean; endpoint: string }
  token: { id: string; name: string; expiresOn: string | null }
  credentials: { accessKeyId: string; secretAccessKey: string }
  probe: 'ok'
  storageAccount: {
    name: string
    endpoint: string
    region: string
    bucketName: string
    accessKeyId: string
    secretAccessKey: string
    quotaBytes: number | null
  }
}

type Candidate = {
  name: string
  scope: string
  resource: (accountId: string, jurisdiction: Jurisdiction, bucket: string) => string
}

const CANDIDATES: Candidate[] = [
  {
    name: 'Workers R2 Storage Bucket Item Write',
    scope: 'com.cloudflare.edge.r2.bucket',
    resource: (a, j, b) => `com.cloudflare.edge.r2.bucket.${a}_${j}_${b}`,
  },
  {
    name: 'Workers R2 Storage Write',
    scope: 'com.cloudflare.api.account',
    resource: (a) => `com.cloudflare.api.account.${a}`,
  },
]

function endpointFor(accountId: string, jurisdiction: Jurisdiction) {
  const prefix = jurisdiction === 'default' ? '' : `${jurisdiction}.`
  return `https://${accountId}.${prefix}r2.cloudflarestorage.com`
}

async function pickPermissionGroup(
  cf: ReturnType<typeof cfClient>,
  accountId: string,
): Promise<{ group: CfPermissionGroup; candidate: Candidate }> {
  for (const candidate of CANDIDATES) {
    const groups = await cf.permissionGroups(accountId, candidate.name)
    const group = groups.find(
      (g) =>
        g.name === candidate.name &&
        g.is_selectable !== false &&
        (g.scopes?.includes(candidate.scope) ?? true),
    )
    if (group) return { group, candidate }
  }

  const all = await cf.permissionGroups(accountId)
  const r2 = all.filter((g) => /r2/i.test(g.name)).map((g) => `${g.name} (selectable=${g.is_selectable})`)
  throw new Error(
    `No selectable R2 permission group found. Need one of: ${CANDIDATES.map((c) => c.name).join(', ')}. ` +
      `Available R2 groups: ${r2.join(', ') || 'none'}`,
  )
}

export async function provision(options: ProvisionOptions): Promise<ProvisionResult> {
  const log = options.log ?? (() => {})
  const jurisdiction = options.jurisdiction ?? 'default'
  const cf = cfClient(options.token, options.apiBase)

  const accounts = await cf.accounts()
  const accountId = options.accountId ?? (accounts.length === 1 ? accounts[0].id : '')
  if (!accountId) {
    throw new Error(
      `Pass --account <id>. Accounts visible to this token: ${accounts.map((a) => `${a.id} ${a.name}`).join(', ')}`,
    )
  }
  const account = accounts.find((a) => a.id === accountId)
  if (!account) throw new Error(`Account ${accountId} is not visible to this token.`)
  log(`Account: ${account.name} (${account.id})`)

  const existing = await cf.getBucket(accountId, options.bucket, jurisdiction)
  let created = false
  if (existing) {
    log(`Bucket ${options.bucket} already exists — reusing it.`)
  } else {
    await cf.createBucket(accountId, options.bucket, jurisdiction)
    created = true
    log(`Bucket ${options.bucket} created (${jurisdiction}).`)
  }

  let tokenId: string
  let tokenName: string
  let tokenValue: string
  let expiresOn: string | null = null

  if (options.tokenId) {
    // Simplest path: the dashboard token already has R2 read+write. Its id is
    // the Access Key ID and the sha256 of its value is the Secret Access Key.
    tokenId = options.tokenId
    tokenValue = options.token
    tokenName = options.name ?? `dashboard-r2-${options.bucket}`
    log(`Direct mode: reusing dashboard token ${tokenId}, no second token minted.`)
  } else {
    const { group, candidate } = await pickPermissionGroup(cf, accountId)
    log(`Permission group: ${group.name} (${group.id})`)

    tokenName = (options.name ?? `9r2-${options.bucket}-${Date.now().toString(36)}`).slice(0, 120)
    expiresOn = options.ttlHours && options.ttlHours > 0
      ? new Date(Date.now() + options.ttlHours * 3_600_000).toISOString()
      : null
    const payload: Record<string, unknown> = {
      name: tokenName,
      policies: [
        {
          effect: 'allow',
          permission_groups: [{ id: group.id, name: group.name }],
          resources: { [candidate.resource(accountId, jurisdiction, options.bucket)]: '*' },
        },
      ],
    }
    if (expiresOn) payload.expires_on = expiresOn

    const createdToken = await cf.createToken(accountId, payload)
    if (!createdToken.id || !createdToken.value) {
      throw new Error('Cloudflare did not return both the token id and value.')
    }
    tokenId = createdToken.id
    tokenValue = createdToken.value
  }

  // R2 S3 keys from an API token: Access Key ID = token id,
  // Secret Access Key = SHA-256 hex digest of the token value.
  const accessKeyId = tokenId
  const secretAccessKey = createHash('sha256').update(tokenValue, 'utf8').digest('hex')
  log(`S3 keys derived (access key id ${accessKeyId}, secret sha256 hex 64 chars).`)

  const endpoint = (options.r2Endpoint ?? endpointFor(accountId, jurisdiction)).replace(/\/+$/, '')
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  const probe = await client.fetch(`${endpoint}/${encodeURIComponent(options.bucket)}/__9r2_probe__`)
  if (!probe.ok && probe.status !== 404) {
    if (probe.status === 403) {
      throw new Error('S3 probe returned 403 — check the token scope and the bucket name.')
    }
    throw new Error(`S3 probe returned ${probe.status}.`)
  }
  log('S3 probe accepted (404 on the probe key = bucket reachable, signature valid).')

  const storageAccount = {
    name: options.name ?? options.bucket,
    endpoint,
    region: 'auto',
    bucketName: options.bucket,
    accessKeyId,
    secretAccessKey,
    quotaBytes: options.quotaBytes ?? null,
  }

  return {
    account: { id: account.id, name: account.name },
    bucket: { name: options.bucket, jurisdiction, created, endpoint },
    token: { id: tokenId, name: tokenName, expiresOn },
    credentials: { accessKeyId, secretAccessKey },
    probe: 'ok',
    storageAccount,
  }
}
