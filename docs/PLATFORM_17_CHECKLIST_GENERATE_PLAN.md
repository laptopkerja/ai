# Rencana Implementasi Structured Checklist Generate (17 Platform)

Last updated: 2026-02-27  
Owner: Codex + User

## Tujuan
- Membuat fitur checklist terstruktur di halaman Generate agar input jadi terukur, bukan hanya teks bebas.
- Menjaga mode `Instant + Preset` tetap simpel, sambil menambah guardrail per platform.
- Menyediakan gate `PASS/FAIL` sebelum generate agar kualitas input konsisten lintas 17 platform.

## Scope Platform
1. TikTok
2. YouTube Short
3. YouTube Long
4. Shopee
5. Tokopedia
6. Lazada
7. Instagram Reels
8. Facebook Reels
9. Pinterest
10. WhatsApp Status
11. Threads
12. WhatsApp Channel
13. Telegram
14. LinkedIn
15. X (Twitter)
16. SoundCloud
17. Blog Blogger

## Scope Domain/Kategori
- General
- Beauty / Affiliate
- Movie / TV (TMDB)
- Blog / SEO
- Gadget
- Fashion

## Prinsip Desain
- `Preset` tetap jadi kontrak utama output.
- `Checklist` jadi input terstruktur tambahan yang bisa divalidasi.
- `Topik/Ide + Referensi Gambar` tetap dipakai untuk konteks fleksibel.
- Jika checklist `OFF`, behavior lama tidak berubah.

## Daftar Upgrade
- [x] U1. Tambah toggle `Checklist Terstruktur (Opsional)` di Generate.
- [x] U2. Tambah domain checklist dinamis (General, Beauty, Movie/TV, Blog/SEO, Gadget, Fashion).
- [x] U3. Inject checklist ke prompt untuk mode Standard dan Instant.
- [x] U4. Pertahankan fallback TMDB query dari topik asli (tidak tercampur checklist).
- [x] U5. Tambah profile karakter per 17 platform (field platform-specific).
- [x] U6. Tambah validasi wajib per platform (`preflight gate` sebelum generate).
- [x] U7. Tambah status gate visual `PASS/FAIL` + daftar field wajib yang kurang.
- [x] U8. Tambah mapping gabungan `platform + domain` untuk mandatory fields.
- [x] U9. Tambah dokumentasi matriks pass/fail checklist per 17 platform di status report.

## Definisi Gate PASS/FAIL
Checklist gate dianggap `PASS` jika:
1. Checklist `ON`.
2. Semua field `required` untuk platform aktif terisi.
3. Semua field `required` untuk domain aktif terisi.
4. Field core wajib terisi.
5. (Khusus e-commerce/hard-sell) disclosure + promo factual field terisi.

Jika ada satu syarat gagal, gate `FAIL` dan generate diblokir.

## Dampak yang Diharapkan
- Input lebih rapi dan konsisten.
- Risiko output halusinasi/terlalu umum menurun.
- Karakter tiap platform lebih terjaga.
- Proses QA lebih mudah karena ada evidence field-level.

## Risiko & Mitigasi
- Risiko form terasa panjang.
  - Mitigasi: tampilkan hanya field sesuai domain + platform aktif.
- Risiko user baru bingung.
  - Mitigasi: checklist default `OFF` dan ada helper text.
- Risiko blocking berlebihan.
  - Mitigasi: validasi ketat hanya saat checklist `ON`.

## Deliverables
1. UI checklist dinamis di `src/components/GenerateForm.jsx`
2. Platform profile map + domain map
3. Preflight validator checklist pass/fail
4. Gate summary di UI
5. Dokumen status implementasi (done/undone)
