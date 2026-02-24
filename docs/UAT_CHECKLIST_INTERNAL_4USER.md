# UAT Checklist Internal (4 User, Akses Setara)

Dokumen ini dipakai untuk memastikan aplikasi siap deploy ke Render untuk tim internal 4 user dengan akses setara.

## Cara Pakai Cepat

1. Isi identitas 4 tester di bagian `Data Penguji`.
2. Jalankan `Preflight`.
3. Eksekusi UAT per halaman sesuai pembagian role (lihat `Rencana Sesi UAT`).
4. Catat temuan ke `Log Temuan`.
5. Tutup dengan `Sign-off`.
6. Ambil keputusan final di `docs/GO_NO_GO_RENDER.md`.

## 1) Scope UAT

Fitur wajib diuji:

1. Dashboard
2. Generate
3. History
4. Templates
5. TMDB Finder
6. Auth + Security Guard + Failover

## 2) Data Penguji

Isi 4 akun yang memang diizinkan login:

1. User A: `________________`
2. User B: `________________`
3. User C: `________________`
4. User D: `________________`

## 2.1) Pembagian Peran UAT (Disarankan)

1. User A (Lead): Preflight, Security, final sign-off.
2. User B: Generate + TMDB Finder.
3. User C: History + Templates.
4. User D: Dashboard + Failover smoke.

## 2.2) Rencana Sesi UAT (60-90 menit)

1. Sesi 1 (10 menit): Preflight + validasi auth/cors/allowlist.
2. Sesi 2 (30 menit): UAT halaman inti.
3. Sesi 3 (15 menit): Failover + retest bug medium/high.
4. Sesi 4 (10 menit): Rekap hasil + keputusan GO/NO-GO.

## 3) Preflight (Wajib Lulus)

Checklist:

1. [ ] `npm run quality` lulus.
2. [ ] `.env`, `.env.primary`, `.env.backup` terisi valid.
3. [ ] Email allowlist aktif (hanya 4 user).
4. [ ] Public signup nonaktif.
5. [ ] CORS sudah terbatas ke origin resmi + localhost dev.
6. [ ] Endpoint sensitif butuh bearer token (tanpa token -> 401).

Catatan bukti (link/screenshot/log):

- ______________________________________

Perintah minimal yang dijalankan:

```bash
npm run quality
```

Hasil ringkas:

1. Status: `PASS / FAIL`
2. Waktu selesai:
3. Catatan:

## 4) UAT Per Halaman

### A. Dashboard

1. [ ] KPI tampil tanpa error.
2. [ ] Filter dashboard berfungsi.
3. [ ] Alert Center: `Ack` dan `Resolve` berfungsi.
4. [ ] Provider Health status tampil benar.
5. [ ] Tidak ada error merah di console saat refresh dashboard.

Bukti:

1. Screenshot kartu KPI
2. Screenshot Alert Center
3. Console bersih

### B. Generate

1. [ ] Mode Instant generate sukses.
2. [ ] Mode Manual generate sukses.
3. [ ] Generate Variations sesuai jumlah.
4. [ ] Upload/paste URL/paste image berfungsi (maks 5).
5. [ ] Pilihan provider/model berfungsi.
6. [ ] Jika TMDB aktif, payload strict terbaca dan dipakai.
7. [ ] Tombol Simpan menyimpan ke cloud sesuai aturan.
8. [ ] Jika gagal provider/API, error message jelas (tidak silent fail).

Bukti:

1. Screenshot hasil Instant
2. Screenshot hasil Manual
3. Screenshot hasil TMDB -> Generate

### C. History

1. [ ] Data cloud tampil.
2. [ ] Draft lokal tampil (jika ada).
3. [ ] Search/filter/sort berfungsi.
4. [ ] Pagination konsisten dengan page size.
5. [ ] Aksi Gunakan/Duplikat/Hapus/View berfungsi.
6. [ ] Bulk action berfungsi.
7. [ ] Delete ada konfirmasi dan tidak rawan salah klik.

Bukti:

1. Screenshot filter aktif
2. Screenshot pagination
3. Screenshot aksi bulk

### D. Templates

1. [ ] Buat template baru sukses.
2. [ ] Edit template sukses.
3. [ ] Clone template sukses.
4. [ ] Riwayat versi tampil.
5. [ ] Publish sesuai mode tim (shared untuk user login tim).
6. [ ] Use template ke Generate sukses.
7. [ ] Autofix hanya muncul saat preset bermasalah.

Bukti:

1. Screenshot create/edit template
2. Screenshot version history
3. Screenshot use template ke generate

### E. TMDB Finder

1. [ ] Search TMDB by judul/ID sukses.
2. [ ] Browse kategori + pagination sukses.
3. [ ] Pilih kandidat -> detail termuat.
4. [ ] Scope TV (`Series/Season/Episode`) valid.
5. [ ] Fact Locks konsisten media type:
   - TV: tanpa `budget/revenue`
   - Movie: tanpa `networks`
6. [ ] Payload Preview strict sesuai data pilihan.
7. [ ] Apply & Hold / Use Data ke Generate sukses.

Bukti:

1. Screenshot kandidat + detail TMDB
2. Screenshot Payload Preview strict
3. Screenshot data berhasil dipakai di halaman Generate

## 5) UAT Keamanan (Internal 4 User)

1. [ ] Email di luar allowlist gagal login.
2. [ ] Request endpoint sensitif tanpa token ditolak.
3. [ ] API key provider tidak pernah tampil full setelah disimpan.
4. [ ] User key terenkripsi server-side.
5. [ ] Tidak ada endpoint data mapping user yang terbuka tanpa auth.

Bukti:

1. Screenshot login ditolak untuk email non-allowlist
2. Log response 401 untuk endpoint sensitif tanpa token

## 6) UAT Failover

1. [ ] Primary aktif, backup ready.
2. [ ] Simulasi switch ke backup berhasil.
3. [ ] Generate + save tetap jalan di backup profile.
4. [ ] Kembali ke primary tanpa error.
5. [ ] Data penting tidak hilang pada skenario switch.

Bukti:

1. Screenshot status profile switch
2. Screenshot generate+save saat profile backup
3. Screenshot kembali ke primary

## 7) Kriteria Lulus

UAT dinyatakan lulus jika:

1. Semua item critical/high = lulus.
2. Tidak ada blocker untuk alur utama.
3. Tidak ada error console/server berulang pada alur inti.

## 8) Log Temuan

Gunakan format:

1. ID: `BUG-___`
2. Severity: `Critical/High/Medium/Low`
3. Halaman: `Dashboard/Generate/History/Templates/TMDB`
4. Langkah reproduksi: `...`
5. Hasil aktual: `...`
6. Hasil harapan: `...`
7. Status: `Open/In Progress/Done`

Template tabel (copy-paste):

| ID | Severity | Halaman | Repro | Aktual | Harapan | Status | Owner |
|---|---|---|---|---|---|---|---|
| BUG-001 | High | Generate | ... | ... | ... | Open | User B |

## 9) Sign-off

1. Tester A: `__________` Tanggal: `__________`
2. Tester B: `__________` Tanggal: `__________`
3. Tester C: `__________` Tanggal: `__________`
4. Tester D: `__________` Tanggal: `__________`
5. Owner Release: `__________` Keputusan: `GO / NO-GO`

## 10) Ringkasan Hasil (Isi Setelah UAT)

1. Total temuan: `_____`
2. Critical open: `_____`
3. High open: `_____`
4. Medium open: `_____`
5. Low open: `_____`
6. Rekomendasi: `GO / NO-GO`
