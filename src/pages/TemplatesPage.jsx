import React, { useEffect, useMemo, useState } from 'react'
import { Card, ListGroup, Badge, Button, Row, Col, Modal, Toast, ToastContainer, Alert, Form } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import validateTemplate from '../lib/validateTemplate'
import normalizePreset from '../lib/normalizePreset'
import lintPresetAgainstPlatformContract from '../lib/presetPlatformLint'
import { sortPresetsForUi } from '../lib/presetOrdering'
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

function normalizePresetForView(rawPreset) {
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

  return next
}

function loadStoredTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
    if (!raw) return PRESETS.map((item) => normalizePresetForView(item))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return PRESETS.map((item) => normalizePresetForView(item))
    return parsed.map((item) => normalizePresetForView(item)).filter(Boolean)
  } catch (err) {
    return PRESETS.map((item) => normalizePresetForView(item))
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

function resolvePresetVariant(preset) {
  const source = String(
    preset?.id ||
    preset?.title ||
    preset?.label ||
    ''
  ).toLowerCase()
  if (source.includes('hard-sell') || source.includes('hard sell')) return 'hard'
  if (source.includes('soft-education') || source.includes('soft education')) return 'soft'
  return 'other'
}

function parseDateMs(value) {
  const ms = Date.parse(String(value || '').trim())
  return Number.isFinite(ms) ? ms : 0
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

  const selectedVersions = useMemo(() => {
    if (!historyTarget?.id) return []
    const rows = versionsById?.[historyTarget.id]
    return Array.isArray(rows) ? rows : []
  }, [versionsById, historyTarget])

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
        const requestConfig = Object.keys(headers).length ? { headers } : {}
        const resp = await apiAxios({
          method: 'get',
          url: '/api/presets',
          ...requestConfig
        })
        if (mounted && resp.data?.ok && Array.isArray(resp.data.data)) {
          setTemplates(resp.data.data.map((item) => normalizePresetForView(item)).filter(Boolean))
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
              const normalized = items.map((item) => normalizePresetForView(item)).filter(Boolean)
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
    let persisted = normalizedPayload

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
        if (resp.data?.ok && resp.data.data) persisted = normalizePresetForView(resp.data.data)
        setTemplates((prev) => mergeById(prev, persisted, editing))
        showToast('Template berhasil diperbarui', { bg: 'success' })
      } else {
        const resp = await apiAxios({
          method: 'post',
          url: '/api/presets',
          data: { preset: normalizedPayload, action, cloneFromPresetId: cloneSourceId || null },
          ...requestConfig
        })
        if (resp.data?.ok && resp.data.data) persisted = normalizePresetForView(resp.data.data)
        setTemplates((prev) => mergeById(prev, persisted))
        showToast('Template baru berhasil disimpan', { bg: 'success' })
      }
    } catch (err) {
      const apiMessage = mapApiError(err)
      if (editing) {
        persisted = normalizePreset({
          ...normalizedPayload,
          version: bumpPatchVersion(templates.find((item) => item.id === editing)?.version || normalizedPayload.version),
          meta: {
            ...(normalizedPayload.meta || {}),
            updatedAt: new Date().toISOString()
          }
        })
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

  async function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result)
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        const errors = []
        const validItems = []
        for (let idx = 0; idx < rows.length; idx += 1) {
          const item = rows[idx]
          const normalized = normalizePreset(item)
          const templateErrors = validateTemplate(normalized)
          const lintResult = lintPresetAgainstPlatformContract(normalized)
          if (templateErrors.length) {
            errors.push(`Item ${idx + 1}: ${templateErrors.join('; ')}`)
          } else if (lintResult.errors.length) {
            errors.push(`Item ${idx + 1}: ${lintResult.errors.join('; ')}`)
          } else {
            validItems.push(normalized)
          }
        }

        if (errors.length) showToast(`Import sebagian gagal: ${errors.length} item`, { bg: 'warning' })
        if (!validItems.length) return

        const headers = await buildAuthHeaders()
        const requestConfig = Object.keys(headers).length ? { headers } : {}
        const persisted = []
        for (const item of validItems) { // eslint-disable-line no-restricted-syntax
          try {
            const resp = await apiAxios({ // eslint-disable-line no-await-in-loop
              method: 'post',
              url: '/api/presets',
              data: { preset: item, action: 'import' },
              ...requestConfig
            })
            if (resp.data?.ok && resp.data.data) persisted.push(normalizePresetForView(resp.data.data))
            else persisted.push(item)
          } catch (err) {
            persisted.push(item)
          }
        }

        setTemplates((prev) => {
          let next = [...prev]
          persisted.forEach((item) => { next = mergeById(next, item) })
          return next
        })
        persisted.forEach((item) => pushSnapshot(item, 'import'))
        showToast(`Import berhasil: ${persisted.length} template`, { bg: 'success' })
      } catch (err) {
        showToast('File JSON tidak valid', { bg: 'danger' })
      }
    }
    reader.readAsText(file)
    e.target.value = null
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
    let persisted = rollbackPayload

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      const resp = await apiAxios({
        method: 'post',
        url: `/api/presets/${encodeURIComponent(presetId)}/rollback`,
        data: { snapshotId: snapshot.snapshotId },
        ...requestConfig
      })
      if (resp.data?.ok && resp.data.data) persisted = normalizePresetForView(resp.data.data)
      showToast('Rollback berhasil', { bg: 'success' })
    } catch (err) {
      const current = templates.find((item) => item.id === presetId)
      persisted = normalizePreset({
        ...rollbackPayload,
        version: bumpPatchVersion(current?.version || rollbackPayload.version),
        meta: {
          ...(rollbackPayload.meta || {}),
          updatedAt: new Date().toISOString()
        }
      })
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
  }

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0">Templates & Presets</h5>
          <div>
            <input id="tmpl-import" type="file" accept="application/json" style={{ display: 'none' }} onChange={importFile} />
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
                  <option value="hard">Hard Sell</option>
                  <option value="soft">Soft Education</option>
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
              <option value="hard">Hard Sell</option>
              <option value="soft">Soft Education</option>
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
                Menampilkan {filteredTemplates.length} dari {sortedTemplates.length} template
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

        <ListGroup>
          {filteredTemplates.map((preset) => (
            <ListGroup.Item key={preset.id}>
              <Row className="align-items-center">
                <Col xs={10}>
                  <div><strong>{preset.title}</strong></div>
                  <div className="text-muted small">{preset.description || preset.topic || '-'}</div>
                  <div className="small text-muted">
                    Last action: {preset._lastAction || 'edit'} · by {resolvePresetOwnerLabel(preset)} · {formatDateTime(resolvePresetActionTime(preset))}
                  </div>
                  <div className="mt-1">
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
            </ListGroup.Item>
          ))}
        </ListGroup>

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
