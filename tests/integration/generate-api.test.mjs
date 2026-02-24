import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import axios from 'axios'

const HOST = '127.0.0.1'
const PORT = 3110

let serverProc = null
let serverBaseUrl = `http://${HOST}:${PORT}`

function waitForServerReady(proc, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), timeoutMs)
    proc.stdout.on('data', (buf) => {
      const text = String(buf)
      if (text.includes('Mock server running on')) {
        const m = text.match(/localhost:(\d+)/)
        if (m) serverBaseUrl = `http://${HOST}:${m[1]}`
        clearTimeout(timer)
        resolve()
      }
    })
    proc.stderr.on('data', () => {})
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Server exited early with code ${code}`))
    })
  })
}

async function startServer() {
  serverProc = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ENABLE_REAL_PROVIDER_CALLS: 'false',
      REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await waitForServerReady(serverProc)
}

async function stopServer() {
  if (!serverProc || serverProc.killed) return
  serverProc.kill('SIGTERM')
  await new Promise((resolve) => {
    serverProc.on('exit', () => resolve())
    setTimeout(() => resolve(), 2000)
  })
}

test.before(async () => {
  await startServer()
})

test.after(async () => {
  await stopServer()
})

test('POST /api/generate manual success', async () => {
  const resp = await axios.post(`${serverBaseUrl}/api/generate`, {
    mode: 'manual',
    provider: 'OpenAI',
    model: 'gpt-4o',
    manualConfig: {
      topic: 'Kopi viral',
      platform: 'TikTok',
      language: 'Indonesia',
      tone: 'Fun',
      contentStructure: { length: 'short', format: 'text' }
    }
  })

  assert.equal(resp.status, 200)
  assert.equal(resp.data.ok, true)
  assert.ok(resp.data.data.id)
  assert.equal(resp.data.data.meta.provider, 'OpenAI')
  assert.equal(typeof resp.data.data.meta.qualityScore, 'number')
  assert.ok(Array.isArray(resp.data.data.meta.qualityChecks))
  assert.ok(['pass', 'retry', 'fallback', 'block'].includes(resp.data.data.meta.qualityGate))
  assert.equal(typeof resp.data.data.meta.complianceScore, 'number')
  assert.equal(typeof resp.data.data.meta.performancePotentialScore, 'number')
  assert.equal(typeof resp.data.data.meta.finalScore, 'number')
  assert.ok(['GO', 'REVISE', 'BLOCK'].includes(String(resp.data.data.meta?.aiDecision?.status || '')))
})

test('POST /api/generate preset success', async () => {
  const resp = await axios.post(`${serverBaseUrl}/api/generate`, {
    mode: 'preset',
    presetId: 'promo-shopee-001',
    provider: 'OpenAI',
    model: 'gpt-4o'
  })

  assert.equal(resp.status, 200)
  assert.equal(resp.data.ok, true)
  assert.equal(resp.data.data.platform, 'Shopee')
  assert.equal(typeof resp.data.data.meta.qualityScore, 'number')
  assert.ok(Array.isArray(resp.data.data.meta.qualityChecks))
  assert.equal(typeof resp.data.data.meta.complianceScore, 'number')
  assert.equal(typeof resp.data.data.meta.performancePotentialScore, 'number')
  assert.equal(typeof resp.data.data.meta.finalScore, 'number')
})

test('POST /api/generate returns validation error for invalid override path', async () => {
  let status = null
  let data = null
  try {
    await axios.post(`${serverBaseUrl}/api/generate`, {
      mode: 'preset',
      presetId: 'promo-shopee-001',
      override: { newIllegalField: 'x' }
    })
  } catch (err) {
    status = err?.response?.status
    data = err?.response?.data
  }

  assert.equal(status, 400)
  assert.equal(data?.ok, false)
  assert.equal(data?.error?.code, 'VALIDATION_ERROR')
})

test('POST /api/generate rejects preset that violates platform contract', async () => {
  let status = null
  let data = null
  try {
    await axios.post(`${serverBaseUrl}/api/generate`, {
      mode: 'preset',
      presetId: 'promo-shopee-001',
      override: { 'hashtags.count': 0 }
    })
  } catch (err) {
    status = err?.response?.status
    data = err?.response?.data
  }

  assert.equal(status, 400)
  assert.equal(data?.ok, false)
  assert.equal(data?.error?.code, 'PRESET_CONTRACT_REJECTED')
  assert.match(String(data?.error?.message || ''), /melanggar kontrak platform/i)
  assert.equal(Array.isArray(data?.error?.details?.errors), true)
  assert.ok(data?.error?.details?.errors?.length > 0)
  assert.match(String(data?.error?.details?.errors?.[0] || ''), /hashtags\.count/i)
  assert.equal(data?.error?.details?.action?.canEdit, true)
  assert.equal(data?.error?.details?.action?.canDelete, true)
  assert.match(String(data?.error?.details?.action?.tip || ''), /Edit|Hapus/i)
})

test('POST /api/generate manual success with image references', async () => {
  const resp = await axios.post(`${serverBaseUrl}/api/generate`, {
    mode: 'manual',
    provider: 'OpenAI',
    model: 'gpt-4o',
    imageReferences: [
      { type: 'url', url: 'https://images.example.com/phone-review-main.jpg' }
    ],
    manualConfig: {
      topic: 'Review handphone camera low light',
      platform: 'TikTok',
      language: 'Indonesia',
      tone: 'Persuasive',
      contentStructure: { length: 'short', format: 'text' }
    }
  })

  assert.equal(resp.status, 200)
  assert.equal(resp.data.ok, true)
  assert.equal(resp.data.data.meta.imageReferencesCount, 1)
  assert.match(String(resp.data.data.prompt || ''), /Referensi visual/i)
  assert.equal(typeof resp.data.data.meta.qualityScore, 'number')
  assert.equal(typeof resp.data.data.meta.complianceScore, 'number')
  assert.equal(typeof resp.data.data.meta.performancePotentialScore, 'number')
})

test('POST /api/generate returns validation error for invalid image reference payload', async () => {
  let status = null
  let data = null
  try {
    await axios.post(`${serverBaseUrl}/api/generate`, {
      mode: 'manual',
      imageReferences: [{ type: 'url', url: 'ftp://invalid-url.example.com/file.jpg' }],
      manualConfig: {
        topic: 'Tes invalid image reference',
        platform: 'TikTok',
        language: 'Indonesia',
        contentStructure: { length: 'short', format: 'text' }
      }
    })
  } catch (err) {
    status = err?.response?.status
    data = err?.response?.data
  }

  assert.equal(status, 400)
  assert.equal(data?.ok, false)
  assert.equal(data?.error?.code, 'VALIDATION_ERROR')
})

test('POST /api/generate returns validation error when image references exceed max', async () => {
  const imageReferences = Array.from({ length: 6 }, (_, i) => ({
    type: 'url',
    url: `https://images.example.com/ref-${i + 1}.jpg`
  }))

  let status = null
  let data = null
  try {
    await axios.post(`${serverBaseUrl}/api/generate`, {
      mode: 'manual',
      imageReferences,
      manualConfig: {
        topic: 'Tes lebih dari batas image references',
        platform: 'TikTok',
        language: 'Indonesia',
        contentStructure: { length: 'short', format: 'text' }
      }
    })
  } catch (err) {
    status = err?.response?.status
    data = err?.response?.data
  }

  assert.equal(status, 400)
  assert.equal(data?.ok, false)
  assert.equal(data?.error?.code, 'VALIDATION_ERROR')
})

test('POST /api/generate returns validation error when image refs use non-vision model', async () => {
  let status = null
  let data = null
  try {
    await axios.post(`${serverBaseUrl}/api/generate`, {
      mode: 'manual',
      provider: 'OpenAI',
      model: 'gpt-3.5-turbo',
      imageReferences: [{ type: 'url', url: 'https://images.example.com/non-vision-check.jpg' }],
      manualConfig: {
        topic: 'Tes validasi model non vision',
        platform: 'TikTok',
        language: 'Indonesia',
        contentStructure: { length: 'short', format: 'text' }
      }
    })
  } catch (err) {
    status = err?.response?.status
    data = err?.response?.data
  }

  assert.equal(status, 400)
  assert.equal(data?.ok, false)
  assert.equal(data?.error?.code, 'VALIDATION_ERROR')
  assert.match(String(data?.error?.message || ''), /tidak mendukung analisis gambar/i)
})

test('POST /api/generate uses text fallback warning for provider without vision adapter', async () => {
  const resp = await axios.post(`${serverBaseUrl}/api/generate`, {
    mode: 'manual',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    imageReferences: [{ type: 'url', url: 'https://images.example.com/fallback-provider.jpg' }],
    manualConfig: {
      topic: 'Tes fallback vision provider belum didukung',
      platform: 'TikTok',
      language: 'Indonesia',
      contentStructure: { length: 'short', format: 'text' }
    }
  })

  assert.equal(resp.status, 200)
  assert.equal(resp.data.ok, true)
  assert.equal(resp.data.data.meta.imageReferencesCount, 1)
  assert.equal(resp.data.data.meta?.vision?.mode, 'text_fallback')
  assert.ok(Array.isArray(resp.data.data.meta?.warnings))
  assert.match(String(resp.data.data.meta?.warnings?.[0] || ''), /konteks teks/i)
})
