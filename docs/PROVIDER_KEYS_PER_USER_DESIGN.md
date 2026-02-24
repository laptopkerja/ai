# Provider Key Per User (Encrypted, Server-Only)

## Scope
- User dapat menyimpan API key provider sendiri (OpenAI, Gemini, dll).
- API key tidak pernah disimpan di frontend/localStorage.
- Frontend hanya kirim key ke backend via HTTPS + bearer token.
- Backend simpan key terenkripsi dan hanya backend yang decrypt saat generate.

## Existing Project Fit
- Frontend settings page saat ini masih placeholder: `src/pages/SettingsPage.jsx`.
- Generate sudah kirim `provider` dan `model`: `src/components/GenerateForm.jsx`.
- Backend entrypoint generate: `server/index.js` (`POST /api/generate`).
- Pola respons backend sudah standar: `sendOk` / `sendError` di `server/index.js`.

## Data Model (Supabase)
Gunakan tabel baru, jangan simpan key di `auth.user_metadata`.

```sql
create table if not exists public.user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  key_ciphertext text not null,
  key_iv text not null,
  key_tag text not null,
  key_version smallint not null default 1,
  key_last4 varchar(8) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_provider unique (user_id, provider),
  constraint chk_provider_name check (
    provider in ('OpenAI', 'Gemini', 'OpenRouter', 'Groq', 'Cohere AI', 'DeepSeek', 'Hugging Face')
  )
);

create index if not exists idx_user_provider_keys_user_id
  on public.user_provider_keys(user_id);

create index if not exists idx_user_provider_keys_active
  on public.user_provider_keys(user_id, provider, is_active);
```

`updated_at` trigger:

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_provider_keys_updated_at on public.user_provider_keys;
create trigger trg_user_provider_keys_updated_at
before update on public.user_provider_keys
for each row execute procedure public.set_updated_at();
```

RLS (defensive):

```sql
alter table public.user_provider_keys enable row level security;

-- Defensive policy: block anon/authenticated direct access from client.
drop policy if exists "deny_all_user_provider_keys" on public.user_provider_keys;
create policy "deny_all_user_provider_keys"
on public.user_provider_keys
for all
using (false)
with check (false);
```

Catatan:
- Service role tetap bisa akses tabel (bypass RLS).
- Ini memaksa semua operasi lewat backend.

## Encryption Design
Pakai application-level encryption (Node `crypto`, AES-256-GCM).

Env:
- `PROVIDER_KEYS_ENC_KEY_B64` (base64 dari 32-byte key).

Store:
- `key_ciphertext` (base64)
- `key_iv` (base64, 12-byte nonce)
- `key_tag` (base64, GCM auth tag)
- `key_version` (untuk future key rotation)
- `key_last4` (4-8 karakter terakhir plaintext key untuk tampilan mask)

Rule:
- Jangan log plaintext key.
- Jangan pernah return plaintext ke frontend.
- Decrypt hanya di memory pada saat request generate.

## API Contract
Semua endpoint di bawah butuh `Authorization: Bearer <supabase_access_token>`.
Backend harus resolve user dari token lalu gunakan `user.id`.

### 1) GET `/api/settings/provider-keys`
Tujuan: daftar status key yang sudah tersimpan (masked).

Response 200:
```json
{
  "ok": true,
  "data": [
    {
      "provider": "OpenAI",
      "configured": true,
      "keyLast4": "A1B2",
      "isActive": true,
      "updatedAt": "2026-02-20T09:12:00.000Z"
    }
  ]
}
```

### 2) POST `/api/settings/provider-keys`
Tujuan: create/update key provider.

Request:
```json
{
  "provider": "OpenAI",
  "apiKey": "sk-xxxxxx",
  "isActive": true
}
```

Response 200:
```json
{
  "ok": true,
  "data": {
    "provider": "OpenAI",
    "configured": true,
    "keyLast4": "A1B2",
    "isActive": true,
    "updatedAt": "2026-02-20T09:15:00.000Z"
  }
}
```

Validation minimum:
- `provider` wajib dan harus enum yang didukung.
- `apiKey` wajib, trim, panjang aman (mis. 16-512).
- Optional provider-specific regex boleh longgar (agar tidak sering false reject).

### 3) DELETE `/api/settings/provider-keys/:provider`
Tujuan: hapus key provider user.

Response 200:
```json
{
  "ok": true,
  "data": {
    "provider": "OpenAI",
    "deleted": true
  }
}
```

### 4) PATCH `/api/settings/provider-keys/:provider/active`
Tujuan: enable/disable key tanpa hapus.

Request:
```json
{
  "isActive": false
}
```

Response 200:
```json
{
  "ok": true,
  "data": {
    "provider": "OpenAI",
    "isActive": false
  }
}
```

## Error Contract
Ikuti pola error backend sekarang:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "provider is required"
  }
}
```

Kode error yang dipakai:
- `UNAUTHORIZED` (401)
- `VALIDATION_ERROR` (400)
- `NOT_FOUND` (404)
- `KEY_NOT_CONFIGURED` (400)
- `INTERNAL_ERROR` (500)

## Integration to `/api/generate`
Aturan resolve key:
1. Ambil `provider` dari payload generate.
2. Resolve user dari bearer token.
3. Cari key aktif milik user pada provider tersebut.
4. Jika ada: decrypt dan pakai key user.
5. Jika tidak ada:
   - dev mode: boleh fallback ke env server key provider.
   - production: default reject `KEY_NOT_CONFIGURED`.

Tambahan metadata response generate (opsional, non-sensitive):
- `meta.keySource = "user" | "server_fallback"`

## Frontend Settings UX (MVP)
Di `src/pages/SettingsPage.jsx`:
- Section "Provider Keys".
- Dropdown provider + input key + Save.
- List key status per provider (Configured / Not configured, masked last4).
- Toggle active + Delete key.
- Tidak ada fitur "show full key".

## Security Checklist
- HTTPS only.
- Rate limit endpoint settings key.
- Redact secret di log/error.
- Jangan kirim key ke analytics/event tracker.
- CORS ketat.
- Service role key tetap server-only (tidak pernah `VITE_*`).

## Incremental Implementation Plan
1. Buat migration SQL `user_provider_keys`.
2. Tambah util `server/lib/crypto-provider-keys.js` (encrypt/decrypt).
3. Tambah auth middleware user dari bearer supabase token.
4. Tambah route `/api/settings/provider-keys*`.
5. Integrasikan resolver key ke provider adapter saat generate.
6. Update `SettingsPage` untuk CRUD key.
7. Tambah test endpoint validation + generate key resolution.

## SQL Update For Existing Table (Add Groq)
Jika tabel sudah terlanjur dibuat sebelum provider `Groq` ditambahkan:

```sql
alter table public.user_provider_keys
drop constraint if exists chk_provider_name;

alter table public.user_provider_keys
add constraint chk_provider_name check (
  provider in ('OpenAI', 'Gemini', 'OpenRouter', 'Groq', 'Cohere AI', 'DeepSeek', 'Hugging Face')
);
```
