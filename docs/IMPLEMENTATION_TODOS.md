# Implementation TODO Tracker

Last updated: 2026-02-22
Owner: Codex + User

## Rules
- Gunakan checklist:
  - `[ ]` belum dikerjakan
  - `[~]` sedang dikerjakan
  - `[x]` selesai
- Setiap kali ada perubahan status, update bagian `Progress Log`.
- Kerjakan berdasarkan prioritas dari atas ke bawah kecuali ada arahan baru.

## Phase 0 - Discovery (Completed)
- [x] Scan total project dari root
- [x] Mapping struktur folder dan alur runtime utama
- [x] Identifikasi gap utama arsitektur dan kualitas

## Phase 1 - Core Stabilization (High Priority)
- [x] Stabilkan source of truth preset (server-first; localStorage hanya fallback/caching)
- [x] Standarisasi kontrak `POST /api/generate` (manual vs preset)
- [x] Validasi server-side konsisten untuk mode manual dan preset
- [x] Rapikan format error API agar konsisten dipakai frontend

## Phase 2 - Shared Logic Refactor
- [x] Pindahkan logic bersama ke modul shared (normalizer, overrides, compiler, validator)
- [x] Hentikan coupling server import langsung dari `src/*`
- [x] Pastikan behavior FE/BE tetap sama setelah refactor

## Phase 3 - Security & Auth Hardening
- [x] Pindahkan limit signup (max user) dari frontend ke backend
- [x] Rapikan environment variables (secret hanya server-side, tanpa prefix `VITE_*`)
- [x] Review dan harden endpoint `/admin/*` (auth token, error exposure, logging)

## Phase 4 - Persistence & Data Consistency
- [x] Jadikan Supabase `generations` sebagai storage utama history
- [x] Tetapkan localStorage hanya untuk fallback/offline sementara
- [x] Sinkronkan write/read history agar konsisten lintas sesi

## Phase 5 - Testing
- [x] Unit test: `normalizePreset`
- [x] Unit test: `normalizeManual`
- [x] Unit test: `applyOverrides`
- [x] Unit test: `promptCompiler`
- [x] Unit test: `validateTemplate`
- [x] Integration test: `POST /api/generate` (manual success)
- [x] Integration test: `POST /api/generate` (preset success)
- [x] Integration test: invalid override / invalid payload

## Phase 6 - Cleanup & Quality Gate
- [x] Cleanup file/script duplikat yang tidak dipakai
- [x] Tambahkan script quality check (`lint`, `test`, optional `format:check`)
- [x] Final pass untuk konsistensi naming, error messages, dan dokumentasi

## Vision Rollout (2026-02-20)
### Phase 1 - Vision Capability Audit
- [x] Audit provider vision capability berdasarkan docs resmi + kondisi kode saat ini
- [x] Dokumentasikan matriks provider/model yang siap vision vs belum
- [x] Tetapkan gap implementasi yang akan ditangani di Phase 2

### Phase 2 - Core Backend Vision
- [x] Implement payload multimodal nyata untuk provider prioritas (OpenAI, Gemini, OpenRouter)
- [x] Tambahkan validasi model non-vision saat imageReferences dikirim

### Phase 3 - Model Capability Metadata
- [x] Tambahkan field `supportsVision` pada hasil deteksi model
- [x] Simpan dan konsumsi metadata capability di frontend

### Phase 4 - Generate UI Integration
- [x] Prioritaskan model vision saat referensi gambar ada
- [x] Tampilkan indikator status `Vision ON/OFF` di halaman generate

### Phase 5 - Guardrail & Fallback
- [x] Error message jelas saat provider/model tidak mendukung vision
- [x] Fallback terkontrol untuk provider yang belum diaktifkan vision adapter

### Phase 6 - Test & Docs
- [ ] Tambah unit/integration tests untuk jalur vision success/failure
- [ ] Update dokumentasi penggunaan mode gambar pada Standard dan Instant

## Quality Hardening Rollout (2026-02-20)
### Phase 1 - Prompt Contract
- [x] Perketat kontrak output provider (khususnya `audioRecommendation` format referensi musik)
- [x] Turunkan randomness provider call untuk konsistensi output

### Phase 2 - Backend Guardrails
- [x] Terapkan validator + sanitizer forbidden words/spam/scam/suspense di backend
- [x] Terapkan fallback rewrite untuk `audioRecommendation` jika format tidak valid/dialog

### Phase 3 - Scoring
- [x] Hitung `qualityScore`, `qualityGate`, dan `qualityChecks` di `result.meta`
- [x] Simpan ringkasan score ke payload history (via `result`)

### Phase 4 - UI Exposure
- [x] Tampilkan score/gate/checks pada hasil generate
- [x] Tampilkan score ringkas pada daftar history

### Phase 5 - Test & Quality Gate
- [x] Tambahkan unit test guardrails (`generationQuality`)
- [x] Tambahkan assertion integration untuk metadata quality di `/api/generate`
- [x] Update `check:syntax` agar mencakup modul quality baru

## Platform 17 Audit Rollout (2026-02-26)
### Phase 1 - Plan & Baseline
- [x] Buat dokumen rencana audit pass/fail 17 platform.
- [x] Buat dokumen status implementasi (sudah vs belum) dengan evidence file.

### Phase 1B - Real Metrics Foundation
- [x] Tambah benchmark performa real per platform (retention/CTR/ranking live).
- [x] Tambah evaluator + agregator verdict performa real platform.
- [x] Tambah endpoint ingest/summary/benchmark performa real.
- [x] Tambah SQL migration tabel `platform_performance_metrics`.
- [x] Tambah unit + integration test untuk performa real platform.

### Phase 2 - Automated Matrix
- [x] Tambah runner audit otomatis untuk matrix 17 platform x allowed length.
- [x] Implement assertion rubric lengkap (contract, guardrail, decision, final score).

### Phase 3 - Reporting & Gate
- [x] Tambah report exporter (`JSON`, `CSV`, `Markdown`) untuk hasil audit 17 platform.
- [x] Tambah command `npm run audit:platform17`.
- [x] Integrasikan verdict `17/17 PASS` ke quality gate.

## Priority Lockdown (Internal Team 4 User)
### Security Perimeter (Point 1-6)
- [x] Batasi login hanya 4 email allowlist team (hard reject di backend auth flow).
- [x] Nonaktifkan signup publik setelah 4 akun aktif (invite/manual only).
- [x] Wajib autentikasi untuk endpoint sensitif: `POST /api/generate` dan `POST /api/history/user-display-names`.
- [x] Kunci CORS ke origin frontend resmi + origin localhost development yang diizinkan.
- [x] Audit dan paksa RLS `authenticated-only` pada tabel/storage yang dipakai aplikasi (tanpa tabel `UNRESTRICTED` untuk data app).
- [x] Pastikan `SUPABASE_SERVICE_ROLE_KEY` hanya di backend, rotasi key aktif, dan tidak pernah terekspos ke frontend/log client.

### Data Accuracy + UX Internal (Temuan #3-#6)
- [x] Ubah history cloud ke pagination server-side murni (`range/limit/offset` + total count) agar page akurat pada data besar.
- [x] Perbaiki KPI dashboard agar tidak bias limit 500 (query agregasi server-side per window/filter).
- [x] Ubah logika `seen` Alert Center menjadi event unik (jangan naik hanya karena refresh/sync berulang).
- [x] Benahi kolom Owner di Settings agar provider yang belum ada key tetap tampil `Not configured` (tidak misleading).

## Progress Log
- 2026-02-19: Membuat tracker TODO implementasi (`docs/IMPLEMENTATION_TODOS.md`).
- 2026-02-19: Phase 1 selesai diimplementasikan pada backend dan frontend.
- 2026-02-19: Phase 2 selesai, logic inti dipindah ke `shared/` dan server tidak lagi bergantung pada `src/`.
- 2026-02-19: Phase 3 selesai, signup limit dipindahkan ke backend dan admin endpoints di-hardening.
- 2026-02-19: Phase 4 selesai, persistence history diprioritaskan ke Supabase dengan fallback queue lokal + auto-sync.
- 2026-02-19: Phase 5 selesai, unit + integration tests ditambahkan dan lulus.
- 2026-02-19: Phase 6 selesai, cleanup script duplikat + quality gate terpasang dan lulus.
- 2026-02-20: Vision Rollout Phase 1 selesai, hasil audit disimpan di `docs/VISION_PHASE1_AUDIT.md`.
- 2026-02-20: Vision Rollout Phase 2 selesai (backend multimodal OpenAI/Gemini/OpenRouter + validasi model non-vision + integration test baru).
- 2026-02-20: Vision Rollout Phase 3 selesai (`supportsVision` di model detection + frontend consume di Generate/Settings + unit test inferensi).
- 2026-02-20: Vision Rollout Phase 4 selesai (auto-prioritas model vision saat ada referensi gambar + indikator `Vision ON/OFF` di Generate).
- 2026-02-20: Vision Rollout Phase 5 selesai (error message vision lebih jelas + fallback terkontrol untuk provider non-vision-adapter + warning tampil di result).
- 2026-02-20: Update model discovery UX: `freeOnly` disimpan per provider (persist), Generate auto `freeOnly=false` saat ada referensi gambar, dan deteksi vision OpenRouter memprioritaskan metadata modalitas.
- 2026-02-20: Quality hardening selesai: kontrak prompt audio diperketat, backend guardrails + fallback rewrite aktif, score/gate/checks tampil di Result dan History, serta test + syntax check diperbarui.
- 2026-02-20: Scoring model di-upgrade ke gate model (`Compliance`, `Performance Potential`, `AI Decision`, `Final Score`) + enforce kontrak `Audio 5-field` dan `Narrator Scene-by-length`.
- 2026-02-21: Preset storage dipindah ke Supabase per-user (`user_presets`, `user_preset_versions`, `user_preset_workflows`) + endpoint workflow/version/rollback + frontend auth wiring.
- 2026-02-21: `Published` preset sekarang menjadi publik lintas user login melalui tabel `public_preset_catalog` (view/use/clone oleh user lain, edit/hapus tetap owner-only).
- 2026-02-21: Refactor preset ke mode team shared: source of truth tunggal `team_presets`, versioning `team_preset_versions` (retensi 20), metadata `title` + display name creator/editor/clone, frontend Templates disederhanakan (tanpa draft/published).
- 2026-02-22: Tambah dokumen UAT Dashboard (`docs/DASHBOARD_UAT_CHECKLIST.md`) untuk verifikasi release cepat 10-15 menit.
- 2026-02-22: Tambah failover API runtime (primary/secondary/local fallback) + health endpoint (`/health`) + Settings UI "Backend Routing" dengan alur test sebelum save.
- 2026-02-22: Tambah hardening import lintas Supabase project (drop auth-user FK constraints script + update migration agar portable saat restore backup).
- 2026-02-22: Tambah hard-block kontrak preset saat generate (`PRESET_CONTRACT_REJECTED`) + integration test untuk memastikan alasan reject dan arahan edit/hapus selalu tersedia.
- 2026-02-22: Tambah backlog TODO prioritas: 6 point security perimeter + 4 point perbaikan akurasi data/UX internal.
- 2026-02-22: Selesai point #1 security perimeter: backend enforce email allowlist (`AUTH_ALLOWED_EMAILS`) pada signup + sesi auth API, plus preflight check setelah login frontend.
- 2026-02-22: Selesai point #2 security perimeter: signup publik dimatikan by default (`ENABLE_PUBLIC_SIGNUP=false`), UI auth auto-hide Sign Up, alur user baru via admin/invite.
- 2026-02-22: Selesai point #3 security perimeter: endpoint sensitif `/api/generate` dan `/api/history/user-display-names` sekarang wajib Bearer token valid.
- 2026-02-22: Selesai point #4 security perimeter: CORS backend dikunci via `CORS_ALLOWED_ORIGINS` (default fallback ke localhost dev), tanpa wildcard di production.
- 2026-02-22: Selesai point #5 security perimeter: tambah hardening SQL `scripts/enforce_internal_rls_lockdown.sql`, update policy avatar bucket private own-folder, dan update client avatar ke signed URL.
- 2026-02-22: Selesai point #6 security perimeter: tambah guard kebocoran service-role env (`STRICT_SECRET_ENV_GUARD`) + endpoint posture (`/api/settings/security-posture`) + metadata rotasi key.
- 2026-02-22: Selesai perbaikan UX internal #4: owner provider key yang belum configured tidak lagi terisi display name actor, UI menampilkan `Not configured`.
- 2026-02-22: Selesai perbaikan akurasi #3: source `Supabase` di History kini pagination server-side (`range + count exact`), termasuk fallback aman untuk sort score/decision client-side.
- 2026-02-22: Selesai perbaikan akurasi #4: dashboard cloud fetch sekarang paginated full window (tanpa hard limit 500), sehingga KPI tidak bias pada dataset besar.
- 2026-02-22: Selesai perbaikan UX internal #5: sync Alert Center kini hanya menambah `seen/count` untuk event unik/perubahan nyata (refresh berulang tidak lagi menaikkan count).
- 2026-02-26: Menambahkan dokumen rencana audit 17 platform (`docs/PLATFORM_17_AUDIT_PLAN.md`) dan status implementasi (`docs/PLATFORM_17_AUDIT_STATUS.md`), serta menambahkan rollout checklist audit 17 platform di tracker ini.
- 2026-02-26: Menambahkan fondasi performa real platform: benchmark shared, evaluator backend, endpoint ingest/summary/benchmark, SQL migration `platform_performance_metrics`, dan test unit+integration terkait.
- 2026-02-26: Menuntaskan Platform 17 Audit end-to-end: matrix runner + checklist 12 item, API smoke per platform, exporter report `JSON/CSV/Markdown`, command `npm run audit:platform17`, CI gate GitHub, dan hasil terbaru `17/17 PASS`.

## Notes
- Jika prioritas berubah, update urutan phase di file ini (jangan simpan hanya di chat).
- Setelah setiap task selesai, tandai checklist dan tambahkan 1 baris ringkas di `Progress Log`.
