# 9r2

A storage gateway for Cloudflare R2 and any S3-compatible endpoint. One dashboard
over several buckets: uploads are routed to the bucket with room, files live in
virtual folders, and share links stream through the Worker.

## Stack

| Piece | Choice |
| --- | --- |
| API | Hono on Cloudflare Workers |
| Database | D1 (SQLite) via Drizzle ORM |
| Storage | R2, one or more bucket bindings |
| UI | React 19 + Vite + Tailwind 4 |
| Deploy | one Worker: API routes plus the built SPA as static assets |

```
apps/
  api/     Hono worker — routes, D1 access, R2 streaming
  web/     React SPA — built into apps/api's assets
packages/
  shared/  zod request schemas and DTO types used by both
```

The SPA and API share one origin, so auth uses an httpOnly session cookie and there
is no CORS to configure. `apps/api/wrangler.jsonc` points at `../web/dist` and sends
`/api/*`, `/public/*` and `/health` to the Worker while everything else falls back to
`index.html`.

## Local development

Requires Node 20+ (wrangler needs it) and either bun or npm.

```bash
bun install        # or: npm install
bun run dev        # or: npm run dev
```

`dev` builds the SPA once if `apps/web/dist` is missing, writes any missing keys
(`SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) into `apps/api/.dev.vars`, applies
D1 migrations locally, then runs the Worker on `:8788` and Vite on `:5173`. Open
http://localhost:5173 — Vite proxies `/api` and `/public` to the Worker.

The default local sign-in is `admin@9r2.local` / `change-me-local-dev`. Change it in
`apps/api/.dev.vars`; there is no registration screen.

If `8788` is taken it moves to the next free port and tells you which one; set
`API_PORT` to start somewhere else. The Vite proxy follows automatically.

No D1 or R2 setup is needed locally: `wrangler dev` simulates both.

### End-to-end check

```bash
npm run e2e
```

Wipes `apps/api/.wrangler/state`, applies every migration from scratch, starts
`wrangler dev` on `:8799` plus two mock S3 servers, then drives the real API with
curl: sign-in, folders, uploads, ranges, shares, trash, moving files across
R2→S3→S3→R2, quotas, and every API-key scope. Exits non-zero on the first recap
failure. It never touches a remote deployment; set `E2E_PORT` if `8799` is busy.

Requires `jq`.

All scripts are package-manager neutral (`bun run build`, `npm run typecheck`, …)
and call the local binaries directly, so no `--workspace` flags are involved.

## Deploy

```bash
bunx wrangler login

# 1. Create the database and bucket
bunx wrangler d1 create 9r2-db
bunx wrangler r2 bucket create 9r2-primary

# 2. Put the D1 id from step 1 into apps/api/wrangler.jsonc (database_id)

# 3. Secrets: session/signing key plus the single account's sign-in
bunx wrangler secret put SESSION_SECRET --config apps/api/wrangler.jsonc
bunx wrangler secret put ADMIN_EMAIL --config apps/api/wrangler.jsonc
bunx wrangler secret put ADMIN_PASSWORD --config apps/api/wrangler.jsonc

# 4. Schema, then build + deploy
bun run db:remote
bun run deploy
```

`npx wrangler …` / `npm run …` are equivalent if you are not using bun.

`SESSION_SECRET` must be long and random: rotating it invalidates sessions and
makes existing share links undecryptable.

## Adding storage accounts

Two ways in, and they behave identically once connected.

### 1. From the UI (any S3-compatible storage, any account)

**Storage → Add storage account.** Pick a type and fill in the form:

| Type | What you need |
| --- | --- |
| Cloudflare R2 (another account) | R2 → Manage R2 API Tokens → create a token with Object Read & Write. Enter the **account ID**, bucket name, Access Key ID and Secret Access Key. Endpoint is derived as `https://<account-id>.r2.cloudflarestorage.com`, region `auto`. |
| Other S3-compatible storage | Endpoint (e.g. `https://s3.us-west-002.backblazeb2.com`), region, bucket name, Access Key ID, Secret Access Key. |

**Test connection** runs a signed GET against the bucket before anything is saved.
Access keys are encrypted with `SESSION_SECRET` and never leave the Worker.
Accounts added this way can be removed from the same page once they hold no files.

### 3. Bulk-seed from collected R2 credentials

`cf-dashboard` writes usable accounts to `cf-access-keys.json`. With an API key
that has `storage:manage`, seed them in one pass (default quota 10 GB each):

```bash
# key lives in apps/api/.9r2-key (gitignored, mode 0600)
bun run seed:9r2
bun run seed:9r2 --quota-gb 20 --limit 5 --api https://drive.lamaaulabs.com
```

It posts to `/api/buckets`, so no browser session is needed. Each account's S3
credentials are verified by the Worker before saving; `409` means already connected.

This is the path for "another Cloudflare account": R2 bindings cannot cross accounts,
but the R2 S3 API can, so it goes through signed HTTP instead.

### 2. From wrangler (a bucket in this deployment's own account)

Cheaper and faster — no per-request signing, and R2 binding egress is free.

```bash
bunx wrangler r2 bucket create 9r2-archive
```

Declare it twice in `apps/api/wrangler.jsonc`: the binding the Worker uses, and
`BUCKET_CONFIG` so the app knows its name and quota.

```jsonc
"r2_buckets": [
  { "binding": "R2_PRIMARY", "bucket_name": "9r2-primary" },
  { "binding": "R2_ARCHIVE", "bucket_name": "9r2-archive" }
],
"vars": {
  "BUCKET_CONFIG": "[{\"binding\":\"R2_PRIMARY\",\"name\":\"Primary\",\"quotaBytes\":10737418240},{\"binding\":\"R2_ARCHIVE\",\"name\":\"Archive\",\"quotaBytes\":null}]"
}
```

`bun run deploy`. Existing accounts pick the new bucket up on their next sign-in or
Storage page load. Locally, restart `bun run dev` (wrangler reads bindings at start).

Per-user quota and routing are editable on the Storage page:

- **Most free space** — uploads go to the eligible bucket with the most room.
- **Round robin** — uploads rotate across eligible buckets (cursor kept in D1).
- **Priority** — uploads try buckets in the order shown, top first.

Usage is the sum of file sizes in D1, not an R2 usage API. Trashed files still count
until permanently deleted, because the object still exists.

## How storage works

- Every upload is one request: `POST /api/files` with the raw file as the body and
  `x-file-name` / `x-mime-type` / `x-folder-id` headers. The body is piped straight
  into the provider — `R2.put` for bindings, a signed `PUT` for S3 accounts — so
  nothing is buffered and the Worker never writes to disk.
- The declared `Content-Length` is checked against the size the provider reports, so
  quota cannot be dodged by lying about the size.
- Content is hashed (SHA-256) as it streams past and the digest is stored on the
  file row, so identical content can be found with a query. Uploading the same bytes
  twice still stores two files — the hash is for identification, not dedupe.
- Rows stored before hashing existed have `sha256: null`.
- Objects are stored flat under `<userId>/<fileId>`. Folders exist only in D1.
- Reads always stream through the Worker with Range support (video seeking, resumed
  downloads). No presigned URLs, no public bucket.
- Trash is a soft delete (`files.deleted_at`). Permanent delete removes the R2 object
  first, then the row.

## API

All routes under `/api` and `/public` are served by the Worker.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | single account only, matched against `ADMIN_EMAIL` / `ADMIN_PASSWORD`; sets the `sid` cookie |
| POST | `/api/auth/logout` | deletes the session row and cookie |
| GET | `/api/auth/me` | current user |
| GET | `/api/buckets` | storage accounts with their ids; readable with an API key |
| GET | `/api/buckets/:id` | one storage account |
| POST | `/api/buckets` | add an S3-compatible account; needs `storage:manage` |
| DELETE | `/api/buckets/:id` | only when the account holds no files; needs `storage:manage` |
| GET | `/api/files` | `folderId`, `q`, `status=trash` |
| POST | `/api/files` | raw-body upload; the response carries the file's `sha256` |
| PATCH | `/api/files/:id` | `name`, `folderId`, `starred` |
| DELETE | `/api/files/:id` | move to trash |
| POST | `/api/files/:id/restore` | |
| DELETE | `/api/files/:id/permanent` | deletes the R2 object too |
| GET | `/api/files/:id/content` | inline stream, `?download=1` |
| POST | `/api/files/:id/move-storage` | copy to another storage account, then drop the old copy |
| POST | `/api/files/:id/share` | creates or reuses a link |
| DELETE | `/api/files/:id/share` | revokes links |
| GET | `/api/files/shared` | links with their URLs |
| GET | `/api/folders` | every folder; `?parentId=<id>` for one level, `?parentId=` for the root |
| GET | `/api/folders/:id` | the folder with its child folders and files |
| POST/PATCH/DELETE | `/api/folders[/:id]` | |
| GET | `/api/storage` | accounts, usage, routing |
| POST | `/api/storage/accounts/test` | verify S3 credentials without saving |
| POST | `/api/storage/accounts` | add an S3-compatible account |
| DELETE | `/api/storage/accounts/:id` | only when the account holds no files |
| PATCH | `/api/storage/buckets/:id` | `quotaBytes`, `priority` |
| PUT | `/api/storage/policy` | `mode`, `priorityBucketIds` |
| GET | `/api/api-keys` | list keys (session cookie only) |
| POST | `/api/api-keys` | create a key; the secret is returned once |
| DELETE | `/api/api-keys/:id` | revoke |
| GET | `/public/files/:token` | public metadata |
| GET | `/public/files/:token/content` | public stream |

Error responses are `{ code, message }` with the HTTP status carrying the meaning.
Unexpected errors return a generic 500 and are logged, never echoed back.

The same list as an OpenAPI 3.1 document lives at `apps/web/public/openapi.json`,
served from the deployment root as `/openapi.json`. It contains no credentials — only
placeholder field names. `npm run openapi:check` fails if the spec and the routes in
`apps/api/src/routes` disagree.

### API keys

Create them in the app under **API keys**. A key replaces the session cookie for
files, folders and buckets. Key management stays browser-only, so a leaked key
cannot mint another key. Adding or removing a storage account needs `storage:manage`,
which is off by default: a key holding it can point uploads at storage its holder
controls, so grant it only to keys that should have it.

Send it as `Authorization: Bearer 9r2_…`. Four scopes, one per kind of route:

| Scope | Covers |
| --- | --- |
| `files:read` | list, search, download content, read folders and buckets |
| `files:write` | upload, rename, move folder, move storage, restore, share, create/rename/delete folders |
| `files:delete` | trash, delete permanently |
| `storage:manage` | add and remove storage accounts (`POST` / `DELETE /api/buckets`) |

```bash
KEY=9r2_…
curl -X POST https://your-worker/api/files \
  -H "Authorization: Bearer $KEY" -H 'x-file-name: backup.tar.gz' \
  --data-binary @backup.tar.gz

curl -H "Authorization: Bearer $KEY" https://your-worker/api/files
curl -H "Authorization: Bearer $KEY" -o out.bin \
  "https://your-worker/api/files/<id>/content?download=1"

# which storage accounts exist, and their ids
curl -H "Authorization: Bearer $KEY" https://your-worker/api/buckets

curl -X POST https://your-worker/api/files/<id>/move-storage \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"bucketId":"<id from /api/buckets>"}'
```

A missing scope is a 403, a revoked or unknown key is a 401.

## Security notes

- **Single account, no registration.** Credentials live in `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` and are compared in constant time; changing the secret changes the
  password. There is no user table to attack and no sign-up endpoint.
- Session tokens: 32 random bytes, only the SHA-256 hash is stored.
- API keys: same treatment — `9r2_` + 32 random bytes, SHA-256 at rest, shown once.
  Revocation is immediate; `last_used_at` is written at most every 5 minutes.
- Share tokens: stored as a hash for lookup, and AES-GCM encrypted separately so the
  dashboard can show the link again. Neither form is ever logged.
- S3 access keys: AES-GCM encrypted with `SESSION_SECRET` before storage.
- Login is limited to 10 attempts per minute per IP by the Workers rate-limiting
  binding. It is per-colo and approximate, not a global counter.
- `storage:manage` is a separate scope because adding a bucket means supplying
  credentials: a key with it can point uploads at storage its holder controls.
- Every file, folder and bucket query is scoped by `user_id`.
- Uploads are capped by `MAX_UPLOAD_BYTES` (default 100 MB, the Workers request-body
  limit on Free/Pro).

## Not built (deliberately)

Registration, multi-user accounts, email verification, password reset, CAPTCHA,
folder sharing, and upload resumption. Sign-in is one account from secrets.
