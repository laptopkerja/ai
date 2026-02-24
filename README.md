# AI Content Generator (React + Vite)

Quick start:

1. Copy `.env.example` → `.env` and set your Supabase and AI provider keys.
2. Setup profile env untuk switch cepat primary/backup:

```bash
copy .env .env.primary
copy .env.example .env.backup
```

Lalu isi kredensial Supabase backup di `.env.backup`.

Perintah switch:

```bash
npm run env:status
npm run env:use:primary
npm run env:use:backup
```

Setelah switch, restart dev server: `npm run dev`.
Untuk tim internal, switch juga tersedia di halaman `Settings` lewat kartu `Supabase Profile Switch`.

3. Install dependencies:

```bash
npm install
```

4. Run in development (client + mock server):

```bash
npm run dev
```

Client runs at `http://localhost:5173`. Server provides a mock `/api/generate` endpoint at `http://localhost:3000/api/generate`.

Quality gate:
```bash
npm run quality
```
This runs syntax checks, tests, build, and preset validation.

Notes:
- Do NOT put third-party AI provider keys in frontend environment variables. Put them in server environment.
- `/api/generate` will call real provider API when a valid provider key is available (user key or server fallback key).
- If no provider key is available and fallback is enabled, server returns mock generation.
- Runtime backend routing can be set from Settings page (primary override, secondary, local fallback) with connection test before save.
 
Admin endpoints (service role)
- The server now exposes protected admin endpoints under `/admin` for creating or confirming users using Supabase Service Role Key. These endpoints MUST be protected and the Service Role Key must remain server-only.

Environment variables (server-side, not committed):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
ADMIN_INTERNAL_TOKEN=some-secret-token-for-internal-api
MAX_SIGNUP_USERS=4
ENABLE_PUBLIC_SIGNUP=false
REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS=true
STRICT_SECRET_ENV_GUARD=true
SERVICE_ROLE_ROTATION_DAYS=30
SUPABASE_SERVICE_ROLE_ROTATED_AT=2026-02-22
ENFORCE_AUTH_EMAIL_ALLOWLIST=true
AUTH_ALLOWED_EMAILS=owner@example.com,user2@example.com,user3@example.com,user4@example.com
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
CORS_ALLOW_ALL_ORIGINS=false
PROVIDER_KEYS_ENC_KEY_B64=base64-32-byte-key-for-user-provider-key-encryption
ALLOW_SERVER_PROVIDER_KEY_FALLBACK=true
ENABLE_REAL_PROVIDER_CALLS=true
ALLOW_MOCK_FALLBACK_ON_PROVIDER_ERROR=false
ENABLE_SUPABASE_DUAL_WRITE=true
```

Auth note:
- Signup limit enforcement now happens on backend endpoint `POST /api/auth/sign-up` (not in frontend).
- Public signup default nonaktif (`ENABLE_PUBLIC_SIGNUP=false`) untuk mode internal team; gunakan jalur admin/invite untuk membuat user baru.
- Login/session access is restricted by backend allowlist (`AUTH_ALLOWED_EMAILS`) when `ENFORCE_AUTH_EMAIL_ALLOWLIST=true`.
- Endpoint sensitif `POST /api/generate` dan `POST /api/history/user-display-names` wajib Bearer token login valid.
- `REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS=true` adalah default produksi; untuk integration test lokal bisa override `false`.
- CORS sekarang dibatasi oleh `CORS_ALLOWED_ORIGINS` (gunakan origin frontend resmi + localhost dev yang diizinkan).
- `STRICT_SECRET_ENV_GUARD=true` akan memblokir startup server jika terdeteksi kebocoran service-role key ke env frontend (`VITE_*`).
- Monitoring rotasi key tersedia via `GET /api/settings/security-posture` dengan indikator `serviceRoleRotation`.
- If allowlist enforcement is enabled but `AUTH_ALLOWED_EMAILS` is empty, backend returns `MISCONFIGURED` until configured.
- Keep service role key server-only. Do not expose it via `VITE_*` variables.

Generation history:
- Primary storage is Supabase table `generations`.
- Client uses local fallback queue only when Supabase insert/read fails, then auto-syncs on next successful session.
- Save ke cloud menggunakan backend endpoint (`/api/generations/save`) agar bisa dual-write ke mirror profile saat `ENABLE_SUPABASE_DUAL_WRITE=true`.

Backup schema compatibility:
- Jika project backup lama belum punya kolom `key_version` di `user_provider_keys`, jalankan:
  - `scripts/alter_user_provider_keys_add_key_version.sql`
- Untuk hardening RLS/authenticated-only lintas tabel + storage avatars, jalankan:
  - `scripts/enforce_internal_rls_lockdown.sql`

API health:
- Backend exposes `GET /health` and `GET /api/health` for runtime connectivity check / failover probe.

Provider keys per user:
- Store user provider keys via backend endpoints under `/api/settings/provider-keys`.
- Keys are encrypted server-side and never returned in plaintext.
- Frontend sends Supabase bearer token; backend resolves `user_id` from token.
- Settings page has `Test` action per provider to detect available models from provider API.

Example admin calls (replace token and host):
```bash
# Create user (auto-confirm optional)
curl -X POST http://localhost:3000/admin/create-user \
	-H "Content-Type: application/json" \
	-H "x-admin-token: some-secret-token-for-internal-api" \
	-d '{"email":"user@example.com","password":"secret","confirm":true}'

# Confirm user by id
curl -X POST http://localhost:3000/admin/confirm-user \
	-H "Content-Type: application/json" \
	-H "x-admin-token: some-secret-token-for-internal-api" \
	-d '{"user_id":"<uuid>"}'

Storage (avatars)
 - The Profile UI supports uploading avatar images to a Supabase Storage bucket named `avatars`.
 - Create the bucket in Supabase Dashboard → Storage → Create bucket. For public avatars choose a public bucket or generate signed URLs.
 - If you create a private bucket, update the code to use `createSignedUrl` instead of `getPublicUrl`.

Example: create public bucket `avatars`.
```
