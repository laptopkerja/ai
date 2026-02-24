import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Col, Dropdown, Form, Modal, Pagination, Row, Table, Toast, ToastContainer } from 'react-bootstrap'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { supabase } from '../supabase/client'
import {
  cleanupLocalHistoryByAge,
  getLocalDraftRows,
  getLocalFallbackRows,
  removeLocalHistoryByIds,
  saveGenerationPrimary,
  syncLocalFallbackToSupabase,
  upsertLocalDraft
} from '../lib/generationStorage'
import { apiFetch } from '../lib/apiRuntime'
const PAGE_SIZE_OPTIONS = [13, 25, 50, 100]
const HISTORY_ACTION_ICON_SIZE = 25

function sourceOf(row) {
  if (row?._localFallback) return 'offline'
  if (row?._localDraft) return 'draft'
  return 'supabase'
}

function sourceLabel(row) {
  const key = sourceOf(row)
  if (key === 'draft') return 'Draft Lokal'
  if (key === 'offline') return 'Queue Offline'
  return 'Supabase'
}

function sourceIconByKey(sourceKey) {
  if (sourceKey === 'draft') return 'icon-park-outline:browser-chrome'
  if (sourceKey === 'supabase') return 'devicon:supabase'
  return ''
}

function sourceBadgeContent(row) {
  const sourceKey = sourceOf(row)
  const label = sourceLabel(row)
  const iconName = sourceIconByKey(sourceKey)
  if (!iconName) return label
  return (
    <span className="d-inline-flex align-items-center justify-content-center" title={label} aria-label={label}>
      <Icon icon={iconName} width="15" height="15" />
    </span>
  )
}

function sourceVariant(row) {
  const key = sourceOf(row)
  if (key === 'draft') return 'secondary'
  if (key === 'offline') return 'warning'
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

function scoreOf(row) {
  const finalScore = Number(row?.result?.meta?.finalScore)
  if (Number.isFinite(finalScore)) return finalScore
  const qualityScore = Number(row?.result?.meta?.qualityScore)
  if (Number.isFinite(qualityScore)) return qualityScore
  return null
}

function dateMsOf(row) {
  const ms = Date.parse(String(row?.created_at || ''))
  return Number.isFinite(ms) ? ms : 0
}

function normalizeIncomingSource(value) {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'supabase' || key === 'draft' || key === 'offline' || key === 'all' || key === 'local') return key
  return 'all'
}

function normalizeIncomingDecision(value) {
  const key = String(value || '').trim().toUpperCase()
  if (key === 'GO' || key === 'REVISE' || key === 'BLOCK') return key
  return 'all'
}

function text(v) {
  return String(v || '').trim().toLowerCase()
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
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

function buildDisplayNameMapFromRows(rows = []) {
  const out = {}
  rows.forEach((row) => {
    const userId = String(row?.user_id || '').trim()
    const userDisplayName = String(row?.user_display_name || '').trim()
    if (!userId || !userDisplayName || isEmailLike(userDisplayName)) return
    out[userId] = userDisplayName
  })
  return out
}

function collectMissingDisplayNameUserIds(rows = []) {
  const ids = new Set()
  rows.forEach((row) => {
    const userId = String(row?.user_id || '').trim()
    const userDisplayName = String(row?.user_display_name || '').trim()
    if (!userId) return
    if (!userDisplayName || isEmailLike(userDisplayName)) ids.add(userId)
  })
  return Array.from(ids)
}

async function fetchDisplayNameMapFromApi(userIds = []) {
  const uniqueIds = Array.from(new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 500)
  if (!uniqueIds.length) return {}
  try {
    const authHeaders = await buildAuthHeaders()
    const headers = { 'Content-Type': 'application/json', ...authHeaders }
    const resp = await apiFetch('/api/history/user-display-names', {
      method: 'POST',
      headers,
      body: JSON.stringify({ userIds: uniqueIds })
    })
    if (!resp.ok) return {}
    const payload = await resp.json()
    if (!payload?.ok || !payload?.data || typeof payload.data !== 'object') return {}
    return payload.data
  } catch (e) {
    return {}
  }
}

function enrichRowsWithProfileDisplayNames(rows = [], nameMap = {}) {
  if (!rows.length || !nameMap || typeof nameMap !== 'object') return rows
  return rows.map((row) => {
    const uid = String(row?.user_id || '').trim()
    if (!uid) return row
    const candidate = String(nameMap[uid] || '').trim()
    if (!candidate) return row
    const current = String(row?.user_display_name || '').trim()
    if (!current || isEmailLike(current)) {
      return { ...row, user_display_name: candidate }
    }
    return row
  })
}

function searchMatch(row, q) {
  const needle = text(q)
  if (!needle) return true
  const haystack = [
    row?.user_display_name,
    row?.topic,
    row?.platform,
    row?.provider,
    row?.result?.title,
    row?.result?.hook,
    row?.result?.description,
    row?.result?.narrator
  ].map((x) => text(x)).join(' ')
  return haystack.includes(needle)
}

function sortRows(rows = [], sortBy = 'created_desc') {
  const out = [...rows]
  out.sort((a, b) => {
    if (sortBy === 'created_asc') return dateMsOf(a) - dateMsOf(b)
    if (sortBy === 'score_desc') return (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1)
    if (sortBy === 'score_asc') return (scoreOf(a) ?? -1) - (scoreOf(b) ?? -1)
    if (sortBy === 'topic_asc') return String(a.topic || '').localeCompare(String(b.topic || ''), 'id')
    if (sortBy === 'provider_asc') return String(a.provider || '').localeCompare(String(b.provider || ''), 'id')
    if (sortBy === 'platform_asc') return String(a.platform || '').localeCompare(String(b.platform || ''), 'id')
    return dateMsOf(b) - dateMsOf(a)
  })
  return out
}

function mergeRows(cloudRows = [], draftRows = [], fallbackRows = []) {
  const map = new Map()
  const all = [...draftRows, ...fallbackRows, ...cloudRows]
  all.forEach((row, idx) => {
    const id = String(row?.id || '').trim()
    const key = id || `row-${idx}-${String(row?.created_at || '')}`
    const prev = map.get(key)
    if (!prev || sourceRank(row) >= sourceRank(prev)) map.set(key, row)
  })
  return sortRows(Array.from(map.values()), 'created_desc')
}

function toHistoryEntry(row, overrides = {}) {
  const id = String(overrides.id || row?.id || '').trim() || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    user_display_name: overrides.user_display_name ?? row?.user_display_name ?? null,
    topic: overrides.topic ?? row?.topic ?? row?.result?.topic ?? row?.result?.title ?? '',
    platform: overrides.platform ?? row?.platform ?? row?.result?.platform ?? row?.result?.meta?.platform ?? '',
    provider: overrides.provider ?? row?.provider ?? row?.result?.meta?.provider ?? '',
    result: overrides.result || { ...(row?.result || {}), _historyId: id },
    created_at: overrides.created_at || new Date().toISOString()
  }
}

function mapCloudSort(sortBy) {
  if (sortBy === 'created_asc') return { column: 'created_at', ascending: true, scoreClientSort: false }
  if (sortBy === 'topic_asc') return { column: 'topic', ascending: true, scoreClientSort: false }
  if (sortBy === 'provider_asc') return { column: 'provider', ascending: true, scoreClientSort: false }
  if (sortBy === 'platform_asc') return { column: 'platform', ascending: true, scoreClientSort: false }
  if (sortBy === 'score_desc' || sortBy === 'score_asc') return { column: 'created_at', ascending: false, scoreClientSort: true }
  return { column: 'created_at', ascending: false, scoreClientSort: false }
}

function csvEscape(v) {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function download(name, type, content) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function exportHistoryRows(rows, format, prefix = 'history') {
  const normalized = rows.map((row) => ({
    id: row.id || null,
    user_display_name: row.user_display_name || null,
    source: sourceOf(row),
    topic: row.topic || '',
    platform: row.platform || '',
    provider: row.provider || '',
    decision: decisionOf(row),
    score: scoreOf(row),
    created_at: row.created_at || null,
    result: row.result || null
  }))
  const ts = Date.now()
  const safe = String(prefix || 'history').replace(/[^a-zA-Z0-9-_]+/g, '_')
  if (format === 'csv') {
    const headers = ['id', 'user_display_name', 'source', 'topic', 'platform', 'provider', 'decision', 'score', 'created_at']
    const lines = [headers.join(',')]
    normalized.forEach((r) => {
      lines.push([
        csvEscape(r.id),
        csvEscape(r.user_display_name),
        csvEscape(r.source),
        csvEscape(r.topic),
        csvEscape(r.platform),
        csvEscape(r.provider),
        csvEscape(r.decision),
        csvEscape(r.score ?? ''),
        csvEscape(r.created_at)
      ].join(','))
    })
    download(`${safe}-${ts}.csv`, 'text/csv;charset=utf-8', lines.join('\n'))
    return
  }
  if (format === 'md') {
    const lines = ['# History Export', '', `Generated: ${new Date().toISOString()}`, '', '| # | User | Topic | Platform | Provider | Source | Score | Decision | Created |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    normalized.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${String(r.user_display_name || '-').replace(/\|/g, '\\|')} | ${String(r.topic || '-').replace(/\|/g, '\\|')} | ${String(r.platform || '-').replace(/\|/g, '\\|')} | ${String(r.provider || '-').replace(/\|/g, '\\|')} | ${r.source} | ${r.score ?? '-'} | ${r.decision || '-'} | ${r.created_at || '-'} |`)
    })
    download(`${safe}-${ts}.md`, 'text/markdown;charset=utf-8', lines.join('\n'))
    return
  }
  download(`${safe}-${ts}.json`, 'application/json;charset=utf-8', JSON.stringify(normalized, null, 2))
}

function buildModernPaginationItems(currentPage, totalPages) {
  const page = Math.max(1, Number(currentPage) || 1)
  const total = Math.max(1, Number(totalPages) || 1)
  if (total <= 7) return Array.from({ length: total }, (_, idx) => idx + 1)

  const items = [1]
  let start = Math.max(2, page - 1)
  let end = Math.min(total - 1, page + 1)

  if (page <= 3) {
    start = 2
    end = 4
  } else if (page >= total - 2) {
    start = total - 3
    end = total - 1
  }

  if (start > 2) items.push('ellipsis-left')
  for (let p = start; p <= end; p += 1) items.push(p)
  if (end < total - 1) items.push('ellipsis-right')
  items.push(total)
  return items
}

export default function HistoryList() {
  const navigate = useNavigate()
  const location = useLocation()
  const firstLoadRef = useRef(true)
  const displayNameCacheRef = useRef({})
  const drilldownAppliedRef = useRef('')

  const [rows, setRows] = useState([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState(null)
  const [selected, setSelected] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterSource, setFilterSource] = useState('all')
  const [filterDecision, setFilterDecision] = useState('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [sortBy, setSortBy] = useState('created_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(13)
  const [cloudTotalCount, setCloudTotalCount] = useState(0)
  const [localShownCount, setLocalShownCount] = useState(0)
  const [bulkExportFormat, setBulkExportFormat] = useState('json')
  const [deletePayload, setDeletePayload] = useState(null)
  const [toastState, setToastState] = useState({ show: false, bg: 'secondary', message: '', autohide: true, delay: 2600, mode: 'message' })

  const serverCloudPaginationMode = filterSource === 'supabase'
  const totalItemCount = serverCloudPaginationMode ? cloudTotalCount : rows.length
  const totalPages = Math.max(1, Math.ceil(totalItemCount / pageSize))
  const paginationEnabled = totalPages > 1
  const pageStartIndex = (Math.max(1, page) - 1) * pageSize
  const modernPaginationItems = useMemo(
    () => buildModernPaginationItems(page, totalPages),
    [page, totalPages]
  )

  function showToast(message, options = {}) {
    setToastState({
      show: true,
      bg: options.bg || 'secondary',
      message,
      autohide: options.autohide ?? true,
      delay: options.delay ?? 2600,
      mode: options.mode || 'message'
    })
  }

  function closeToast() {
    setToastState((prev) => ({ ...prev, show: false }))
    setDeletePayload(null)
  }

  useEffect(() => {
    const incoming = location?.state?.dashboardFilters
    if (!incoming || typeof incoming !== 'object') return
    const key = JSON.stringify(incoming)
    if (!key || drilldownAppliedRef.current === key) return
    drilldownAppliedRef.current = key

    const source = normalizeIncomingSource(incoming.source)
    const decision = normalizeIncomingDecision(incoming.decision)
    const allowedSort = new Set([
      'created_desc',
      'created_asc',
      'score_desc',
      'score_asc',
      'topic_asc',
      'provider_asc',
      'platform_asc'
    ])
    const sort = allowedSort.has(String(incoming.sortBy || '').trim())
      ? String(incoming.sortBy || '').trim()
      : 'created_desc'

    setSearch(String(incoming.search || '').trim())
    setFilterPlatform(String(incoming.platform || '').trim())
    setFilterProvider(String(incoming.provider || '').trim())
    setFilterSource(source)
    setFilterDecision(decision)
    setFilterDateFrom(String(incoming.dateFrom || '').trim())
    setFilterDateTo(String(incoming.dateTo || '').trim())
    setSortBy(sort)
    setPage(1)
    setSelectedIds([])
    showToast('Filter dari Dashboard diterapkan.', { bg: 'info' })
  }, [location])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    setPage(1)
  }, [search, filterPlatform, filterProvider, filterSource, filterDecision, filterDateFrom, filterDateTo, sortBy, pageSize])

  async function loadHistory({ maintenance = false } = {}) {
    setLoading(true)
    setWarn(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData?.user
      setUserId(user?.id || '')
      if (!user) {
        setRows([])
        setCloudTotalCount(0)
        setLocalShownCount(0)
        setSelectedIds([])
        setLoading(false)
        return
      }

      if (maintenance) {
        const cleanup = cleanupLocalHistoryByAge(user.id, 30)
        if (cleanup.removedTotal > 0) showToast(`Cleanup lokal: ${cleanup.removedTotal} item dihapus (> ${cleanup.maxAgeDays} hari)`)
        try { await syncLocalFallbackToSupabase({ supabase, userId: user.id }) } catch (e) {}
      }

      const localRowsRaw = mergeRows([], getLocalDraftRows(user.id), getLocalFallbackRows(user.id))
      const localRowsFiltered = sortRows(
        localRowsRaw.filter((row) => {
          if (!searchMatch(row, search)) return false
          if (filterPlatform && String(row.platform || '').trim() !== filterPlatform) return false
          if (filterProvider && String(row.provider || '').trim() !== filterProvider) return false
          if (filterSource === 'draft' && sourceOf(row) !== 'draft') return false
          if (filterSource === 'offline' && sourceOf(row) !== 'offline') return false
          if (filterSource === 'supabase') return false
          if (filterDecision !== 'all' && decisionOf(row) !== filterDecision) return false
          const t = dateMsOf(row)
          const fromMs = filterDateFrom ? Date.parse(`${filterDateFrom}T00:00:00`) : null
          const toMs = filterDateTo ? Date.parse(`${filterDateTo}T23:59:59.999`) : null
          if (Number.isFinite(fromMs) && t < fromMs) return false
          if (Number.isFinite(toMs) && t > toMs) return false
          return true
        }),
        sortBy
      )

      let cloudRows = []
      let cloudCount = 0
      const shouldLoadCloud = filterSource !== 'draft' && filterSource !== 'offline' && filterSource !== 'local'
      if (shouldLoadCloud) {
        const order = mapCloudSort(sortBy)
        const safeSearch = String(search || '').trim().replace(/[%_,]/g, ' ')
        const shouldServerPageCloud = filterSource === 'supabase'
        const rangeFrom = Math.max(0, (Math.max(1, page) - 1) * Math.max(1, pageSize))
        const rangeTo = rangeFrom + Math.max(1, pageSize) - 1

        const buildQuery = (withDecision, { applyRange = true } = {}) => {
          let q = supabase.from('generations').select('*', { count: 'exact' })
          if (filterPlatform) q = q.eq('platform', filterPlatform)
          if (filterProvider) q = q.eq('provider', filterProvider)
          if (filterDateFrom) q = q.gte('created_at', `${filterDateFrom}T00:00:00`)
          if (filterDateTo) q = q.lte('created_at', `${filterDateTo}T23:59:59.999`)
          if (safeSearch) q = q.or(`topic.ilike.%${safeSearch}%,platform.ilike.%${safeSearch}%,provider.ilike.%${safeSearch}%,user_display_name.ilike.%${safeSearch}%`)
          if (withDecision && filterDecision !== 'all') q = q.filter('result->meta->aiDecision->>status', 'eq', filterDecision)
          q = q.order(order.column, { ascending: order.ascending })
          if (applyRange && shouldServerPageCloud) q = q.range(rangeFrom, rangeTo)
          return q
        }

        let resp = await buildQuery(true)
        let decisionFallback = false
        if (resp.error && filterDecision !== 'all') {
          const retry = await buildQuery(false)
          if (!retry.error) {
            resp = retry
            decisionFallback = true
            setWarn('Filter Decision diterapkan di sisi client untuk halaman cloud saat ini.')
          }
        }

        if (resp.error) {
          setWarn('Gagal memuat history cloud. Menampilkan data lokal.')
        } else {
          cloudRows = Array.isArray(resp.data) ? resp.data : []
          cloudCount = Number.isFinite(resp.count) ? resp.count : 0

          // Saat mode Supabase dengan sort score atau decision fallback client-side,
          // perlu basis data penuh agar pagination tetap akurat per halaman.
          const needFullClientWindow = shouldServerPageCloud && (order.scoreClientSort || (decisionFallback && filterDecision !== 'all'))
          let fullWindowApplied = false
          if (needFullClientWindow) {
            let fullResp = await buildQuery(true, { applyRange: false })
            let fullDecisionFallback = false
            if (fullResp.error && filterDecision !== 'all') {
              const retryFull = await buildQuery(false, { applyRange: false })
              if (!retryFull.error) {
                fullResp = retryFull
                fullDecisionFallback = true
              }
            }

            if (!fullResp.error) {
              cloudRows = Array.isArray(fullResp.data) ? fullResp.data : []
              if ((decisionFallback || fullDecisionFallback) && filterDecision !== 'all') {
                cloudRows = cloudRows.filter((row) => decisionOf(row) === filterDecision)
              }
              if (order.scoreClientSort) {
                cloudRows = sortRows(cloudRows, sortBy)
              }
              cloudCount = cloudRows.length
              cloudRows = cloudRows.slice(rangeFrom, rangeFrom + Math.max(1, pageSize))
              fullWindowApplied = true
            }
          }

          if (!fullWindowApplied) {
            if (decisionFallback && filterDecision !== 'all') {
              cloudRows = cloudRows.filter((row) => decisionOf(row) === filterDecision)
              cloudCount = cloudRows.length
            }
            if (order.scoreClientSort) cloudRows = sortRows(cloudRows, sortBy)
          }

          if (cloudRows.length) {
            // First, reuse display names that already exist in history rows (non-email).
            const inferredMap = buildDisplayNameMapFromRows(cloudRows)
            if (Object.keys(inferredMap).length) {
              displayNameCacheRef.current = { ...displayNameCacheRef.current, ...inferredMap }
              cloudRows = enrichRowsWithProfileDisplayNames(cloudRows, inferredMap)
            }

            // Then, resolve unresolved user ids from backend (service-role), bypassing profiles RLS on client.
            const unresolvedUserIds = collectMissingDisplayNameUserIds(cloudRows)
              .filter((id) => !displayNameCacheRef.current[id])
            if (unresolvedUserIds.length) {
              const remoteMap = await fetchDisplayNameMapFromApi(unresolvedUserIds)
              if (Object.keys(remoteMap).length) {
                displayNameCacheRef.current = { ...displayNameCacheRef.current, ...remoteMap }
              }
            }

            if (Object.keys(displayNameCacheRef.current).length) {
              cloudRows = enrichRowsWithProfileDisplayNames(cloudRows, displayNameCacheRef.current)
            }
          }
        }
      }

      const finalRows = filterSource === 'supabase'
        ? cloudRows
        : filterSource === 'draft' || filterSource === 'offline' || filterSource === 'local'
          ? localRowsFiltered
          : mergeRows(cloudRows, localRowsFiltered, [])

      setRows(sortRows(finalRows, sortBy))
      setLocalShownCount(localRowsFiltered.length)
      setCloudTotalCount(cloudCount)
    } catch (e) {
      setWarn('Gagal memuat history.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory({ maintenance: firstLoadRef.current })
    firstLoadRef.current = false
  }, [search, filterPlatform, filterProvider, filterSource, filterDecision, filterDateFrom, filterDateTo, sortBy, pageSize])

  useEffect(() => {
    if (!serverCloudPaginationMode) return
    if (firstLoadRef.current) return
    loadHistory({ maintenance: false })
  }, [page, serverCloudPaginationMode])

  useEffect(() => {
    const validIds = new Set(rows.map((r) => String(r.id || '').trim()).filter(Boolean))
    setSelectedIds((prev) => prev.filter((id) => validIds.has(id)))
  }, [rows])

  const pagedRows = useMemo(() => {
    if (serverCloudPaginationMode) return rows
    return rows.slice(pageStartIndex, pageStartIndex + pageSize)
  }, [rows, pageStartIndex, pageSize, serverCloudPaginationMode])

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedRows = useMemo(() => {
    const map = new Map(rows.map((r) => [String(r.id || '').trim(), r]))
    return selectedIds.map((id) => map.get(id)).filter(Boolean)
  }, [rows, selectedIds])
  const allVisibleIds = useMemo(() => pagedRows.map((r) => String(r.id || '').trim()).filter(Boolean), [pagedRows])
  const allVisibleSelected = useMemo(() => allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIdSet.has(id)), [allVisibleIds, selectedIdSet])

  const platformOptions = useMemo(() => Array.from(new Set(rows.map((r) => String(r.platform || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id')), [rows])
  const providerOptions = useMemo(() => Array.from(new Set(rows.map((r) => String(r.provider || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id')), [rows])

  function toggleSelectAll(checked) {
    if (!checked) {
      setSelectedIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)))
      return
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...allVisibleIds])))
  }

  function toggleSelectRow(id, checked) {
    const rowId = String(id || '').trim()
    if (!rowId) return
    setSelectedIds((prev) => checked ? Array.from(new Set([...prev, rowId])) : prev.filter((x) => x !== rowId))
  }

  function resetFilters() {
    setSearch('')
    setFilterPlatform('')
    setFilterProvider('')
    setFilterSource('all')
    setFilterDecision('all')
    setFilterDateFrom('')
    setFilterDateTo('')
    setSortBy('created_desc')
  }

  async function saveToCloud(targetRows) {
    if (!userId) return showToast('Sesi user tidak ditemukan.', { bg: 'danger' })
    const locals = (targetRows || []).filter((r) => sourceOf(r) !== 'supabase')
    if (!locals.length) return showToast('Tidak ada draft/offline untuk disimpan.', { bg: 'secondary' })
    setBusy(true)
    let ok = 0
    const savedIds = []
    for (const row of locals) {
      const res = await saveGenerationPrimary({ supabase, userId, entry: toHistoryEntry(row) }) // eslint-disable-line no-await-in-loop
      if (res.ok) {
        ok += 1
        savedIds.push(String(row.id || '').trim())
      }
    }
    if (savedIds.length) removeLocalHistoryByIds(userId, savedIds)
    await loadHistory({ maintenance: false })
    showToast(ok === locals.length ? `Berhasil simpan ${ok} item ke cloud.` : `Sebagian gagal. Berhasil ${ok}/${locals.length}.`, { bg: ok === locals.length ? 'success' : 'warning' })
    setBusy(false)
  }

  async function duplicateToDraft(targetRows) {
    if (!userId) return showToast('Sesi user tidak ditemukan.', { bg: 'danger' })
    const list = Array.isArray(targetRows) ? targetRows.filter(Boolean) : []
    list.forEach((row) => {
      const dup = toHistoryEntry(row, { id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString() })
      upsertLocalDraft(dup, userId)
    })
    await loadHistory({ maintenance: false })
    showToast(`Duplikat berhasil: ${list.length} item`, { bg: 'success' })
  }

  function requestDelete(targetRows) {
    const ids = (targetRows || []).map((r) => String(r?.id || '').trim()).filter(Boolean)
    if (!ids.length) return showToast('Tidak ada item untuk dihapus.', { bg: 'secondary' })
    setDeletePayload({ ids, count: ids.length })
    showToast(`Hapus ${ids.length} item history?`, { bg: 'warning', autohide: false, delay: 0, mode: 'confirm-delete' })
  }

  async function confirmDelete() {
    if (!deletePayload?.ids?.length || !userId) return
    const ids = deletePayload.ids
    closeToast()
    setBusy(true)
    const targetRows = rows.filter((r) => ids.includes(String(r.id || '').trim()))
    const localIds = targetRows.filter((r) => sourceOf(r) !== 'supabase').map((r) => String(r.id || '').trim())
    const ownCloudRows = targetRows.filter((r) => {
      if (sourceOf(r) !== 'supabase') return false
      return String(r?.user_id || '').trim() === String(userId || '').trim()
    })
    const foreignCloudCount = targetRows.filter((r) => {
      if (sourceOf(r) !== 'supabase') return false
      return String(r?.user_id || '').trim() !== String(userId || '').trim()
    }).length
    const cloudIds = ownCloudRows.map((r) => String(r.id || '').trim())
    const localRes = removeLocalHistoryByIds(userId, localIds)
    let cloudDeleted = 0
    let cloudError = null
    if (cloudIds.length) {
      const { data, error } = await supabase.from('generations').delete().eq('user_id', userId).in('id', cloudIds).select('id')
      if (error) cloudError = error
      else cloudDeleted = Array.isArray(data) ? data.length : cloudIds.length
    }
    const total = localRes.removedTotal + cloudDeleted
    if (!cloudError && foreignCloudCount > 0 && total === 0) {
      showToast(`Tidak bisa hapus ${foreignCloudCount} item cloud milik user lain.`, { bg: 'warning' })
    } else if (!cloudError && foreignCloudCount > 0) {
      showToast(`Berhasil hapus ${total} item. ${foreignCloudCount} item cloud milik user lain dilewati.`, { bg: 'warning' })
    } else {
      showToast(cloudError ? `Hapus sebagian berhasil (${total}).` : `Berhasil hapus ${total} item.`, { bg: cloudError ? 'warning' : 'success' })
    }
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)))
    await loadHistory({ maintenance: false })
    setBusy(false)
  }

  function exportSingle(row, format) {
    exportHistoryRows([row], format, `history-${String(row?.topic || row?.id || 'item').replace(/[^a-zA-Z0-9-_]+/g, '_')}`)
    showToast(`Export ${format.toUpperCase()} berhasil.`, { bg: 'success' })
  }

  function exportBulk() {
    if (!selectedRows.length) return showToast('Pilih item dulu untuk export.', { bg: 'secondary' })
    exportHistoryRows(selectedRows, bulkExportFormat, `history-selected-${selectedRows.length}`)
    showToast(`Export ${bulkExportFormat.toUpperCase()} berhasil (${selectedRows.length}).`, { bg: 'success' })
  }

  function renderBottomPagination() {
    if (!paginationEnabled) return null
    return (
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-2">
        <small className="text-muted">
          Page {page}/{totalPages} · showing {pagedRows.length} of {totalItemCount}
        </small>
        <Pagination className="mb-0 history-pagination-modern">
          <Pagination.First
            disabled={loading || page <= 1}
            onClick={() => setPage(1)}
          />
          <Pagination.Prev
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          {modernPaginationItems.map((item, idx) => (
            typeof item === 'string' ? (
              <Pagination.Ellipsis key={`${item}-${idx}`} disabled />
            ) : (
              <Pagination.Item
                key={item}
                active={item === page}
                onClick={() => setPage(item)}
              >
                {item}
              </Pagination.Item>
            )
          ))}
          <Pagination.Next
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
          <Pagination.Last
            disabled={loading || page >= totalPages}
            onClick={() => setPage(totalPages)}
          />
        </Pagination>
      </div>
    )
  }

  return (
    <>
      {warn && <Alert variant="warning">{warn}</Alert>}

      <Row className="g-2 mb-3">
        <Col xs={12} md={3}>
          <Form.Label>Cari</Form.Label>
          <Form.Control value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari topic/platform/provider" />
        </Col>
        <Col xs={4} md={2}>
          <Form.Label>Platform</Form.Label>
          <Form.Select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
            <option value="">Semua</option>
            {platformOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </Form.Select>
        </Col>
        <Col xs={4} md={2}>
          <Form.Label>Provider</Form.Label>
          <Form.Select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)}>
            <option value="">Semua</option>
            {providerOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </Form.Select>
        </Col>
        <Col xs={4} md={2}>
          <Form.Label>Source</Form.Label>
          <Form.Select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
            <option value="all">Semua</option>
            <option value="supabase">Supabase</option>
            <option value="local">Lokal (Draft + Offline)</option>
            <option value="draft">Draft Lokal</option>
            <option value="offline">Queue Offline</option>
          </Form.Select>
        </Col>
        <Col xs={6} md={1}>
          <Form.Label>Decision</Form.Label>
          <Form.Select value={filterDecision} onChange={(e) => setFilterDecision(e.target.value)}>
            <option value="all">Semua</option>
            <option value="GO">GO</option>
            <option value="REVISE">REVISE</option>
            <option value="BLOCK">BLOCK</option>
          </Form.Select>
        </Col>
        <Col xs={6} md={2}>
          <Form.Label>Sort</Form.Label>
          <Form.Select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="created_desc">Created (Newest)</option>
            <option value="created_asc">Created (Oldest)</option>
            <option value="score_desc">Score (Highest)</option>
            <option value="score_asc">Score (Lowest)</option>
            <option value="topic_asc">Topic (A-Z)</option>
            <option value="provider_asc">Provider (A-Z)</option>
            <option value="platform_asc">Platform (A-Z)</option>
          </Form.Select>
        </Col>
      </Row>

      <Row className="g-2 mb-2">
        <Col className='tglDari' xs={6} md={2}>
          <Form.Label>Tanggal Dari</Form.Label>
          <Form.Control type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
        </Col>
        <Col className='tglSampai' xs={6} md={2}>
          <Form.Label>Tanggal Sampai</Form.Label>
          <Form.Control type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
        </Col>
        <Col xs={6} className="d-flex align-items-end d-md-none"><Button variant="outline-secondary" className="w-100" onClick={resetFilters}>Reset Filter</Button></Col>
        <Col xs={6} className="d-flex align-items-end d-md-none"><Button variant="outline-secondary" className="w-100" onClick={() => loadHistory({ maintenance: true })} disabled={busy}>Refresh</Button></Col>
        <Col md={2} className="d-none d-md-flex align-items-end"><Button variant="outline-secondary" className="w-100" onClick={resetFilters}>Reset Filter</Button></Col>
        <Col md={2} className="d-none d-md-flex align-items-end"><Button variant="outline-secondary" className="w-100" onClick={() => loadHistory({ maintenance: true })} disabled={busy}>Refresh</Button></Col>
        <Col xs={4} md={2}>
          <Form.Label>Page Size</Form.Label>
          <Form.Select value={pageSize} onChange={(e) => setPageSize(Math.max(1, Number(e.target.value) || 25))}>
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </Form.Select>
        </Col>
        <Col xs={4} md={1} className="d-flex align-items-end">
          <Button variant="outline-secondary" className="w-100" disabled={!paginationEnabled || page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
        </Col>
        <Col xs={4} md={1} className="d-flex align-items-end">
          <Button variant="outline-secondary" className="w-100" disabled={!paginationEnabled || page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
        </Col>
      </Row>

      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Form.Check type="checkbox" checked={allVisibleSelected} onChange={(e) => toggleSelectAll(e.target.checked)} label={`Select All (${pagedRows.length})`} />
          <Badge bg="dark">Terpilih: {selectedIds.length}</Badge>
          <Button
            size="sm"
            variant="outline-success"
            className="history-icon-btn"
            disabled={busy || !selectedRows.some((r) => sourceOf(r) !== 'supabase')}
            onClick={() => saveToCloud(selectedRows)}
            title="Simpan Cloud (Bulk)"
            aria-label="Simpan Cloud (Bulk)"
          >
            <Icon icon="iconoir:database-tag" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            className="history-icon-btn"
            disabled={busy || !selectedRows.length}
            onClick={() => duplicateToDraft(selectedRows)}
            title="Duplikat (Bulk)"
            aria-label="Duplikat (Bulk)"
          >
            <Icon icon="heroicons:document-duplicate" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
          </Button>
          <Button
            size="sm"
            variant="outline-danger"
            className="history-icon-btn"
            disabled={busy || !selectedRows.length}
            onClick={() => requestDelete(selectedRows)}
            title="Hapus (Bulk)"
            aria-label="Hapus (Bulk)"
          >
            <Icon icon="material-symbols-light:delete-outline" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
          </Button>
          <Form.Select size="sm" value={bulkExportFormat} onChange={(e) => setBulkExportFormat(e.target.value)} style={{ width: '10ch' }}>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="md">MD</option>
          </Form.Select>
          <Button
            size="sm"
            variant="outline-primary"
            className="history-icon-btn"
            disabled={!selectedRows.length}
            onClick={exportBulk}
            title="Export (Bulk)"
            aria-label="Export (Bulk)"
          >
            <Icon icon="token-branded:extra" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
          </Button>
        </div>
        {paginationEnabled && (
          <small className="text-muted">
            Page {page}/{totalPages} · showing {pagedRows.length}/{totalItemCount} · cloud {cloudTotalCount}{filterSource === 'all' ? ` · local ${localShownCount}` : ''}
          </small>
        )}
      </div>

      {loading && <Alert variant="info">Loading history...</Alert>}
      {!loading && rows.length === 0 ? (
        <Alert variant="secondary">Belum ada data sesuai filter. Coba ubah filter atau generate konten baru.</Alert>
      ) : (
        <>
          <Table className='table-history' striped bordered hover size="sm" responsive>
            <thead>
              <tr>
                <th></th>
                <th>#</th>
                <th className='th-user'>User</th>
                <th>Topic</th>
                <th>Platform</th>
                <th className='th-provider'>Provider</th>
                <th className='th-source'>Source</th>
                <th>Score</th>
                <th className='th-created'>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, i) => {
                const id = String(row.id || '').trim()
                const rowSource = sourceOf(row)
                const isOwnCloudRow = rowSource !== 'supabase' || String(row?.user_id || '').trim() === String(userId || '').trim()
                return (
                  <tr key={id || i}>
                    <td><Form.Check type="checkbox" checked={selectedIdSet.has(id)} onChange={(e) => toggleSelectRow(id, e.target.checked)} /></td>
                    <td>{pageStartIndex + i + 1}</td>
                    <td className='td-user'>{row.user_display_name || '-'}</td>
                    <td className="td-topic">{row.topic}</td>
                    <td className="td-platform">{row.platform}</td>
                    <td className="td-provider">{row.provider}</td>
                    <td className="td-source"><Badge bg={sourceVariant(row)} text={rowSource === 'offline' ? 'dark' : undefined}>{sourceBadgeContent(row)}</Badge></td>
                    <td className="td-score">
                      {Number.isFinite(scoreOf(row)) ? (
                        <span><Badge bg="primary" className="me-1">{Number(scoreOf(row)).toFixed(1)}%</Badge><small className="text-muted">{decisionOf(row) || '-'}</small></span>
                      ) : <small className="text-muted">-</small>}
                    </td>
                    <td className='td-created'>{new Date(row.created_at).toLocaleString()}</td>
                    <td className="td-action">
                      <div className="d-flex gap-1 flex-wrap justify-content-between">
                        <Button
                          size="sm"
                          variant="outline-primary"
                          className="history-icon-btn"
                          disabled={busy}
                          title="Gunakan"
                          aria-label="Gunakan"
                          onClick={() => navigate('/generate', { state: { historyItem: row } })}
                        >
                          <Icon icon="material-symbols:select-check-box-rounded" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
                        </Button>
                        {rowSource !== 'supabase' && (
                          <Button
                            size="sm"
                            variant="outline-success"
                            className="history-icon-btn"
                            disabled={busy}
                            title="Simpan Cloud"
                            aria-label="Simpan Cloud"
                            onClick={() => saveToCloud([row])}
                          >
                            <Icon icon="iconoir:database-tag" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          className="history-icon-btn"
                          disabled={busy}
                          title="Duplikat"
                          aria-label="Duplikat"
                          onClick={() => duplicateToDraft([row])}
                        >
                          <Icon icon="heroicons:document-duplicate" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
                        </Button>
                        <Dropdown>
                          <Dropdown.Toggle
                            size="sm"
                            variant="outline-dark"
                            className="history-icon-btn"
                            disabled={busy}
                            title="Export"
                            aria-label="Export"
                          >
                            <Icon icon="token-branded:extra" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
                          </Dropdown.Toggle>
                          <Dropdown.Menu>
                            <Dropdown.Item onClick={() => exportSingle(row, 'json')}>JSON</Dropdown.Item>
                            <Dropdown.Item onClick={() => exportSingle(row, 'csv')}>CSV</Dropdown.Item>
                            <Dropdown.Item onClick={() => exportSingle(row, 'md')}>Markdown</Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>
                        <Button
                          size="sm"
                          variant="outline-danger"
                          className="history-icon-btn"
                          disabled={busy || !isOwnCloudRow}
                          title={isOwnCloudRow ? 'Hapus' : 'Cloud item milik user lain tidak bisa dihapus'}
                          aria-label="Hapus"
                          onClick={() => requestDelete([row])}
                        >
                          <Icon icon="material-symbols-light:delete-outline" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
                        </Button>
                        <Button
                          size="sm"
                          className="history-icon-btn"
                          disabled={busy}
                          title="View"
                          aria-label="View"
                          onClick={() => setSelected(row)}
                        >
                          <Icon icon="lucide:view" width={HISTORY_ACTION_ICON_SIZE} height={HISTORY_ACTION_ICON_SIZE} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          {renderBottomPagination()}
        </>
      )}

      <Modal show={!!selected} onHide={() => setSelected(null)} size="lg" contentClassName="modal-desk">
        <Modal.Header closeButton><Modal.Title>Detail</Modal.Title></Modal.Header>
        <Modal.Body><pre>{JSON.stringify(selected, null, 2)}</pre></Modal.Body>
      </Modal>

      <ToastContainer position="middle-center" className="p-2 templates-toast-center">
        <Toast show={toastState.show} bg={toastState.bg} autohide={toastState.autohide} delay={toastState.delay} onClose={closeToast}>
          <Toast.Header closeButton><strong className="me-auto">History</strong></Toast.Header>
          <Toast.Body className={toastState.bg === 'warning' ? 'text-dark' : 'text-white'}>
            <div>{toastState.message}</div>
            {toastState.mode === 'confirm-delete' && deletePayload && (
              <div className="d-flex justify-content-end gap-2 mt-2">
                <Button size="sm" variant="outline-secondary" onClick={closeToast}>Batal</Button>
                <Button size="sm" variant="danger" onClick={confirmDelete}>Hapus</Button>
              </div>
            )}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </>
  )
}
