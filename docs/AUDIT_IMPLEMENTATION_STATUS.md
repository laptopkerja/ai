# Audit & Implementasi Status (content-py2)

Dokumen ini adalah acuan bersama untuk flashback progres refactor/audit/perbaikan.

## Metadata
- Repo: `content-py2`
- Branch kerja: `dev`
- Commit implementasi audit terakhir: `4e7d1ae6`
- Tanggal update: `2026-02-25`
- Fokus: sinkron kontrak platform, stabilitas migrasi Vercel, kebersihan changeset

## Tujuan Refactor/Audit
1. Menjadikan kontrak output platform sebagai **single source of truth**.
2. Mencegah preset valid schema tetapi lemah secara kontrak platform.
3. Menurunkan risiko typo platform di editor preset.
4. Verifikasi migrasi Render -> Vercel (routing, CORS, auth) sudah sehat.
5. Menata commit agar hanya berisi perubahan inti, bukan noise build/cache.

## Status Implementasi

### Selesai
- [x] Kontrak platform disatukan ke modul bersama.
  - File: `shared/lib/platformContracts.js`
- [x] Lint preset memakai kontrak bersama (tidak hardcode terpisah).
  - File: `src/lib/presetPlatformLint.js`
- [x] Generation quality memakai kontrak bersama.
  - File: `server/lib/generationQuality.js`
- [x] Prompt hints provider memakai kontrak bersama.
  - File: `server/lib/aiProviders.js`
- [x] Validator preset sekarang menjalankan platform lint + schema validation.
  - File: `scripts/validate-presets.mjs`
- [x] Field Platform di Preset Editor diganti ke dropdown canonical list.
  - File: `src/components/PresetEditor.jsx`
- [x] Preset legacy dirapikan (CTA style + audio length) agar lolos lint.
  - File: `data/presets.json`
  - File: `public/sample-presets-format1.json`
  - File: `public/example-format-template-converted-by-script.json`
- [x] Ditambah test snapshot kontrak platform.
  - File: `tests/unit/platformContracts.snapshot.test.mjs`
- [x] Quality gate lokal lulus.
  - `npm run check:syntax` ✅
  - `npm test` (33/33) ✅
  - `node scripts/validate-presets.mjs` ✅
  - `npm run quality` ✅

### Belum / Pending
- [x] Rapikan working tree non-inti (restore dokumen yang sempat terhapus agar tidak hilang tidak sengaja).
- [x] Rapikan `.gitignore` agar standar dev/deploy lebih aman (`node_modules`, `dist`, `.vercel`, log files, dll).
- [x] Keputusan tracking `dist/`: **dist dikeluarkan dari tracking git** agar tidak menambah noise build.
- [x] Hardening `apiRuntime` agar di production tidak fallback diam-diam ke localhost jika env salah/blank.
  - File terkait: `src/lib/apiRuntime.js`
- [x] Placeholder lama `onrender.com` pada UI settings diganti ke placeholder netral Vercel.
  - File terkait: `src/pages/SettingsPage.jsx`
- [ ] Rapikan sisa perubahan UI in-progress di working tree agar deploy tidak ikut membawa perubahan yang belum final.

## Audit Migrasi Render -> Vercel

### Selesai Diverifikasi
- [x] API health endpoint aktif.
  - `GET /api/health` => `200`
- [x] Public signup policy endpoint aktif.
  - `GET /api/public/signup-policy` => `200`
- [x] Endpoint sensitif menolak request tanpa bearer token.
  - `GET /api/settings/security-posture` => `401` (expected)
  - `POST /api/generate` => `401` (expected)
- [x] CORS origin frontend resmi terbaca benar.
  - Preflight dari origin frontend => `204` + header CORS valid
- [x] SPA fallback frontend aktif (reload route React Router tidak 404).
  - `/dashboard`, `/generate`, `/history`, `/templates`, `/tmdb-finder` => `200`

### Risiko Aktif yang Harus Dipantau
- Working tree yang tidak bersih berisiko membawa perubahan tak diinginkan saat deploy.

## Ringkasan Keputusan Teknis
1. **Single Source Contract** dipusatkan di `shared/lib/platformContracts.js`.
2. Semua layer (`lint`, `quality`, `provider prompt`) wajib referensi modul shared tersebut.
3. Validasi preset wajib memblok item yang gagal platform lint (bukan hanya schema JSON).
4. Commit perbaikan audit dipisah dari perubahan UI/non-inti untuk menjaga traceability.

## Checklist Sebelum Deploy Berikutnya
- [ ] `git status` bersih (atau hanya file yang memang akan dideploy).
- [ ] `npm run quality` hijau.
- [ ] Cek env production Vercel: backend + frontend sesuai profile aktif.
- [ ] Smoke test minimal:
  - [ ] Login
  - [ ] Generate 1 konten
  - [ ] Simpan cloud
  - [ ] Cek History
  - [ ] Cek Templates
  - [ ] Cek Settings

## Catatan Commit Penting
- `4e7d1ae6` - `refactor(platform-contract): unify platform rules across lint quality and prompts`
- `a3c70512` - default provider Gemini
- `0084973b`, `05db7ea1` - SPA/Vercel route fix

## Rekomendasi Tahap Berikutnya (Prioritas)
1. P1: Bersihkan working tree & repo hygiene (`.gitignore`, keputusan `dist`).
2. P1: Hardening `apiRuntime` production fallback behavior.
3. P2: Rapikan text/placeholder deploy lama (Render -> Vercel terminology).
4. P2: Tambah smoke test script khusus Vercel production endpoint.

---
Dokumen ini harus diupdate setiap kali ada:
- audit baru,
- perubahan kebijakan deploy,
- atau refactor lintas layer (frontend/backend/shared).
