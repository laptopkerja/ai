import test from 'node:test'
import assert from 'node:assert/strict'
import applyOverrides from '../../shared/lib/applyOverrides.js'

test('applyOverrides updates valid existing paths', () => {
  const config = {
    language: 'Indonesia',
    cta: [{ type: 'primary', text: 'Beli sekarang' }],
    contentStructure: { length: 'short' }
  }
  const result = applyOverrides(config, {
    language: 'English',
    'cta.0.text': 'Buy now'
  })

  assert.equal(result.language, 'English')
  assert.equal(result.cta[0].text, 'Buy now')
})

test('applyOverrides ignores invalid paths safely', () => {
  const config = { language: 'Indonesia', cta: [{ text: 'x' }] }
  const result = applyOverrides(config, { 'does.not.exist': 'value', 'cta.99.text': 'nope' })
  assert.equal(result.language, 'Indonesia')
  assert.equal(result.cta[0].text, 'x')
})
