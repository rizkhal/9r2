#!/usr/bin/env bash
# End-to-end check of the API against a real workerd + local D1/R2.
#
#   npm run e2e
#
# Wipes the local D1 and R2 state first, so it also covers first-run sign-in and
# the whole migration chain. Never point this at a remote deployment.
#
# Every request goes through a helper below rather than an inline curl: bash 3.2
# (the /bin/bash on macOS) drops the \" escapes inside "$( ... )", which silently
# sends an empty body. Quoting inside a function body is safe.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${E2E_PORT:-8799}"
BASE="http://localhost:$PORT"
S3_A=9901
S3_B=9902
S3_P=9903
JAR="$(mktemp)"
ANON="$(mktemp)" # empty cookie jar, for calls that must not be signed in
LOG="$(mktemp)"
PIDS=()

PASS=0
FAIL=0
FAILED=()

cleanup() {
  # Kill each child's whole process group: wrangler dev leaves a workerd
  # grandchild that would otherwise hold the port and a stale database.
  for pid in "${PIDS[@]:-}"; do
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    disown "$pid" 2>/dev/null || true # keeps the shell from printing "Terminated"
  done
  wait 2>/dev/null
  rm -f "$JAR" "$ANON" "$LOG" "$JAR.body" "$JAR.body2"
}
trap cleanup EXIT

for port in "$PORT" "$S3_A" "$S3_B" "$S3_P"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "port $port is already in use — stop that process or set E2E_PORT"
    exit 1
  fi
done
# Job control gives each background child its own process group, so cleanup can kill it whole.
set -m

# ------------------------------------------------------------------- helpers

ok() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() {
  FAIL=$((FAIL + 1))
  FAILED+=("$1")
  printf '  \033[31m✗\033[0m %s\n      %s\n' "$1" "$2"
}
expect() { # name expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected $2, got $3"; fi
}
expect_contains() { # name needle haystack
  case "$3" in *"$2"*) ok "$1" ;; *) bad "$1" "expected to contain '$2', got: ${3:0:200}" ;; esac
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

json() { jq -cn "$@"; }

# Only the signed-in jar is written back, so an anonymous call that happens to
# set a cookie cannot silently sign the rest of the suite in.
jarargs() { # jar -> curl flags; only the signed-in jar is written back
  if [ "$1" = "$JAR" ]; then
    JARARGS=(-b "$JAR" -c "$JAR")
  else
    JARARGS=(-b "$1")
  fi
}
call() { # jar method path [json] -> response body
  local jar="$1" method="$2" path="$3" payload="${4:-}"
  jarargs "$jar"
  if [ -n "$payload" ]; then
    curl -s "${JARARGS[@]}" -X "$method" "$BASE$path" -H 'content-type: application/json' -d "$payload"
  else
    curl -s "${JARARGS[@]}" -X "$method" "$BASE$path"
  fi
}
status() { # jar method path [json] -> http status
  local jar="$1" method="$2" path="$3" payload="${4:-}"
  jarargs "$jar"
  if [ -n "$payload" ]; then
    curl -s -o /dev/null -w '%{http_code}' "${JARARGS[@]}" -X "$method" "$BASE$path" -H 'content-type: application/json' -d "$payload"
  else
    curl -s -o /dev/null -w '%{http_code}' "${JARARGS[@]}" -X "$method" "$BASE$path"
  fi
}
acode() { status "$JAR" "$@"; }  # signed in
abody() { call "$JAR" "$@"; }
code() { status "$ANON" "$@"; }  # anonymous
body() { call "$ANON" "$@"; }

kcode() { # key method path [json] -> http status, authenticated by API key
  local key="$1" method="$2" path="$3" payload="${4:-}"
  if [ -n "$payload" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" -H "Authorization: Bearer $key" -H 'content-type: application/json' -d "$payload"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" -H "Authorization: Bearer $key"
  fi
}
hcode() { curl -s -o /dev/null -w '%{http_code}' -b "$1" -c "$1" -H "$2" "$BASE$3"; }
hbody() { curl -s -b "$1" -c "$1" -H "$2" "$BASE$3"; }
headers() { curl -s -D - -o /dev/null -b "$1" -c "$1" "$BASE$2"; }
upload() { # jar name file -> response body
  curl -s -b "$1" -c "$1" -X POST "$BASE/api/files" -H "x-file-name: $2" -H 'x-mime-type: text/plain' --data-binary "@$3"
}
ustatus() { # jar name file -> http status
  curl -s -o /dev/null -w '%{http_code}' -b "$1" -c "$1" -X POST "$BASE/api/files" -H "x-file-name: $2" -H 'x-mime-type: text/plain' --data-binary "@$3"
}
account_json() { # name port bucket
  json --arg n "$1" --arg e "http://127.0.0.1:$2" --arg b "$3" \
    '{name:$n,endpoint:$e,region:"auto",bucketName:$b,accessKeyId:"AK",secretAccessKey:"SK"}'
}

# ---------------------------------------------------------------- environment

# The seed account lives on its own mock server: mock-s3 drops the bucket from the
# path, so two buckets on one server would share storage and break move-storage.
printf 'Starting mock S3 on %s, %s and %s\n' "$S3_A" "$S3_B" "$S3_P"
node "$ROOT/scripts/mock-s3.mjs" "$S3_A" > /dev/null 2>&1 &
PIDS+=($!)
node "$ROOT/scripts/mock-s3.mjs" "$S3_B" > /dev/null 2>&1 &
PIDS+=($!)
node "$ROOT/scripts/mock-s3.mjs" "$S3_P" > /dev/null 2>&1 &
PIDS+=($!)

export DATABASE_URL="${E2E_DATABASE_URL:-postgres://9r2:9r2@127.0.0.1:5433/9r2}"
export SESSION_SECRET="e2e-secret"
export ADMIN_EMAIL="admin@9r2.local"
export ADMIN_PASSWORD="change-me-local-dev"
# One S3 account is seeded at sign-in so uploads have somewhere to land.
export SEED_BUCKETS="$(json --arg e "http://127.0.0.1:$S3_P" \
  '[{name:"Primary",endpoint:$e,region:"auto",bucketName:"bucket-primary",accessKeyId:"AK",secretAccessKey:"SK"}]')"

printf 'Resetting the test database schema\n'
bun "$ROOT/scripts/db-reset.mjs" > "$LOG" 2>&1 || {
  echo "db reset failed — is Postgres up on $DATABASE_URL? (docker compose -f docker-compose.dev.yml up -d)"
  tail -30 "$LOG"
  exit 1
}

printf 'Applying migrations to the fresh database\n'
(cd "$ROOT/apps/api" && bun src/migrate.ts > "$LOG" 2>&1) || {
  echo "migrations failed; see below"
  tail -30 "$LOG"
  exit 1
}

printf 'Starting the API on %s\n' "$PORT"
(cd "$ROOT/apps/api" && exec env PORT="$PORT" bun src/server.ts > "$LOG" 2>&1) &
PIDS+=($!)

for _ in $(seq 1 90); do
  [ "$(code GET /health 2>/dev/null)" = "200" ] && break
  sleep 1
done
if [ "$(code GET /health)" != "200" ]; then
  echo "dev server never came up; see below"
  tail -30 "$LOG"
  exit 1
fi
ok "dev server is up on $PORT"

EMAIL="admin@9r2.local"
PASSWORD="change-me-local-dev"
LOGIN="$(json --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')"

# ---------------------------------------------------------------------- auth

section "Auth"
expect "login with a wrong password is 401" 401 \
  "$(code POST /api/auth/login "$(json --arg e "$EMAIL" --arg p nope '{email:$e,password:$p}')")"
expect "login with a wrong email is 401" 401 \
  "$(code POST /api/auth/login "$(json --arg e someone@else.test --arg p "$PASSWORD" '{email:$e,password:$p}')")"
expect "login is 200" 200 "$(acode POST /api/auth/login "$LOGIN")"
expect_contains "the session cookie is httpOnly" "HttpOnly" \
  "$(curl -s -D - -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "$LOGIN" | grep -i '^set-cookie')"
expect "me with the cookie is 200" 200 "$(acode GET /api/auth/me)"
expect "me without the cookie is 401" 401 "$(code GET /api/auth/me)"
expect "me returns the admin email" "$EMAIL" "$(abody GET /api/auth/me | jq -r .user.email)"
USER_ID="$(abody GET /api/auth/me | jq -r .user.id)"
expect "signing in again reuses the same account" "$USER_ID" \
  "$(body POST /api/auth/login "$LOGIN" | jq -r .user.id)"

# ------------------------------------------------------------------- storage

section "Storage"
expect "storage requires a session" 401 "$(code GET /api/storage)"
expect "a seed account is created on first sign-in" 1 "$(abody GET /api/storage | jq '.buckets | length')"
expect "the seeded account is an S3 account" "s3" "$(abody GET /api/storage | jq -r '.buckets[0].kind')"
PRIMARY_ID="$(abody GET /api/storage | jq -r '.buckets[0].id')"

expect "test-connection against a live endpoint is 200" 200 \
  "$(acode POST /api/storage/accounts/test "$(account_json A "$S3_A" bucket-a)")"
expect "test-connection against a dead endpoint is 400" 400 \
  "$(acode POST /api/storage/accounts/test "$(account_json A 9 bucket-a)")"

A_ID="$(abody POST /api/storage/accounts "$(account_json "S3 A" "$S3_A" bucket-a)" | jq -r .id)"
B_ID="$(abody POST /api/storage/accounts "$(account_json "S3 B" "$S3_B" bucket-b)" | jq -r .id)"
expect "adding an S3 account returns an id" "true" "$([ -n "$A_ID" ] && [ "$A_ID" != "null" ] && echo true || echo false)"
expect "adding the same bucket twice is 409" 409 \
  "$(acode POST /api/storage/accounts "$(account_json dup "$S3_A" bucket-a)")"
expect "storage now lists three accounts" 3 "$(abody GET /api/storage | jq '.buckets | length')"
expect "quota can be set" 200 "$(acode PATCH "/api/storage/buckets/$A_ID" "$(json '{quotaBytes:1048576}')")"
expect "routing policy can be set" 200 \
  "$(acode PUT /api/storage/policy "$(json --arg id "$PRIMARY_ID" '{mode:"priority",priorityBucketIds:[$id]}')")"
expect "the policy reads back" "priority" "$(abody GET /api/storage | jq -r .routing.mode)"
expect "the seeded account has no quota by default" "null" \
  "$(abody GET /api/storage | jq -r --arg id "$PRIMARY_ID" '.buckets[] | select(.id==$id) | (.quotaBytes // "null")')"

# ------------------------------------------------------------------- folders

section "Folders"
expect "folders require a session" 401 "$(code GET /api/folders)"
FOLDER_ID="$(abody POST /api/folders "$(json --arg n Reports '{name:$n}')" | jq -r .folder.id)"
expect "creating a folder is 201" "true" "$([ -n "$FOLDER_ID" ] && [ "$FOLDER_ID" != "null" ] && echo true || echo false)"
CHILD_ID="$(abody POST /api/folders "$(json --arg n 2026 --arg p "$FOLDER_ID" '{name:$n,parentId:$p}')" | jq -r .folder.id)"
expect "folders list both" 2 "$(abody GET /api/folders | jq '.folders | length')"
expect "a bogus parent is 404" 404 "$(acode POST /api/folders "$(json --arg p nope '{name:"x",parentId:$p}')")"
expect "renaming a folder is 200" 200 "$(acode PATCH "/api/folders/$CHILD_ID" "$(json --arg n 2026-Q1 '{name:$n}')")"
expect "a folder cannot be its own parent" 400 "$(acode PATCH "/api/folders/$CHILD_ID" "$(json --arg p "$CHILD_ID" '{parentId:$p}')")"
expect "parentId filters to one level" 1 "$(abody GET "/api/folders?parentId=$FOLDER_ID" | jq '.folders | length')"
expect "parentId= lists the root" 1 "$(abody GET '/api/folders?parentId=' | jq '.folders | length')"
expect "a folder is fetchable with its children" 1 "$(abody GET "/api/folders/$FOLDER_ID" | jq '.folders | length')"
expect "a bogus folder id is 404" 404 "$(acode GET /api/folders/nope)"

# --------------------------------------------------------------------- files

section "Files"
expect "files require a session" 401 "$(code GET /api/files)"
expect "upload without a body is 411" 411 "$(acode POST /api/files)"
expect "upload without x-file-name is 400" 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/files" -H 'x-mime-type: text/plain' --data-binary 'hello')"

printf 'hello from e2e\n' > "$JAR.body"
UPLOAD="$(upload "$JAR" report.txt "$JAR.body")"
FILE_ID="$(printf '%s' "$UPLOAD" | jq -r .file.id)"
expect "upload is 201" "true" "$([ -n "$FILE_ID" ] && [ "$FILE_ID" != "null" ] && echo true || echo false)"
expect "the stored size matches" "$(wc -c < "$JAR.body" | tr -d ' ')" "$(printf '%s' "$UPLOAD" | jq -r .file.sizeBytes)"
expect "the upload landed in the priority bucket" "$PRIMARY_ID" "$(printf '%s' "$UPLOAD" | jq -r .file.bucketId)"
expect "the upload carries a sha256" "$(shasum -a 256 "$JAR.body" | cut -d' ' -f1)" \
  "$(printf '%s' "$UPLOAD" | jq -r .file.sha256)"
expect "a different file is 201" 201 "$(printf 'second file\n' > "$JAR.body2" && ustatus "$JAR" second.txt "$JAR.body2")"

# The hash is informational: identical bytes are stored as a second file, not merged.
TWIN="$(upload "$JAR" copy-of-report.txt "$JAR.body")"
TWIN_ID="$(printf '%s' "$TWIN" | jq -r .file.id)"
expect "the same bytes upload as a separate file" "true" \
  "$([ -n "$TWIN_ID" ] && [ "$TWIN_ID" != "null" ] && [ "$TWIN_ID" != "$FILE_ID" ] && echo true || echo false)"
expect "both copies share one sha256" "$(printf '%s' "$UPLOAD" | jq -r .file.sha256)" \
  "$(printf '%s' "$TWIN" | jq -r .file.sha256)"
expect "the duplicate copy is cleaned up" 200 "$(acode DELETE "/api/files/$TWIN_ID/permanent")"

expect "listing returns both files" 2 "$(abody GET /api/files | jq '.files | length')"
expect "search filters by name" 1 "$(abody GET '/api/files?q=report' | jq '.files | length')"
expect "renaming a file is 200" "renamed.txt" \
  "$(abody PATCH "/api/files/$FILE_ID" "$(json --arg n renamed.txt '{name:$n}')" | jq -r .file.name)"
expect "starring a file is 200" "true" \
  "$(abody PATCH "/api/files/$FILE_ID" "$(json '{starred:true}')" | jq -r .file.starred)"
expect "moving into a folder is 200" "$FOLDER_ID" \
  "$(abody PATCH "/api/files/$FILE_ID" "$(json --arg f "$FOLDER_ID" '{folderId:$f}')" | jq -r .file.folderId)"
expect "listing that folder returns it" 1 "$(abody GET "/api/files?folderId=$FOLDER_ID" | jq '.files | length')"
expect "folder contents include the file" 1 "$(abody GET "/api/folders/$FOLDER_ID" | jq '.files | length')"
expect "moving to a bogus folder is 404" 404 "$(acode PATCH "/api/files/$FILE_ID" "$(json '{folderId:"nope"}')")"

expect "downloading returns the bytes" "hello from e2e" "$(abody GET "/api/files/$FILE_ID/content")"
expect "a full read is 200" 200 "$(acode GET "/api/files/$FILE_ID/content")"
expect "a ranged read is 206" 206 "$(hcode "$JAR" 'Range: bytes=0-4' "/api/files/$FILE_ID/content")"
expect "the ranged read is partial" "hello" "$(hbody "$JAR" 'Range: bytes=0-4' "/api/files/$FILE_ID/content")"
expect "a suffix range is 206" 206 "$(hcode "$JAR" 'Range: bytes=-2' "/api/files/$FILE_ID/content")"
expect_contains "download sets an attachment disposition" "attachment" \
  "$(headers "$JAR" "/api/files/$FILE_ID/content?download=1" | grep -i '^content-disposition')"

section "Shares"
SHARE_URL="$(abody POST "/api/files/$FILE_ID/share" | jq -r .url)"
TOKEN="${SHARE_URL##*/f/}"
expect "sharing returns a url" "true" "$([ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo true || echo false)"
expect "sharing again reuses the link" "$SHARE_URL" "$(abody POST "/api/files/$FILE_ID/share" | jq -r .url)"
expect "the public page is readable without a session" 200 "$(code GET "/public/files/$TOKEN")"
expect "the public download returns the bytes" "hello from e2e" "$(body GET "/public/files/$TOKEN/content")"
expect "the public page names the file" "renamed.txt" "$(body GET "/public/files/$TOKEN" | jq -r .file.name)"
expect "a bogus token is 404" 404 "$(code GET /public/files/not-a-token)"
expect "the share list has one entry" 1 "$(abody GET /api/files/shared | jq '.shares | length')"
expect "revoking the share is 200" 200 "$(acode DELETE "/api/files/$FILE_ID/share")"
expect "the revoked link is 404" 404 "$(code GET "/public/files/$TOKEN")"

section "Trash"
expect "trashing is 200" 200 "$(acode DELETE "/api/files/$FILE_ID")"
expect "the file leaves the default listing" 1 "$(abody GET /api/files | jq '.files | length')"
expect "the file appears in trash" 1 "$(abody GET '/api/files?status=trash' | jq '.files | length')"
expect "a trashed file is not downloadable" 404 "$(acode GET "/api/files/$FILE_ID/content")"
expect "restoring is 200" 200 "$(acode POST "/api/files/$FILE_ID/restore")"
expect "the restored file is back" 2 "$(abody GET /api/files | jq '.files | length')"
expect "deleting a folder returns its files to root" 200 "$(acode DELETE "/api/folders/$FOLDER_ID")"
expect "the file is back at the root" "null" "$(abody GET '/api/files?q=renamed' | jq -r '.files[0].folderId')"

# ------------------------------------------------------------ moving storage

section "Moving between storage accounts"
expect "moving to the same account is 400" 400 \
  "$(acode POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$PRIMARY_ID" '{bucketId:$b}')")"
expect "moving to a bogus account is 404" 404 \
  "$(acode POST "/api/files/$FILE_ID/move-storage" "$(json '{bucketId:"nope"}')")"
expect "moving to another account is 200" 200 \
  "$(acode POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$A_ID" '{bucketId:$b}')")"
expect "the row points at the new account" "$A_ID" "$(abody GET '/api/files?q=renamed' | jq -r '.files[0].bucketId')"
expect "the bytes survived the move" "hello from e2e" "$(abody GET "/api/files/$FILE_ID/content")"
expect "a ranged read still works after the move" "hello" "$(hbody "$JAR" 'Range: bytes=0-4' "/api/files/$FILE_ID/content")"
expect "an account holding a file cannot be removed" 409 "$(acode DELETE "/api/storage/accounts/$A_ID")"
expect "moving between two S3 accounts is 200" 200 \
  "$(acode POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$B_ID" '{bucketId:$b}')")"
expect "the bytes survived the second move" "hello from e2e" "$(abody GET "/api/files/$FILE_ID/content")"
expect "moving back to the seeded account is 200" 200 \
  "$(acode POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$PRIMARY_ID" '{bucketId:$b}')")"
expect "the bytes survived the round trip" "hello from e2e" "$(abody GET "/api/files/$FILE_ID/content")"

expect "setting a tiny quota is 200" 200 "$(acode PATCH "/api/storage/buckets/$A_ID" "$(json '{quotaBytes:4}')")"
expect "moving into a full account is 409" 409 \
  "$(acode POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$A_ID" '{bucketId:$b}')")"
expect "the file stayed put after the refusal" "$PRIMARY_ID" "$(abody GET '/api/files?q=renamed' | jq -r '.files[0].bucketId')"
expect "the refused move left the content intact" "hello from e2e" "$(abody GET "/api/files/$FILE_ID/content")"
expect "an empty account can be removed" 200 "$(acode DELETE "/api/storage/accounts/$A_ID")"
expect "removing it twice is 404" 404 "$(acode DELETE "/api/storage/accounts/$A_ID")"

# ------------------------------------------------------------------ api keys

section "API keys"
expect "key management requires a session" 401 "$(code GET /api/api-keys)"
READ_KEY="$(abody POST /api/api-keys "$(json '{name:"reader",scopes:["files:read"]}')" | jq -r .secret)"
FULL_KEY="$(abody POST /api/api-keys "$(json '{name:"full",scopes:["files:read","files:write","files:delete"]}')" | jq -r .secret)"
STORAGE_KEY="$(abody POST /api/api-keys "$(json '{name:"storage",scopes:["files:read","storage:manage"]}')" | jq -r .secret)"
FULL_ID="$(abody GET /api/api-keys | jq -r '.apiKeys[] | select(.name=="full") | .id')"
expect_contains "the secret is prefixed" "9r2_" "$READ_KEY"
expect "the secret is never listed again" "null" "$(abody GET /api/api-keys | jq -r '.apiKeys[0].secret // "null"')"
expect "an empty scope list is rejected" 400 "$(acode POST /api/api-keys "$(json '{name:"x",scopes:[]}')")"

expect "a read key can list" 200 "$(kcode "$READ_KEY" GET /api/files)"
expect "a read key can download" 200 "$(kcode "$READ_KEY" GET "/api/files/$FILE_ID/content")"
expect "a read key cannot upload" 403 "$(kcode "$READ_KEY" POST /api/files)"
expect "a read key cannot delete" 403 "$(kcode "$READ_KEY" DELETE "/api/files/$FILE_ID")"
expect "a read key cannot move storage" 403 \
  "$(kcode "$READ_KEY" POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$B_ID" '{bucketId:$b}')")"
expect "a write key can move storage" 200 \
  "$(kcode "$FULL_KEY" POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$B_ID" '{bucketId:$b}')")"
expect "a write key can move it back" 200 \
  "$(kcode "$FULL_KEY" POST "/api/files/$FILE_ID/move-storage" "$(json --arg b "$PRIMARY_ID" '{bucketId:$b}')")"
expect "a key can list buckets" 200 "$(kcode "$READ_KEY" GET /api/buckets)"
expect "the bucket list carries the ids move-storage needs" "$PRIMARY_ID" \
  "$(curl -s -H "Authorization: Bearer $READ_KEY" "$BASE/api/buckets" | jq -r '.buckets[0].id')"
expect "the bucket list hides the endpoint" "null" \
  "$(curl -s -H "Authorization: Bearer $READ_KEY" "$BASE/api/buckets" | jq -r '.buckets[0].endpoint // "null"')"
expect "a key cannot touch storage accounts" 401 "$(kcode "$FULL_KEY" GET /api/storage)"
expect "a key cannot manage keys" 401 "$(kcode "$FULL_KEY" GET /api/api-keys)"
expect "a key can list folders" 200 "$(kcode "$FULL_KEY" GET /api/folders)"
expect "a read key cannot create folders" 403 "$(kcode "$READ_KEY" POST /api/folders "$(json '{name:"nope"}')")"
expect "a write key can create folders" 201 "$(kcode "$FULL_KEY" POST /api/folders "$(json '{name:"from-key"}')")"
expect "a key can read one bucket" 200 "$(kcode "$READ_KEY" GET "/api/buckets/$PRIMARY_ID")"
expect "a bogus bucket id is 404" 404 "$(kcode "$READ_KEY" GET /api/buckets/nope)"
expect "a key without storage:manage cannot add a bucket" 403 \
  "$(kcode "$FULL_KEY" POST /api/buckets "$(account_json "S3 C" "$S3_A" bucket-c)")"
C_ID="$(curl -s -H "Authorization: Bearer $STORAGE_KEY" -H 'content-type: application/json' \
  -X POST "$BASE/api/buckets" -d "$(account_json "S3 C" "$S3_A" bucket-c)" | jq -r .id)"
expect "a storage key can add a bucket" "true" "$([ -n "$C_ID" ] && [ "$C_ID" != "null" ] && echo true || echo false)"
expect "the added bucket is readable" 200 "$(kcode "$STORAGE_KEY" GET "/api/buckets/$C_ID")"
expect "deleting a bogus account over the API is 404" 404 "$(kcode "$STORAGE_KEY" DELETE /api/buckets/nope)"
expect "an empty account can be deleted over the API" 200 "$(kcode "$STORAGE_KEY" DELETE "/api/buckets/$C_ID")"
expect "deleting it twice is 404" 404 "$(kcode "$STORAGE_KEY" DELETE "/api/buckets/$C_ID")"
expect "a garbage key is 401" 401 "$(kcode 9r2_nope GET /api/files)"
expect "last_used_at is recorded" "true" \
  "$(abody GET /api/api-keys | jq -r '(.apiKeys[] | select(.name=="reader") | .lastUsedAt != null)')"
expect "revoking is 200" 200 "$(acode DELETE "/api/api-keys/$FULL_ID")"
expect "a revoked key is 401" 401 "$(kcode "$FULL_KEY" GET /api/files)"
expect "revoking twice is 404" 404 "$(acode DELETE "/api/api-keys/$FULL_ID")"

# ------------------------------------------------------------------ the rest

section "Misc"
expect "an unknown api route is 404" 404 "$(code GET /api/nope)"
expect "an unknown public route is 404" 404 "$(code GET /public/nope)"
expect "health is 200" 200 "$(code GET /health)"
expect "logging out is 200" 200 "$(acode POST /api/auth/logout)"
expect "the session is gone after logout" 401 "$(acode GET /api/auth/me)"

section "Permanent delete"
abody POST /api/auth/login "$LOGIN" > /dev/null
expect "permanent delete is 200" 200 "$(acode DELETE "/api/files/$FILE_ID/permanent")"
expect "the content is gone from storage" 404 "$(acode GET "/api/files/$FILE_ID/content")"
expect "the row is gone" 0 "$(abody GET '/api/files?status=trash' | jq '.files | length')"

# --------------------------------------------------------------------- recap

printf '\n\033[1m────────────────────────────────────────\033[0m\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m\033[1mALL GREEN\033[0m — %d checks passed\n' "$PASS"
else
  printf '\033[31m\033[1m%d FAILED\033[0m, %d passed\n' "$FAIL" "$PASS"
  for name in "${FAILED[@]}"; do printf '  - %s\n' "$name"; done
fi
printf '\033[1m────────────────────────────────────────\033[0m\n'
[ "$FAIL" -eq 0 ]
