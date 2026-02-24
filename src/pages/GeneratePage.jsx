import React, { useRef, useState } from 'react'
import GenerateForm from '../components/GenerateForm'
import GenerateResult from '../components/GenerateResult'
import { Row, Col, Alert } from 'react-bootstrap'
import { supabase } from '../supabase/client'
import { saveGenerationPrimary, upsertLocalDraft, removeLocalDraftById } from '../lib/generationStorage'

export default function GeneratePage() {
  const [result, setResult] = useState(null)
  const [msg, setMsg] = useState(null)
  const [regenerateToken, setRegenerateToken] = useState(0)
  const displayNameCacheRef = useRef(new Map())

  function flashMsg(message, durationMs = 3000) {
    setMsg(message)
    setTimeout(() => setMsg(null), durationMs)
  }

  function createHistoryId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function pickProfileDisplayName(profileRow) {
    if (!profileRow || typeof profileRow !== 'object') return ''
    const candidates = [
      profileRow.user_display_name,
      profileRow.display_name,
      profileRow['Display Name'],
      profileRow.full_name,
      profileRow.name,
      profileRow.email
    ]
    for (const candidate of candidates) { // eslint-disable-line no-restricted-syntax
      const text = String(candidate || '').trim()
      if (text) return text
    }
    return ''
  }

  async function resolveDisplayName(user) {
    const meta = user?.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {}
    const fromMeta = String(
      meta.display_name ||
      meta.user_display_name ||
      meta.full_name ||
      meta.name ||
      ''
    ).trim()
    if (fromMeta) return fromMeta

    const userId = String(user?.id || '').trim()
    if (userId) {
      const cached = displayNameCacheRef.current.get(userId)
      if (cached) return cached
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()
        if (!error && data) {
          const fromProfile = pickProfileDisplayName(data)
          if (fromProfile) {
            displayNameCacheRef.current.set(userId, fromProfile)
            return fromProfile
          }
        }
      } catch (e) {}
    }

    return String(user?.email || 'unknown').trim() || 'unknown'
  }

  function normalizeResultWithHistoryIds(input) {
    if (!input || typeof input !== 'object') return input

    const assignId = (item) => {
      const existingId = String(item?._historyId || item?.id || '').trim()
      const historyId = existingId || createHistoryId()
      return { ...item, _historyId: historyId }
    }

    if (Array.isArray(input.variations) && input.variations.length) {
      const variations = input.variations.filter(Boolean).map((item) => assignId(item))
      return { ...assignId(input), variations }
    }
    return assignId(input)
  }

  function toHistoryEntry(item, overrides = {}) {
    const historyId = String(item?._historyId || item?.id || '').trim() || createHistoryId()
    return {
      id: historyId,
      user_display_name: overrides.user_display_name ?? item?.user_display_name ?? null,
      topic: overrides.topic ?? item.topic ?? item.title ?? '',
      platform: overrides.platform ?? item.platform ?? item.meta?.platform ?? '',
      provider: overrides.provider ?? item.meta?.provider ?? '',
      result: overrides.result ?? { ...item, _historyId: historyId },
      created_at: overrides.created_at || new Date().toISOString()
    }
  }

  async function saveResultToLocalDraft(r) {
    try {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData?.user
      const userId = user?.id || 'anonymous'
      const userDisplayName = await resolveDisplayName(user)
      const list = Array.isArray(r?.variations) ? r.variations : [r]
      list.filter(Boolean).forEach((item) => {
        upsertLocalDraft(toHistoryEntry(item, { user_display_name: userDisplayName }), userId)
      })
    } catch (e) {}
  }

  function handleResult(r) {
    const normalized = normalizeResultWithHistoryIds(r)
    setResult(normalized)
    const count = Array.isArray(normalized?.variations) ? normalized.variations.length : 1
    saveResultToLocalDraft(normalized)
    flashMsg(count > 1 ? `Generated ${count} variations successfully` : 'Generated successfully')
  }

  async function handleSave(item) {
    if (!item) return
    try {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData?.user
      const userDisplayName = await resolveDisplayName(user)
      const entry = toHistoryEntry(item, { user_display_name: userDisplayName })
      const saveRes = await saveGenerationPrimary({ supabase, userId: user?.id, entry })
      if (saveRes.ok) {
        removeLocalDraftById(user?.id || 'anonymous', entry.id)
        flashMsg('Saved to Supabase history')
      } else {
        if (saveRes.reason === 'forbidden_rls') {
          flashMsg('Supabase history ditolak (RLS/permission). Data tetap tersimpan di browser history.')
        } else {
          flashMsg('Gagal ke Supabase, tetap tersimpan di browser history')
        }
      }
    } catch (e) {
      flashMsg('Gagal menyimpan ke Supabase')
    }
  }

  function handleRegenerate() {
    setRegenerateToken((n) => n + 1)
    flashMsg('Regenerating...')
  }

  return (
    <Row>
      <Col md={6}>
        <h4>Generate Content</h4>
        <GenerateForm onResult={handleResult} regenerateToken={regenerateToken} />
        {msg && <Alert variant="success" className="mt-2">{msg}</Alert>}
      </Col>
      <Col md={6}>
        <h5>Result</h5>
        <GenerateResult
          item={result}
          onCopy={() => flashMsg('Copied to clipboard')}
          onRegenerate={handleRegenerate}
          onSave={handleSave}
        />
      </Col>
    </Row>
  )
}
