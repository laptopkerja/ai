import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, ButtonGroup, Card, Col, Dropdown, ListGroup, OverlayTrigger, Row, Tooltip } from 'react-bootstrap'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import { getLocalDraftRows, getLocalFallbackRows } from '../lib/generationStorage'
import { apiFetch } from '../lib/apiRuntime'
const DASHBOARD_WINDOW_OPTIONS = [7, 14, 30]
const DASHBOARD_FETCH_PAGE_SIZE = 500
const DASHBOARD_FETCH_MAX_PAGES = 200
const RECENT_ROWS_LIMIT = 8
const CANONICAL_PROVIDERS = ['Gemini', 'OpenAI', 'OpenRouter', 'Groq', 'Cohere AI', 'DeepSeek', 'Hugging Face']
const SOURCE_SCOPE_OPTIONS = [
  { key: 'all', label: 'All Source' },
  { key: 'supabase', label: 'Cloud' },
  { key: 'local', label: 'Local' }
]
const DECISION_SCOPE_OPTIONS = [
  { key: 'all', label: 'All Decision' },
  { key: 'GO', label: 'GO' },
  { key: 'REVISE', label: 'REVISE' },
  { key: 'BLOCK', label: 'BLOCK' }
]

function dateMsOf(row) {
  const ms = Date.parse(String(row?.created_at || ''))
  return Number.isFinite(ms) ? ms : 0
}

function sourceOf(row) {
  if (row?._localDraft) return 'draft'
  if (row?._localFallback) return 'offline'
  return 'supabase'
}

function sourceLabel(source) {
  if (source === 'draft') return 'Draft Lokal'
  if (source === 'offline') return 'Queue Offline'
  return 'Supabase'
}

function sourceVariant(source) {
  if (source === 'draft') return 'secondary'
  if (source === 'offline') return 'warning'
  return 'success'
}

function sourceRank(row) {
  const key = sourceOf(row)
  if (key === 'draft') return 1
  if (key === 'offline') return 2
  return 3
}

function decisionOf(row) {
  return String(row?.result?.meta?.aiDecision?.status || '').toUpperCase()
}

function decisionVariant(status) {
  if (status === 'GO') return 'success'
  if (status === 'REVISE') return 'warning'
  if (status === 'BLOCK') return 'danger'
  return 'secondary'
}

function decisionFillColor(status) {
  if (status === 'GO') return '#198754'
  if (status === 'REVISE') return '#ffc107'
  if (status === 'BLOCK') return '#dc3545'
  return '#6c757d'
}

function drilldownForAlertRule(ruleKey) {
  const key = String(ruleKey || '').trim().toLowerCase()
  if (key === 'go-rate-low') return { decision: 'REVISE' }
  if (key === 'score-low') return { sortBy: 'score_asc' }
  if (key === 'block-exist') return { decision: 'BLOCK' }
  if (key === 'provider-risk') return { decision: 'REVISE', sortBy: 'score_asc' }
  if (key === 'inactive-keys') return { _link: '/settings' }
  if (key === 'empty-filter') return {}
  return {}
}

function alertSeverityVariant(value) {
  const key = String(value || '').trim().toLowerCase()
  if (['secondary', 'info', 'warning', 'danger', 'success'].includes(key)) return key
  return 'secondary'
}

function modelOf(row) {
  return String(row?.result?.meta?.model || '').trim()
}

function scoreOf(row) {
  const finalScore = Number(row?.result?.meta?.finalScore)
  if (Number.isFinite(finalScore)) return finalScore
  const qualityScore = Number(row?.result?.meta?.qualityScore)
  if (Number.isFinite(qualityScore)) return qualityScore
  return null
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function displayNameOf(row, currentUser) {
  const rowName = String(row?.user_display_name || '').trim()
  if (rowName && !isEmailLike(rowName)) return rowName

  const rowUserId = String(row?.user_id || '').trim()
  const currentUserId = String(currentUser?.id || '').trim()
  if (rowUserId && rowUserId === currentUserId) {
    const ownDisplayName = String(
      currentUser?.user_metadata?.display_name ||
      currentUser?.user_metadata?.name ||
      ''
    ).trim()
    if (ownDisplayName) return ownDisplayName
    return 'You'
  }

  if (rowName && isEmailLike(rowName)) return rowName.split('@')[0]
  return '-'
}

function normalizeProviderName(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const key = text.toLowerCase()
  const aliasMap = {
    gemini: 'Gemini',
    openai: 'OpenAI',
    'open ai': 'OpenAI',
    openrouter: 'OpenRouter',
    openroute: 'OpenRouter',
    groq: 'Groq',
    cohere: 'Cohere AI',
    'cohere ai': 'Cohere AI',
    deepseek: 'DeepSeek',
    huggingface: 'Hugging Face',
    'hugging face': 'Hugging Face'
  }
  if (aliasMap[key]) return aliasMap[key]
  const canonical = CANONICAL_PROVIDERS.find((x) => x.toLowerCase() === key)
  return canonical || text
}

function platformOf(row) {
  return String(row?.platform || row?.result?.meta?.platform || '').trim()
}

function providerOf(row) {
  return normalizeProviderName(row?.provider || row?.result?.meta?.provider)
}

function rowTopic(row) {
  return String(
    row?.topic ||
    row?.result?.topic ||
    row?.result?.title ||
    '-'
  ).trim()
}

function mergeRows(cloudRows = [], draftRows = [], fallbackRows = []) {
  const map = new Map()
  const allRows = [...draftRows, ...fallbackRows, ...cloudRows]
  allRows.forEach((row, idx) => {
    const id = String(row?.id || '').trim()
    const key = id || `row-${idx}-${String(row?.created_at || '')}`
    const prev = map.get(key)
    if (!prev || sourceRank(row) >= sourceRank(prev)) map.set(key, row)
  })
  return Array.from(map.values()).sort((a, b) => dateMsOf(b) - dateMsOf(a))
}

function toDayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function createDayBuckets(days = 7) {
  const out = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    out.push({
      key: toDayKey(d),
      label: d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' })
    })
  }
  return out
}

function average(values = []) {
  if (!values.length) return null
  const sum = values.reduce((acc, n) => acc + Number(n || 0), 0)
  return sum / values.length
}

function providerElapsedMsOf(row) {
  const fromMeta = Number(row?.result?.meta?.providerRequest?.elapsedMs)
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta
  const legacy = Number(row?.result?.meta?.providerLatencyMs)
  if (Number.isFinite(legacy) && legacy > 0) return legacy
  return null
}

function providerAttemptsOf(row) {
  const value = Number(row?.result?.meta?.providerRequest?.attemptsUsed)
  if (Number.isFinite(value) && value >= 1) return value
  return null
}

function formatDurationMs(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(2)}s`
}

function applySourceScope(rows = [], sourceScope = 'all') {
  if (sourceScope === 'supabase') return rows.filter((row) => sourceOf(row) === 'supabase')
  if (sourceScope === 'local') return rows.filter((row) => sourceOf(row) !== 'supabase')
  return rows
}

function applyDecisionScope(rows = [], decisionScope = 'all') {
  const scope = String(decisionScope || 'all').toUpperCase()
  if (scope === 'ALL') return rows
  return rows.filter((row) => decisionOf(row) === scope)
}

function countByDecision(rows = []) {
  const out = { GO: 0, REVISE: 0, BLOCK: 0, UNKNOWN: 0 }
  rows.forEach((row) => {
    const decision = decisionOf(row)
    if (decision === 'GO' || decision === 'REVISE' || decision === 'BLOCK') {
      out[decision] += 1
      return
    }
    out.UNKNOWN += 1
  })
  return out
}

function topN(rows = [], pick, limit = 4) {
  const map = new Map()
  rows.forEach((row) => {
    const key = String(pick(row) || '').trim()
    if (!key) return
    map.set(key, (map.get(key) || 0) + 1)
  })
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

function providerHealthVariant(status) {
  if (status === 'healthy') return 'success'
  if (status === 'watch' || status === 'vision') return 'warning'
  if (status === 'tune') return 'danger'
  if (status === 'ready') return 'info'
  if (status === 'inactive' || status === 'idle') return 'secondary'
  return 'dark'
}

function providerHealthLabel(status) {
  if (status === 'healthy') return 'Healthy'
  if (status === 'watch') return 'Watch'
  if (status === 'vision') return 'Vision Check'
  if (status === 'tune') return 'Needs Tune'
  if (status === 'ready') return 'Ready'
  if (status === 'inactive') return 'Inactive'
  if (status === 'idle') return 'Idle'
  return 'Unknown'
}

function providerHealthDescription(status) {
  if (status === 'healthy') return 'Performa stabil: key aktif, kualitas baik, dan siap dipakai.'
  if (status === 'watch') return 'Perlu dipantau: ada indikasi penurunan skor/GO rate atau latency provider sedang tinggi.'
  if (status === 'vision') return 'Perlu cek model vision: ada kebutuhan gambar yang belum optimal.'
  if (status === 'tune') return 'Butuh tuning: risiko kualitas tinggi, evaluasi model/prompt disarankan.'
  if (status === 'ready') return 'Siap dipakai: key aktif dan bisa generate.'
  if (status === 'inactive') return 'Tidak aktif: key belum dikonfigurasi atau dimatikan.'
  if (status === 'idle') return 'Aktif tapi belum banyak dipakai pada window saat ini.'
  return 'Status belum dikenali.'
}

function keyStatusLabel(row, usage) {
  if (!row) return usage > 0 ? 'Server key' : 'n/a'
  if (!row.configured) return 'No key'
  return row.isActive ? 'Key on' : 'Key off'
}

function toDateInputValue(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildWindowDateRange(days = 7) {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (Math.max(1, Number(days) || 7) - 1))
  return { from: toDateInputValue(start), to: toDateInputValue(end) }
}

function buildProviderModelStats(rows = [], minCount = 2) {
  const map = new Map()
  rows.forEach((row) => {
    const provider = providerOf(row)
    const model = modelOf(row)
    if (!provider || !model) return
    const key = `${provider}|||${model}`
    const current = map.get(key) || {
      provider,
      model,
      label: `${provider} / ${model}`,
      count: 0,
      scoreValues: [],
      decisionTotal: 0,
      decisionGo: 0
    }
    current.count += 1
    const score = scoreOf(row)
    if (Number.isFinite(score)) current.scoreValues.push(score)
    const decision = decisionOf(row)
    if (decision) current.decisionTotal += 1
    if (decision === 'GO') current.decisionGo += 1
    map.set(key, current)
  })
  return Array.from(map.values())
    .filter((item) => item.count >= minCount)
    .map((item) => ({
      ...item,
      avgScore: average(item.scoreValues),
      goRate: item.decisionTotal > 0 ? (item.decisionGo / item.decisionTotal) * 100 : null
    }))
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function downloadFile(name, type, content) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function buildAuthHeaders() {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  } catch (e) {
    return {}
  }
}

async function fetchProviderKeyRows() {
  try {
    const headers = await buildAuthHeaders()
    if (!headers.Authorization) return { rows: [], error: 'Sesi login tidak ditemukan' }
    const resp = await apiFetch('/api/settings/provider-keys', { headers })
    if (!resp.ok) return { rows: [], error: `Provider key status HTTP ${resp.status}` }
    const payload = await resp.json()
    if (!payload?.ok || !Array.isArray(payload?.data)) {
      return { rows: [], error: 'Response provider key tidak valid' }
    }
    return { rows: payload.data, error: '' }
  } catch (e) {
    return { rows: [], error: 'Gagal memuat status provider key' }
  }
}

async function fetchDashboardCloudRowsForWindow(fromIso) {
  const rows = []
  for (let page = 0; page < DASHBOARD_FETCH_MAX_PAGES; page += 1) {
    const from = page * DASHBOARD_FETCH_PAGE_SIZE
    const to = from + DASHBOARD_FETCH_PAGE_SIZE - 1
    const resp = await supabase
      .from('generations')
      .select('id,user_id,user_display_name,topic,platform,provider,result,created_at')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (resp.error) {
      return { rows, error: resp.error, truncated: false }
    }

    const batch = Array.isArray(resp.data) ? resp.data : []
    rows.push(...batch)
    if (batch.length < DASHBOARD_FETCH_PAGE_SIZE) {
      return { rows, error: null, truncated: false }
    }
  }

  return { rows, error: null, truncated: true }
}

function mapApiErrorMessage(payload, fallback = 'Request gagal') {
  return String(payload?.error?.message || fallback).trim() || fallback
}

async function fetchDashboardAlertsApi(limit = 120) {
  const headers = await buildAuthHeaders()
  if (!headers.Authorization) return { ok: false, data: [], error: 'Sesi login tidak ditemukan' }
  const resp = await apiFetch(`/api/dashboard/alerts?limit=${Math.max(1, Math.min(limit, 200))}`, { headers })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok || !payload?.ok) {
    return { ok: false, data: [], error: mapApiErrorMessage(payload, `Gagal memuat alerts (${resp.status})`) }
  }
  return { ok: true, data: Array.isArray(payload.data) ? payload.data : [], error: '' }
}

async function syncDashboardAlertsApi(alerts = []) {
  const headers = await buildAuthHeaders()
  if (!headers.Authorization) return { ok: false, data: [], error: 'Sesi login tidak ditemukan' }
  const resp = await apiFetch('/api/dashboard/alerts/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ alerts })
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok || !payload?.ok) {
    return { ok: false, data: [], error: mapApiErrorMessage(payload, `Gagal sinkron alert (${resp.status})`) }
  }
  const rawData = payload.data
  if (Array.isArray(rawData)) {
    return { ok: true, data: rawData, mirror: null, error: '' }
  }
  if (rawData && typeof rawData === 'object') {
    return {
      ok: true,
      data: Array.isArray(rawData.rows) ? rawData.rows : [],
      mirror: rawData.mirror || null,
      error: ''
    }
  }
  return { ok: true, data: [], mirror: null, error: '' }
}

async function mutateDashboardAlertStatusApi(alertId, action) {
  const id = String(alertId || '').trim()
  const endpoint = String(action || '').trim().toLowerCase()
  if (!id || !endpoint) return { ok: false, data: null, error: 'Alert id/action tidak valid' }
  const headers = await buildAuthHeaders()
  if (!headers.Authorization) return { ok: false, data: null, error: 'Sesi login tidak ditemukan' }
  const resp = await apiFetch(`/api/dashboard/alerts/${encodeURIComponent(id)}/${encodeURIComponent(endpoint)}`, {
    method: 'POST',
    headers
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok || !payload?.ok) {
    return { ok: false, data: null, error: mapApiErrorMessage(payload, `Gagal update alert (${resp.status})`) }
  }
  return { ok: true, data: payload.data || null, error: '' }
}

async function fetchDashboardSnapshotsApi({ windowDays, sourceScope, decisionScope, limit = 20 }) {
  const headers = await buildAuthHeaders()
  if (!headers.Authorization) return { ok: false, data: [], error: 'Sesi login tidak ditemukan' }
  const params = new URLSearchParams()
  params.set('limit', String(Math.max(1, Math.min(limit, 120))))
  params.set('windowDays', String(Math.max(1, Number(windowDays) || 7)))
  params.set('sourceScope', String(sourceScope || 'all'))
  params.set('decisionScope', String(decisionScope || 'all').toLowerCase())
  const resp = await apiFetch(`/api/dashboard/snapshots?${params.toString()}`, { headers })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok || !payload?.ok) {
    return { ok: false, data: [], error: mapApiErrorMessage(payload, `Gagal memuat snapshots (${resp.status})`) }
  }
  return { ok: true, data: Array.isArray(payload.data) ? payload.data : [], error: '' }
}

async function runDashboardSnapshotApi(payload) {
  const headers = await buildAuthHeaders()
  if (!headers.Authorization) return { ok: false, data: null, error: 'Sesi login tidak ditemukan' }
  const resp = await apiFetch('/api/dashboard/snapshots/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload || {})
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok || !body?.ok) {
    return { ok: false, data: null, error: mapApiErrorMessage(body, `Gagal simpan snapshot (${resp.status})`) }
  }
  return { ok: true, data: body.data || null, error: '' }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [cloudCount, setCloudCount] = useState(0)
  const [currentUser, setCurrentUser] = useState(null)
  const [lastLoadedAt, setLastLoadedAt] = useState(null)
  const [windowDays, setWindowDays] = useState(7)
  const [sourceScope, setSourceScope] = useState('all')
  const [decisionScope, setDecisionScope] = useState('all')
  const [providerKeyRows, setProviderKeyRows] = useState([])
  const [providerKeyWarning, setProviderKeyWarning] = useState('')
  const [alertRows, setAlertRows] = useState([])
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertBusyId, setAlertBusyId] = useState('')
  const [alertTab, setAlertTab] = useState('open')
  const [alertError, setAlertError] = useState('')
  const [lastAlertSyncSignature, setLastAlertSyncSignature] = useState('')
  const [snapshotRows, setSnapshotRows] = useState([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')

  async function loadDashboard() {
    setLoading(true)
    setError('')
    setProviderKeyWarning('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const user = userData?.user || null
      setCurrentUser(user)

      if (!user?.id) {
        setRows([])
        setCloudCount(0)
        setLastAlertSyncSignature('')
        setLastLoadedAt(new Date())
        setLoading(false)
        return
      }

      const maxWindow = Math.max(...DASHBOARD_WINDOW_OPTIONS)
      const fromIso = new Date(Date.now() - (maxWindow * 24 * 60 * 60 * 1000)).toISOString()

      const [cloudResp, countResp, keyStatusResp] = await Promise.all([
        fetchDashboardCloudRowsForWindow(fromIso),
        supabase
          .from('generations')
          .select('id', { count: 'exact', head: true }),
        fetchProviderKeyRows()
      ])

      const localDraftRows = getLocalDraftRows(user.id)
      const localFallbackRows = getLocalFallbackRows(user.id)

      const cloudRows = cloudResp.error ? [] : (Array.isArray(cloudResp.rows) ? cloudResp.rows : [])
      const countFromHead = Number.isFinite(countResp?.count) ? countResp.count : null

      setProviderKeyRows(Array.isArray(keyStatusResp.rows) ? keyStatusResp.rows : [])
      if (keyStatusResp.error) setProviderKeyWarning(keyStatusResp.error)

      if (cloudResp.error && localDraftRows.length + localFallbackRows.length === 0) {
        setError('Gagal memuat data cloud dashboard.')
      } else if (cloudResp.error) {
        setError('Data cloud tidak tersedia, menampilkan data lokal.')
      } else if (cloudResp.truncated) {
        setError('Data cloud dashboard sangat besar; analitik memakai batch terbaru (maks 100.000 baris window).')
      }

      setCloudCount(countFromHead ?? cloudRows.length)
      setRows(mergeRows(cloudRows, localDraftRows, localFallbackRows))
      setLastAlertSyncSignature('')
      setLastLoadedAt(new Date())
    } catch (e) {
      setError('Gagal memuat dashboard.')
      setRows([])
      setCloudCount(0)
      setLastAlertSyncSignature('')
      setLastLoadedAt(new Date())
    } finally {
      setLoading(false)
    }
  }

  function openHistoryDrilldown(extra = {}) {
    const range = buildWindowDateRange(windowDays)
    const baseFilters = {
      source: sourceScope === 'local' ? 'local' : sourceScope,
      decision: decisionScope,
      dateFrom: range.from,
      dateTo: range.to,
      sortBy: 'created_desc'
    }
    const nextFilters = { ...baseFilters, ...(extra || {}) }
    navigate('/history', { state: { dashboardFilters: nextFilters } })
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  const dashboard = useMemo(() => {
    const nowMs = Date.now()
    const cutoffMs = nowMs - (windowDays * 24 * 60 * 60 * 1000)
    const windowRows = rows.filter((row) => dateMsOf(row) >= cutoffMs)
    const sourceScopedRows = applySourceScope(windowRows, sourceScope)
    const recentRows = applyDecisionScope(sourceScopedRows, decisionScope)
    const recentScores = recentRows.map(scoreOf).filter((n) => Number.isFinite(n))
    const recentDecisions = recentRows.map(decisionOf).filter(Boolean)
    const goCount = recentDecisions.filter((x) => x === 'GO').length
    const scoreAvg = average(recentScores)
    const goRate = recentDecisions.length ? (goCount / recentDecisions.length) * 100 : null
    const decisionCounts = countByDecision(recentRows)
    const decisionTotal = Object.values(decisionCounts).reduce((acc, n) => acc + n, 0)

    const sourceCounts = { supabase: 0, draft: 0, offline: 0 }
    windowRows.forEach((row) => {
      const key = sourceOf(row)
      sourceCounts[key] = (sourceCounts[key] || 0) + 1
    })

    const dayBuckets = createDayBuckets(windowDays)
    const perDay = new Map(dayBuckets.map((d) => [d.key, 0]))
    recentRows.forEach((row) => {
      const ms = dateMsOf(row)
      if (!ms) return
      const key = toDayKey(new Date(ms))
      if (!perDay.has(key)) return
      perDay.set(key, (perDay.get(key) || 0) + 1)
    })
    const trend = dayBuckets.map((d) => ({ ...d, count: perDay.get(d.key) || 0 }))
    const maxTrend = Math.max(1, ...trend.map((x) => x.count))

    const topPlatforms = topN(recentRows, platformOf, 4)
    const topProviders = topN(recentRows, providerOf, 4)
    const providerModelStats = buildProviderModelStats(recentRows, 2)
    const bestProviderModels = [...providerModelStats]
      .sort((a, b) => {
        const aGo = Number.isFinite(a.goRate) ? a.goRate : -1
        const bGo = Number.isFinite(b.goRate) ? b.goRate : -1
        if (bGo !== aGo) return bGo - aGo
        const aScore = Number.isFinite(a.avgScore) ? a.avgScore : -1
        const bScore = Number.isFinite(b.avgScore) ? b.avgScore : -1
        if (bScore !== aScore) return bScore - aScore
        return b.count - a.count
      })
      .slice(0, 5)
    const riskyProviderModels = [...providerModelStats]
      .sort((a, b) => {
        const aGo = Number.isFinite(a.goRate) ? a.goRate : 999
        const bGo = Number.isFinite(b.goRate) ? b.goRate : 999
        if (aGo !== bGo) return aGo - bGo
        const aScore = Number.isFinite(a.avgScore) ? a.avgScore : 999
        const bScore = Number.isFinite(b.avgScore) ? b.avgScore : 999
        if (aScore !== bScore) return aScore - bScore
        return b.count - a.count
      })
      .slice(0, 5)
    const teamMap = new Map()
    recentRows.forEach((row) => {
      const userId = String(row?.user_id || '').trim()
      const label = displayNameOf(row, currentUser)
      const key = userId || `label:${String(label || '-').trim().toLowerCase()}`
      const current = teamMap.get(key) || {
        key,
        userLabel: label || '-',
        userId,
        count: 0,
        scoreValues: [],
        decisionTotal: 0,
        decisionGo: 0,
        lastCreatedAtMs: 0
      }
      if (!current.userLabel || current.userLabel === '-' || isEmailLike(current.userLabel)) {
        if (label && label !== '-') current.userLabel = label
      }
      if (!current.userId && userId) current.userId = userId
      current.count += 1
      const score = scoreOf(row)
      if (Number.isFinite(score)) current.scoreValues.push(score)
      const decision = decisionOf(row)
      if (decision) current.decisionTotal += 1
      if (decision === 'GO') current.decisionGo += 1
      current.lastCreatedAtMs = Math.max(current.lastCreatedAtMs, dateMsOf(row))
      teamMap.set(key, current)
    })
    const teamPerformance = Array.from(teamMap.values())
      .map((item) => ({
        ...item,
        avgScore: average(item.scoreValues),
        goRate: item.decisionTotal > 0 ? (item.decisionGo / item.decisionTotal) * 100 : null
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        const aGo = Number.isFinite(a.goRate) ? a.goRate : -1
        const bGo = Number.isFinite(b.goRate) ? b.goRate : -1
        if (bGo !== aGo) return bGo - aGo
        return b.lastCreatedAtMs - a.lastCreatedAtMs
      })
      .slice(0, 10)
    const providerHealthRows = applySourceScope(windowRows, sourceScope)
    const providerKeyMap = new Map(
      (providerKeyRows || []).map((row) => [
        normalizeProviderName(row?.provider),
        row
      ])
    )
    const includeAllKeyProviders = sourceScope === 'all'
    const providerSet = new Set([
      ...providerHealthRows.map((row) => providerOf(row)).filter(Boolean),
      ...(includeAllKeyProviders ? Array.from(providerKeyMap.keys()).filter(Boolean) : [])
    ])
    const providerHealth = Array.from(providerSet).map((providerName) => {
      const keyRow = providerKeyMap.get(providerName) || null
      const providerRows = providerHealthRows.filter((row) => providerOf(row) === providerName)
      const usage = providerRows.length
      const scores = providerRows.map(scoreOf).filter((n) => Number.isFinite(n))
      const elapsedValues = providerRows.map(providerElapsedMsOf).filter((n) => Number.isFinite(n))
      const attemptsValues = providerRows.map(providerAttemptsOf).filter((n) => Number.isFinite(n))
      const avgScore = average(scores)
      const avgElapsedMs = average(elapsedValues)
      const avgAttempts = average(attemptsValues)
      const decisions = providerRows.map(decisionOf).filter(Boolean)
      const goRate = decisions.length
        ? (decisions.filter((x) => x === 'GO').length / decisions.length) * 100
        : null
      const imageRows = providerRows.filter((row) => Number(row?.result?.meta?.imageReferencesCount || 0) > 0)
      const visionOnRows = imageRows.filter((row) => String(row?.result?.meta?.vision?.mode || '') === 'multimodal')
      const visionCoverage = imageRows.length ? (visionOnRows.length / imageRows.length) * 100 : null
      const topModel = topN(providerRows, modelOf, 1)[0]?.label || '-'
      const keyConfigured = !!keyRow?.configured
      const keyActive = !!keyRow?.isActive && keyConfigured

      let status = 'idle'
      if (keyConfigured && !keyActive) {
        status = 'inactive'
      } else if (usage === 0) {
        status = keyActive ? 'ready' : 'idle'
      } else if (imageRows.length && Number.isFinite(visionCoverage) && visionCoverage < 50) {
        status = 'vision'
      } else if (Number.isFinite(avgElapsedMs) && avgElapsedMs > 26000) {
        status = 'watch'
      } else if (Number.isFinite(avgScore) && avgScore >= 85 && (!Number.isFinite(goRate) || goRate >= 70)) {
        status = 'healthy'
      } else if (Number.isFinite(avgScore) && avgScore >= 70) {
        status = 'watch'
      } else {
        status = 'tune'
      }

      return {
        providerName,
        usage,
        avgScore,
        avgElapsedMs,
        avgAttempts,
        goRate,
        topModel,
        visionCoverage,
        keyText: keyStatusLabel(keyRow, usage),
        status
      }
    })
      .sort((a, b) => {
        if (b.usage !== a.usage) return b.usage - a.usage
        return a.providerName.localeCompare(b.providerName, 'id')
      })

    const qualityRiskCount = providerHealth.filter((x) => x.status === 'tune' || x.status === 'vision').length
    const inactiveKeyCount = (providerKeyRows || []).filter((row) => row?.configured && !row?.isActive).length
    const alerts = []
    if (!recentRows.length) {
      alerts.push({
        key: 'empty-filter',
        variant: 'secondary',
        text: 'Tidak ada output pada filter aktif. Ubah source/decision atau range.'
      })
    }
    if (Number.isFinite(goRate) && goRate < 70) {
      alerts.push({
        key: 'go-rate-low',
        variant: 'warning',
        text: `GO rate ${goRate.toFixed(1)}% masih rendah. Review prompt dan preset utama.`
      })
    }
    if (Number.isFinite(scoreAvg) && scoreAvg < 75) {
      alerts.push({
        key: 'score-low',
        variant: 'warning',
        text: `Avg score ${scoreAvg.toFixed(1)}% di bawah target 75%. Perketat quality contract preset.`
      })
    }
    if ((decisionCounts.BLOCK || 0) > 0) {
      alerts.push({
        key: 'block-exist',
        variant: 'danger',
        text: `Ada ${decisionCounts.BLOCK} output BLOCK pada filter aktif.`
      })
    }
    if (qualityRiskCount > 0) {
      alerts.push({
        key: 'provider-risk',
        variant: 'warning',
        text: `Ada ${qualityRiskCount} provider berstatus risk (vision/tune).`
      })
    }
    if (sourceScope === 'all' && inactiveKeyCount > 0) {
      alerts.push({
        key: 'inactive-keys',
        variant: 'info',
        text: `${inactiveKeyCount} provider key nonaktif. Cek halaman Settings.`
      })
    }

    return {
      windowRows,
      recentRows,
      scoreAvg,
      goRate,
      sourceCounts,
      decisionCounts,
      decisionTotal,
      trend,
      maxTrend,
      topPlatforms,
      topProviders,
      bestProviderModels,
      riskyProviderModels,
      teamPerformance,
      providerHealth,
      qualityRiskCount,
      alerts
    }
  }, [rows, providerKeyRows, windowDays, sourceScope, decisionScope, currentUser])

  const computedAlertPayload = useMemo(() => {
    return (dashboard.alerts || []).map((item) => {
      const ruleKey = String(item?.key || '').trim().toLowerCase()
      return {
        key: `dashboard:${ruleKey}`,
        source: 'dashboard',
        severity: item?.variant || 'warning',
        message: String(item?.text || '').trim(),
        context: {
          ruleKey,
          windowDays,
          sourceScope,
          decisionScope,
          drilldown: drilldownForAlertRule(ruleKey)
        }
      }
    }).filter((item) => item.key && item.message)
  }, [dashboard.alerts, windowDays, sourceScope, decisionScope])
  const computedAlertSignature = useMemo(() => JSON.stringify(computedAlertPayload), [computedAlertPayload])

  async function loadPersistedAlerts() {
    setAlertsLoading(true)
    setAlertError('')
    try {
      const resp = await fetchDashboardAlertsApi(160)
      if (!resp.ok) {
        setAlertError(resp.error || 'Gagal memuat alert center')
        return
      }
      setAlertRows(resp.data || [])
    } catch (e) {
      setAlertError('Gagal memuat alert center')
    } finally {
      setAlertsLoading(false)
    }
  }

  async function loadPersistedSnapshots() {
    setSnapshotsLoading(true)
    setSnapshotError('')
    try {
      const resp = await fetchDashboardSnapshotsApi({
        windowDays,
        sourceScope,
        decisionScope,
        limit: 20
      })
      if (!resp.ok) {
        setSnapshotError(resp.error || 'Gagal memuat snapshots')
        return
      }
      setSnapshotRows(resp.data || [])
    } catch (e) {
      setSnapshotError('Gagal memuat snapshots')
    } finally {
      setSnapshotsLoading(false)
    }
  }

  async function syncComputedAlertsToServer() {
    if (!computedAlertPayload.length) {
      await loadPersistedAlerts()
      return
    }
    setAlertsLoading(true)
    setAlertError('')
    try {
      const resp = await syncDashboardAlertsApi(computedAlertPayload)
      if (!resp.ok) {
        setAlertError(resp.error || 'Gagal sinkron alert center')
        return
      }
      if (Array.isArray(resp.data) && resp.data.length) {
        setAlertRows(resp.data)
      } else {
        await loadPersistedAlerts()
      }
    } catch (e) {
      setAlertError('Gagal sinkron alert center')
    } finally {
      setAlertsLoading(false)
    }
  }

  useEffect(() => {
    if (!currentUser?.id) return
    const nextSignature = computedAlertSignature
    if (nextSignature === lastAlertSyncSignature) return
    setLastAlertSyncSignature(nextSignature)
    syncComputedAlertsToServer()
  }, [currentUser?.id, computedAlertSignature])

  useEffect(() => {
    if (!currentUser?.id) return
    loadPersistedSnapshots()
  }, [currentUser?.id, windowDays, sourceScope, decisionScope])

  async function handleAlertAction(alertRow, action) {
    const id = String(alertRow?.id || '').trim()
    if (!id || !action) return
    setAlertBusyId(id)
    setAlertError('')
    try {
      const resp = await mutateDashboardAlertStatusApi(id, action)
      if (!resp.ok) {
        setAlertError(resp.error || 'Gagal update alert')
        return
      }
      await loadPersistedAlerts()
    } catch (e) {
      setAlertError('Gagal update alert')
    } finally {
      setAlertBusyId('')
    }
  }

  function handleAlertNavigate(alertRow) {
    const context = alertRow?.context || {}
    const drilldown = context?.drilldown || {}
    const link = String(drilldown?._link || '').trim()
    if (link && link.startsWith('/')) {
      navigate(link)
      return
    }
    const query = { ...(drilldown || {}) }
    delete query._link
    openHistoryDrilldown(query)
  }

  const recentItems = useMemo(() => dashboard.recentRows.slice(0, RECENT_ROWS_LIMIT), [dashboard.recentRows])
  const localCount = (dashboard.sourceCounts.draft || 0) + (dashboard.sourceCounts.offline || 0)
  const sourceScopeLabel = SOURCE_SCOPE_OPTIONS.find((x) => x.key === sourceScope)?.label || 'All Source'
  const decisionScopeLabel = DECISION_SCOPE_OPTIONS.find((x) => x.key === decisionScope)?.label || 'All Decision'
  const filterDirty = sourceScope !== 'all' || decisionScope !== 'all'
  const openAlertCount = useMemo(
    () => (alertRows || []).filter((row) => String(row?.status || '').toLowerCase() === 'open').length,
    [alertRows]
  )
  const visibleAlertRows = useMemo(() => {
    const status = String(alertTab || 'open').toLowerCase()
    return (alertRows || []).filter((row) => String(row?.status || '').toLowerCase() === status)
  }, [alertRows, alertTab])
  const latestSnapshot = snapshotRows[0] || null
  const previousSnapshot = snapshotRows[1] || null
  const latestKpi = latestSnapshot?.summary?.kpi || {}
  const previousKpi = previousSnapshot?.summary?.kpi || {}
  const snapshotDelta = {
    output: Number(latestKpi.outputCount || 0) - Number(previousKpi.outputCount || 0),
    goRate: (Number(latestKpi.goRate || 0) - Number(previousKpi.goRate || 0)),
    avgScore: (Number(latestKpi.avgFinalScore || 0) - Number(previousKpi.avgFinalScore || 0))
  }

  function buildReportFileName(ext = 'json') {
    const ts = new Date()
      .toISOString()
      .replace(/[:]/g, '-')
      .replace(/\..+$/, '')
    const sourcePart = String(sourceScope || 'all').toLowerCase()
    const decisionPart = String(decisionScope || 'all').toLowerCase()
    return `dashboard-${windowDays}d-${sourcePart}-${decisionPart}-${ts}.${ext}`
  }

  function buildRecentReportRows() {
    return dashboard.recentRows.map((row) => ({
      user: displayNameOf(row, currentUser),
      topic: rowTopic(row),
      platform: platformOf(row),
      provider: providerOf(row),
      model: modelOf(row),
      source: sourceOf(row),
      score: scoreOf(row),
      decision: decisionOf(row),
      created_at: row?.created_at || ''
    }))
  }

  function buildDashboardSummary(generatedAt = new Date().toISOString()) {
    const range = buildWindowDateRange(windowDays)
    const recentRows = buildRecentReportRows()
    return {
      generatedAt,
      filters: {
        windowDays,
        source: sourceScope,
        decision: decisionScope,
        dateFrom: range.from,
        dateTo: range.to
      },
      kpi: {
        outputCount: dashboard.recentRows.length,
        goRate: Number.isFinite(dashboard.goRate) ? Number(dashboard.goRate.toFixed(2)) : null,
        avgFinalScore: Number.isFinite(dashboard.scoreAvg) ? Number(dashboard.scoreAvg.toFixed(2)) : null,
        providerRiskCount: dashboard.qualityRiskCount,
        cloudRecords: cloudCount,
        localRecords: localCount
      },
      decisionCounts: dashboard.decisionCounts,
      sourceCounts: dashboard.sourceCounts,
      topPlatforms: dashboard.topPlatforms,
      topProviders: dashboard.topProviders,
      bestProviderModels: dashboard.bestProviderModels,
      riskyProviderModels: dashboard.riskyProviderModels,
      teamPerformance: dashboard.teamPerformance,
      providerHealth: dashboard.providerHealth,
      alerts: dashboard.alerts.map((item) => ({
        key: item.key,
        severity: item.variant,
        message: item.text
      })),
      rows: recentRows
    }
  }

  async function handleSaveSnapshot() {
    setSnapshotSaving(true)
    setSnapshotError('')
    try {
      const summary = buildDashboardSummary(new Date().toISOString())
      const resp = await runDashboardSnapshotApi({
        windowDays,
        sourceScope,
        decisionScope: String(decisionScope || 'all').toLowerCase(),
        summary
      })
      if (!resp.ok) {
        setSnapshotError(resp.error || 'Gagal simpan snapshot')
        return
      }
      await loadPersistedSnapshots()
    } catch (e) {
      setSnapshotError('Gagal simpan snapshot')
    } finally {
      setSnapshotSaving(false)
    }
  }

  function handleExportDashboardReport(format = 'json') {
    const generatedAt = new Date().toISOString()
    const summary = buildDashboardSummary(generatedAt)
    const range = summary.filters || {}
    const recentRows = Array.isArray(summary.rows) ? summary.rows : []

    if (format === 'json') {
      downloadFile(
        buildReportFileName('json'),
        'application/json;charset=utf-8',
        JSON.stringify(summary, null, 2)
      )
      return
    }

    if (format === 'csv') {
      const headers = ['user', 'topic', 'platform', 'provider', 'model', 'source', 'score', 'decision', 'created_at']
      const lines = [headers.join(',')]
      recentRows.forEach((row) => {
        lines.push([
          csvEscape(row.user),
          csvEscape(row.topic),
          csvEscape(row.platform),
          csvEscape(row.provider),
          csvEscape(row.model),
          csvEscape(row.source),
          csvEscape(Number.isFinite(row.score) ? Number(row.score).toFixed(1) : ''),
          csvEscape(row.decision),
          csvEscape(row.created_at)
        ].join(','))
      })
      downloadFile(
        buildReportFileName('csv'),
        'text/csv;charset=utf-8',
        lines.join('\n')
      )
      return
    }

    const lines = [
      '# Dashboard Report',
      '',
      `Generated: ${generatedAt}`,
      '',
      '## Filters',
      '',
      `- Window: ${windowDays} hari`,
      `- Source: ${sourceScopeLabel}`,
      `- Decision: ${decisionScopeLabel}`,
      `- Date: ${range.dateFrom || '-'} s/d ${range.dateTo || '-'}`,
      '',
      '## KPI',
      '',
      `- Output: ${dashboard.recentRows.length}`,
      `- GO Rate: ${Number.isFinite(dashboard.goRate) ? `${dashboard.goRate.toFixed(1)}%` : '-'}`,
      `- Avg Final Score: ${Number.isFinite(dashboard.scoreAvg) ? `${dashboard.scoreAvg.toFixed(1)}%` : '-'}`,
      `- Provider Risk: ${dashboard.qualityRiskCount}`,
      `- Cloud Records: ${cloudCount}`,
      `- Local Records: ${localCount}`,
      '',
      '## Decision Counts',
      '',
      `- GO: ${dashboard.decisionCounts?.GO || 0}`,
      `- REVISE: ${dashboard.decisionCounts?.REVISE || 0}`,
      `- BLOCK: ${dashboard.decisionCounts?.BLOCK || 0}`,
      `- UNKNOWN: ${dashboard.decisionCounts?.UNKNOWN || 0}`,
      '',
      '## Team Performance',
      '',
      '| User | Count | GO Rate | Avg Score |',
      '| --- | --- | --- | --- |'
    ]
    ;(dashboard.teamPerformance || []).forEach((item) => {
      lines.push(
        `| ${String(item.userLabel || '-').replace(/\|/g, '\\|')} | ${item.count} | ${Number.isFinite(item.goRate) ? `${item.goRate.toFixed(1)}%` : '-'} | ${Number.isFinite(item.avgScore) ? `${item.avgScore.toFixed(1)}%` : '-'} |`
      )
    })
    lines.push('', '## Rows', '', '| User | Topic | Platform | Provider | Model | Source | Score | Decision | Created |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    recentRows.slice(0, 200).forEach((row) => {
      lines.push(
        `| ${String(row.user || '-').replace(/\|/g, '\\|')} | ${String(row.topic || '-').replace(/\|/g, '\\|')} | ${String(row.platform || '-').replace(/\|/g, '\\|')} | ${String(row.provider || '-').replace(/\|/g, '\\|')} | ${String(row.model || '-').replace(/\|/g, '\\|')} | ${String(row.source || '-').replace(/\|/g, '\\|')} | ${Number.isFinite(row.score) ? row.score.toFixed(1) : '-'} | ${String(row.decision || '-').replace(/\|/g, '\\|')} | ${String(row.created_at || '-').replace(/\|/g, '\\|')} |`
      )
    })

    downloadFile(
      buildReportFileName('md'),
      'text/markdown;charset=utf-8',
      lines.join('\n')
    )
  }

  return (
    <div className="dashboard-page">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h4 className="mb-0">Dashboard</h4>
          <small className="text-muted">
            Ringkasan performa konten {windowDays} hari terakhir
            {lastLoadedAt ? ` · update ${lastLoadedAt.toLocaleTimeString()}` : ''}
            {` · open alerts ${openAlertCount}`}
          </small>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap justify-content-end">
          <div className="d-flex align-items-center gap-1">
            <small className="text-muted">Range</small>
            <ButtonGroup size="sm">
              {DASHBOARD_WINDOW_OPTIONS.map((days) => (
                <Button
                  key={days}
                  variant={windowDays === days ? 'primary' : 'outline-secondary'}
                  onClick={() => setWindowDays(days)}
                >
                  {days}D
                </Button>
              ))}
            </ButtonGroup>
          </div>
          <Button as={Link} to="/generate" size="sm" variant="primary">Generate</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => openHistoryDrilldown()}>
            History
          </Button>
          <Button size="sm" variant="outline-secondary" disabled={loading} onClick={loadDashboard}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button size="sm" variant="outline-secondary" disabled={snapshotSaving || loading} onClick={handleSaveSnapshot}>
            {snapshotSaving ? 'Saving...' : 'Save Snapshot'}
          </Button>
          <Dropdown align="end">
            <Dropdown.Toggle size="sm" variant="outline-secondary">
              Export
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => handleExportDashboardReport('json')}>Export JSON</Dropdown.Item>
              <Dropdown.Item onClick={() => handleExportDashboardReport('csv')}>Export CSV</Dropdown.Item>
              <Dropdown.Item onClick={() => handleExportDashboardReport('md')}>Export Markdown</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      {error && <Alert variant="warning" className="mb-3">{error}</Alert>}

      <Row className="g-2 mb-3">
        <Col xs={12} lg={8}>
          <Card className="h-100">
            <Card.Body className="py-2 d-flex align-items-center flex-wrap gap-2">
              <small className="text-muted">Source</small>
              <ButtonGroup size="sm">
                {SOURCE_SCOPE_OPTIONS.map((item) => (
                  <Button
                    key={item.key}
                    variant={sourceScope === item.key ? 'primary' : 'outline-secondary'}
                    onClick={() => setSourceScope(item.key)}
                  >
                    {item.label}
                  </Button>
                ))}
              </ButtonGroup>
              <small className="text-muted ms-lg-2">Decision</small>
              <ButtonGroup size="sm">
                {DECISION_SCOPE_OPTIONS.map((item) => (
                  <Button
                    key={item.key}
                    variant={decisionScope === item.key ? decisionVariant(item.key) : 'outline-secondary'}
                    onClick={() => setDecisionScope(item.key)}
                  >
                    {item.label}
                  </Button>
                ))}
              </ButtonGroup>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card className="h-100">
            <Card.Body className="py-2 d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <small className="text-muted">Aktif: {sourceScopeLabel} · {decisionScopeLabel}</small>
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={!filterDirty}
                onClick={() => { setSourceScope('all'); setDecisionScope('all') }}
              >
                Reset Filter
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-1">
            <small className="text-muted">Action Signals</small>
            <div className="d-flex gap-2">
              <Button as={Link} to="/settings" size="sm" variant="outline-secondary">Settings</Button>
              <Button as={Link} to="/templates" size="sm" variant="outline-secondary">Templates</Button>
            </div>
          </div>
          {!dashboard.alerts.length ? (
            <small className="text-success">Semua indikator utama terlihat sehat pada filter aktif.</small>
          ) : (
            dashboard.alerts.map((item) => (
              <Alert key={item.key} variant={item.variant} className="py-1 px-2 mb-1">
                {item.text}
              </Alert>
            ))
          )}
        </Card.Body>
      </Card>

      <Row className="g-3 mb-3">
        <Col lg={7}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <h6 className="mb-0">Alert Center</h6>
                  <Badge bg="danger">{openAlertCount}</Badge>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <ButtonGroup size="sm">
                    <Button variant={alertTab === 'open' ? 'danger' : 'outline-secondary'} onClick={() => setAlertTab('open')}>Open</Button>
                    <Button variant={alertTab === 'acknowledged' ? 'warning' : 'outline-secondary'} onClick={() => setAlertTab('acknowledged')}>Acknowledged</Button>
                    <Button variant={alertTab === 'resolved' ? 'success' : 'outline-secondary'} onClick={() => setAlertTab('resolved')}>Resolved</Button>
                  </ButtonGroup>
                  <Button size="sm" variant="outline-secondary" onClick={loadPersistedAlerts} disabled={alertsLoading}>
                    {alertsLoading ? 'Loading...' : 'Refresh'}
                  </Button>
                </div>
              </div>
              {alertError && <Alert variant="warning" className="py-1 px-2 mb-2">{alertError}</Alert>}
              {!alertsLoading && !visibleAlertRows.length ? (
                <small className="text-muted">Tidak ada alert pada tab ini.</small>
              ) : (
                <ListGroup variant="flush">
                  {visibleAlertRows.map((row) => {
                    const status = String(row?.status || '').toLowerCase()
                    const isBusy = alertBusyId === row?.id
                    return (
                      <ListGroup.Item key={`alert-${row?.id}`} className="px-0 py-2">
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div className="dashboard-recent-text">
                            <div className="fw-semibold">{row?.message || '-'}</div>
                            <small className="text-muted">
                              key: {row?.alertKey || '-'} · seen: {row?.count || 1}
                              {row?.lastSeenAt ? ` · ${new Date(row.lastSeenAt).toLocaleString()}` : ''}
                            </small>
                            <div className="mt-1 d-flex gap-2 flex-wrap">
                              <Button size="sm" variant="outline-secondary" onClick={() => handleAlertNavigate(row)}>
                                Buka Konteks
                              </Button>
                              {status === 'open' && (
                                <>
                                  <OverlayTrigger
                                    placement="top"
                                    overlay={<Tooltip id={`tooltip-alert-ack-${String(row?.id || 'row')}`}>Acknowledge alert tanpa menutupnya.</Tooltip>}
                                  >
                                    <span className="d-inline-flex">
                                      <Button size="sm" variant="outline-warning" disabled={isBusy} onClick={() => handleAlertAction(row, 'ack')}>
                                        Ack
                                      </Button>
                                    </span>
                                  </OverlayTrigger>
                                  <OverlayTrigger
                                    placement="top"
                                    overlay={<Tooltip id={`tooltip-alert-resolve-${String(row?.id || 'row')}`}>Tandai alert selesai.</Tooltip>}
                                  >
                                    <span className="d-inline-flex">
                                      <Button size="sm" variant="outline-success" disabled={isBusy} onClick={() => handleAlertAction(row, 'resolve')}>
                                        Resolve
                                      </Button>
                                    </span>
                                  </OverlayTrigger>
                                </>
                              )}
                              {status === 'acknowledged' && (
                                <>
                                  <OverlayTrigger
                                    placement="top"
                                    overlay={<Tooltip id={`tooltip-alert-resolve-ack-${String(row?.id || 'row')}`}>Tandai alert selesai.</Tooltip>}
                                  >
                                    <span className="d-inline-flex">
                                      <Button size="sm" variant="outline-success" disabled={isBusy} onClick={() => handleAlertAction(row, 'resolve')}>
                                        Resolve
                                      </Button>
                                    </span>
                                  </OverlayTrigger>
                                  <Button size="sm" variant="outline-secondary" disabled={isBusy} onClick={() => handleAlertAction(row, 'reopen')}>
                                    Reopen
                                  </Button>
                                </>
                              )}
                              {status === 'resolved' && (
                                <Button size="sm" variant="outline-secondary" disabled={isBusy} onClick={() => handleAlertAction(row, 'reopen')}>
                                  Reopen
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="text-end">
                            <Badge bg={alertSeverityVariant(row?.severity)}>
                              {String(row?.severity || 'warning').toUpperCase()}
                            </Badge>
                            <div>
                              <small className="text-muted">{String(row?.status || '-').toUpperCase()}</small>
                            </div>
                          </div>
                        </div>
                      </ListGroup.Item>
                    )
                  })}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={5}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <h6 className="mb-0">Snapshot Timeline</h6>
                <Button size="sm" variant="outline-secondary" onClick={loadPersistedSnapshots} disabled={snapshotsLoading}>
                  {snapshotsLoading ? 'Loading...' : 'Refresh'}
                </Button>
              </div>
              {snapshotError && <Alert variant="warning" className="py-1 px-2 mb-2">{snapshotError}</Alert>}
              {latestSnapshot ? (
                <div className="mb-2">
                  <small className="d-block text-muted">
                    Latest: {latestSnapshot.snapshotDate || '-'}
                    {latestSnapshot.createdAt ? ` · ${new Date(latestSnapshot.createdAt).toLocaleString()}` : ''}
                  </small>
                  <small className="d-block text-muted">
                    Output: {Number(latestKpi.outputCount || 0)}
                    {previousSnapshot ? ` (${snapshotDelta.output >= 0 ? '+' : ''}${snapshotDelta.output})` : ''}
                  </small>
                  <small className="d-block text-muted">
                    GO: {Number.isFinite(Number(latestKpi.goRate)) ? `${Number(latestKpi.goRate).toFixed(1)}%` : '-'}
                    {previousSnapshot ? ` (${snapshotDelta.goRate >= 0 ? '+' : ''}${snapshotDelta.goRate.toFixed(1)}%)` : ''}
                  </small>
                  <small className="d-block text-muted">
                    Avg Score: {Number.isFinite(Number(latestKpi.avgFinalScore)) ? `${Number(latestKpi.avgFinalScore).toFixed(1)}%` : '-'}
                    {previousSnapshot ? ` (${snapshotDelta.avgScore >= 0 ? '+' : ''}${snapshotDelta.avgScore.toFixed(1)}%)` : ''}
                  </small>
                </div>
              ) : (
                <small className="text-muted d-block mb-2">Belum ada snapshot untuk scope aktif.</small>
              )}

              {!snapshotsLoading && snapshotRows.length > 0 && (
                <ListGroup variant="flush">
                  {snapshotRows.slice(0, 8).map((item) => (
                    <ListGroup.Item key={`snap-${item.id}`} className="px-0 py-2">
                      <div className="d-flex justify-content-between align-items-center gap-2">
                        <div>
                          <div className="fw-semibold">{item.snapshotDate || '-'}</div>
                          <small className="text-muted">
                            {item.generatedByDisplayName || '-'} · {item.windowDays}D · {item.sourceScope}/{String(item.decisionScope || '').toUpperCase()}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({
                            source: item.sourceScope || 'all',
                            decision: String(item.decisionScope || 'all').toUpperCase()
                          })}
                        >
                          Buka
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col xs={6} md={3}>
          <Card className="h-100 dashboard-kpi-card">
            <Card.Body>
              <small className="text-muted">Output {windowDays} Hari</small>
              <div className="dashboard-kpi-value">{dashboard.recentRows.length}</div>
              <small className="dashboard-kpi-sub">Sesuai source/decision filter</small>
              <Button size="sm" variant="outline-secondary" onClick={() => openHistoryDrilldown()}>
                Detail
              </Button>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100 dashboard-kpi-card">
            <Card.Body>
              <small className="text-muted">GO Rate</small>
              <div className="dashboard-kpi-value">
                {Number.isFinite(dashboard.goRate) ? `${dashboard.goRate.toFixed(1)}%` : '-'}
              </div>
              <small className="dashboard-kpi-sub">Dari output dengan decision</small>
              <Button size="sm" variant="outline-success" onClick={() => openHistoryDrilldown({ decision: 'GO' })}>
                Lihat GO
              </Button>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100 dashboard-kpi-card">
            <Card.Body>
              <small className="text-muted">Avg Final Score</small>
              <div className="dashboard-kpi-value">
                {Number.isFinite(dashboard.scoreAvg) ? `${dashboard.scoreAvg.toFixed(1)}%` : '-'}
              </div>
              <small className="dashboard-kpi-sub">Nilai compliance/performance gate</small>
              <Button size="sm" variant="outline-primary" onClick={() => openHistoryDrilldown({ sortBy: 'score_desc' })}>
                Score Tertinggi
              </Button>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100 dashboard-kpi-card">
            <Card.Body>
              <small className="text-muted">Provider Risk</small>
              <div className="dashboard-kpi-value">{dashboard.qualityRiskCount}</div>
              <small className="dashboard-kpi-sub">Status watch/needs tune</small>
              <Button size="sm" variant="outline-warning" onClick={() => openHistoryDrilldown({ decision: 'REVISE', sortBy: 'score_asc' })}>
                Cek Risiko
              </Button>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100 dashboard-kpi-card">
            <Card.Body>
              <small className="text-muted">Cloud Records (All)</small>
              <div className="dashboard-kpi-value">{cloudCount}</div>
              <small className="dashboard-kpi-sub">Draft/offline lokal: {localCount}</small>
              <Button size="sm" variant="outline-info" onClick={() => openHistoryDrilldown({ source: 'supabase' })}>
                Lihat Cloud
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col lg={8}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">Tren Output {windowDays} Hari</h6>
                <small className="text-muted">Count per hari</small>
              </div>
              <div
                className="dashboard-trend-grid"
                style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))` }}
              >
                {dashboard.trend.map((item) => {
                  const pct = item.count > 0 ? Math.max(12, (item.count / dashboard.maxTrend) * 100) : 6
                  return (
                    <div key={item.key} className="dashboard-trend-col" title={`${item.label}: ${item.count}`}>
                      <div className="dashboard-trend-bar-wrap">
                        <div className="dashboard-trend-bar" style={{ height: `${pct}%` }} />
                      </div>
                      <small className="dashboard-trend-count">{item.count}</small>
                      <small className="dashboard-trend-label">{item.label}</small>
                    </div>
                  )
                })}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-2">Source Breakdown</h6>
              {['supabase', 'draft', 'offline'].map((source) => {
                const count = dashboard.sourceCounts[source] || 0
                const total = dashboard.windowRows.length || 1
                const pct = Math.round((count / total) * 100)
                return (
                  <div key={source} className="dashboard-source-line">
                    <div className="d-flex justify-content-between align-items-center gap-2">
                      <small>{sourceLabel(source)}</small>
                      <div className="d-flex align-items-center gap-2">
                        <small>{count} ({pct}%)</small>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ source })}
                        >
                          Lihat
                        </Button>
                      </div>
                    </div>
                    <div className="dashboard-source-progress">
                      <div className={`dashboard-source-progress-fill is-${source}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3">
        <Col lg={4}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-2">Decision Overview</h6>
              {['GO', 'REVISE', 'BLOCK'].map((status) => {
                const count = dashboard.decisionCounts?.[status] || 0
                const total = dashboard.decisionTotal || 1
                const pct = Math.round((count / total) * 100)
                return (
                  <div key={status} className="dashboard-source-line">
                    <div className="d-flex justify-content-between align-items-center gap-2">
                      <small>{status}</small>
                      <div className="d-flex align-items-center gap-2">
                        <small>{count} ({pct}%)</small>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ decision: status })}
                        >
                          Lihat
                        </Button>
                      </div>
                    </div>
                    <div className="dashboard-source-progress">
                      <div
                        className="dashboard-source-progress-fill"
                        style={{ width: `${pct}%`, background: decisionFillColor(status) }}
                      />
                    </div>
                  </div>
                )
              })}
              {(dashboard.decisionCounts?.UNKNOWN || 0) > 0 && (
                <small className="text-muted">
                  Unknown decision: {dashboard.decisionCounts.UNKNOWN}
                </small>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-2">Top Platform</h6>
              {dashboard.topPlatforms.length ? (
                <ListGroup variant="flush">
                  {dashboard.topPlatforms.map((item) => (
                    <ListGroup.Item key={`platform-${item.label}`} className="px-0 d-flex justify-content-between align-items-center">
                      <span>{item.label}</span>
                      <div className="d-flex align-items-center gap-2">
                        <Badge bg="dark">{item.count}</Badge>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ platform: item.label })}
                        >
                          Lihat
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : (
                <small className="text-muted">Belum ada data platform.</small>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-2">Top Provider</h6>
              {dashboard.topProviders.length ? (
                <ListGroup variant="flush">
                  {dashboard.topProviders.map((item) => (
                    <ListGroup.Item key={`provider-${item.label}`} className="px-0 d-flex justify-content-between align-items-center">
                      <span>{item.label}</span>
                      <div className="d-flex align-items-center gap-2">
                        <Badge bg="info">{item.count}</Badge>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ provider: item.label })}
                        >
                          Lihat
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              ) : (
                <small className="text-muted">Belum ada data provider.</small>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mt-0">
        <Col lg={6}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-2">Leaderboard: Best Provider/Model</h6>
              {!dashboard.bestProviderModels.length ? (
                <small className="text-muted">Belum cukup data (min 2 output per model).</small>
              ) : (
                <ListGroup variant="flush">
                  {dashboard.bestProviderModels.map((item) => (
                    <ListGroup.Item key={`best-${item.label}`} className="px-0 py-2">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="dashboard-recent-text">
                          <div className="fw-semibold dashboard-recent-topic">{item.label}</div>
                          <small className="text-muted">
                            Use: {item.count}
                            {Number.isFinite(item.goRate) ? ` · GO: ${item.goRate.toFixed(0)}%` : ''}
                            {Number.isFinite(item.avgScore) ? ` · Avg: ${item.avgScore.toFixed(1)}%` : ''}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ provider: item.provider })}
                        >
                          Lihat
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="h-100">
            <Card.Body>
              <h6 className="mb-2">Leaderboard: Needs Attention</h6>
              {!dashboard.riskyProviderModels.length ? (
                <small className="text-muted">Belum cukup data (min 2 output per model).</small>
              ) : (
                <ListGroup variant="flush">
                  {dashboard.riskyProviderModels.map((item) => (
                    <ListGroup.Item key={`risk-${item.label}`} className="px-0 py-2">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="dashboard-recent-text">
                          <div className="fw-semibold dashboard-recent-topic">{item.label}</div>
                          <small className="text-muted">
                            Use: {item.count}
                            {Number.isFinite(item.goRate) ? ` · GO: ${item.goRate.toFixed(0)}%` : ''}
                            {Number.isFinite(item.avgScore) ? ` · Avg: ${item.avgScore.toFixed(1)}%` : ''}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ provider: item.provider, sortBy: 'score_asc' })}
                        >
                          Review
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mt-0">
        <Col lg={12}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                <h6 className="mb-0">Team Performance</h6>
                <small className="text-muted">Berdasarkan output pada filter aktif</small>
              </div>
              {!dashboard.teamPerformance.length ? (
                <small className="text-muted">Belum ada data tim pada filter aktif.</small>
              ) : (
                <ListGroup variant="flush">
                  {dashboard.teamPerformance.map((item) => (
                    <ListGroup.Item key={`team-${item.key || item.userId || item.userLabel}`} className="px-0 py-2">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="dashboard-recent-text">
                          <div className="fw-semibold">{item.userLabel || '-'}</div>
                          <small className="text-muted">
                            Output: {item.count}
                            {Number.isFinite(item.goRate) ? ` · GO: ${item.goRate.toFixed(1)}%` : ''}
                            {Number.isFinite(item.avgScore) ? ` · Avg: ${item.avgScore.toFixed(1)}%` : ''}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => openHistoryDrilldown({ search: item.userLabel || '' })}
                        >
                          Lihat History
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mt-0">
        <Col lg={5}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">Provider Health</h6>
                <small className="text-muted">{windowDays}D window</small>
              </div>
              {providerKeyWarning && (
                <Alert variant="warning" className="py-1 px-2 mb-2">
                  {providerKeyWarning}
                </Alert>
              )}
              {!dashboard.providerHealth.length ? (
                <small className="text-muted">Belum ada data provider.</small>
              ) : (
                <ListGroup variant="flush">
                  {dashboard.providerHealth.map((item) => (
                    <ListGroup.Item key={`health-${item.providerName}`} className="px-0 py-2">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="dashboard-recent-text">
                          <div className="fw-semibold">{item.providerName}</div>
                          <small className="text-muted">
                            Key: {item.keyText} · Top model: {item.topModel}
                          </small>
                          <div>
                            <small className="text-muted">
                              Use: {item.usage}
                              {Number.isFinite(item.avgScore) ? ` · Avg: ${item.avgScore.toFixed(1)}%` : ''}
                              {Number.isFinite(item.goRate) ? ` · GO: ${item.goRate.toFixed(0)}%` : ''}
                              {Number.isFinite(item.visionCoverage) ? ` · Vision: ${item.visionCoverage.toFixed(0)}%` : ''}
                              {Number.isFinite(item.avgElapsedMs) ? ` · Avg RTT: ${formatDurationMs(item.avgElapsedMs)}` : ''}
                              {Number.isFinite(item.avgAttempts) ? ` · Attempts: ${item.avgAttempts.toFixed(1)}` : ''}
                            </small>
                          </div>
                          <div className="mt-1">
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => openHistoryDrilldown({ provider: item.providerName })}
                            >
                              Lihat History
                            </Button>
                          </div>
                        </div>
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip id={`tooltip-provider-health-${String(item.providerName || 'provider').replace(/\s+/g, '-').toLowerCase()}`}>{providerHealthDescription(item.status)}</Tooltip>}
                        >
                          <span className="d-inline-flex">
                            <Badge bg={providerHealthVariant(item.status)} text={item.status === 'watch' || item.status === 'vision' ? 'dark' : undefined}>
                              {providerHealthLabel(item.status)}
                            </Badge>
                          </span>
                        </OverlayTrigger>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={7}>
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">Aktivitas Terbaru</h6>
                <Button size="sm" variant="outline-secondary" onClick={() => openHistoryDrilldown()}>
                  Open History
                </Button>
              </div>
              {!recentItems.length ? (
                <small className="text-muted">Belum ada aktivitas.</small>
              ) : (
                <ListGroup variant="flush">
                  {recentItems.map((row, idx) => {
                    const rowSource = sourceOf(row)
                    const score = scoreOf(row)
                    const decision = decisionOf(row)
                    return (
                      <ListGroup.Item key={String(row?.id || idx)} className="px-0 py-2">
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div className="dashboard-recent-text">
                            <div className="fw-semibold dashboard-recent-topic">{rowTopic(row)}</div>
                            <small className="text-muted">
                              {displayNameOf(row, currentUser)} · {platformOf(row) || '-'} · {providerOf(row) || '-'}
                            </small>
                            <div className="mt-1">
                              <Button
                                size="sm"
                                variant="outline-primary"
                                onClick={() => navigate('/generate', { state: { historyItem: row } })}
                              >
                                Gunakan
                              </Button>
                            </div>
                          </div>
                          <div className="text-end">
                            <Badge bg={sourceVariant(rowSource)} text={rowSource === 'offline' ? 'dark' : undefined} className="mb-1">
                              {sourceLabel(rowSource)}
                            </Badge>
                            <div>
                              {Number.isFinite(score) ? (
                                <small className="text-muted">
                                  {Number(score).toFixed(1)}%{decision ? ` · ${decision}` : ''}
                                </small>
                              ) : (
                                <small className="text-muted">{decision || '-'}</small>
                              )}
                            </div>
                          </div>
                        </div>
                      </ListGroup.Item>
                    )
                  })}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
