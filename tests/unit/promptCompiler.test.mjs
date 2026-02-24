import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePrompt, defaultTemplateForConfig } from '../../shared/lib/promptCompiler.js'

test('compilePrompt replaces placeholders from nested paths', () => {
  const template = 'Platform {{platform}} topic {{topic}} cta {{cta.0.text}}'
  const config = { platform: 'TikTok', topic: 'Kopi', cta: [{ text: 'Follow' }] }
  const output = compilePrompt(template, config)
  assert.equal(output, 'Platform TikTok topic Kopi cta Follow')
})

test('defaultTemplateForConfig returns a usable template', () => {
  const tpl = defaultTemplateForConfig({})
  const output = compilePrompt(tpl, {
    platform: 'TikTok',
    topic: 'Kopi',
    language: 'Indonesia',
    tone: 'Fun',
    contentStructure: { length: 'short' },
    cta: [{ text: 'Follow' }]
  })
  assert.match(output, /TikTok/)
  assert.match(output, /Kopi/)
  assert.match(output, /Indonesia/)
})
