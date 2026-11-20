# @9r2/cf-bootstrap

Login ke akun Cloudflare, bikin/reuse satu R2 bucket, mint API token yang
**di-scope ke bucket itu saja**, ambil Access Key ID + Secret Access Key, lalu
tulis semua hasilnya ke **satu file JSON di root repo**: `cf-access-keys.json`.

File output dan file token lokal dibuat dengan mode `0600` dan keduanya
di-gitignore. Tool ini jalan lokal pakai `bun`, ga di-deploy.

## Kenapa butuh bootstrap token

`bunx wrangler whoami --json` di mesin ini menunjukkan token OAuth Wrangler
punya `account:read`, `d1:write`, `workers:write`, tapi **ga ada `r2:write` dan
ga ada scope bikin token**. Jadi ga bisa dipakai buat bikin bucket/access key.

Bootstrap token dibuat dari dashboard dengan izin:

- **Account → Account API Tokens → Edit**
- **Workers R2 Storage → Edit**

Simpan lewat hidden prompt atau env `CF_API_TOKEN`.

Token `cfut_` bawaan `accounts.json` **tidak cukup**: hasil probe live di session
ini — `GET /accounts` mengembalikan `0`, `GET /user/tokens/permission_groups`
dan `POST /user/tokens` keduanya balas `9109` (Unauthorized). Token itu hanya
punya izin User › API Tokens Write, jadi ga bisa baca account apalagi bikin R2.
Ganti field `api_token` di file input dengan bootstrap token per akun.

**Jalur paling simpel:** token yang lu bikin manual di dashboard dengan izin
**Workers R2 Storage: Read + Write** sudah cukup — ga perlu mint token kedua.
Catat **token ID**-nya (kolom ID di halaman API Tokens), lalu:

```bash
CF_API_TOKEN=*** bun run cf-bootstrap provision --token-id <token-id> --bucket 9r2-main
```

Tool-nya langsung pakai token itu sebagai kredensial S3: Access Key ID = token
ID, Secret Access Key = SHA-256 hex dari token value. `POST /tokens` dan
pencarian permission-group dilewati. Untuk batch, tambahkan `token_id` per baris.

## Commands

```bash
# Login: verify token + lihat account yang terlihat
bun apps/cf-bootstrap/src/index.ts login
bun apps/cf-bootstrap/src/index.ts accounts

# Satu akun
bun apps/cf-bootstrap/src/index.ts provision --bucket 9r2-main

# Banyak akun dari accounts.json (default input, bisa --input <path>)
bun apps/cf-bootstrap/src/index.ts batch --limit 5
```

Output root `cf-access-keys.json`:

```json
{
  "updatedAt": "2026-11-21T...",
  "entries": [
    {
      "key": "user@example.com:<accountId>:9r2-storage",
      "email": "user@example.com",
      "userId": "...",
      "accountId": "...",
      "accountName": "...",
      "bucket": "9r2-storage",
      "jurisdiction": "default",
      "endpoint": "https://<account>.r2.cloudflarestorage.com",
      "region": "auto",
      "accessKeyId": "...",
      "secretAccessKey": "<sha256 hex 64 char>",
      "tokenId": "...",
      "tokenName": "9r2-...",
      "status": "ok",
      "createdAt": "..."
    }
  ]
}
```

Entry gagal tetap ditulis dengan `status: "error"` dan field `error`, jadi satu
akun yang gagal ga menghentikan batch. Dedupe pakai `key`, jadi jalan ulang ga
nambah duplikat.

## Urutan kerja

1. `GET /user/tokens/verify` + `GET /accounts` — login.
2. `GET /accounts/:id/r2/buckets/:name` — 200 → reuse, 404 → `POST` bikin.
3. `GET /accounts/:id/tokens/permission_groups?name=…` — ambil id group saat
   runtime. Prefer `Workers R2 Storage Bucket Item Write` scoped ke
   `com.cloudflare.edge.r2.bucket.<account>_<jurisdiction>_<bucket>`; fallback
   `Workers R2 Storage Write` level account.
4. `POST /accounts/:id/tokens` — mint token.
5. Access Key ID = `result.id`; Secret Access Key = **SHA-256 hex** dari
   `result.value` (mapping resmi Cloudflare).
6. Probe S3 pakai `aws4fetch`: `GET /<bucket>/__9r2_probe__`; 404 berarti bucket
   kejangkau dan signature valid.
7. Tulis/merge entry ke `cf-access-keys.json`.

## Test offline

```bash
cd apps/cf-bootstrap && bun test
```

Mock Cloudflare + mock R2, ga butuh kredensial dan ga nyentuh API beneran.
