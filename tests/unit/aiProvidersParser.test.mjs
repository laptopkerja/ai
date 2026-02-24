import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProviderOutputJson } from '../../server/lib/aiProviders.js'

test('parseProviderOutputJson repairs common malformed JSON output', () => {
  const raw = [
    'Berikut hasilnya:',
    '```json',
    '{',
    "  title: 'Judul Konten',",
    "  hook: 'Hook singkat',",
    "  narrator: 'Scene 1 (0-10s): Narasi siap pakai.',",
    "  description: 'Deskripsi ringkas',",
    "  hashtags: ['#a', '#b',],",
    '}',
    '```'
  ].join('\n')

  const parsed = parseProviderOutputJson(raw)
  assert.ok(parsed && typeof parsed === 'object')
  assert.equal(parsed.title, 'Judul Konten')
  assert.equal(parsed.hook, 'Hook singkat')
  assert.equal(parsed.description, 'Deskripsi ringkas')
  assert.ok(Array.isArray(parsed.hashtags))
})

test('parseProviderOutputJson can read label-based plain text output', () => {
  const raw = [
    'Title: Review HP 2026',
    'Hook: Worth it nggak buat harian?',
    'Narrator:',
    'Scene 1 (0-10s): Kita cek dulu performanya.',
    'Scene 2 (10-20s): Kamera low light dan stabilisasi.',
    'Scene 3 (20-30s): Simpan dulu kalau kamu lagi cari HP.',
    'Description: Ringkas performa, kamera, baterai.',
    'Hashtags: #reviewhp, #techtips'
  ].join('\n')

  const parsed = parseProviderOutputJson(raw)
  assert.ok(parsed && typeof parsed === 'object')
  assert.equal(parsed.title, 'Review HP 2026')
  assert.match(String(parsed.narrator), /Scene 1/)
  assert.ok(Array.isArray(parsed.hashtags))
})
