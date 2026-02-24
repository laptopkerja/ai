import test from 'node:test'
import assert from 'node:assert/strict'
import normalizeManual from '../../shared/lib/normalizeManual.js'

test('normalizeManual maps form values to manual config', () => {
  const normalized = normalizeManual({
    platform: 'YouTube Short',
    topic: 'Tips kopi',
    language: 'Indonesia',
    tone: 'Fun',
    length: 'short',
    keywords: 'kopi,viral',
    cta: 'Follow sekarang'
  })

  assert.equal(normalized.platform, 'YouTube Short')
  assert.equal(normalized.topic, 'Tips kopi')
  assert.equal(normalized.language, 'Indonesia')
  assert.equal(normalized.contentStructure.length, 'short')
  assert.deepEqual(normalized.keywords, ['kopi', 'viral'])
  assert.equal(normalized.cta[0].text, 'Follow sekarang')
})

test('normalizeManual drops empty optional fields', () => {
  const normalized = normalizeManual({
    platform: 'TikTok',
    topic: 'Tes',
    language: 'Indonesia',
    length: 'short'
  })

  assert.equal(Object.hasOwn(normalized, 'tone'), false)
  assert.equal(Object.hasOwn(normalized, 'keywords'), false)
  assert.equal(Object.hasOwn(normalized, 'cta'), false)
})
