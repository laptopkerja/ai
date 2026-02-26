import test from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_PLATFORMS } from '../../shared/lib/platformContracts.js'
import { resolvePlatformRealPerformanceBenchmark } from '../../shared/lib/platformPerformanceBenchmarks.js'
import {
  normalizePlatformPerformanceItem,
  evaluateRealPlatformPerformance,
  aggregateRealPlatformPerformance
} from '../../server/lib/platformPerformance.js'

test('normalizePlatformPerformanceItem rejects invalid platform', () => {
  const parsed = normalizePlatformPerformanceItem({
    platform: 'Unknown Platform',
    retentionRate: 50
  }, { index: 0 })

  assert.equal(parsed.ok, false)
  assert.match(String(parsed.error || ''), /platform is invalid/i)
})

test('evaluateRealPlatformPerformance returns pass for strong metrics', () => {
  const benchmark = resolvePlatformRealPerformanceBenchmark('TikTok')
  const result = evaluateRealPlatformPerformance({
    platform: 'TikTok',
    retentionRate: Number(benchmark.retentionRateMin) + 8,
    ctr: Number(benchmark.ctrMin) + 1.1,
    rankingLive: Math.max(1, Number(benchmark.rankingLiveMax) - 10)
  })

  assert.equal(result.status, 'pass')
  assert.ok(Number(result.score) >= 100)
  assert.equal(result.missingMetrics.length, 0)
})

test('evaluateRealPlatformPerformance returns fail when thresholds are missed', () => {
  const benchmark = resolvePlatformRealPerformanceBenchmark('Blog Blogger')
  const result = evaluateRealPlatformPerformance({
    platform: 'Blog Blogger',
    retentionRate: Math.max(0, Number(benchmark.retentionRateMin) - 12),
    ctr: Math.max(0, Number(benchmark.ctrMin) - 0.8),
    rankingLive: Number(benchmark.rankingLiveMax) + 30
  })

  assert.equal(result.status, 'fail')
  assert.ok(result.checks.some((check) => check.status === 'fail'))
})

test('aggregateRealPlatformPerformance yields PASS verdict when all 17 platforms pass', () => {
  const rows = CANONICAL_PLATFORMS.map((platform, idx) => {
    const benchmark = resolvePlatformRealPerformanceBenchmark(platform)
    return {
      id: `row-${idx + 1}`,
      platform,
      observedAt: new Date(Date.now() - idx * 1000).toISOString(),
      retentionRate: Number(benchmark.retentionRateMin) + 5,
      ctr: Number(benchmark.ctrMin) + 0.7,
      rankingLive: Math.max(1, Number(benchmark.rankingLiveMax) - 4)
    }
  })

  const summary = aggregateRealPlatformPerformance(rows)
  assert.equal(summary.audit.verdict, 'PASS')
  assert.equal(summary.audit.passPlatformCount, 17)
  assert.equal(summary.audit.failPlatforms.length, 0)
})

test('aggregateRealPlatformPerformance yields FAIL verdict when data incomplete', () => {
  const summary = aggregateRealPlatformPerformance([
    {
      platform: 'TikTok',
      observedAt: new Date().toISOString(),
      retentionRate: 44,
      ctr: 2.7,
      rankingLive: 24
    }
  ])

  assert.equal(summary.audit.verdict, 'FAIL')
  assert.ok(summary.audit.failPlatforms.length > 0)
})
