# Dashboard UAT Checklist

Last updated: 2026-02-22  
Target: Verifikasi cepat fitur Dashboard sebelum release.

## Prasyarat
- [ ] User sudah login (akun `authenticated`).
- [ ] API server aktif (`/api/dashboard/*` bisa diakses).
- [ ] Tabel Supabase untuk observability sudah ada:
  - `dashboard_alerts`
  - `dashboard_snapshots`
- [ ] Ada data history minimal 10+ row pada rentang 7-30 hari.

## UAT Cepat (10-15 Menit)
1. **Load Dashboard**
   - [ ] Buka halaman Dashboard.
   - [ ] KPI tampil tanpa crash.
   - [ ] Tombol `Refresh` berfungsi.

2. **Filter Scope**
   - [ ] Ubah `Window` (7/14/30 hari), data ikut berubah.
   - [ ] Ubah `Source` dan `Decision`, kartu/trend ikut berubah.
   - [ ] Klik `Reset Filter`, kembali ke default.

3. **Alert Center**
   - [ ] Tab `Open`, `Acknowledged`, `Resolved` bisa dipilih.
   - [ ] Tombol `Ack` memindahkan alert ke `Acknowledged`.
   - [ ] Tombol `Resolve` memindahkan alert ke `Resolved`.
   - [ ] Tombol `Reopen` mengembalikan alert ke `Open`.
   - [ ] Tooltip muncul pada tombol `Ack` dan `Resolve`.
   - [ ] Tombol `Buka Konteks` mengarahkan ke halaman/filter yang benar.

4. **Provider Health**
   - [ ] Badge status tampil untuk setiap provider.
   - [ ] Tooltip status muncul saat hover badge (Healthy/Ready/Idle/dll).
   - [ ] Tombol `Lihat History` membuka history dengan filter provider.

5. **Snapshot Timeline**
   - [ ] Klik `Save Snapshot`, data snapshot baru tersimpan.
   - [ ] `Latest` terupdate.
   - [ ] Delta vs snapshot sebelumnya muncul (output/GO/avg score).
   - [ ] Tombol `Refresh` memuat ulang snapshot.

6. **Drilldown ke History**
   - [ ] Dari widget dashboard, klik `Lihat History`.
   - [ ] Filter di halaman History mengikuti konteks dashboard.

7. **Export**
   - [ ] `Export JSON` menghasilkan file valid.
   - [ ] `Export CSV` menghasilkan file valid.
   - [ ] `Export Markdown` menghasilkan file valid.

8. **Persistensi Setelah Reload**
   - [ ] Reload halaman, status alert/snapshot tetap konsisten dari server.

## Kriteria Lulus
- [ ] Tidak ada error blocking di console/network untuk flow utama.
- [ ] Semua aksi penting (`Ack/Resolve/Reopen`, save snapshot, drilldown, export) berjalan.
- [ ] Data dashboard konsisten dengan filter aktif.

## Hasil UAT
- Tanggal:
- Tester:
- Environment:
- Status: `PASS / FAIL`
- Catatan:
