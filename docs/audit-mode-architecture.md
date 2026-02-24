# Audit Mode Architecture — AI Content Generator

Tanggal: 2026-02-19
Penulis: Tim Arsitek (auto-generated summary)

Tujuan
- Audit tanggung-jawab Mode Manual vs Mode Preset.
- Usulkan arsitektur yang memastikan single prompt pipeline.

Ringkasan singkat
- Temuan utama: saat ini UI Manual dan Preset keduanya menghasilkan prompt/konfigurasi secara tersebar (GenerateForm, TemplatesPage, server mock). Hal ini menimbulkan duplikasi logic dan risiko divergent behavior.
- Rekomendasi: konsolidasikan menjadi satu pipeline: UI → Mode Handler → Normalizer → Prompt Compiler → AI Adapter → Persist/Analytics.

Komponen yang diusulkan

1) Mode Handler
- Input: `{ mode: 'manual'|'preset', payload: {...}, override?: {...} }` dari UI.
- Tugas: ambil config awal (manual fields atau preset lookup), terapkan override (path-based), kirim ke Normalizer.

2) Preset Storage / Loader
- Preset canonical disimpan sebagai JSON (DB JSONB untuk produksi, `localStorage` untuk dev). Schema harus validasi (AJV).
- Preset lookup API: `GET /api/presets/:id` (server) — mengembalikan object canonical.

3) Normalizer
- Tugas: hasilkan `NormalizedConfig` lengkap (platform, category, language, tone, length, ctas[], keywords[], audio{}, constraints{}, strategy{}, contentStructure{}, meta{}).
- Isi default values dari schema; map legacy keys (audioStyle→audio.style).
- Strip fields yang tidak diperbolehkan (mis. provider/model dalam preset).

4) Prompt Compiler
- Input: `NormalizedConfig` + `promptTemplate` + `placeholders`.
- Engine: jalankan substitution aman (escape), mendukung loops/conditions minimal (handlebars-like) — prefer lightweight template engine (mustache/handlebars) OR implement internal simple replacer.
- Output: final prompt string.

5) AI Adapter
- Abstraksi provider: `providers/openai.js`, `providers/anthropic.js`, `providers/custom.js`.
- Input: final prompt + provider config (model, max tokens, temperature).
- Handle rate-limits via queue (Bull) and retry logic; persist response metadata.

6) Persist / Analytics
- Persist generation: `generations` table with `user_id`, `preset_id?`, `preset_version?`, `normalized_config (jsonb)`, `prompt`, `response`, `cost`, `created_at`.
- Emit analytics events: preset used, overrides applied, generation success/failure.

Data Flow (tekstual diagram)
UI (Manual | Preset Selector)
  → Mode Handler (merge payload + overrides)
  → Normalizer (fill defaults, map legacy)
  → Prompt Compiler (template + placeholders → final prompt)
  → AI Adapter (provider abstraction)
  → Persist & Analytics

Key Rules & Decisions
- Preset MUST NOT contain `provider`/`model` — provider choice is always done on Generate page.
- Overrides are allowed only for shallow values (language, tone, cta, keywords) and must be path-validated.
- Final merged config must be validated against canonical JSON Schema before compilation.
- Use `json-schema` (draft-07 or later) and `ajv` for both client-side preview/import and server-side enforcement.

Backward compatibility & migration
- Provide a converter (already present: `scripts/convertTemplates.cjs`) to map legacy templates to canonical schema.
- Normalizer should include legacy mapping rules to handle any old-format template still present.

Dev vs Prod runtime
- Dev: presets in `localStorage`, prompt compiler runs in browser for preview.
- Prod: presets persisted in Postgres JSONB + server-side validation and prompt compilation (or at least server-side verification) to avoid client tampering.

Quick API suggestions
- `GET /api/presets?tags=&platform=&q=&page=` — paged, filtered listing
- `GET /api/presets/:id` — get single preset
- `POST /api/presets` — create (server validate schema)
- `PATCH /api/presets/:id` — partial update + version bump
- `POST /api/generate` — body: `{ mode, presetId?, override?, manualConfig?, provider, model }` → server resolves normalized config, compiles prompt, forwards to AI adapter. Returns generation id and response.

Testing & Validation
- Unit tests for Normalizer and Prompt Compiler.
- Integration test for full flow (preset → generate) with mocked AI provider.
- Schema tests: ensure AJV errors are surfaced to UI gracefully.

Minimum Implementation Steps (MVP)
1. Add canonical JSON Schema file under `src/templates/template.schema.json` (exists but verify completeness).
2. Add `ajv` as dependency and wire client import validation in `TemplatesPage`.
3. Implement `src/lib/normalizePreset.js` and `src/lib/promptCompiler.js` with tests.
4. Update `GenerateForm` to call Mode Handler + Normalizer + Prompt Compiler for preview and on submit call `POST /api/generate`.
5. Update server `POST /api/generate` to accept mode/presetId/override and perform server-side validation + compilation before sending to provider.

Risiko & Mitigasi
- Risk: divergent behavior between client and server compilation → Mitigate by keeping canonical compilation logic on server or ensure identical implementations (shared library).
- Risk: invalid overrides breaking templates → Mitigate by path validation + schema validation on final merged config.

Next recommended actions (prioritas)
- Immediate (now): integrate `ajv` client-side and validate imports in `TemplatesPage` (prevents bad presets). (Saya bisa kerjakan ini sekarang jika Anda setuju.)
- Short term: implement `normalizePreset` + `promptCompiler` and wire into `GenerateForm` and server.
- Mid term: move presets to Postgres JSONB and add indexes for tags/platform.

---
File dibuat otomatis oleh agen; beri tahu jika Anda ingin saya langsung mengimplementasikan langkah `ajv` + client validation sekarang.
