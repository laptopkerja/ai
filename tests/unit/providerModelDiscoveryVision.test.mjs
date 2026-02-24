import test from 'node:test'
import assert from 'node:assert/strict'
import { inferVisionSupport } from '../../server/lib/providerModelDiscovery.js'

test('inferVisionSupport marks OpenAI vision vs non-vision models', () => {
  assert.equal(inferVisionSupport('OpenAI', 'gpt-4o-mini'), true)
  assert.equal(inferVisionSupport('OpenAI', 'gpt-3.5-turbo'), false)
})

test('inferVisionSupport marks Gemini vision vs non-vision models', () => {
  assert.equal(inferVisionSupport('Gemini', 'gemini-2.0-flash'), true)
  assert.equal(inferVisionSupport('Gemini', 'text-embedding-004'), false)
})

test('inferVisionSupport marks OpenRouter vision vs non-vision models', () => {
  assert.equal(inferVisionSupport('OpenRouter', 'openai/gpt-4o-mini'), true)
  assert.equal(inferVisionSupport('OpenRouter', 'text-embedding-3-small'), false)
})

test('inferVisionSupport for OpenRouter prefers modality metadata when available', () => {
  assert.equal(
    inferVisionSupport('OpenRouter', 'some/unknown-model', {
      architecture: { modality: 'text+image->text' }
    }),
    true
  )
  assert.equal(
    inferVisionSupport('OpenRouter', 'some/unknown-model', {
      architecture: { input_modalities: ['text'], output_modalities: ['text'] }
    }),
    false
  )
})

test('inferVisionSupport uses provider-specific fallback heuristics', () => {
  assert.equal(inferVisionSupport('DeepSeek', 'deepseek-chat'), false)
  assert.equal(
    inferVisionSupport('Hugging Face', 'meta-llama/Llama-3.2-11B-Vision-Instruct', {
      input_modalities: ['text', 'image']
    }),
    true
  )
})
