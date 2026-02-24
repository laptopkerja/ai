import { apiAxios } from './apiRuntime'

const LEGACY_LOCAL_KEY = 'generations_fallback_queue'
const LOCAL_KEY_PREFIX = 'generations_fallback_queue:'
const LOCAL_DRAFT_KEY_PREFIX = 'generations_local_draft:'
const LOCAL_LIMIT = 200
const DEFAULT_LOCAL_RETENTION_DAYS = 30

function safeParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch (e) {
    return fallback
  }
}

function scopedLocalKey(userId) {
  return `${LOCAL_KEY_PREFIX}${userId || 'anonymous'}`
}

function readLocalQueueByKey(key) {
  const raw = localStorage.getItem(key)
  const parsed = safeParse(raw || '[]', [])
  return Array.isArray(parsed) ? parsed : []
}

function getLocalQueue(userId) {
  const scopedKey = scopedLocalKey(userId)
  const scoped = readLocalQueueByKey(scopedKey)
  if (scoped.length) return scoped

  // One-time legacy migration from old shared key into current user scope.
  if (userId) {
    const legacy = readLocalQueueByKey(LEGACY_LOCAL_KEY)
    if (legacy.length) {
      setLocalQueue(userId, legacy)
      localStorage.removeItem(LEGACY_LOCAL_KEY)
      return legacy
    }
  }
  return scoped
}

function setLocalQueue(userId, rows) {
  const normalized = Array.isArray(rows) ? rows.slice(0, LOCAL_LIMIT) : []
  localStorage.setItem(scopedLocalKey(userId), JSON.stringify(normalized))
}

function scopedLocalDraftKey(userId) {
  return `${LOCAL_DRAFT_KEY_PREFIX}${userId || 'anonymous'}`
}

function readLocalDraftQueue(userId) {
  const raw = localStorage.getItem(scopedLocalDraftKey(userId))
  const parsed = safeParse(raw || '[]', [])
  return Array.isArray(parsed) ? parsed : []
}

function setLocalDraftQueue(userId, rows) {
  const normalized = Array.isArray(rows) ? rows.slice(0, LOCAL_LIMIT) : []
  localStorage.setItem(scopedLocalDraftKey(userId), JSON.stringify(normalized))
}

function parseCreatedAtMs(entry) {
  const raw = String(entry?.created_at || '').trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function toGenerationRow(entry, userId) {
  return {
    user_id: userId,
    user_display_name: entry.user_display_name || null,
    topic: entry.topic || '',
    platform: entry.platform || '',
    provider: entry.provider || '',
    result: entry.result || null,
    created_at: entry.created_at || new Date().toISOString()
  }
}

async function saveGenerationViaApi({ supabase, entry }) {
  if (!supabase) return { ok: false, skipped: true, reason: 'supabase_missing' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return { ok: false, skipped: true, reason: 'session_missing' }
    const resp = await apiAxios({
      method: 'post',
      url: '/api/generations/save',
      headers: {
        Authorization: `Bearer ${token}`
      },
      data: {
        entry
      }
    })
    if (!resp.data?.ok) {
      const apiErr = resp.data?.error
      return { ok: false, skipped: false, reason: apiErr?.code || 'api_rejected', error: apiErr || null }
    }
    return {
      ok: true,
      skipped: false,
      mirrored: !!resp.data?.data?.mirror?.mirrored,
      mirror: resp.data?.data?.mirror || null
    }
  } catch (error) {
    return { ok: false, skipped: false, reason: 'api_failed', error }
  }
}

function isMissingUserDisplayNameColumnError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  return (
    message.includes('user_display_name') &&
    (message.includes('schema cache') || message.includes('column') || details.includes('column') || hint.includes('column'))
  )
}

async function insertGenerationRowCompat(supabase, row) {
  const { error } = await supabase.from('generations').insert([row])
  if (!error) return { error: null, degraded: false }

  if (isMissingUserDisplayNameColumnError(error)) {
    const fallbackRow = { ...row }
    delete fallbackRow.user_display_name
    const retry = await supabase.from('generations').insert([fallbackRow])
    if (!retry.error) return { error: null, degraded: true }
    return { error: retry.error, degraded: true }
  }
  return { error, degraded: false }
}

function fromLocalEntry(entry, userId) {
  return {
    id: entry.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    user_display_name: entry.user_display_name || null,
    topic: entry.topic || '',
    platform: entry.platform || '',
    provider: entry.provider || '',
    result: entry.result || null,
    created_at: entry.created_at || new Date().toISOString(),
    _localFallback: true
  }
}

function fromLocalDraftEntry(entry, userId) {
  return {
    id: entry.id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    user_display_name: entry.user_display_name || null,
    topic: entry.topic || '',
    platform: entry.platform || '',
    provider: entry.provider || '',
    result: entry.result || null,
    created_at: entry.created_at || new Date().toISOString(),
    _localDraft: true
  }
}

export function pushLocalFallback(entry, userId) {
  const queue = getLocalQueue(userId)
  queue.unshift(entry)
  setLocalQueue(userId, queue)
}

export function getLocalFallbackRows(userId) {
  return getLocalQueue(userId).map((entry) => fromLocalEntry(entry, userId))
}

export function upsertLocalDraft(entry, userId) {
  if (!entry || typeof entry !== 'object') return
  const id = String(entry.id || '').trim()
  const nextEntry = {
    ...entry,
    id: id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: entry.created_at || new Date().toISOString()
  }
  const queue = readLocalDraftQueue(userId)
  const filtered = queue.filter((x) => String(x?.id || '') !== nextEntry.id)
  filtered.unshift(nextEntry)
  setLocalDraftQueue(userId, filtered)
}

export function removeLocalDraftById(userId, id) {
  const target = String(id || '').trim()
  if (!target) return
  const queue = readLocalDraftQueue(userId)
  const next = queue.filter((x) => String(x?.id || '') !== target)
  setLocalDraftQueue(userId, next)
}

export function removeLocalDraftByIds(userId, ids = []) {
  const targets = new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))
  if (!targets.size) return 0
  const queue = readLocalDraftQueue(userId)
  const next = queue.filter((x) => !targets.has(String(x?.id || '').trim()))
  const removed = queue.length - next.length
  if (removed > 0) setLocalDraftQueue(userId, next)
  return removed
}

export function removeLocalFallbackByIds(userId, ids = []) {
  const targets = new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))
  if (!targets.size) return 0
  const queue = getLocalQueue(userId)
  const next = queue.filter((x) => !targets.has(String(x?.id || '').trim()))
  const removed = queue.length - next.length
  if (removed > 0) setLocalQueue(userId, next)
  return removed
}

export function removeLocalHistoryByIds(userId, ids = []) {
  const removedDraft = removeLocalDraftByIds(userId, ids)
  const removedFallback = removeLocalFallbackByIds(userId, ids)
  return { removedDraft, removedFallback, removedTotal: removedDraft + removedFallback }
}

export function cleanupLocalHistoryByAge(userId, maxAgeDays = DEFAULT_LOCAL_RETENTION_DAYS) {
  const days = Math.max(1, Number(maxAgeDays) || DEFAULT_LOCAL_RETENTION_DAYS)
  const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000)

  const draftQueue = readLocalDraftQueue(userId)
  const nextDraft = draftQueue.filter((entry) => {
    const createdAtMs = parseCreatedAtMs(entry)
    if (!Number.isFinite(createdAtMs)) return true
    return createdAtMs >= cutoffMs
  })
  const removedDraft = draftQueue.length - nextDraft.length
  if (removedDraft > 0) setLocalDraftQueue(userId, nextDraft)

  const fallbackQueue = getLocalQueue(userId)
  const nextFallback = fallbackQueue.filter((entry) => {
    const createdAtMs = parseCreatedAtMs(entry)
    if (!Number.isFinite(createdAtMs)) return true
    return createdAtMs >= cutoffMs
  })
  const removedFallback = fallbackQueue.length - nextFallback.length
  if (removedFallback > 0) setLocalQueue(userId, nextFallback)

  return {
    removedDraft,
    removedFallback,
    removedTotal: removedDraft + removedFallback,
    maxAgeDays: days
  }
}

export function getLocalDraftRows(userId) {
  return readLocalDraftQueue(userId).map((entry) => fromLocalDraftEntry(entry, userId))
}

export async function saveGenerationPrimary({ supabase, userId, entry }) {
  if (!supabase || !userId) {
    pushLocalFallback(entry, userId)
    return { ok: false, savedTo: 'local' }
  }

  // Primary path: use backend endpoint so active project can dual-write to backup in real-time.
  const apiSave = await saveGenerationViaApi({ supabase, entry })
  if (apiSave.ok) {
    return {
      ok: true,
      savedTo: 'supabase',
      mirrored: !!apiSave.mirrored,
      mirror: apiSave.mirror || null
    }
  }

  // Fallback path: direct client insert (backward compatibility / backend unavailable).
  const row = toGenerationRow(entry, userId)
  const { error, degraded } = await insertGenerationRowCompat(supabase, row)
  if (error) {
    const message = String(error?.message || '').toLowerCase()
    const code = String(error?.code || '').trim()
    const details = String(error?.details || '').toLowerCase()
    const isForbidden = code === '42501' || message.includes('permission denied') || message.includes('row-level security') || details.includes('policy')

    pushLocalFallback(entry, userId)
    return { ok: false, savedTo: 'local', error, reason: isForbidden ? 'forbidden_rls' : 'insert_failed' }
  }
  return { ok: true, savedTo: 'supabase', degraded }
}

export async function syncLocalFallbackToSupabase({ supabase, userId }) {
  if (!supabase || !userId) return { synced: 0, remaining: getLocalQueue(userId).length }
  const queue = getLocalQueue(userId)
  if (!queue.length) return { synced: 0, remaining: 0 }

  let synced = 0
  const remaining = []
  for (const entry of queue) {
    const apiSave = await saveGenerationViaApi({ supabase, entry }) // eslint-disable-line no-await-in-loop
    if (apiSave.ok) {
      synced += 1
      continue
    }
    const row = toGenerationRow(entry, userId)
    const { error } = await insertGenerationRowCompat(supabase, row) // eslint-disable-line no-await-in-loop
    if (error) remaining.push(entry)
    else synced += 1
  }
  setLocalQueue(userId, remaining)
  return { synced, remaining: remaining.length }
}
