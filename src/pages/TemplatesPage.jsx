import React, { useEffect, useMemo, useState } from 'react'
import { Card, ListGroup, Badge, Button, Row, Col, Modal, Toast, ToastContainer, Alert, Form, Pagination } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import validateTemplate from '../lib/validateTemplate'
import normalizePreset from '../lib/normalizePreset'
import lintPresetAgainstPlatformContract from '../lib/presetPlatformLint'
import { sortPresetsForUi } from '../lib/presetOrdering'
import { resolveToastBehavior } from '../lib/toastBehavior'
import PresetEditor from '../components/PresetEditor'
import { supabase } from '../supabase/client'
import { apiAxios } from '../lib/apiRuntime'
const TEMPLATE_STORAGE_KEY = 'templates'
const VERSIONS_STORAGE_KEY = 'template_versions_v2'
const MAX_VERSION_SNAPSHOTS = 20
const TEAM_PRESET_VIEW_META_KEYS = [
  '_teamVersion',
  '_lastAction',
  '_lastActionAt',
  '_createdAt',
  '_updatedAt',
  '_updatedByUserId',
  '_createdByUserId',
  '_updatedByDisplayName',
  '_createdByDisplayName',
  '_lastClonedFromPresetId'
]
const TEMPLATE_SOURCE_LOCAL = 'local'
const TEMPLATE_SOURCE_SUPABASE = 'supabase'

export const PRESETS = [
  {
    id: 'promo-shopee',
    title: 'Promo Shopee Diskon',
    topic: 'Diskon 50% produk X, mulai hari ini',
    platform: 'Shopee',
    language: 'Indonesia',
    tone: 'Urgency',
    length: 'short',
    audioRecommendation: 'Bright promo jingle',
    description: 'Template untuk promo cepat di Shopee.'
  },
  {
    id: 'tiktok-hook',
    title: 'TikTok Viral Hook',
    topic: 'Trik cepat untuk membuat kopi enak',
    platform: 'TikTok',
    language: 'Indonesia',
    tone: 'Fun',
    length: 'short',
    audioRecommendation: 'Energetic pop beat',
    description: 'Hook singkat untuk TikTok.'
  },
  {
    id: 'threads-insight-funnel-advanced-001',
    title: 'Threads Advanced - Insight Funnel Engagement',
    topic: 'Opini + insight yang mengundang diskusi sehat',
    platform: 'Threads',
    language: 'Indonesia',
    tone: 'Curious / Bikin Penasaran',
    length: 'medium',
    audioRecommendation: 'No audio focus (text-first)',
    description: 'Starter template Threads untuk growth reply, profile visit, dan followers.'
  },
  {
    id: 'whatsapp-channel-growth-advanced-001',
    title: 'WhatsApp Channel Advanced - Daily Update Growth',
    topic: 'Update ringkas harian dengan nilai langsung pakai',
    platform: 'WhatsApp Channel',
    language: 'Indonesia',
    tone: 'Friendly / Ramah',
    length: 'short',
    audioRecommendation: 'No audio focus (message-first)',
    description: 'Starter template WhatsApp Channel untuk retention, reaction, dan forward.'
  },
  {
    id: 'telegram-community-booster-advanced-001',
    title: 'Telegram Advanced - Community Booster',
    topic: 'Konten komunitas yang mendorong komentar berkualitas',
    platform: 'Telegram',
    language: 'Indonesia',
    tone: 'Profesional',
    length: 'medium',
    audioRecommendation: 'Minimal instrumental',
    description: 'Starter template Telegram untuk menjaga engagement komunitas tetap aktif.'
  }
]

function normalizeTemplateSource(value, fallback = TEMPLATE_SOURCE_LOCAL) {
  const key = String(value || '').trim().toLowerCase()
  if (key === TEMPLATE_SOURCE_SUPABASE) return TEMPLATE_SOURCE_SUPABASE
  if (key === TEMPLATE_SOURCE_LOCAL) return TEMPLATE_SOURCE_LOCAL
  return fallback
}

function resolveTemplateSourceLabel(sourceKey) {
  return sourceKey === TEMPLATE_SOURCE_SUPABASE ? 'Supabase' : 'Draft Lokal'
}

function resolveTemplateSourceIcon(sourceKey) {
  return sourceKey === TEMPLATE_SOURCE_SUPABASE ? 'devicon:supabase' : 'icon-park-outline:browser-chrome'
}

function normalizePresetForView(rawPreset, explicitSource = null) {
  const normalized = normalizePreset(rawPreset)
  if (!normalized) return null
  const source = rawPreset && typeof rawPreset === 'object' ? rawPreset : {}
  const next = { ...normalized }

  TEAM_PRESET_VIEW_META_KEYS.forEach((key) => {
    if (source[key] !== undefined) next[key] = source[key]
  })

  if (!next._updatedByDisplayName && source.updated_by_display_name) {
    next._updatedByDisplayName = source.updated_by_display_name
  }
  if (!next._createdByDisplayName && source.created_by_display_name) {
    next._createdByDisplayName = source.created_by_display_name
  }
  if (!next._lastAction && source.last_action) {
    next._lastAction = source.last_action
  }
  if (!next._lastActionAt && source.last_action_at) {
    next._lastActionAt = source.last_action_at
  }
  next._storageSource = normalizeTemplateSource(
    explicitSource || source._storageSource || source.storage_source || source.storageSource || '',
    TEMPLATE_SOURCE_LOCAL
  )

  return next
}

function loadStoredTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
    if (!raw) return PRESETS.map((item) => normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return PRESETS.map((item) => normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL))
    return parsed.map((item) => normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL)).filter(Boolean)
  } catch (err) {
    return PRESETS.map((item) => normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL))
  }
}

function readStorageMap(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch (err) {
    return {}
  }
}

function buildSnapshot(preset, source = 'save') {
  const normalized = normalizePreset(preset)
  return {
    snapshotId: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    source,
    version: normalized.version || '1.0.0',
    title: normalized.title || '',
    hash: JSON.stringify(normalized),
    actorDisplayName: 'local-fallback',
    preset: normalized
  }
}

function bumpPatchVersion(versionText) {
  try {
    const parts = String(versionText || '1.0.0').split('.').map((item) => parseInt(item || '0', 10))
    while (parts.length < 3) parts.push(0)
    parts[2] += 1
    return parts.join('.')
  } catch (err) {
    return '1.0.1'
  }
}

function mergeById(prevRows, nextRow, previousId = null) {
  const nextId = String(nextRow?.id || '').trim()
  const oldId = String(previousId || '').trim()
  const filtered = (prevRows || []).filter((row) => {
    const rowId = String(row?.id || '').trim()
    return rowId && rowId !== nextId && rowId !== oldId
  })
  return [nextRow, ...filtered]
}

function makeCloneFromPreset(preset) {
  const cloned = normalizePreset(preset)
  const ts = Date.now().toString(36)
  const baseId = String(cloned.id || 'preset').replace(/[^a-zA-Z0-9-_]/g, '-')
  const clone = {
    ...cloned,
    id: `${baseId}-clone-${ts}`,
    version: '1.0.0',
    title: cloned.title?.endsWith('(Clone)') ? cloned.title : `${cloned.title || 'Untitled'} (Clone)`,
    label: cloned.label?.endsWith('Clone') ? cloned.label : `${cloned.label || cloned.title || 'Preset'} Clone`,
    meta: {
      ...(cloned.meta || {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'team-clone'
    }
  }
  return normalizePreset(clone)
}

function mapApiError(err) {
  const status = err?.response?.status
  const message = err?.response?.data?.error?.message
  if (status === 401) return 'Sesi login tidak valid. Silakan login ulang.'
  if (status === 503) return message || 'Konfigurasi server belum siap.'
  return message || err?.message || 'Request gagal'
}

function formatDateTime(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch (err) {
    return String(value)
  }
}

function resolvePresetOwnerLabel(preset) {
  const raw = String(
    preset?._updatedByDisplayName ||
    preset?._createdByDisplayName ||
    ''
  ).trim()
  return raw || '-'
}

function resolvePresetActionTime(preset) {
  return (
    preset?._lastActionAt ||
    preset?._updatedAt ||
    preset?.meta?.updatedAt ||
    preset?.meta?.createdAt ||
    null
  )
}

function hasVariantToken(source, token) {
  const safeSource = String(source || '').toLowerCase()
  const safeToken = String(token || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!safeSource || !safeToken) return false
  const pattern = new RegExp(`(^|[^a-z0-9])${safeToken}([^a-z0-9]|$)`, 'i')
  return pattern.test(safeSource)
}

function resolvePresetVariant(preset) {
  const source = String(
    preset?.id ||
    preset?.title ||
    preset?.label ||
    ''
  ).toLowerCase()
  if (hasVariantToken(source, 'hard')) return 'hard'
  if (hasVariantToken(source, 'medium')) return 'medium'
  if (hasVariantToken(source, 'soft')) return 'soft'
  return 'other'
}

function parseDateMs(value) {
  const ms = Date.parse(String(value || '').trim())
  return Number.isFinite(ms) ? ms : 0
}

function buildModernPaginationItems(currentPage, totalPages) {
  const page = Math.max(1, Number(currentPage) || 1)
  const total = Math.max(1, Number(totalPages) || 1)
  if (total <= 7) return Array.from({ length: total }, (_, idx) => idx + 1)
  const items = [1]
  if (page > 3) items.push('...')
  const start = Math.max(2, page - 1)
  const end = Math.min(total - 1, page + 1)
  for (let p = start; p <= end; p += 1) items.push(p)
  if (page < total - 2) items.push('...')
  items.push(total)
  return items
}

export default function TemplatesPage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState(() => loadStoredTemplates())
  const [versionsById, setVersionsById] = useState(() => readStorageMap(VERSIONS_STORAGE_KEY))
  const [showModal, setShowModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [cloneSourceId, setCloneSourceId] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [form, setForm] = useState({ id: '', title: '' })
  const [deleteCandidate, setDeleteCandidate] = useState(null)
  const [toastState, setToastState] = useState({ show: false, bg: 'secondary', message: '', autohide: true, delay: 2600, mode: 'message' })
  const sortedTemplates = useMemo(() => sortPresetsForUi(templates), [templates])
  const [searchQuery, setSearchQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [variantFilter, setVariantFilter] = useState('all')
  const [sortMode, setSortMode] = useState('recommended')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(13)
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([])

  const platformOptions = useMemo(() => {
    const set = new Set()
    sortedTemplates.forEach((preset) => {
      const platform = String(preset?.platform || '').trim()
      if (platform) set.add(platform)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [sortedTemplates])

  const filteredTemplates = useMemo(() => {
    const q = String(searchQuery || '').trim().toLowerCase()
    let rows = sortedTemplates.filter((preset) => {
      if (platformFilter && String(preset?.platform || '') !== platformFilter) return false
      if (variantFilter !== 'all' && resolvePresetVariant(preset) !== variantFilter) return false
      if (!q) return true
      const haystack = [
        preset?.title,
        preset?.id,
        preset?.label,
        preset?.description,
        preset?.topic,
        preset?.platform
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return haystack.includes(q)
    })

    if (sortMode === 'newest') {
      rows = [...rows].sort((a, b) => parseDateMs(resolvePresetActionTime(b)) - parseDateMs(resolvePresetActionTime(a)))
    } else if (sortMode === 'oldest') {
      rows = [...rows].sort((a, b) => parseDateMs(resolvePresetActionTime(a)) - parseDateMs(resolvePresetActionTime(b)))
    } else if (sortMode === 'az') {
      rows = [...rows].sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')))
    } else if (sortMode === 'za') {
      rows = [...rows].sort((a, b) => String(b?.title || '').localeCompare(String(a?.title || '')))
    }

    return rows
  }, [platformFilter, searchQuery, sortMode, sortedTemplates, variantFilter])

  const totalItemCount = filteredTemplates.length
  const totalPages = Math.max(1, Math.ceil(totalItemCount / pageSize))
  const paginationEnabled = totalPages > 1
  const pageStartIndex = (Math.max(1, page) - 1) * pageSize
  const pagedTemplates = useMemo(
    () => filteredTemplates.slice(pageStartIndex, pageStartIndex + pageSize),
    [filteredTemplates, pageSize, pageStartIndex]
  )
  const modernPaginationItems = useMemo(
    () => buildModernPaginationItems(page, totalPages),
    [page, totalPages]
  )
  const selectedTemplateIdSet = useMemo(
    () => new Set(
      (selectedTemplateIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    ),
    [selectedTemplateIds]
  )
  const selectedTemplates = useMemo(
    () => templates.filter((preset) => selectedTemplateIdSet.has(String(preset?.id || '').trim())),
    [templates, selectedTemplateIdSet]
  )
  const selectedCount = selectedTemplates.length
  const allFilteredSelected = filteredTemplates.length > 0 && filteredTemplates.every(
    (preset) => selectedTemplateIdSet.has(String(preset?.id || '').trim())
  )

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, platformFilter, variantFilter, sortMode, pageSize])

  useEffect(() => {
    setSelectedTemplateIds((prev) => {
      const validIds = new Set(
        templates
          .map((preset) => String(preset?.id || '').trim())
          .filter(Boolean)
      )
      const next = (prev || []).filter((id) => validIds.has(String(id || '').trim()))
      return next.length === (prev || []).length ? prev : next
    })
  }, [templates])

  const selectedVersions = useMemo(() => {
    if (!historyTarget?.id) return []
    const rows = versionsById?.[historyTarget.id]
    return Array.isArray(rows) ? rows : []
  }, [versionsById, historyTarget])

  function showToast(message, options = {}) {
    const behavior = resolveToastBehavior(options)
    setToastState({
      show: true,
      bg: options.bg || 'secondary',
      message,
      autohide: behavior.autohide,
      delay: behavior.delay,
      mode: options.mode || 'message'
    })
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

  function pushSnapshot(preset, source = 'save') {
    if (!preset?.id) return
    const normalized = normalizePreset(preset)
    const presetId = String(normalized.id || '').trim()
    if (!presetId) return
    const snapshot = buildSnapshot(normalized, source)
    setVersionsById((prev) => {
      const current = Array.isArray(prev?.[presetId]) ? prev[presetId] : []
      if (current[0]?.hash === snapshot.hash) return prev
      const next = [snapshot, ...current].slice(0, MAX_VERSION_SNAPSHOTS)
      return { ...prev, [presetId]: next }
    })
  }

  useEffect(() => {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates))
  }, [templates])

  useEffect(() => {
    localStorage.setItem(VERSIONS_STORAGE_KEY, JSON.stringify(versionsById))
  }, [versionsById])

  useEffect(() => {
    setVersionsById((prev) => {
      let changed = false
      const next = { ...prev }
      templates.forEach((preset) => {
        const presetId = String(preset?.id || '').trim()
        if (!presetId) return
        if (!Array.isArray(next[presetId]) || !next[presetId].length) {
          next[presetId] = [buildSnapshot(preset, 'seed')]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [templates])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const headers = await buildAuthHeaders()
        const sourceKey = Object.keys(headers).length ? TEMPLATE_SOURCE_SUPABASE : TEMPLATE_SOURCE_LOCAL
        const requestConfig = Object.keys(headers).length ? { headers } : {}
        const resp = await apiAxios({
          method: 'get',
          url: '/api/presets',
          ...requestConfig
        })
        if (mounted && resp.data?.ok && Array.isArray(resp.data.data)) {
          setTemplates(resp.data.data.map((item) => normalizePresetForView(item, sourceKey)).filter(Boolean))
          return
        }
      } catch (e) {
        if (mounted) showToast(mapApiError(e), { bg: 'warning' })
      }

      try {
        const existing = localStorage.getItem(TEMPLATE_STORAGE_KEY)
        if (!existing) {
          const response = await fetch('/example-format-template-converted-by-script.json')
          if (response.ok) {
          const items = await response.json()
          if (Array.isArray(items) && items.length) {
              const normalized = items.map((item) => normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL)).filter(Boolean)
              if (mounted) setTemplates(normalized)
              localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(normalized))
            }
          }
        }
      } catch (err) {
      }
    }
    load()
    return () => { mounted = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(preset) {
    navigate('/generate', { state: { preset: `template:${preset.id}` } })
  }

  function openCreate() {
    setEditing(null)
    setCloneSourceId(null)
    setForm({ id: `tpl-${Date.now()}` })
    setShowModal(true)
  }

  function openCloneEditor(preset) {
    const clone = makeCloneFromPreset(preset)
    setEditing(null)
    setCloneSourceId(preset?.id || null)
    setForm(clone)
    setShowModal(true)
    showToast('Clone dibuat. Silakan edit lalu simpan.', { bg: 'info' })
  }

  function openEdit(preset) {
    setEditing(preset.id)
    setCloneSourceId(null)
    setForm(normalizePreset(preset))
    setShowModal(true)
  }

  async function handlePresetSave(payload) {
    if (!payload || !payload.id) return
    const normalizedPayload = normalizePreset(payload)
    const lintResult = lintPresetAgainstPlatformContract(normalizedPayload)
    if (lintResult.errors.length) {
      showToast(`Preset lint gagal: ${lintResult.errors.join(' | ')}`, {
        bg: 'danger',
        autohide: false,
        delay: 0
      })
      return
    }
    if (lintResult.warnings.length) {
      showToast(`Preset lint warning: ${lintResult.warnings.join(' | ')}`, { bg: 'warning' })
    }

    const action = editing ? 'edit' : (cloneSourceId ? 'clone' : 'create')
    let persisted = normalizePresetForView(normalizedPayload, TEMPLATE_SOURCE_LOCAL)

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      if (editing) {
        const resp = await apiAxios({
          method: 'patch',
          url: `/api/presets/${encodeURIComponent(editing)}`,
          data: { preset: normalizedPayload, action: 'edit' },
          ...requestConfig
        })
        if (resp.data?.ok && resp.data.data) persisted = normalizePresetForView(resp.data.data, TEMPLATE_SOURCE_SUPABASE)
        setTemplates((prev) => mergeById(prev, persisted, editing))
        showToast('Template berhasil diperbarui', { bg: 'success' })
      } else {
        const resp = await apiAxios({
          method: 'post',
          url: '/api/presets',
          data: { preset: normalizedPayload, action, cloneFromPresetId: cloneSourceId || null },
          ...requestConfig
        })
        if (resp.data?.ok && resp.data.data) persisted = normalizePresetForView(resp.data.data, TEMPLATE_SOURCE_SUPABASE)
        setTemplates((prev) => mergeById(prev, persisted))
        showToast('Template baru berhasil disimpan', { bg: 'success' })
      }
    } catch (err) {
      const apiMessage = mapApiError(err)
      if (editing) {
        persisted = normalizePresetForView({
          ...normalizedPayload,
          version: bumpPatchVersion(templates.find((item) => item.id === editing)?.version || normalizedPayload.version),
          meta: {
            ...(normalizedPayload.meta || {}),
            updatedAt: new Date().toISOString()
          }
        }, TEMPLATE_SOURCE_LOCAL)
        setTemplates((prev) => mergeById(prev, persisted, editing))
        showToast(`${apiMessage}. Template disimpan lokal (fallback).`, { bg: 'warning' })
      } else {
        setTemplates((prev) => mergeById(prev, persisted))
        showToast(`${apiMessage}. Template dibuat lokal (fallback).`, { bg: 'warning' })
      }
    } finally {
      pushSnapshot(persisted, action)
      setEditing(null)
      setCloneSourceId(null)
      setShowModal(false)
    }
  }

  function requestDeleteTemplate(id) {
    const found = templates.find((preset) => preset.id === id)
    if (!found) return
    setDeleteCandidate(found)
    showToast(`Hapus template "${found.title}"?`, {
      bg: 'warning',
      autohide: false,
      delay: 0,
      mode: 'confirm'
    })
  }

  function closeToast() {
    setToastState((prev) => ({ ...prev, show: false }))
    setDeleteCandidate(null)
  }

  async function confirmDeleteTemplate() {
    if (!deleteCandidate) return
    const id = deleteCandidate.id
    setDeleteCandidate(null)
    setToastState((prev) => ({ ...prev, show: false }))

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      await apiAxios({
        method: 'delete',
        url: `/api/presets/${encodeURIComponent(id)}`,
        ...requestConfig
      })
      showToast('Template berhasil dihapus', { bg: 'success' })
    } catch (err) {
      showToast(`${mapApiError(err)}. Template dihapus lokal (fallback).`, { bg: 'warning' })
    } finally {
      setTemplates((prev) => prev.filter((preset) => preset.id !== id))
      setVersionsById((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  function exportAll() {
    const data = JSON.stringify(templates, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `templates-export-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function exportSingle(preset) {
    if (!preset) return
    const data = JSON.stringify(preset, null, 2)
    const safeId = String(preset.id || 'preset').replace(/[^a-zA-Z0-9-_]/g, '_')
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeId}-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function toggleTemplateSelection(id, checked) {
    const presetId = String(id || '').trim()
    if (!presetId) return
    setSelectedTemplateIds((prev) => {
      const set = new Set((prev || []).map((item) => String(item || '').trim()).filter(Boolean))
      if (checked) set.add(presetId)
      else set.delete(presetId)
      return Array.from(set)
    })
  }

  function selectAllFilteredTemplates() {
    const ids = filteredTemplates
      .map((preset) => String(preset?.id || '').trim())
      .filter(Boolean)
    setSelectedTemplateIds(Array.from(new Set(ids)))
  }

  function clearSelectedTemplates() {
    setSelectedTemplateIds([])
  }

  function exportSelectedTemplates() {
    if (!selectedTemplates.length) {
      showToast('Belum ada template terpilih.', { bg: 'warning' })
      return
    }
    const data = JSON.stringify(selectedTemplates, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `templates-selected-export-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showToast(`Export selected berhasil: ${selectedTemplates.length} template`, { bg: 'success' })
  }

  async function deleteSelectedTemplates() {
    const selectedIds = Array.from(new Set(
      (selectedTemplateIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    ))
    if (!selectedIds.length) {
      showToast('Belum ada template terpilih.', { bg: 'warning' })
      return
    }
    const confirmed = window.confirm(`Hapus ${selectedIds.length} template terpilih?`)
    if (!confirmed) return

    const headers = await buildAuthHeaders()
    const requestConfig = Object.keys(headers).length ? { headers } : {}

    const deleteResults = await Promise.all(
      selectedIds.map(async (id) => {
        try {
          await apiAxios({
            method: 'delete',
            url: `/api/presets/${encodeURIComponent(id)}`,
            ...requestConfig
          })
          return { id, ok: true }
        } catch (err) {
          return { id, ok: false }
        }
      })
    )

    const deletedOnServer = deleteResults.filter((item) => item.ok).length
    const deletedLocally = selectedIds.length

    setTemplates((prev) => prev.filter((preset) => {
      const presetId = String(preset?.id || '').trim()
      return !selectedIds.includes(presetId)
    }))
    setVersionsById((prev) => {
      const next = { ...prev }
      selectedIds.forEach((id) => {
        if (next[id]) delete next[id]
      })
      return next
    })
    setSelectedTemplateIds([])

    if (deletedOnServer === deletedLocally) {
      showToast(`Delete selected berhasil: ${deletedLocally} template`, { bg: 'success' })
      return
    }
    showToast(
      `Delete selected: ${deletedLocally} lokal, ${deletedOnServer} sinkron server.`,
      { bg: 'warning' }
    )
  }

  async function importFile(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = null
    if (!files.length) return

    const parseErrors = []
    const validationErrors = []
    const validItems = []

    for (const file of files) { // eslint-disable-line no-restricted-syntax
      let text = ''
      try {
        text = await file.text() // eslint-disable-line no-await-in-loop
      } catch (err) {
        parseErrors.push(`${file.name}: gagal membaca file`)
        continue // eslint-disable-line no-continue
      }

      let parsed
      try {
        parsed = JSON.parse(text)
      } catch (err) {
        parseErrors.push(`${file.name}: JSON tidak valid`)
        continue // eslint-disable-line no-continue
      }

      const rows = Array.isArray(parsed) ? parsed : [parsed]
      for (let idx = 0; idx < rows.length; idx += 1) {
        const item = rows[idx]
        const normalized = normalizePreset(item)
        const templateErrors = validateTemplate(normalized)
        const lintResult = lintPresetAgainstPlatformContract(normalized)
        if (templateErrors.length) {
          validationErrors.push(`${file.name} item ${idx + 1}: ${templateErrors.join('; ')}`)
        } else if (lintResult.errors.length) {
          validationErrors.push(`${file.name} item ${idx + 1}: ${lintResult.errors.join('; ')}`)
        } else {
          validItems.push(normalized)
        }
      }
    }

    if (!validItems.length) {
      showToast('Tidak ada item valid untuk di-import', { bg: 'warning' })
      return
    }

    const dedupedById = new Map()
    validItems.forEach((item) => {
      const id = String(item?.id || '').trim()
      if (!id) return
      dedupedById.set(id, item)
    })
    const itemsToImport = Array.from(dedupedById.values())
    const droppedDuplicateCount = Math.max(0, validItems.length - itemsToImport.length)

    if (parseErrors.length || validationErrors.length || droppedDuplicateCount > 0) {
      const parts = []
      if (parseErrors.length) parts.push(`${parseErrors.length} file invalid`)
      if (validationErrors.length) parts.push(`${validationErrors.length} item gagal validasi`)
      if (droppedDuplicateCount > 0) parts.push(`${droppedDuplicateCount} duplikat id dilewati`)
      showToast(`Import warning: ${parts.join(', ')}`, { bg: 'warning' })
    }

    const headers = await buildAuthHeaders()
    const requestConfig = Object.keys(headers).length ? { headers } : {}
    const persisted = []
    for (const item of itemsToImport) { // eslint-disable-line no-restricted-syntax
      try {
        const resp = await apiAxios({ // eslint-disable-line no-await-in-loop
          method: 'post',
          url: '/api/presets',
          data: { preset: item, action: 'import' },
          ...requestConfig
        })
        if (resp.data?.ok && resp.data.data) persisted.push(normalizePresetForView(resp.data.data, TEMPLATE_SOURCE_SUPABASE))
        else persisted.push(normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL))
      } catch (err) {
        persisted.push(normalizePresetForView(item, TEMPLATE_SOURCE_LOCAL))
      }
    }

    setTemplates((prev) => {
      let next = [...prev]
      persisted.forEach((item) => { next = mergeById(next, item) })
      return next
    })
    persisted.forEach((item) => pushSnapshot(item, 'import'))
    showToast(`Import berhasil: ${persisted.length} template dari ${files.length} file`, { bg: 'success' })
  }

  async function openHistoryModal(preset) {
    setHistoryTarget(preset)
    setShowHistoryModal(true)
    if (!preset?.id) return

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      const resp = await apiAxios({
        method: 'get',
        url: `/api/presets/${encodeURIComponent(preset.id)}/versions`,
        ...requestConfig
      })
      if (resp.data?.ok && Array.isArray(resp.data.data)) {
        setVersionsById((prev) => ({ ...prev, [preset.id]: resp.data.data }))
      }
    } catch (err) {
    }
  }

  async function rollbackToSnapshot(snapshot) {
    if (!snapshot || !historyTarget?.id) return
    const presetId = historyTarget.id
    const rollbackPayload = normalizePreset({ ...(snapshot.preset || {}), id: presetId })
    setRollingBack(true)
    let persisted = normalizePresetForView(rollbackPayload, TEMPLATE_SOURCE_LOCAL)

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      const resp = await apiAxios({
        method: 'post',
        url: `/api/presets/${encodeURIComponent(presetId)}/rollback`,
        data: { snapshotId: snapshot.snapshotId },
        ...requestConfig
      })
      if (resp.data?.ok && resp.data.data) persisted = normalizePresetForView(resp.data.data, TEMPLATE_SOURCE_SUPABASE)
      showToast('Rollback berhasil', { bg: 'success' })
    } catch (err) {
      const current = templates.find((item) => item.id === presetId)
      persisted = normalizePresetForView({
        ...rollbackPayload,
        version: bumpPatchVersion(current?.version || rollbackPayload.version),
        meta: {
          ...(rollbackPayload.meta || {}),
          updatedAt: new Date().toISOString()
        }
      }, TEMPLATE_SOURCE_LOCAL)
      showToast(`${mapApiError(err)}. Rollback lokal dijalankan.`, { bg: 'warning' })
    } finally {
      setTemplates((prev) => mergeById(prev, persisted, presetId))
      pushSnapshot(persisted, 'rollback')
      setHistoryTarget(persisted)
      setRollingBack(false)
    }
  }

  function resetFilters() {
    setSearchQuery('')
    setPlatformFilter('')
    setVariantFilter('all')
    setSortMode('recommended')
    setPage(1)
    setPageSize(13)
  }

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0 templates-title-compact">Templates & Presets</h5>
          <div>
            <input id="tmpl-import" type="file" accept="application/json,.json" multiple style={{ display: 'none' }} onChange={importFile} />
            <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => document.getElementById('tmpl-import').click()}>Import</Button>
            <Button size="sm" variant="outline-secondary" className="me-2" onClick={exportAll}>Export</Button>
            <Button
              size="sm"
              variant="outline-secondary"
              className="template-create-btn"
              onClick={openCreate}
              title="Buat Template"
              aria-label="Buat Template"
            >
              <Icon icon="vscode-icons:file-type-libreoffice-writer" width="32" height="32" style={{ color: '#005aff' }} />
            </Button>
          </div>
        </div>

        <Row className="g-2 mb-2">
          <Col xs={12} md={5}>
            <Form.Control
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari title / id / deskripsi / platform..."
            />
          </Col>

          <Col xs={12} className="d-md-none">
            <div className="templates-mobile-filter-group">
              <div className="templates-mobile-filter-grid">
                <Form.Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                  <option value="">Semua Platform</option>
                  {platformOptions.map((platform) => (
                    <option key={platform} value={platform}>{platform}</option>
                  ))}
                </Form.Select>
                <Form.Select value={variantFilter} onChange={(e) => setVariantFilter(e.target.value)}>
                  <option value="all">Semua Varian</option>
                  <option value="hard">Hard</option>
                  <option value="medium">Medium</option>
                  <option value="soft">Soft</option>
                  <option value="other">Lainnya</option>
                </Form.Select>
                <Form.Select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  <option value="recommended">Sort: Rekomendasi</option>
                  <option value="newest">Sort: Terbaru</option>
                  <option value="oldest">Sort: Terlama</option>
                  <option value="az">Sort: A-Z</option>
                  <option value="za">Sort: Z-A</option>
                </Form.Select>
              </div>
            </div>
          </Col>

          <Col md={3} className="d-none d-md-block">
            <Form.Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="">Semua Platform</option>
              {platformOptions.map((platform) => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </Form.Select>
          </Col>
          <Col md={2} className="d-none d-md-block">
            <Form.Select value={variantFilter} onChange={(e) => setVariantFilter(e.target.value)}>
              <option value="all">Semua Varian</option>
              <option value="hard">Hard</option>
              <option value="medium">Medium</option>
              <option value="soft">Soft</option>
              <option value="other">Lainnya</option>
            </Form.Select>
          </Col>
          <Col md={2} className="d-none d-md-block">
            <Form.Select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="recommended">Sort: Rekomendasi</option>
              <option value="newest">Sort: Terbaru</option>
              <option value="oldest">Sort: Terlama</option>
              <option value="az">Sort: A-Z</option>
              <option value="za">Sort: Z-A</option>
            </Form.Select>
          </Col>
          <Col xs={12}>
            <div className="d-flex align-items-center justify-content-between">
              <small className="text-muted">
                Page {page}/{totalPages} · showing {pagedTemplates.length}/{filteredTemplates.length}
              </small>
              <Button size="sm" variant="outline-secondary" onClick={resetFilters}>Reset Filter</Button>
            </div>
          </Col>
        </Row>

        {filteredTemplates.length === 0 && (
          <Alert variant="secondary" className="mb-2">
            {sortedTemplates.length === 0
              ? 'Belum ada preset. Buat template baru untuk mulai.'
              : 'Tidak ada preset yang cocok dengan filter saat ini.'}
          </Alert>
        )}

        {filteredTemplates.length > 0 && (
          <div className="templates-selection-toolbar mb-2">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Form.Check
                type="checkbox"
                id="tmpl-select-all-filtered"
                className="template-select-check"
                checked={allFilteredSelected}
                onChange={(e) => {
                  if (e.target.checked) selectAllFilteredTemplates()
                  else clearSelectedTemplates()
                }}
                label={`Select All (Filtered: ${filteredTemplates.length})`}
              />
              <Badge bg="secondary">Selected: {selectedCount}</Badge>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline-primary" onClick={exportSelectedTemplates} disabled={!selectedCount}>
                Export Selected
              </Button>
              <Button size="sm" variant="outline-danger" onClick={deleteSelectedTemplates} disabled={!selectedCount}>
                Delete Selected
              </Button>
            </div>
          </div>
        )}

        <ListGroup>
          {pagedTemplates.map((preset, idx) => (
            <ListGroup.Item
              key={preset.id}
              className={selectedTemplateIdSet.has(String(preset?.id || '').trim()) ? 'template-list-item-selected' : ''}
            >
              {(() => {
                const presetNumber = pageStartIndex + idx + 1
                const presetId = String(preset?.id || '').trim()
                const sourceKey = normalizeTemplateSource(preset?._storageSource, TEMPLATE_SOURCE_LOCAL)
                const sourceLabel = resolveTemplateSourceLabel(sourceKey)
                const sourceIcon = resolveTemplateSourceIcon(sourceKey)
                return (
              <Row className="align-items-center">
                <Col xs={10}>
                  <div className="d-flex align-items-center gap-2">
                    <Form.Check
                      type="checkbox"
                      checked={selectedTemplateIdSet.has(presetId)}
                      onChange={(e) => toggleTemplateSelection(presetId, e.target.checked)}
                      className="template-select-check"
                      aria-label={`Pilih template ${preset.title}`}
                    />
                    <Badge bg="dark">#{presetNumber}</Badge>
                    <strong>{preset.title}</strong>
                  </div>
                  <div className="text-muted small">{preset.description || preset.topic || '-'}</div>
                  <div className="small text-muted templates-last-action-meta">
                    {preset._lastAction || 'edit'} : {resolvePresetOwnerLabel(preset)} · {formatDateTime(resolvePresetActionTime(preset))}
                  </div>
                  <div className="mt-1">
                    <Badge
                      bg={sourceKey === TEMPLATE_SOURCE_SUPABASE ? 'success' : 'secondary'}
                      className="me-1 templates-source-badge"
                      title={`Source: ${sourceLabel}`}
                    >
                      <Icon icon={sourceIcon} width="14" height="14" />
                    </Badge>
                    {preset.platform && <Badge bg="danger" className="me-1">{preset.platform}</Badge>}
                    {preset.language && <Badge bg="warning" text="dark" className="me-1">{preset.language === 'Indonesia' ? 'ID' : 'EN'}</Badge>}
                    <Badge bg="light" text="dark" className="me-1">v{preset.version || '1.0.0'}</Badge>
                  </div>
                </Col>
                <Col xs={2} className="text-end template-action-col">
                  <Button
                    size="sm"
                    variant="outline-primary"
                    className="me-1 template-action-btn template-action-export"
                    onClick={() => exportSingle(preset)}
                    title="Download preset"
                    aria-label="Download preset"
                  >
                    <Icon icon="line-md:downloading" width="22" height="22" />
                  </Button>
                  <Button
                    size="sm"
                    variant="success"
                    className="me-1 template-action-btn template-action-use"
                    onClick={() => applyPreset(preset)}
                    title="Gunakan"
                    aria-label="Gunakan template"
                  >
                    <Icon icon="material-symbols:select-check-box-rounded" width="22" height="22" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="me-1 template-action-btn template-action-clone"
                    onClick={() => openCloneEditor(preset)}
                    title="Clone template"
                    aria-label="Clone template"
                  >
                    <Icon icon="material-symbols:content-copy-outline-rounded" width="22" height="22" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="me-1 template-action-btn template-action-history"
                    onClick={() => openHistoryModal(preset)}
                    title="Riwayat versi"
                    aria-label="Riwayat versi"
                  >
                    <Icon icon="material-symbols:history-rounded" width="22" height="22" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="me-1 template-action-btn template-action-edit"
                    onClick={() => openEdit(preset)}
                    title="Edit"
                    aria-label="Edit template"
                  >
                    <Icon icon="raphael:edit" width="22" height="22" />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="template-action-btn template-action-delete"
                    onClick={() => requestDeleteTemplate(preset.id)}
                    title="Hapus"
                    aria-label="Hapus template"
                  >
                    <Icon icon="material-symbols-light:delete-outline" width="22" height="22" />
                  </Button>
                </Col>
              </Row>
                )
              })()}
            </ListGroup.Item>
          ))}
        </ListGroup>

        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
          <small className="text-muted">
            Page {page}/{totalPages} · showing {pagedTemplates.length}/{totalItemCount}
          </small>
          <div className="d-flex align-items-center gap-2">
            <small className="text-muted">Page Size</small>
            <Form.Select
              size="sm"
              style={{ width: 92 }}
              value={pageSize}
              onChange={(e) => setPageSize(Math.max(1, Number(e.target.value) || 13))}
            >
              <option value={13}>13</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </Form.Select>
          </div>
        </div>

        {paginationEnabled && (
          <div className="d-flex justify-content-end mt-2">
            <Pagination className="mb-0 history-pagination-modern">
              <Pagination.First
                disabled={page <= 1}
                onClick={() => setPage(1)}
              />
              <Pagination.Prev
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              />
              {modernPaginationItems.map((item, idx) => (
                item === '...'
                  ? <Pagination.Ellipsis key={`${item}-${idx}`} disabled />
                  : (
                    <Pagination.Item
                      key={item}
                      active={page === item}
                      onClick={() => setPage(Number(item))}
                    >
                      {item}
                    </Pagination.Item>
                    )
              ))}
              <Pagination.Next
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
              <Pagination.Last
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
              />
            </Pagination>
          </div>
        )}

        <Modal show={showModal} onHide={() => setShowModal(false)} size="lg" contentClassName="modal-desk">
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit Template' : 'Buat Template'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <PresetEditor initialData={form} onSave={handlePresetSave} onCancel={() => setShowModal(false)} />
          </Modal.Body>
        </Modal>

        <Modal show={showHistoryModal} onHide={() => setShowHistoryModal(false)} size="lg" contentClassName="modal-desk">
          <Modal.Header closeButton>
            <Modal.Title>Riwayat Versi - {historyTarget?.title || '-'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {!selectedVersions.length ? (
              <Alert variant="secondary" className="mb-0">Belum ada riwayat versi.</Alert>
            ) : (
              <ListGroup>
                {selectedVersions.map((row, idx) => (
                  <ListGroup.Item key={row.snapshotId || `${row.version}-${idx}`}>
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                      <div>
                        <div className="d-flex align-items-center flex-wrap gap-2">
                          <strong>v{row.version || '-'}</strong>
                          {idx === 0 && <Badge bg="success">Aktif</Badge>}
                          <span>· {row.title || '-'}</span>
                          <Badge bg="secondary">{row.source || 'edit'}</Badge>
                        </div>
                        <div className="small text-muted">
                          {formatDateTime(row.savedAt)} · by {row.actorDisplayName || '-'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={idx === 0 ? 'outline-success' : 'outline-secondary'}
                        disabled={rollingBack || idx === 0}
                        onClick={() => rollbackToSnapshot(row)}
                        title={idx === 0 ? 'Versi aktif saat ini' : 'Rollback ke versi ini'}
                      >
                        <Icon icon="material-symbols:restore-rounded" width="18" height="18" />
                        <span className="ms-1">{idx === 0 ? 'Aktif' : 'Rollback'}</span>
                      </Button>
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
          </Modal.Body>
        </Modal>
      </Card.Body>

      <ToastContainer position="middle-center" className="p-2 templates-toast-center">
        <Toast
          show={toastState.show}
          bg={toastState.bg}
          autohide={toastState.autohide}
          delay={toastState.delay}
          onClose={closeToast}
        >
          <Toast.Header closeButton>
            <strong className="me-auto">Templates</strong>
          </Toast.Header>
          <Toast.Body className={toastState.bg === 'warning' ? 'text-dark' : 'text-white'}>
            <div>{toastState.message}</div>
            {toastState.mode === 'confirm' && deleteCandidate && (
              <div className="d-flex justify-content-end gap-2 mt-2">
                <Button size="sm" variant="outline-secondary" onClick={closeToast}>Batal</Button>
                <Button size="sm" variant="danger" onClick={confirmDeleteTemplate}>Hapus</Button>
              </div>
            )}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </Card>
  )
}
