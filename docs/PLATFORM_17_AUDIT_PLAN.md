# Rencana Audit Pass/Fail 17 Platform

Last updated: 2026-02-26  
Owner: Codex + User

## Tujuan
- Menetapkan audit otomatis dengan verdict objektif `PASS/FAIL` untuk seluruh 17 platform.
- Menjadikan hasil audit terukur, repeatable, dan bisa dipakai sebagai quality gate sebelum release.

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

## Definisi PASS/FAIL (Rubric)
Setiap platform dianggap `PASS` jika seluruh checklist wajib lulus:

1. Kontrak platform tersedia dan dikenali dari `shared/lib/platformContracts.js`.
2. `allowed length` platform tervalidasi.
3. Hook hasil guardrail berada di range kontrak.
4. Description hasil guardrail memenuhi aturan kalimat/karakter + CTA jika diwajibkan.
5. Jumlah hashtag hasil guardrail memenuhi range kontrak.
6. Narrator hasil guardrail memenuhi format scene-by-length (atau artikel SEO untuk Blogger).
7. Audio memenuhi kontrak 5 field (kecuali Blogger text-first).
8. Decision model valid (`GO/REVISE/BLOCK`) dan konsisten dengan gate rule.
9. Final score valid terhadap rumus gate (`0.6 compliance + 0.4 potential` + cap decision).
10. API `/api/generate` tetap menghasilkan metadata quality utama (`compliance`, `potential`, `decision`, `finalScore`).
11. Data performa real platform (retention, CTR, ranking live) berhasil di-ingest ke sistem audit.
12. Evaluasi performa real platform menghasilkan status `pass` (bukan `fail/insufficient`).

Jika 1 item gagal, platform dinyatakan `FAIL`.

## Layer Performa Real Platform
Audit kini memiliki 2 layer:

1. Layer kontrak konten (output quality sebelum publish).
2. Layer performa real (retention analytics, CTR, ranking live setelah publish).

Implementasi teknis layer performa real:
- Benchmark per platform: `shared/lib/platformPerformanceBenchmarks.js`
- Evaluator + agregator verdict: `server/lib/platformPerformance.js`
- Endpoint benchmark: `GET /api/dashboard/platform-performance/benchmarks`
- Endpoint ingest metrics: `POST /api/dashboard/platform-performance/ingest`
- Endpoint summary verdict: `GET /api/dashboard/platform-performance`
- SQL table metrics: `scripts/create_platform_performance_metrics.sql`

## Mekanisme Checklist Platform
### Aturan Penandaan
- Checklist platform boleh dicentang (`[x]`) hanya jika 10 kategori rubric lulus.
- Jika ada minimal 1 kategori gagal, platform tetap `FAIL` dan checklist tetap `[ ]`.
- Penandaan checklist harus berdasarkan hasil runner audit otomatis, bukan manual feeling.

### Contoh Penandaan (Simulasi)
Gunakan format ini untuk menandai platform yang sudah lulus penuh:

- [x] TikTok (contoh simulasi: lulus semua kategori)
- [ ] YouTube Short
- [ ] YouTube Long
- [ ] Shopee
- [ ] Tokopedia
- [ ] Lazada
- [ ] Instagram Reels
- [ ] Facebook Reels
- [ ] Pinterest
- [ ] WhatsApp Status
- [ ] Threads
- [ ] WhatsApp Channel
- [ ] Telegram
- [ ] LinkedIn
- [ ] X (Twitter)
- [ ] SoundCloud
- [ ] Blog Blogger

Catatan: daftar di atas adalah format acuan. Status real harus mengikuti output audit terbaru.

## Tujuan, Hasil, dan Dampak
### Tujuan
- Menjamin setiap platform lolos standar kualitas yang sama.
- Mengurangi regresi saat update prompt/guardrail/model.
- Menetapkan quality gate objektif sebelum release.

### Hasil yang Diharapkan
- Tersedia verdict per platform: `PASS/FAIL`.
- Tersedia ringkasan global: `x/17 PASS`.
- Tersedia alasan gagal yang spesifik per kategori agar perbaikan cepat dan terarah.

### Dampak Implementasi
- Dampak baik:
  - Kualitas output lebih konsisten lintas platform.
  - Risiko incident produksi menurun karena ada gate otomatis.
  - Proses QA lebih cepat karena evidence terstruktur.
- Dampak yang perlu dikendalikan:
  - Waktu CI/test awal akan bertambah.
  - Perlu maintenance saat kontrak/rubric berubah.
  - Potensi false fail jika rule terlalu ketat dan belum dituning.
- Mitigasi:
  - Jalankan paralel test bila memungkinkan.
  - Versioning rubric + changelog rule.
  - Review threshold secara berkala.

## Arsitektur Audit Otomatis
1. Data kontrak diambil dari `CANONICAL_PLATFORMS`, `resolvePlatformOutputContract`, `resolvePlatformAllowedLength`.
2. Runner audit membuat test matrix per platform x allowed length.
3. Engine evaluasi utama memakai `applyGenerationQualityGuardrails` agar hasil deterministik.
4. API smoke layer memverifikasi endpoint `/api/generate` pada subset terkontrol.
5. Reporter menghasilkan artefak `JSON`, `CSV`, dan `Markdown`.

## Deliverables Implementasi
1. `tests/audit/platform-17-audit.test.mjs`
2. `scripts/run-platform-17-audit.mjs`
3. `scripts/export-platform-17-audit-report.mjs`
4. `reports/platform-17-audit/latest.json`
5. `reports/platform-17-audit/latest.csv`
6. `reports/platform-17-audit/latest.md`
7. Script npm: `audit:platform17`
8. `shared/lib/platformPerformanceBenchmarks.js`
9. `server/lib/platformPerformance.js`
10. `scripts/create_platform_performance_metrics.sql`
11. `tests/unit/platformPerformance.test.mjs`
12. `tests/integration/platform-performance-api.test.mjs`

## Fase Implementasi
### Phase 1 - Matrix & Assertions
- Bangun matrix otomatis dari 17 platform.
- Implement semua assertion rubric.
- Target output: pass/fail detail per platform.

### Phase 2 - Reporting
- Tambahkan exporter JSON/CSV/Markdown.
- Tambahkan ringkasan global `x/17 PASS`.

### Phase 3 - API Smoke Binding
- Tambahkan smoke API terstruktur untuk memastikan parity antara evaluator lokal dan runtime API.

### Phase 4 - CI Quality Gate
- Tambahkan command `npm run audit:platform17`.
- Integrasikan ke pipeline quality agar release gagal jika < `17/17 PASS`.

## Aturan Verdict Global
- `GLOBAL PASS` hanya jika `17/17 PASS`.
- `GLOBAL FAIL` jika ada minimal 1 platform `FAIL`.
- Tidak ada verdict manual/subjektif.

## Referensi Status Implementasi
Status progress aktual rencana ini dilacak di:  
`docs/PLATFORM_17_AUDIT_STATUS.md`
