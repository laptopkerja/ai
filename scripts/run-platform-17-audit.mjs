import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import axios from 'axios'
import {
  CANONICAL_PLATFORMS,
  resolvePlatformAllowedLength
} from '../shared/lib/platformContracts.js'
import { runPlatform17Audit } from '../server/lib/platform17Audit.js'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 3120
const REPORT_DIR = path.resolve(process.cwd(), 'reports', 'platform-17-audit')
const REPORT_JSON_FILE = path.join(REPORT_DIR, 'latest.json')

function safeString(value) {
  return String(value || '').trim()
}

function isQualityMetaValid(meta) {
  const decision = safeString(meta?.aiDecision?.status).toUpperCase()
  return (
    Number.isFinite(Number(meta?.complianceScore)) &&
    Number.isFinite(Number(meta?.performancePotentialScore)) &&
    Number.isFinite(Number(meta?.finalScore)) &&
    ['GO', 'REVISE', 'BLOCK'].includes(decision)
  )
}

function waitForServerReady(proc, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), timeoutMs)
    proc.stdout.on('data', (buf) => {
      const text = String(buf || '')
      const match = text.match(/localhost:(\d+)/i)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Server exited early with code ${code}`))
    })
  })
}

async function startAuditServer(port = DEFAULT_PORT) {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_REAL_PROVIDER_CALLS: 'false',
      REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const actualPort = await waitForServerReady(proc)
  return {
    proc,
    baseUrl: `http://${HOST}:${actualPort}`
  }
}

async function stopAuditServer(proc) {
  if (!proc || proc.killed) return
  proc.kill('SIGTERM')
  await new Promise((resolve) => {
    proc.on('exit', () => resolve())
    setTimeout(() => resolve(), 2000)
  })
}

async function runApiSmokeChecks(baseUrl) {
  const out = {}
  for (const platform of CANONICAL_PLATFORMS) { // eslint-disable-line no-restricted-syntax
    const allowedLengths = resolvePlatformAllowedLength(platform)
    const contentLength = allowedLengths[0] || 'short'
    try {
      const resp = await axios.post(`${baseUrl}/api/generate`, { // eslint-disable-line no-await-in-loop
        mode: 'manual',
        provider: 'OpenAI',
        model: 'gpt-4o',
        manualConfig: {
          topic: `Audit ${platform}`,
          platform,
          language: 'Indonesia',
          tone: 'Urgency',
          contentStructure: { length: contentLength, format: 'text' }
        }
      }, { timeout: 45000 })

      const okResponse = resp.status === 200 && resp?.data?.ok === true
      const meta = resp?.data?.data?.meta || {}
      const qualityMetaPass = isQualityMetaValid(meta)
      const pass = okResponse && qualityMetaPass
      out[platform] = {
        pass,
        message: pass
          ? `ok length=${contentLength}`
          : `invalid quality meta length=${contentLength}`
      }
    } catch (err) {
      const detail = err?.response?.status
        ? `${err.response.status} ${JSON.stringify(err.response.data || {})}`
        : safeString(err?.message || err)
      out[platform] = {
        pass: false,
        message: `request_failed length=${contentLength} detail=${detail}`
      }
    }
  }
  return out
}

function printSummary(report) {
  const summary = report?.summary || {}
  console.log(`Audit verdict: ${summary.verdict} (${summary.passPlatformCount}/${summary.totalPlatformCount} PASS)`)
  const failed = (report?.platforms || []).filter((item) => item.verdict !== 'PASS')
  if (!failed.length) {
    console.log('All 17 platforms passed checklist.')
    return
  }
  console.log('Failed platforms:')
  failed.forEach((row) => {
    console.log(`- ${row.platform}: ${Array.isArray(row.failedItems) ? row.failedItems.join(', ') : '-'}`)
  })
}

async function main() {
  const skipApiSmoke = String(process.env.AUDIT_PLATFORM17_SKIP_API_SMOKE || '').toLowerCase() === 'true'
  let serverProc = null
  let apiSmokeByPlatform = {}

  if (!skipApiSmoke) {
    const desiredPort = Number(process.env.AUDIT_PLATFORM17_PORT || DEFAULT_PORT)
    const started = await startAuditServer(Number.isFinite(desiredPort) ? desiredPort : DEFAULT_PORT)
    serverProc = started.proc
    try {
      apiSmokeByPlatform = await runApiSmokeChecks(started.baseUrl)
    } finally {
      await stopAuditServer(serverProc)
      serverProc = null
    }
  }

  const report = runPlatform17Audit({
    includeApiSmoke: !skipApiSmoke,
    apiSmokeByPlatform,
    generatedAt: new Date().toISOString()
  })

  await fs.mkdir(REPORT_DIR, { recursive: true })
  await fs.writeFile(REPORT_JSON_FILE, JSON.stringify(report, null, 2), 'utf8')

  printSummary(report)
  console.log(`JSON report saved: ${REPORT_JSON_FILE}`)

  if (report?.summary?.verdict !== 'PASS') {
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error(`platform17 audit failed: ${safeString(err?.message || err)}`)
  process.exitCode = 1
})
