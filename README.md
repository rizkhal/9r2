# 9r2

A storage gateway for Cloudflare R2 and any S3-compatible endpoint. One dashboard
over several buckets: uploads are routed to the bucket with room, files live in
virtual folders, and share links stream through the server.

## Stack

| Piece | Choice |
| --- | --- |
| API | Hono on Bun |
| Database | PostgreSQL via Drizzle ORM |
| Storage | any S3-compatible endpoint (including R2) over signed HTTP |
| UI | React 19 + Vite + Tailwind 4 |
| Deploy | one container: the Bun server serves the API and the built SPA |

```
apps/
  api/     Hono server — routes, Postgres access, streaming to storage
  web/     React SPA — built to apps/web/dist and served by the API
packages/
  shared/  zod request schemas and DTO types used by both
```

The SPA and API share one origin, so auth uses an httpOnly session cookie and there
is no CORS to configure. `apps/api/src/server.ts` sends `/api/*`, `/public/*` and
`/health` to Hono while everything else is served from `apps/web/dist`, falling back
to `index.html` for client-side routes.

## Local development

Requires [Bun](https://bun.sh) and a Postgres. The easiest Postgres is the bundled
compose file (port 5433, so it won't clash with a system Postgres):

```bash
docker compose -f docker-compose.dev.yml up -d   # or point DATABASE_URL at your own
bun install
bun run dev
```

`dev` writes any missing keys (`DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`) into a gitignored `.env`, applies migrations, then runs the API on
`:8788` and Vite on `:5173`. Open http://localhost:5173 — Vite proxies `/api`,
`/public` and `/health` to the API.

The default local sign-in is `admin@9r2.local` / `change-me-local-dev`. Change it in
`.env`; there is no registration screen.

If `8788` is taken it moves to the next free port and tells you which one; set
`API_PORT` to start somewhere else. The Vite proxy follows automatically.

To change the schema, edit `apps/api/src/db/schema.ts` and run `bun run db:generate`,
then restart (or `bun run migrate`).

### End-to-end check

```bash
bun run e2e
```

Resets the `public` and `drizzle` schemas, applies every migration from scratch,
starts the API on `:8799` plus three mock S3 servers, then drives the real API with
curl: sign-in, folders, uploads, ranges, shares, trash, moving files across storage
accounts, quotas, and every API-key scope. It exits non-zero on the first recap
failure. It never touches a remote deployment; set `E2E_PORT` if `8799` is busy and
`E2E_DATABASE_URL` to point at a different database.

Requires `jq` and a reachable Postgres.

All scripts are package-manager neutral (`bun run build`, `npm run typecheck`, …)
and call the local binaries directly, so no `--workspace` flags are involved.

## Deploy

The app is a single container (see `Dockerfile`). At start it applies migrations, then
serves the API and the SPA on `PORT`.

```bash
docker build -t 9r2 .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/9r2 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_EMAIL=you@example.com \
  -e ADMIN_PASSWORD='a-long-password' \
  9r2
```

On Coolify (the lamaaulabs project): point an application at this repo with the
Dockerfile build pack, use a standalone Postgres resource for `DATABASE_URL`, and set
the environment variables below. The container needs `DATABASE_URL` at **run** time,
not build time, so migrations can reach the database.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `SESSION_SECRET` | Long and random. Rotating it invalidates sessions and makes existing share links undecryptable. Encrypts stored S3 credentials. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The single account; its row is created on first sign-in. |
| `SEED_BUCKETS` | Optional JSON array of S3 accounts seeded for a new account (see below). |
| `PORT` | Port the server listens on (default 3000). |

## Adding storage accounts

Two ways in, and they behave identically once connected.

### 1. From the UI (any S3-compatible storage, any account)

**Storage → Add storage account.** Pick a type and fill in the form:

| Type | What you need |
| --- | --- |
| Cloudflare R2 (another account) | R2 → Manage R2 API Tokens → create a token with Object Read & Write. Enter the **account ID**, bucket name, Access Key ID and Secret Access Key. Endpoint is derived as `https://<account-id>.r2.cloudflarestorage.com`, region `auto`. |
| Other S3-compatible storage | Endpoint (e.g. `https://s3.us-west-002.backblazeb2.com`), region, bucket name, Access Key ID, Secret Access Key. |

**Test connection** runs a signed GET against the bucket before anything is saved.
Access keys are encrypted with `SESSION_SECRET` and never leave the server. Accounts
added this way can be removed from the same page once they hold no files.

### 2. Bulk-seed from collected R2 credentials

`cf-dashboard` writes usable accounts to `cf-access-keys.json`. With an API key
that has `storage:manage`, seed them in one pass (default quota 10 GB each):

```bash
# key lives in apps/api/.9r2-key (gitignored, mode 0600)
bun run seed:9r2
bun run seed:9r2 --quota-gb 20 --limit 5 --api https://drive.lamaaulabs.com
```

It posts to `/api/buckets`, so no browser session is needed. Each account's S3
credentials are verified by the server before saving; `409` means already connected.

### 3. From the environment (`SEED_BUCKETS`)

For a fresh install with no browser handy, seed one or more accounts at sign-in:

```bash
SEED_BUCKETS='[{"name":"Primary","endpoint":"https://<account-id>.r2.cloudflarestorage.com","region":"auto","bucketName":"9r2-primary","accessKeyId":"…","secretAccessKey":"…","quotaBytes":null}]'
```

Seeding is idempotent on `(userId, endpoint/bucket)`, so it is safe on every restart.

Per-user quota and routing are editable on the Storage page:

- **Most free space** — uploads go to the eligible bucket with the most room.
- **Round robin** — uploads rotate across eligible buckets (cursor kept in Postgres).
- **Priority** — uploads try buckets in the order shown, top first.

Usage is the sum of file sizes in Postgres, not a storage-API call. Trashed files still
count until permanently deleted, because the object still exists.

## How storage works

- Every upload is one request: `POST /api/files` with the raw file as the body and
  `x-file-name` / `x-mime-type` / `x-folder-id` headers. The body is piped straight
  into a signed `PUT` for the chosen account, so nothing is buffered to disk.
- The declared `Content-Length` is checked against the size the provider reports, so
  quota cannot be dodged by lying about the size.
- Content is hashed (SHA-256) in the same pass that streams it to storage, and the
  digest is stored on the file row. Uploading the same bytes twice still stores two
  files — the hash is for identification, not dedupe.
- Objects are stored flat under `<userId>/<fileId>`. Folders exist only in Postgres.
- Reads always stream through the server with Range support (video seeking, resumed
  downloads). No presigned URLs, no public bucket.
- Trash is a soft delete (`files.deleted_at`). Permanent delete removes the object
  first, then the row.

## API

All routes under `/api` and `/public` are served by the server.

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
| DELETE | `/api/files/:id/permanent` | deletes the stored object too |
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
placeholder field names. `bun run openapi:check` fails if the spec and the routes in
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
curl -X POST https://your-host/api/files \
  -H "Authorization: Bearer $KEY" -H 'x-file-name: backup.tar.gz' \
  --data-binary @backup.tar.gz

curl -H "Authorization: Bearer $KEY" https://your-host/api/files
curl -H "Authorization: Bearer $KEY" -o out.bin \
  "https://your-host/api/files/<id>/content?download=1"

# which storage accounts exist, and their ids
curl -H "Authorization: Bearer $KEY" https://your-host/api/buckets

curl -X POST https://your-host/api/files/<id>/move-storage \
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
- Login is limited to 10 attempts per minute per client IP by an in-process limiter.
  It is per-container, so a multi-instance deployment would need a shared limiter.
- `storage:manage` is a separate scope because adding a bucket means supplying
  credentials: a key with it can point uploads at storage its holder controls.
- Every file, folder and bucket query is scoped by `user_id`.
- There is no app-level upload cap; the practical limit is the host's memory and
  request-body settings. Uploads stream, so large files do not sit in memory.

## Not built (deliberately)

Registration, multi-user accounts, email verification, password reset, CAPTCHA,
folder sharing, and upload resumption. Sign-in is one account from secrets.
