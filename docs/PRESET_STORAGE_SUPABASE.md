# Preset Storage Supabase

Dokumen ini menjelaskan storage preset mode **team shared** (bukan lagi per-user + publish).

## 1) SQL yang wajib dijalankan

Jalankan script berikut di **Supabase SQL Editor**:

`scripts/create_preset_storage_tables.sql`

Script ini membuat/menyesuaikan tabel:
- `public.team_presets`
- `public.team_preset_versions`

Struktur metadata utama di `team_presets`:
- `title` (judul preset untuk tampilan tabel)
- `created_by_display_name`
- `updated_by_display_name`
- `last_action` (`create|edit|clone|import|rollback|seed`)
- `last_cloned_from_preset_id`

## 2) Environment backend

Pastikan backend punya env:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Tanpa dua env ini, endpoint preset akan fallback lokal atau mengembalikan error konfigurasi.

Opsional:
- `TEAM_PRESET_VERSION_LIMIT` (default `20`) untuk retensi snapshot per preset.

## 3) Endpoint yang dipakai frontend

- `GET /api/presets`
- `GET /api/presets/:id`
- `POST /api/presets`
- `PATCH /api/presets/:id`
- `DELETE /api/presets/:id`
- `GET /api/presets/:id/versions`
- `POST /api/presets/:id/rollback`

Mutasi endpoint menggunakan bearer token user login.

## 4) Model akses

- Semua user login tim melihat preset yang sama (single source of truth).
- Tidak ada status draft/published/public.
- Versioning tetap ada via `team_preset_versions` dengan retensi terbatas.
