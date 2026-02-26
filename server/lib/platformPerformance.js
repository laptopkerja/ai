import { CANONICAL_PLATFORMS } from '../../shared/lib/platformContracts.js'
import {
  REAL_PERFORMANCE_BENCHMARK_VERSION,
  resolvePlatformRealPerformanceBenchmark
} from '../../shared/lib/platformPerformanceBenchmarks.js'

function safeString(value) {
  return String(value || '').trim()
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function toNullableNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (Number.isFinite(min) && parsed < min) return null
  if (Number.isFinite(max) && parsed > max) return null
  return parsed
}

function toNullableInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const num = toNullableNumber(value, min, max)
  if (num === null) return null
  return Math.round(num)
}

function normalizePlatform(platform) {
  const raw = safeString(platform)
  if (!raw) return ''
  const exact = CANONICAL_PLATFORMS.find((x) => x === raw)
  if (exact) return exact
  const lower = raw.toLowerCase()
  return CANONICAL_PLATFORMS.find((x) => x.toLowerCase() === lower) || ''
}

function normalizeSource(source) {
  const text = safeString(source).toLowerCase()
  if (!text) return 'manual'
  return text
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'manual'
}

function normalizePeriod(period) {
  const value = safeString(period).toLowerCase()
  if (['hourly', 'daily', 'weekly', 'monthly', 'lifetime'].includes(value)) return value
  return 'daily'
}

function normalizeObservedAt(observedAt) {
  const raw = safeString(observedAt)
  if (!raw) return new Date().toISOString()
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return new Date().toISOString()
  return new Date(ms).toISOString()
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  try {
    return JSON.parse(JSON.stringify(metadata))
  } catch (e) {
    return {}
  }
}

export function normalizePlatformPerformanceItem(raw, { index = 0 } = {}) {
  const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  if (!item) {
    return { ok: false, error: `items.${index} must be an object` }
  }

  const platform = normalizePlatform(item.platform)
  if (!platform) {
    return { ok: false, error: `items.${index}.platform is invalid` }
  }

  const retentionRate = toNullableNumber(item.retentionRate ?? item.retention_rate, 0, 100)
  const ctr = toNullableNumber(item.ctr, 0, 100)
  const rankingLive = toNullableNumber(item.rankingLive ?? item.ranking_live, 1, 100000)

  if (retentionRate === null && ctr === null && rankingLive === null) {
    return { ok: false, error: `items.${index} requires at least one metric (retentionRate|ctr|rankingLive)` }
  }

  return {
    ok: true,
    value: {
      observedAt: normalizeObservedAt(item.observedAt ?? item.observed_at),
      platform,
      channelId: safeString(item.channelId ?? item.channel_id).slice(0, 160) || null,
      contentId: safeString(item.contentId ?? item.content_id).slice(0, 240) || null,
      period: normalizePeriod(item.period),
      retentionRate,
      ctr,
      rankingLive,
      impressions: toNullableInteger(item.impressions, 0),
      views: toNullableInteger(item.views, 0),
      clicks: toNullableInteger(item.clicks, 0),
      watchTimeSeconds: toNullableInteger(item.watchTimeSeconds ?? item.watch_time_seconds, 0),
      source: normalizeSource(item.source),
      metadata: normalizeMetadata(item.metadata)
    }
  }
}

function scoreFromMinimum(value, min) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || min <= 0) return null
  const ratio = value / min
  return clampNumber(ratio * 100, 0, 120, null)
}

function scoreFromMaximum(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null
  const ratio = max / value
  return clampNumber(ratio * 100, 0, 120, null)
}

function buildMetricCheck({ id, label, value, target, comparator }) {
  const hasValue = Number.isFinite(Number(value))
  if (!hasValue) {
    return {
      id,
      label,
      value: null,
      target,
      comparator,
      status: 'missing',
      pass: false
    }
  }
  const numeric = Number(value)
  const pass = comparator === 'max' ? numeric <= Number(target) : numeric >= Number(target)
  return {
    id,
    label,
    value: round2(numeric),
    target: round2(Number(target)),
    comparator,
    status: pass ? 'pass' : 'fail',
    pass
  }
}

export function evaluateRealPlatformPerformance(input) {
  const platform = normalizePlatform(input?.platform)
  const benchmark = resolvePlatformRealPerformanceBenchmark(platform)
  const retentionRate = toNullableNumber(input?.retentionRate ?? input?.retention_rate, 0, 100)
  const ctr = toNullableNumber(input?.ctr, 0, 100)
  const rankingLive = toNullableNumber(input?.rankingLive ?? input?.ranking_live, 1, 100000)

  const checks = [
    buildMetricCheck({
      id: 'retention_rate',
      label: 'Retention Rate',
      value: retentionRate,
      target: benchmark.retentionRateMin,
      comparator: 'min'
    }),
    buildMetricCheck({
      id: 'ctr',
      label: 'CTR',
      value: ctr,
      target: benchmark.ctrMin,
      comparator: 'min'
    }),
    buildMetricCheck({
      id: 'ranking_live',
      label: 'Ranking Live',
      value: rankingLive,
      target: benchmark.rankingLiveMax,
      comparator: 'max'
    })
  ]

  const hasFail = checks.some((check) => check.status === 'fail')
  const missingMetrics = checks.filter((check) => check.status === 'missing').map((check) => check.id)
  let status = 'pass'
  if (hasFail) status = 'fail'
  else if (missingMetrics.length > 0) status = 'insufficient'

  const weightedComponents = [
    { weight: 45, score: scoreFromMinimum(retentionRate, benchmark.retentionRateMin) },
    { weight: 35, score: scoreFromMinimum(ctr, benchmark.ctrMin) },
    { weight: 20, score: scoreFromMaximum(rankingLive, benchmark.rankingLiveMax) }
  ].filter((item) => Number.isFinite(item.score))

  const weightSum = weightedComponents.reduce((acc, item) => acc + item.weight, 0)
  const weightedScore = weightSum > 0
    ? weightedComponents.reduce((acc, item) => acc + (item.score * item.weight), 0) / weightSum
    : null

  const completeness = round1((checks.filter((check) => check.status !== 'missing').length / checks.length) * 100)

  return {
    benchmarkVersion: REAL_PERFORMANCE_BENCHMARK_VERSION,
    platform: benchmark.platform || platform || '',
    status,
    completeness,
    score: Number.isFinite(weightedScore) ? round1(weightedScore) : null,
    missingMetrics,
    checks,
    benchmark
  }
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value))
  if (!numeric.length) return null
  const sum = numeric.reduce((acc, value) => acc + value, 0)
  return round2(sum / numeric.length)
}

export function mapPlatformPerformanceStorageRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  return {
    id: row.id || null,
    observedAt: row.observed_at || row.observedAt || null,
    platform: normalizePlatform(row.platform || ''),
    channelId: safeString(row.channel_id || row.channelId || '') || null,
    contentId: safeString(row.content_id || row.contentId || '') || null,
    period: normalizePeriod(row.period || 'daily'),
    retentionRate: toNullableNumber(row.retention_rate ?? row.retentionRate, 0, 100),
    ctr: toNullableNumber(row.ctr, 0, 100),
    rankingLive: toNullableNumber(row.ranking_live ?? row.rankingLive, 1, 100000),
    impressions: toNullableInteger(row.impressions, 0),
    views: toNullableInteger(row.views, 0),
    clicks: toNullableInteger(row.clicks, 0),
    watchTimeSeconds: toNullableInteger(row.watch_time_seconds ?? row.watchTimeSeconds, 0),
    source: normalizeSource(row.source || 'manual'),
    metadata: normalizeMetadata(row.metadata),
    createdByUserId: row.created_by_user_id || row.createdByUserId || null,
    createdByDisplayName: row.created_by_display_name || row.createdByDisplayName || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null
  }
}

export function aggregateRealPlatformPerformance(inputRows = []) {
  const rows = Array.isArray(inputRows) ? inputRows : []
  const accByPlatform = new Map(
    CANONICAL_PLATFORMS.map((platform) => [platform, {
      platform,
      total: 0,
      passCount: 0,
      failCount: 0,
      insufficientCount: 0,
      scoreValues: [],
      retentionValues: [],
      ctrValues: [],
      rankingValues: []
    }])
  )

  const evaluatedRows = rows
    .map((row) => {
      const mapped = mapPlatformPerformanceStorageRow(row) || (row && typeof row === 'object' ? row : null)
      if (!mapped) return null
      const evalResult = row?.evaluation && typeof row.evaluation === 'object'
        ? row.evaluation
        : evaluateRealPlatformPerformance(mapped)
      return { ...mapped, evaluation: evalResult }
    })
    .filter(Boolean)

  evaluatedRows.forEach((row) => {
    const platform = normalizePlatform(row.platform)
    if (!platform) return
    const bucket = accByPlatform.get(platform)
    if (!bucket) return
    bucket.total += 1
    const status = String(row?.evaluation?.status || '').toLowerCase()
    if (status === 'pass') bucket.passCount += 1
    else if (status === 'fail') bucket.failCount += 1
    else bucket.insufficientCount += 1

    if (Number.isFinite(Number(row?.evaluation?.score))) bucket.scoreValues.push(Number(row.evaluation.score))
    if (Number.isFinite(Number(row?.retentionRate))) bucket.retentionValues.push(Number(row.retentionRate))
    if (Number.isFinite(Number(row?.ctr))) bucket.ctrValues.push(Number(row.ctr))
    if (Number.isFinite(Number(row?.rankingLive))) bucket.rankingValues.push(Number(row.rankingLive))
  })

  const platforms = CANONICAL_PLATFORMS.map((platform) => {
    const bucket = accByPlatform.get(platform)
    const auditStatus = bucket.total > 0 && bucket.failCount === 0 && bucket.insufficientCount === 0
      ? 'PASS'
      : 'FAIL'
    const reasons = []
    if (bucket.total === 0) reasons.push('no_data')
    if (bucket.failCount > 0) reasons.push('has_failed_metrics')
    if (bucket.insufficientCount > 0) reasons.push('has_incomplete_metrics')
    if (!reasons.length) reasons.push('passed_all_metrics')
    return {
      platform,
      total: bucket.total,
      passCount: bucket.passCount,
      failCount: bucket.failCount,
      insufficientCount: bucket.insufficientCount,
      avgScore: average(bucket.scoreValues),
      avgRetentionRate: average(bucket.retentionValues),
      avgCtr: average(bucket.ctrValues),
      avgRankingLive: average(bucket.rankingValues),
      auditStatus,
      reasons
    }
  })

  const passPlatforms = platforms.filter((item) => item.auditStatus === 'PASS').map((item) => item.platform)
  const failPlatforms = platforms.filter((item) => item.auditStatus === 'FAIL').map((item) => item.platform)

  return {
    benchmarkVersion: REAL_PERFORMANCE_BENCHMARK_VERSION,
    totalRows: evaluatedRows.length,
    passCount: platforms.reduce((acc, item) => acc + item.passCount, 0),
    failCount: platforms.reduce((acc, item) => acc + item.failCount, 0),
    insufficientCount: platforms.reduce((acc, item) => acc + item.insufficientCount, 0),
    platforms,
    audit: {
      passPlatforms,
      failPlatforms,
      verdict: failPlatforms.length === 0 && passPlatforms.length === CANONICAL_PLATFORMS.length ? 'PASS' : 'FAIL',
      passPlatformCount: passPlatforms.length,
      totalPlatformCount: CANONICAL_PLATFORMS.length
    }
  }
}

