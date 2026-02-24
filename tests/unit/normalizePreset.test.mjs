import test from 'node:test'
import assert from 'node:assert/strict'
import normalizePreset from '../../shared/lib/normalizePreset.js'

test('normalizePreset maps legacy-ish input to canonical format', () => {
  const raw = {
    id: 'preset-1',
    title: 'Preset One',
    platform: 'TikTok',
    language: 'Indonesia',
    cta: 'Beli sekarang',
    keywordExtra: ['viral', 'promo'],
    strategy: { goals: ['engagement'] },
    unknownField: 'should-not-exist'
  }

  const normalized = normalizePreset(raw)
  assert.equal(normalized.id, 'preset-1')
  assert.equal(normalized.title, 'Preset One')
  assert.equal(normalized.platform, 'TikTok')
  assert.ok(Array.isArray(normalized.cta))
  assert.ok(Array.isArray(normalized.keywords))
  assert.equal(Object.hasOwn(normalized, 'unknownField'), false)
})

test('normalizePreset provides required defaults', () => {
  const normalized = normalizePreset({ id: 'x', title: 'T' })
  assert.equal(normalized.version, '1.0.0')
  assert.equal(normalized.contentStructure.length, 'short')
  assert.equal(normalized.analytics.trackingEnabled, false)
  assert.ok(Array.isArray(normalized.examples))
})
