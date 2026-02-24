# Prompt Audit & Refactor Project untuk AI Copilot

## Konteks

Project ini memiliki dua mode pembuatan konten:

1.  **Mode Manual**
    -   User mengisi field generator secara manual (platform, tone,
        topik, CTA, dll).
    -   Ringan dan fleksibel.
2.  **Mode Preset**
    -   User memilih preset.
    -   Preset mengikuti **Master Preset Format v3 (Format 1)**.
    -   Preset berisi konfigurasi strategis lengkap (strategy,
        structure, CTA, audio, constraints, dll).

Tujuan audit ini adalah memastikan kedua mode: - TIDAK bentrok - TIDAK
memiliki duplikasi logic - Tetap clean dan scalable - Mengikuti struktur
Master Preset Format v3 secara konsisten

------------------------------------------------------------------------

# 🎯 Tujuan Audit

Lakukan analisis menyeluruh terhadap project dan:

1.  Pastikan Mode Manual dan Mode Preset memiliki tanggung jawab yang
    jelas dan terpisah.
2.  Hapus logic yang duplikat dan field yang redundant.
3.  Hapus fitur, state, endpoint, dan properti yang tidak terpakai.
4.  Pastikan struktur Preset mengikuti Master Preset Format v3 secara
    ketat.
5.  Pastikan sistem scalable untuk 1000+ preset.
6.  Siapkan sistem agar siap untuk marketplace preset di masa depan.

------------------------------------------------------------------------

# 📌 Master Preset Format v3 (Struktur Acuan Wajib)

Preset HARUS memiliki field berikut:

-   id
-   version
-   title
-   label
-   description
-   platform
-   category
-   tags
-   engine
-   strategy (termasuk goals)
-   contentStructure
-   language
-   keywords
-   hashtags
-   cta
-   audio
-   constraints
-   analytics
-   examples
-   meta

Tidak boleh ada field tambahan kecuali memang benar-benar dibutuhkan
secara teknis.

------------------------------------------------------------------------

# 🔍 Analisis yang Harus Dilakukan

## 1️⃣ Arsitektur Mode

Analisis:

-   Apakah Mode Manual dan Mode Preset menggunakan pipeline yang sama?
-   Apakah ada duplikasi logic prompt?
-   Apakah ada conditional logic yang tidak efisien?
-   Apakah ada fitur yang tumpang tindih?

Rekomendasikan arsitektur ideal berikut:

UI → Mode Handler → Normalized Config → Prompt Compiler → AI Engine

Kedua mode harus bermuara ke SATU universal prompt compiler.

------------------------------------------------------------------------

## 2️⃣ Identifikasi Duplikasi & Cleanup

Temukan dan daftarkan:

-   CTA ganda
-   Properti audio yang tidak terpakai
-   Field example yang redundant
-   State yang tidak pernah dipakai
-   Kolom database yang tidak digunakan
-   Komponen UI yang mati (dead component)
-   Endpoint API yang tidak dipakai

Berikan:

-   Daftar field yang aman dihapus
-   Field yang perlu digabung
-   Field yang perlu dipindahkan layer

------------------------------------------------------------------------

## 3️⃣ Blueprint Fitur Add Preset

Rancang form modular berdasarkan Format 1:

Section:

-   Basic Info
-   Strategy (termasuk goals)
-   Content Structure
-   Language
-   Keywords
-   Hashtags
-   CTA
-   Audio
-   Constraints
-   Analytics
-   Examples

Persyaratan:

-   Validasi schema
-   Default value tersedia
-   Bisa disimpan sebagai draft
-   Tidak ada duplikasi field
-   Strict mengikuti Format v3

------------------------------------------------------------------------

## 4️⃣ Blueprint Fitur Edit Preset

Fitur harus:

-   Load preset berdasarkan ID
-   Mendukung partial update
-   Otomatis increment version saat update
-   Validasi schema sebelum save
-   Menghapus empty array atau null value
-   Menjaga integritas struktur preset

------------------------------------------------------------------------

## 5️⃣ Desain Sistem Override

Mode Preset harus mendukung:

{ "mode": "preset", "presetId": "...", "override": { "language.tone":
"...", "cta.main": "...", "keywords.main": "..." } }

Aturan:

-   Override hanya mengganti value
-   Tidak mengubah struktur
-   Tetap memiliki fallback aman ke preset default

------------------------------------------------------------------------

## 6️⃣ Evaluasi Skalabilitas

Evaluasi kesiapan sistem untuk:

-   1000+ preset
-   Filter berdasarkan tag
-   Filter berdasarkan kategori
-   Visibility public/private
-   Versioning system
-   Tracking analytics per preset
-   Ekspansi marketplace

------------------------------------------------------------------------

# 📦 Struktur Output yang Diminta dari AI

1.  Ringkasan Audit\
2.  Analisis Konflik Antar Mode\
3.  Daftar Cleanup & Redundansi\
4.  Rekomendasi Arsitektur (diagram teks)\
5.  Blueprint Add Preset\
6.  Blueprint Edit Preset\
7.  Desain Override System\
8.  Step-by-step Refactor Plan\
9.  Evaluasi Skalabilitas\
10. Rekomendasi Arsitektur Final

------------------------------------------------------------------------

# 🎯 Tujuan Akhir

Refactor sistem menjadi:

-   Clean
-   Modular
-   Tidak bentrok antar mode
-   Scalable
-   Maintainable
-   Production-ready
-   SaaS-ready
