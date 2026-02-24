import test from 'node:test'
import assert from 'node:assert/strict'
import normalizePreset from '../../shared/lib/normalizePreset.js'
import validateTemplate from '../../shared/lib/validateTemplate.js'

test('validateTemplate passes for normalized preset', () => {
  const preset = normalizePreset({
    id: 'validate-1',
    title: 'Validate Preset',
    label: 'Validate',
    platform: 'TikTok',
    language: 'Indonesia'
  })
  const errors = validateTemplate(preset)
  assert.equal(errors.length, 0)
})

test('validateTemplate returns errors for invalid object', () => {
  const errors = validateTemplate({ id: 'broken' })
  assert.ok(errors.length > 0)
})
