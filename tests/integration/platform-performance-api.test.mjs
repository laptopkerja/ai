import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import axios from 'axios'

const HOST = '127.0.0.1'
const PORT = 3111

let serverProc = null
let serverBaseUrl = `http://${HOST}:${PORT}`

function waitForServerReady(proc, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), timeoutMs)
    proc.stdout.on('data', (buf) => {
      const text = String(buf)
      if (text.includes('Mock server running on')) {
        const match = text.match(/localhost:(\d+)/)
        if (match) serverBaseUrl = `http://${HOST}:${match[1]}`
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

test('GET /api/dashboard/platform-performance/benchmarks returns canonical benchmark list', async () => {
  const resp = await axios.get(`${serverBaseUrl}/api/dashboard/platform-performance/benchmarks`)
  assert.equal(resp.status, 200)
  assert.equal(resp.data.ok, true)
  assert.equal(Array.isArray(resp.data.data.platforms), true)
  assert.equal(resp.data.data.platforms.length, 17)
})

test('POST /api/dashboard/platform-performance/ingest stores and evaluates real metrics', async () => {
  const payload = {
    items: [
      {
        platform: 'TikTok',
        observedAt: new Date().toISOString(),
        contentId: 'tt-001',
        retentionRate: 47,
        ctr: 2.9,
        rankingLive: 20,
        impressions: 10000,
        views: 4100,
        clicks: 290,
        watchTimeSeconds: 130000,
        source: 'tiktok_analytics'
      },
      {
        platform: 'Blog Blogger',
        observedAt: new Date().toISOString(),
        contentId: 'blog-001',
        retentionRate: 58,
        ctr: 4.7,
        rankingLive: 13,
        impressions: 5200,
        views: 1900,
        clicks: 243,
        source: 'gsc'
      }
    ]
  }

  const resp = await axios.post(`${serverBaseUrl}/api/dashboard/platform-performance/ingest`, payload)
  assert.equal(resp.status, 201)
  assert.equal(resp.data.ok, true)
  assert.equal(Array.isArray(resp.data.data.rows), true)
  assert.equal(resp.data.data.rows.length, 2)
  assert.equal(typeof resp.data.data.rows[0]?.evaluation?.status, 'string')
  assert.equal(typeof resp.data.data.summary?.audit?.verdict, 'string')
})

test('GET /api/dashboard/platform-performance returns summary with real-performance audit verdict', async () => {
  const resp = await axios.get(`${serverBaseUrl}/api/dashboard/platform-performance?windowDays=30&limit=200`)
  assert.equal(resp.status, 200)
  assert.equal(resp.data.ok, true)
  assert.equal(Array.isArray(resp.data.data.rows), true)
  assert.equal(typeof resp.data.data.summary?.audit?.verdict, 'string')
  assert.equal(typeof resp.data.data.summary?.audit?.totalPlatformCount, 'number')
  assert.equal(resp.data.data.summary?.audit?.totalPlatformCount, 17)
})

test('POST /api/dashboard/platform-performance/ingest rejects invalid platform payload', async () => {
  let status = null
  let data = null
  try {
    await axios.post(`${serverBaseUrl}/api/dashboard/platform-performance/ingest`, {
      items: [
        { platform: 'Unknown', retentionRate: 45 }
      ]
    })
  } catch (err) {
    status = err?.response?.status
    data = err?.response?.data
  }

  assert.equal(status, 400)
  assert.equal(data?.ok, false)
  assert.equal(data?.error?.code, 'VALIDATION_ERROR')
})
