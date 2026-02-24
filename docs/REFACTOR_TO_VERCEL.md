# Refactor To Vercel - Guardrail Wajib

Dokumen ini adalah kontrak kerja refactor agar migrasi ke Vercel aman, terukur, dan tidak mengganggu fitur yang sudah stabil.

## 1) Tujuan

- Menyiapkan deploy backend + frontend ke Vercel.
- Menjaga perilaku aplikasi tetap sama bagi 4 user internal.
- Meminimalkan risiko bug dengan commit bertahap dan quality gate ketat.

## 2) Aturan Invarian (Tidak Boleh Dilanggar)

1. Perubahan hanya pada layer deploy adapter (Vercel), bukan logika bisnis utama.
2. Kontrak API existing harus tetap sama (`/api/*` request/response shape tidak berubah).
3. UI/UX fungsional existing harus tetap sama (Dashboard, Generate, History, Templates, TMDB Finder, Settings, Profile).
4. Tidak boleh menurunkan proteksi keamanan yang sudah ada (auth guard, allowlist, encryption, CORS policy).
5. Semua secret tetap server-only, tidak boleh masuk `VITE_*` selain yang memang public frontend.

## 3) Ruang Lingkup Perubahan yang Diizinkan

- Menambah file adapter deploy:
  - `vercel.json`
  - `api/index.js` (entry serverless)
- Refactor bootstrap backend:
  - pisah `app` dari `listen()`
  - `listen()` hanya untuk local runtime
- Penyesuaian env untuk Vercel (tanpa ubah business rules).
- Penyesuaian rewrite SPA frontend untuk route React.

## 4) Perubahan yang Dilarang (Kecuali Ada Persetujuan Eksplisit)

- Mengubah scoring, validator, prompt contract, dan rules generate.
- Mengubah schema/flow data utama Supabase.
- Mengubah endpoint name, payload contract, atau status code behavior yang dipakai frontend.
- Menghapus fitur existing untuk "mempermudah deploy".

## 5) Strategi Commit Aman (Wajib Bertahap)

Gunakan urutan berikut:

1. `refactor(server): export express app and guard local listen`
2. `feat(vercel): add serverless entry adapter`
3. `feat(vercel): add routing config and SPA rewrites`
4. `chore(env): document vercel env mapping`
5. `test: run quality gate after adapter changes`

Setiap commit harus kecil, fokus, dan bisa rollback sendiri.

## 6) Quality Gate Per Tahap

Sebelum lanjut ke tahap berikutnya, wajib lulus:

1. `npm run check:syntax`
2. `npm run test`
3. `npm run build`
4. Smoke test manual minimum:
   - Login
   - Generate (manual + instant)
   - Save ke history cloud
   - Settings load
   - Templates load

Jika salah satu gagal: stop, perbaiki dulu, baru lanjut.

## 7) Checklist Anti Kelupaan

### A. Backend Adapter

- [ ] `app` diexport untuk serverless
- [ ] `listen()` hanya aktif saat local
- [ ] semua route `/api/*` tetap tersedia
- [ ] CORS production mengizinkan origin frontend Vercel

### B. Frontend Deploy

- [ ] build output `dist` valid
- [ ] SPA rewrite ke `index.html` aktif
- [ ] `VITE_API_URL` menunjuk backend Vercel

### C. Security

- [ ] `SUPABASE_SERVICE_ROLE_KEY` tidak pernah ada di frontend
- [ ] `PROVIDER_KEYS_ENC_KEY_B64` hanya di backend
- [ ] allowlist email tetap aktif untuk mode internal

## 8) Definisi Selesai (Definition of Done)

Refactor dianggap selesai jika:

1. Seluruh quality gate lulus.
2. Tidak ada perubahan perilaku bisnis utama.
3. Deploy Vercel backend + frontend sukses.
4. UAT internal 4 user untuk flow inti lulus.
5. Dokumen ini tetap valid dan terpenuhi seluruh checklist.

## 9) Rollback Plan

Jika production issue muncul:

1. rollback ke commit terakhir yang lulus quality gate
2. nonaktifkan auto deploy sementara
3. lakukan hotfix kecil di layer adapter saja
4. verifikasi ulang full gate sebelum redeploy

---

Dokumen ini menjadi acuan bersama selama refactor ke Vercel berlangsung.
