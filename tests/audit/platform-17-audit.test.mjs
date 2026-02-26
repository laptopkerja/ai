import test from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_PLATFORMS } from '../../shared/lib/platformContracts.js'
import { runPlatform17Audit } from '../../server/lib/platform17Audit.js'

function passApiMap() {
  return Object.fromEntries(
    CANONICAL_PLATFORMS.map((platform) => [platform, { pass: true, message: 'ok' }])
  )
}

test('platform 17 audit matrix returns 17/17 PASS with successful api probes', () => {
  const report = runPlatform17Audit({
    includeApiSmoke: true,
    apiSmokeByPlatform: passApiMap(),
    generatedAt: '2026-02-26T00:00:00.000Z'
  })

  assert.equal(report.summary.totalPlatformCount, 17)
  assert.equal(report.summary.passPlatformCount, 17)
  assert.equal(report.summary.failPlatformCount, 0)
  assert.equal(report.summary.verdict, 'PASS')

  for (const platformRow of report.platforms) {
    assert.equal(platformRow.verdict, 'PASS', `${platformRow.platform} should pass`)
    assert.equal(Array.isArray(platformRow.checklist), true)
    assert.equal(platformRow.checklist.length, 12)
    assert.equal(Array.isArray(platformRow.failedItems), true)
    assert.equal(platformRow.failedItems.length, 0)
    assert.equal(Array.isArray(platformRow.lengthAudits), true)
    assert.ok(platformRow.lengthAudits.length >= 1)
  }
})

test('platform 17 audit fails when one platform api probe fails', () => {
  const apiMap = passApiMap()
  apiMap['TikTok'] = { pass: false, message: 'simulated api failure' }

  const report = runPlatform17Audit({
    includeApiSmoke: true,
    apiSmokeByPlatform: apiMap,
    generatedAt: '2026-02-26T00:00:00.000Z'
  })

  assert.equal(report.summary.verdict, 'FAIL')
  const tiktok = report.platforms.find((item) => item.platform === 'TikTok')
  assert.ok(tiktok)
  assert.equal(tiktok.verdict, 'FAIL')
  assert.ok(tiktok.failedItems.includes('api_generate_quality_meta'))
})
