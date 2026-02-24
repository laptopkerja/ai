# GO / NO-GO Deploy ke Render (Internal Team)

Dokumen keputusan akhir deploy production ke Render untuk aplikasi internal 4 user.

## 1) Tujuan

Memastikan deploy aman, stabil, dan bisa rollback cepat jika terjadi masalah.

## 2) Gate Keputusan

## GO jika semua terpenuhi:

1. `npm run quality` lulus.
2. UAT checklist lulus untuk semua alur utama.
3. Tidak ada bug `Critical` atau `High` yang open.
4. Auth allowlist + guard endpoint aktif.
5. Primary/Backup profile Supabase tervalidasi.
6. Smoke test di staging/deploy preview lulus.

## NO-GO jika salah satu terjadi:

1. Ada bug `Critical`/`High` pada Generate/Auth/Save.
2. Endpoint sensitif bisa diakses tanpa auth.
3. Save history/cloud gagal konsisten.
4. Failover profile menimbulkan kehilangan data.

## 3) Daftar Validasi Cepat Sebelum Tombol Deploy

1. [ ] Render env backend terisi benar.
2. [ ] Render env frontend terisi benar.
3. [ ] URL API runtime di Settings tervalidasi (`Test Connection`).
4. [ ] CORS origin production sudah ditambahkan.
5. [ ] Supabase key sesuai profile yang aktif.
6. [ ] Logs server bersih dari error loop.

## 4) Smoke Test Setelah Deploy

Jalankan minimal urutan berikut:

1. Login salah satu user allowlist.
2. Generate mode Instant (dengan preset) -> berhasil.
3. Generate mode Manual -> berhasil.
4. Simpan hasil -> masuk History cloud.
5. Buka Templates -> Use template -> generate lagi.
6. Buka TMDB Finder -> pilih data -> Use Data -> generate lagi.
7. Cek Dashboard alert/kpi tidak error.

Jika salah satu gagal, tahan release dan masuk NO-GO.

## 5) Rollback Plan

Jika produksi bermasalah:

1. Kembalikan frontend ke deploy terakhir yang stabil.
2. Kembalikan backend ke deploy terakhir yang stabil.
3. Jika isu profile Supabase: switch ke profile stabil (`Primary/Backup`).
4. Matikan fitur yang jadi sumber error (sementara) via env flag bila tersedia.
5. Catat incident + root cause.

## 6) Incident Template Singkat

1. Waktu kejadian:
2. Gejala:
3. Dampak:
4. Endpoint/fitur terdampak:
5. Mitigasi cepat:
6. Akar masalah:
7. Perbaikan permanen:

## 7) Final Decision

1. Tanggal:
2. Commit/Build:
3. Keputusan: `GO / NO-GO`
4. Alasan:
5. Penanggung jawab:

## 8) Petunjuk Eksekusi Setelah Dokumen UAT Terisi

1. Buka `docs/UAT_CHECKLIST_INTERNAL_4USER.md`.
2. Pastikan semua item Preflight tercentang.
3. Pastikan bug `Critical` dan `High` = `0` open.
4. Baca ringkasan hasil (bagian akhir checklist).
5. Isi keputusan final di dokumen ini (`GO / NO-GO`).
6. Jika `GO`: deploy Render lalu jalankan smoke test pascadeploy.
7. Jika `NO-GO`: perbaiki item blocker, lalu ulangi UAT fokus area gagal.
