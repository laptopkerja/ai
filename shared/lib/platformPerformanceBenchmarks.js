import { CANONICAL_PLATFORMS } from './platformContracts.js'

function safeString(value) {
  return String(value || '').trim()
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const REAL_PERFORMANCE_BENCHMARK_VERSION = 'v1-real-platform'

export const DEFAULT_REAL_PERFORMANCE_BENCHMARK = {
  retentionRateMin: 30,
  ctrMin: 1.8,
  rankingLiveMax: 50,
  stage: 1
}

export const PLATFORM_REAL_PERFORMANCE_BENCHMARKS = {
  TikTok: { retentionRateMin: 38, ctrMin: 2.2, rankingLiveMax: 40, stage: 1 },
  'YouTube Short': { retentionRateMin: 42, ctrMin: 2.5, rankingLiveMax: 45, stage: 1 },
  'YouTube Long': { retentionRateMin: 32, ctrMin: 3.2, rankingLiveMax: 55, stage: 2 },
  Shopee: { retentionRateMin: 28, ctrMin: 2.8, rankingLiveMax: 30, stage: 2 },
  Tokopedia: { retentionRateMin: 28, ctrMin: 2.8, rankingLiveMax: 30, stage: 2 },
  Lazada: { retentionRateMin: 28, ctrMin: 2.8, rankingLiveMax: 30, stage: 2 },
  'Instagram Reels': { retentionRateMin: 36, ctrMin: 2.0, rankingLiveMax: 45, stage: 1 },
  'Facebook Reels': { retentionRateMin: 30, ctrMin: 1.6, rankingLiveMax: 50, stage: 2 },
  Pinterest: { retentionRateMin: 24, ctrMin: 1.4, rankingLiveMax: 35, stage: 2 },
  'WhatsApp Status': { retentionRateMin: 40, ctrMin: 2.4, rankingLiveMax: 50, stage: 2 },
  Threads: { retentionRateMin: 31, ctrMin: 2.1, rankingLiveMax: 45, stage: 1 },
  'WhatsApp Channel': { retentionRateMin: 38, ctrMin: 2.4, rankingLiveMax: 45, stage: 2 },
  Telegram: { retentionRateMin: 33, ctrMin: 2.0, rankingLiveMax: 45, stage: 2 },
  LinkedIn: { retentionRateMin: 27, ctrMin: 2.9, rankingLiveMax: 35, stage: 2 },
  'X (Twitter)': { retentionRateMin: 22, ctrMin: 1.8, rankingLiveMax: 40, stage: 2 },
  SoundCloud: { retentionRateMin: 35, ctrMin: 2.1, rankingLiveMax: 35, stage: 2 },
  'Blog Blogger': { retentionRateMin: 45, ctrMin: 3.5, rankingLiveMax: 20, stage: 2 }
}

function normalizePlatform(platform) {
  const raw = safeString(platform)
  if (!raw) return ''
  const exact = CANONICAL_PLATFORMS.find((x) => x === raw)
  if (exact) return exact
  const lower = raw.toLowerCase()
  const byLower = CANONICAL_PLATFORMS.find((x) => x.toLowerCase() === lower)
  return byLower || ''
}

export function resolvePlatformRealPerformanceBenchmark(platform) {
  const normalizedPlatform = normalizePlatform(platform)
  const specific = PLATFORM_REAL_PERFORMANCE_BENCHMARKS[normalizedPlatform] || null
  const merged = {
    ...DEFAULT_REAL_PERFORMANCE_BENCHMARK,
    ...(specific || {})
  }
  return {
    platform: normalizedPlatform,
    supported: !!specific,
    retentionRateMin: clampNumber(merged.retentionRateMin, 0, 100, DEFAULT_REAL_PERFORMANCE_BENCHMARK.retentionRateMin),
    ctrMin: clampNumber(merged.ctrMin, 0, 100, DEFAULT_REAL_PERFORMANCE_BENCHMARK.ctrMin),
    rankingLiveMax: clampNumber(merged.rankingLiveMax, 1, 10000, DEFAULT_REAL_PERFORMANCE_BENCHMARK.rankingLiveMax),
    stage: clampNumber(merged.stage, 1, 2, DEFAULT_REAL_PERFORMANCE_BENCHMARK.stage)
  }
}

export function listPlatformRealPerformanceBenchmarks() {
  return CANONICAL_PLATFORMS.map((platform) => resolvePlatformRealPerformanceBenchmark(platform))
}

