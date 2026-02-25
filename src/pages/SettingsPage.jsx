import React, { useEffect, useState } from 'react'
import { Card, Alert, Form, Row, Col, Button, Spinner, Badge, Table, Toast, ToastContainer } from 'react-bootstrap'
import { clearSupabaseRuntimeConfig, getSupabaseClientConfig, setSupabaseRuntimeConfig, supabase } from '../supabase/client'
import {
  apiAxios,
  clearApiRuntimeConfig,
  getApiRuntimeConfig,
  humanizeApiError,
  normalizeApiBase,
  probeApiCandidates,
  saveApiRuntimeConfig
} from '../lib/apiRuntime'
import { mapAlertVariantToToastBg, resolveToastBehavior } from '../lib/toastBehavior'

const PROVIDERS = ['Gemini', 'OpenAI', 'OpenRouter', 'Groq', 'Cohere AI', 'DeepSeek', 'Hugging Face']
const FREE_ONLY_PREFS_STORAGE_KEY = 'provider_free_only_by_provider_v1'
const DEFAULT_TMDB_STATUS = {
  keyName: 'tmdb_api_key',
  configured: false,
  keyLast4: null,
  isActive: false,
  updatedAt: null,
  updatedByDisplayName: null,
  keySource: 'none'
}
const FEATURED_MODELS_BY_PROVIDER = {
  Gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  OpenAI: ['gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4o-mini-2024-07-18'],
  OpenRouter: [
    'meta-llama/llama-3-8b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'mmeta-llama/llama-3.1-8b-instruct'
  ],
  Groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  'Cohere AI': ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r7b-12-2024'],
  'Hugging Face': [
    'meta-llama/llama-3-70b-chat-hf',
    'mistralai/mixtral-8x7b-instruct-v0.1',
    'qwen/qwen2.5-72b-instruct'
  ],
  DeepSeek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-r1-distil-llama-70b']
}

function normalizeModelKey(id) {
  return String(id || '').trim().toLowerCase().replace(/^mmeta-/, 'meta-')
}

const FEATURED_MODEL_SET_BY_PROVIDER = Object.fromEntries(
  Object.entries(FEATURED_MODELS_BY_PROVIDER).map(([provider, models]) => [
    provider,
    new Set((models || []).map((id) => normalizeModelKey(id)))
  ])
)

function isFeaturedModel(providerName, modelId) {
  const set = FEATURED_MODEL_SET_BY_PROVIDER[String(providerName || '').trim()]
  if (!set) return false
  return set.has(normalizeModelKey(modelId))
}

function mapApiError(err) {
  return humanizeApiError(err, { fallback: 'Permintaan gagal. Coba lagi.' })
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sesi login tidak ditemukan')
  return { Authorization: `Bearer ${token}` }
}

function getModelTestLimit(providerName) {
  const provider = String(providerName || '').trim()
  if (provider === 'OpenRouter') return 400
  return 80
}

export default function SettingsPage() {
  const initialApiConfig = getApiRuntimeConfig()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyProvider, setBusyProvider] = useState('')
  const [testingProvider, setTestingProvider] = useState('')
  const [testingApiRoute, setTestingApiRoute] = useState(false)
  const [savingApiRoute, setSavingApiRoute] = useState(false)
  const [apiRouteConfig, setApiRouteConfig] = useState(() => ({
    override: initialApiConfig.override || '',
    secondary: initialApiConfig.secondary || '',
    allowLocalFallback: initialApiConfig.allowLocalFallback !== false
  }))
  const [apiRouteTest, setApiRouteTest] = useState(null)
  const [freeOnlyByProvider, setFreeOnlyByProvider] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(FREE_ONLY_PREFS_STORAGE_KEY) || '{}')
      return raw && typeof raw === 'object' ? raw : {}
    } catch (e) {
      return {}
    }
  })
  const [rows, setRows] = useState([])
  const [detectedModelsByProvider, setDetectedModelsByProvider] = useState({})
  const [tmdbStatus, setTmdbStatus] = useState(DEFAULT_TMDB_STATUS)
  const [tmdbForm, setTmdbForm] = useState({ apiKey: '', isActive: true })
  const [tmdbTestResult, setTmdbTestResult] = useState(null)
  const [loadingTmdb, setLoadingTmdb] = useState(false)
  const [savingTmdb, setSavingTmdb] = useState(false)
  const [updatingTmdb, setUpdatingTmdb] = useState(false)
  const [testingTmdb, setTestingTmdb] = useState(false)
  const [supabaseProfileStatus, setSupabaseProfileStatus] = useState(null)
  const [securityPosture, setSecurityPosture] = useState(null)
  const [supabaseClientConfig, setSupabaseClientConfig] = useState(() => getSupabaseClientConfig())
  const [loadingSupabaseProfile, setLoadingSupabaseProfile] = useState(false)
  const [loadingSecurityPosture, setLoadingSecurityPosture] = useState(false)
  const [switchingSupabaseProfile, setSwitchingSupabaseProfile] = useState('')
  const [notice, setNotice] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [toastState, setToastState] = useState({
    show: false,
    bg: 'secondary',
    message: '',
    autohide: true,
    delay: 2600,
    mode: 'message'
  })
  const [form, setForm] = useState({
    provider: 'OpenAI',
    apiKey: '',
    isActive: true
  })

  useEffect(() => {
    setApiRouteTest(null)
  }, [apiRouteConfig.override, apiRouteConfig.secondary, apiRouteConfig.allowLocalFallback])

  function isFreeOnlyForProvider(provider) {
    const value = freeOnlyByProvider?.[provider]
    if (typeof value === 'boolean') return value
    return provider === 'OpenRouter' ? false : true
  }

  function setFreeOnlyForProvider(provider, nextValue) {
    setFreeOnlyByProvider((prev) => ({ ...prev, [provider]: !!nextValue }))
  }

  useEffect(() => {
    try {
      localStorage.setItem(FREE_ONLY_PREFS_STORAGE_KEY, JSON.stringify(freeOnlyByProvider || {}))
    } catch (e) {}
  }, [freeOnlyByProvider])

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

  useEffect(() => {
    if (!notice?.message) return
    showToast(notice.message, { bg: mapAlertVariantToToastBg(notice.variant) })
    setNotice(null)
  }, [notice]) // eslint-disable-line react-hooks/exhaustive-deps

  function closeToast() {
    setToastState((prev) => ({ ...prev, show: false }))
    setConfirmAction(null)
  }

  async function handleTestApiRoute() {
    setTestingApiRoute(true)
    setNotice(null)
    try {
      const nextConfig = {
        override: normalizeApiBase(apiRouteConfig.override),
        secondary: normalizeApiBase(apiRouteConfig.secondary),
        allowLocalFallback: !!apiRouteConfig.allowLocalFallback
      }
      const result = await probeApiCandidates(nextConfig, { timeoutMs: 2800, includeLocalFallback: true })
      setApiRouteTest(result)
      if (result.ok) {
        setNotice({ variant: 'success', message: `Backend aktif terdeteksi di ${result.activeBase}` })
      } else {
        setNotice({ variant: 'warning', message: 'Tidak ada endpoint backend yang merespon. Cek URL atau jalankan backend lokal.' })
      }
    } catch (err) {
      setApiRouteTest({ ok: false, activeBase: '', checked: [] })
      setNotice({ variant: 'danger', message: err?.message || 'Gagal mengetes endpoint backend' })
    } finally {
      setTestingApiRoute(false)
    }
  }

  function handleSaveApiRoute() {
    const override = normalizeApiBase(apiRouteConfig.override)
    const secondary = normalizeApiBase(apiRouteConfig.secondary)
    if (!apiRouteTest?.ok) {
      setNotice({ variant: 'warning', message: 'Jalankan Test Connection dan pastikan minimal satu endpoint healthy sebelum menyimpan.' })
      return
    }
    setSavingApiRoute(true)
    try {
      saveApiRuntimeConfig({
        override,
        secondary,
        allowLocalFallback: !!apiRouteConfig.allowLocalFallback
      })
      setApiRouteConfig({
        override,
        secondary,
        allowLocalFallback: !!apiRouteConfig.allowLocalFallback
      })
      setNotice({ variant: 'success', message: 'Konfigurasi backend berhasil disimpan.' })
    } catch (err) {
      setNotice({ variant: 'danger', message: err?.message || 'Gagal menyimpan konfigurasi backend' })
    } finally {
      setSavingApiRoute(false)
    }
  }

  function handleResetApiRoute() {
    clearApiRuntimeConfig()
    const cfg = getApiRuntimeConfig()
    setApiRouteConfig({
      override: cfg.override || '',
      secondary: cfg.secondary || '',
      allowLocalFallback: cfg.allowLocalFallback !== false
    })
    setApiRouteTest(null)
    setNotice({ variant: 'info', message: 'Konfigurasi backend dikembalikan ke default env.' })
  }

  async function loadProviderKeys() {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'get',
        url: '/api/settings/provider-keys',
        headers
      })
      if (!resp.data?.ok || !Array.isArray(resp.data?.data)) {
        throw new Error('Response provider-keys tidak valid')
      }
      setRows(resp.data.data)
      setNotice(null)
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setLoading(false)
    }
  }

  async function loadTmdbKeyStatus({ silent = false } = {}) {
    if (!silent) setLoadingTmdb(true)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'get',
        url: '/api/settings/tmdb-key',
        headers
      })
      if (!resp.data?.ok || !resp.data?.data || typeof resp.data.data !== 'object') {
        throw new Error('Response tmdb-key tidak valid')
      }
      const next = { ...DEFAULT_TMDB_STATUS, ...resp.data.data }
      setTmdbStatus(next)
      setTmdbForm((prev) => ({ ...prev, isActive: !!next.isActive }))
      if (!silent) setNotice(null)
      return next
    } catch (err) {
      if (!silent) {
        setNotice({ variant: 'danger', message: mapApiError(err) })
      }
      return null
    } finally {
      if (!silent) setLoadingTmdb(false)
    }
  }

  async function loadSupabaseProfileStatus({ silent = false } = {}) {
    if (!silent) setLoadingSupabaseProfile(true)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'get',
        url: '/api/settings/supabase-profile',
        headers
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error('Response supabase-profile tidak valid')
      }
      setSupabaseProfileStatus(resp.data.data)
      setSupabaseClientConfig(getSupabaseClientConfig())
    } catch (err) {
      if (!silent) {
        setNotice({ variant: 'danger', message: mapApiError(err) })
      }
    } finally {
      if (!silent) setLoadingSupabaseProfile(false)
    }
  }

  async function loadSecurityPosture({ silent = false } = {}) {
    if (!silent) setLoadingSecurityPosture(true)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'get',
        url: '/api/settings/security-posture',
        headers
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error('Response security-posture tidak valid')
      }
      setSecurityPosture(resp.data.data)
    } catch (err) {
      if (!silent) {
        setNotice({ variant: 'danger', message: mapApiError(err) })
      }
    } finally {
      if (!silent) setLoadingSecurityPosture(false)
    }
  }

  async function handleSwitchSupabaseProfile(profile) {
    const target = String(profile || '').trim().toLowerCase()
    if (!target) return
    setSwitchingSupabaseProfile(target)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'post',
        url: '/api/settings/supabase-profile/switch',
        data: { profile: target },
        headers
      })
      if (!resp.data?.ok) throw new Error(resp.data?.error?.message || 'Gagal switch Supabase profile')

      const data = resp.data.data || {}
      const runtime = data.frontendRuntime || {}
      const runtimeUrl = String(runtime.url || '').trim()
      const runtimeAnonKey = String(runtime.anonKey || '').trim()
      if (runtimeUrl && runtimeAnonKey) {
        setSupabaseRuntimeConfig({ url: runtimeUrl, anonKey: runtimeAnonKey })
      } else {
        clearSupabaseRuntimeConfig()
      }

      setSupabaseClientConfig(getSupabaseClientConfig())
      setSupabaseProfileStatus(data.status || null)
      setNotice({ variant: 'success', message: `Supabase profile aktif: ${target}. Aplikasi akan reload.` })
      setTimeout(() => {
        window.location.reload()
      }, 900)
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setSwitchingSupabaseProfile('')
    }
  }

  useEffect(() => {
    loadProviderKeys()
    loadTmdbKeyStatus({ silent: true })
    loadSupabaseProfileStatus({ silent: true })
    loadSecurityPosture({ silent: true })
  }, [])

  async function handleSave(event) {
    event.preventDefault()
    const provider = String(form.provider || '').trim()
    const apiKey = String(form.apiKey || '').trim()
    if (!provider) {
      setNotice({ variant: 'warning', message: 'Provider wajib dipilih' })
      return
    }
    if (!apiKey) {
      setNotice({ variant: 'warning', message: 'API key wajib diisi' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'post',
        url: '/api/settings/provider-keys',
        data: {
          provider,
          apiKey,
          isActive: !!form.isActive
        },
        headers
      })

      if (!resp.data?.ok) throw new Error(resp.data?.error?.message || 'Gagal menyimpan key')
      setForm((prev) => ({ ...prev, apiKey: '' }))
      setNotice({ variant: 'success', message: `API key ${provider} berhasil disimpan` })
      await loadProviderKeys()
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTmdb(event) {
    event.preventDefault()
    const apiKey = String(tmdbForm.apiKey || '').trim()
    if (!apiKey) {
      setNotice({ variant: 'warning', message: 'TMDB API key wajib diisi' })
      return
    }

    setSavingTmdb(true)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'post',
        url: '/api/settings/tmdb-key',
        data: {
          apiKey,
          isActive: !!tmdbForm.isActive
        },
        headers
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error(resp.data?.error?.message || 'Gagal menyimpan TMDB key')
      }
      const next = { ...DEFAULT_TMDB_STATUS, ...resp.data.data }
      setTmdbStatus(next)
      setTmdbForm((prev) => ({ ...prev, apiKey: '', isActive: !!next.isActive }))
      setTmdbTestResult(null)
      setNotice({ variant: 'success', message: 'TMDB API key berhasil disimpan' })
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setSavingTmdb(false)
    }
  }

  async function handleToggleTmdbActive(isActive) {
    setUpdatingTmdb(true)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'patch',
        url: '/api/settings/tmdb-key/active',
        data: { isActive: !!isActive },
        headers
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error(resp.data?.error?.message || 'Gagal update status TMDB key')
      }
      const next = { ...DEFAULT_TMDB_STATUS, ...resp.data.data }
      setTmdbStatus(next)
      setTmdbForm((prev) => ({ ...prev, isActive: !!next.isActive }))
      setNotice({ variant: 'success', message: `Status TMDB key ${isActive ? 'aktif' : 'nonaktif'}` })
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setUpdatingTmdb(false)
    }
  }

  async function handleDeleteTmdb() {
    setUpdatingTmdb(true)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'delete',
        url: '/api/settings/tmdb-key',
        headers
      })
      if (!resp.data?.ok) throw new Error(resp.data?.error?.message || 'Gagal hapus TMDB key')

      const latest = await loadTmdbKeyStatus({ silent: true })
      setTmdbTestResult(null)
      if (latest?.configured && latest.keySource === 'env') {
        setNotice({
          variant: 'warning',
          message: 'TMDB key di tabel berhasil dihapus, tapi env fallback TMDB_API_KEY masih aktif.'
        })
      } else {
        setNotice({ variant: 'success', message: 'TMDB key berhasil dihapus' })
      }
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setUpdatingTmdb(false)
    }
  }

  async function handleTestTmdb() {
    setTestingTmdb(true)
    setNotice(null)
    setTmdbTestResult(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'post',
        url: '/api/settings/tmdb-key/test',
        headers
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error(resp.data?.error?.message || 'Gagal test TMDB key')
      }
      setTmdbTestResult(resp.data.data)
      setNotice({ variant: 'success', message: 'TMDB key valid dan endpoint merespon.' })
    } catch (err) {
      setTmdbTestResult(null)
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setTestingTmdb(false)
    }
  }

  async function handleToggleActive(provider, isActive) {
    setBusyProvider(provider)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'patch',
        url: `/api/settings/provider-keys/${encodeURIComponent(provider)}/active`,
        data: { isActive: !!isActive },
        headers
      })
      if (!resp.data?.ok) throw new Error(resp.data?.error?.message || 'Gagal update status key')

      setRows((prev) => prev.map((row) => {
        if (row.provider !== provider) return row
        return { ...row, isActive: !!isActive }
      }))
      setNotice({ variant: 'success', message: `Status key ${provider} berhasil diperbarui` })
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setBusyProvider('')
    }
  }

  async function handleDelete(provider) {
    setBusyProvider(provider)
    setNotice(null)
    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'delete',
        url: `/api/settings/provider-keys/${encodeURIComponent(provider)}`,
        headers
      })
      if (!resp.data?.ok) throw new Error(resp.data?.error?.message || 'Gagal hapus key')

      setRows((prev) => prev.map((row) => {
        if (row.provider !== provider) return row
        return { ...row, configured: false, keyLast4: null, isActive: false, updatedAt: null }
      }))
      setDetectedModelsByProvider((prev) => {
        const next = { ...prev }
        delete next[provider]
        return next
      })
      setNotice({ variant: 'success', message: `API key ${provider} berhasil dihapus` })
    } catch (err) {
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setBusyProvider('')
    }
  }

  async function handleTestProvider(provider) {
    if (!provider) return
    const freeOnly = isFreeOnlyForProvider(provider)
    setTestingProvider(provider)
    setNotice(null)
    setDetectedModelsByProvider((prev) => ({
      ...prev,
      [provider]: {
        loading: true,
        error: null,
        models: prev?.[provider]?.models || []
      }
    }))

    try {
      const headers = await getAuthHeaders()
      const resp = await apiAxios({
        method: 'post',
        url: `/api/settings/provider-keys/${encodeURIComponent(provider)}/test`,
        data: { freeOnly, limit: getModelTestLimit(provider) },
        headers
      })
      if (!resp.data?.ok) throw new Error(resp.data?.error?.message || 'Gagal test provider key')

      const data = resp.data.data || {}
      setDetectedModelsByProvider((prev) => ({
        ...prev,
        [provider]: {
          loading: false,
          error: null,
          models: Array.isArray(data.models) ? data.models : [],
          source: data.source || null,
          freeFilterApplied: !!data.freeFilterApplied,
          freeOnlyRequested: !!data.freeOnlyRequested
        }
      }))
      setNotice({ variant: 'success', message: `Test ${provider} berhasil. Model terdeteksi: ${Number(data.count || 0)}` })
    } catch (err) {
      setDetectedModelsByProvider((prev) => ({
        ...prev,
        [provider]: {
          loading: false,
          error: mapApiError(err),
          models: []
        }
      }))
      setNotice({ variant: 'danger', message: mapApiError(err) })
    } finally {
      setTestingProvider('')
    }
  }

  function requestDelete(provider) {
    if (!provider) return
    setConfirmAction({ type: 'provider', provider })
    showToast(`Hapus API key provider "${provider}"?`, {
      bg: 'warning',
      autohide: false,
      delay: 0,
      mode: 'confirm'
    })
  }

  function requestDeleteTmdb() {
    setConfirmAction({ type: 'tmdb' })
    showToast('Hapus TMDB API key?', {
      bg: 'warning',
      autohide: false,
      delay: 0,
      mode: 'confirm'
    })
  }

  async function confirmDelete() {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    setToastState((prev) => ({ ...prev, show: false }))
    if (action.type === 'provider' && action.provider) {
      await handleDelete(action.provider)
      return
    }
    if (action.type === 'tmdb') {
      await handleDeleteTmdb()
    }
  }

  function renderFlagBadge(flag, onLabel = 'ON', offLabel = 'OFF') {
    return flag
      ? <Badge bg="success">{onLabel}</Badge>
      : <Badge bg="secondary">{offLabel}</Badge>
  }

  const postureWarnings = []
  if (securityPosture) {
    if (!securityPosture.serviceRoleConfigured) postureWarnings.push('SUPABASE_SERVICE_ROLE_KEY belum terkonfigurasi.')
    if (!securityPosture.providerKeyEncryptionConfigured) postureWarnings.push('PROVIDER_KEY_ENCRYPTION_KEY belum terkonfigurasi.')
    if (!securityPosture.requireAuthForSensitiveEndpoints) postureWarnings.push('Auth guard endpoint sensitif sedang OFF.')
    if (securityPosture.publicSignupEnabled) postureWarnings.push('Public signup aktif. Untuk tim internal, sebaiknya OFF.')
    if (securityPosture.corsAllowAllOrigins) postureWarnings.push('CORS_ALLOW_ALL_ORIGINS aktif. Ini membuka semua origin.')
    if (!securityPosture.strictSecretEnvGuard) postureWarnings.push('STRICT_SECRET_ENV_GUARD sedang OFF.')
    if (Array.isArray(securityPosture.leakedServiceRoleEnvKeys) && securityPosture.leakedServiceRoleEnvKeys.length > 0) {
      postureWarnings.push(`Terdeteksi env service role bocor ke VITE_*: ${securityPosture.leakedServiceRoleEnvKeys.join(', ')}`)
    }
    if (securityPosture.serviceRoleRotation?.stale) {
      postureWarnings.push(
        `Service role key melewati batas rotasi ${securityPosture.serviceRoleRotation?.maxAgeDays || '-'} hari ` +
        `(${securityPosture.serviceRoleRotation?.daysSinceRotation || '-'} hari).`
      )
    }
  }

  return (
    <Card>
      <Card.Body>
        <h4 className="mb-3">Settings</h4>

        <Card className="mb-3">
          <Card.Body className="py-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="mb-0">Security Posture (Bearer Token)</h6>
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={loadingSecurityPosture}
                onClick={() => loadSecurityPosture()}
              >
                {loadingSecurityPosture ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <small className="text-muted d-block mb-2">
              Endpoint ini dibaca via bearer token session aktif. Tanpa Authorization header valid, server akan balas 401.
            </small>

            {!securityPosture && (
              <Alert variant="secondary" className="mb-2">
                {loadingSecurityPosture ? 'Memuat security posture...' : 'Belum ada data security posture.'}
              </Alert>
            )}

            {securityPosture && (
              <>
                <Row className="g-2 mb-2 scurity-posture-table">
                  <Col md={6}>
                    <Table responsive bordered size="sm" className="mb-0">
                      <tbody>
                        <tr>
                          <td style={{ width: '56%' }}>Service role configured</td>
                          <td>{renderFlagBadge(!!securityPosture.serviceRoleConfigured, 'READY', 'MISSING')}</td>
                        </tr>
                        <tr>
                          <td>Provider key encryption</td>
                          <td>{renderFlagBadge(!!securityPosture.providerKeyEncryptionConfigured, 'READY', 'MISSING')}</td>
                        </tr>
                        <tr>
                          <td>Strict secret env guard</td>
                          <td>{renderFlagBadge(!!securityPosture.strictSecretEnvGuard, 'ON', 'OFF')}</td>
                        </tr>
                        <tr>
                          <td>Sensitive endpoint auth guard</td>
                          <td>{renderFlagBadge(!!securityPosture.requireAuthForSensitiveEndpoints, 'ON', 'OFF')}</td>
                        </tr>
                        <tr>
                          <td>Public signup</td>
                          <td>{renderFlagBadge(!securityPosture.publicSignupEnabled, 'OFF (AMAN)', 'ON')}</td>
                        </tr>
                        <tr>
                          <td>Leaked service-role env keys</td>
                          <td>
                            {(securityPosture.leakedServiceRoleEnvKeys || []).length > 0
                              ? (
                                <small className="text-danger">
                                  {securityPosture.leakedServiceRoleEnvKeys.join(', ')}
                                </small>
                                )
                              : <Badge bg="success">NONE</Badge>}
                          </td>
                        </tr>
                      </tbody>
                    </Table>
                  </Col>
                  <Col md={6}>
                    <Table responsive bordered size="sm" className="mb-0">
                      <tbody>
                        <tr>
                          <td style={{ width: '56%' }}>Email allowlist</td>
                          <td>
                            {renderFlagBadge(!!securityPosture.allowlistEnabled, 'ON', 'OFF')}{' '}
                            <small className="text-muted">({Number(securityPosture.allowlistCount || 0)} email)</small>
                          </td>
                        </tr>
                        <tr>
                          <td>CORS allow all origins</td>
                          <td>{renderFlagBadge(!securityPosture.corsAllowAllOrigins, 'OFF (AMAN)', 'ON')}</td>
                        </tr>
                        <tr>
                          <td>Allowed origins</td>
                          <td>
                            <small className="text-muted">
                              {Array.isArray(securityPosture.corsAllowedOrigins) && securityPosture.corsAllowedOrigins.length > 0
                                ? securityPosture.corsAllowedOrigins.join(', ')
                                : '-'}
                            </small>
                          </td>
                        </tr>
                        <tr>
                          <td>Service role rotation</td>
                          <td>
                            {securityPosture.serviceRoleRotation?.configured
                              ? (
                                <>
                                  {securityPosture.serviceRoleRotation?.stale
                                    ? <Badge bg="warning" text="dark">STALE</Badge>
                                    : <Badge bg="success">OK</Badge>}{' '}
                                  <small className="text-muted">
                                    {securityPosture.serviceRoleRotation?.daysSinceRotation} hari / max {securityPosture.serviceRoleRotation?.maxAgeDays} hari
                                  </small>
                                </>
                                )
                              : <Badge bg="secondary">NOT SET</Badge>}
                          </td>
                        </tr>
                      </tbody>
                    </Table>
                  </Col>
                </Row>
                {postureWarnings.length > 0 && (
                  <Alert variant="warning" className="mb-0 py-2">
                    <strong>Perlu tindakan:</strong>
                    <ul className="mb-0 mt-1 ps-3">
                      {postureWarnings.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </>
            )}
          </Card.Body>
        </Card>
        <Card className="mb-3">
          <Card.Body className="py-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="mb-0">Backend Routing (Failover)</h6>
              <small className="text-muted">Test endpoint sebelum simpan</small>
            </div>
            <small className="text-muted d-block mb-2">
              Default env: {initialApiConfig.envPrimary || '-'}
            </small>
            <Row className="g-2 align-items-end">
              <Col md={5}>
                <Form.Label>Primary URL (Override)</Form.Label>
                <Form.Control
                  type="text"
                  placeholder={initialApiConfig.envPrimary || 'https://api-backend.vercel.app'}
                  value={apiRouteConfig.override}
                  onChange={(e) => setApiRouteConfig((prev) => ({ ...prev, override: e.target.value }))}
                />
              </Col>
              <Col md={5}>
                <Form.Label>Secondary URL (Optional)</Form.Label>
                <Form.Control
                  type="text"
                  placeholder={initialApiConfig.envSecondary || 'https://api-backup.vercel.app'}
                  value={apiRouteConfig.secondary}
                  onChange={(e) => setApiRouteConfig((prev) => ({ ...prev, secondary: e.target.value }))}
                />
              </Col>
              <Col md={2}>
                <Form.Check
                  type="switch"
                  id="allow-local-fallback"
                  label="Local fallback"
                  checked={!!apiRouteConfig.allowLocalFallback}
                  onChange={(e) => setApiRouteConfig((prev) => ({ ...prev, allowLocalFallback: e.target.checked }))}
                />
              </Col>
            </Row>
            <div className="d-flex gap-2 mt-3 flex-wrap">
              <Button size="sm" variant="outline-primary" onClick={handleTestApiRoute} disabled={testingApiRoute || savingApiRoute}>
                {testingApiRoute ? 'Testing...' : 'Test Connection'}
              </Button>
              <Button size="sm" variant="primary" onClick={handleSaveApiRoute} disabled={savingApiRoute || testingApiRoute}>
                {savingApiRoute ? 'Saving...' : 'Save Routing'}
              </Button>
              <Button size="sm" variant="outline-secondary" onClick={handleResetApiRoute} disabled={testingApiRoute || savingApiRoute}>
                Reset
              </Button>
            </div>
            {apiRouteTest && (
              <div className="mt-2">
                <small className={apiRouteTest.ok ? 'text-success' : 'text-warning'}>
                  {apiRouteTest.ok
                    ? `Endpoint aktif: ${apiRouteTest.activeBase}`
                    : 'Tidak ada endpoint healthy dari daftar kandidat.'}
                </small>
                {!!apiRouteTest?.checked?.length && (
                  <div className="mt-1">
                    <small className="text-muted">
                      {apiRouteTest.checked.map((item) => `${item.base || '-'} (${item.ok ? 'OK' : item.error || 'ERR'})`).join(' | ')}
                    </small>
                  </div>
                )}
              </div>
            )}
          </Card.Body>
        </Card>

        <Card className="mb-3">
          <Card.Body className="py-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="mb-0">Supabase Profile Switch</h6>
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={loadingSupabaseProfile || !!switchingSupabaseProfile}
                onClick={() => loadSupabaseProfileStatus()}
              >
                {loadingSupabaseProfile ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <small className="text-muted d-block">
              Active profile file: {supabaseProfileStatus?.activeProfile || '-'}
            </small>
            <small className="text-muted d-block">
              Dual-write: {supabaseProfileStatus?.dualWrite?.enabled
                ? (supabaseProfileStatus?.dualWrite?.mirrorReady
                  ? `ON -> mirror ${supabaseProfileStatus?.dualWrite?.mirrorProfile || '-'}`
                  : `ON (mirror not ready: ${supabaseProfileStatus?.dualWrite?.reason || 'unknown'})`)
                : 'OFF'}
            </small>
            <small className="text-muted d-block mb-2">
              Frontend client source: {supabaseClientConfig?.source || 'env'} ({supabaseClientConfig?.url || '-'})
            </small>
            <Row className="g-2">
              <Col md={6}>
                <Card className="h-100">
                  <Card.Body className="py-2">
                    <div className="d-flex align-items-center justify-content-between">
                      <strong>Primary</strong>
                      <div className="d-flex align-items-center gap-2">
                        {supabaseProfileStatus?.profiles?.primary?.ready
                          ? <Badge bg="success">Ready</Badge>
                          : supabaseProfileStatus?.profiles?.primary?.exists
                            ? <Badge bg="warning" text="dark">Incomplete</Badge>
                            : <Badge bg="secondary">Missing</Badge>}
                        {supabaseProfileStatus?.activeProfile === 'primary' && (
                          <span
                            title="Active profile"
                            aria-label="Active profile"
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              display: 'inline-block',
                              backgroundColor: '#22c55e',
                              boxShadow: '0 0 0 2px rgba(34, 197, 94, 0.18)'
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <small className="text-muted d-block mt-1">
                      {supabaseProfileStatus?.profiles?.primary?.supabaseUrl || '-'}
                    </small>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline-primary"
                      disabled={!supabaseProfileStatus?.profiles?.primary?.ready || switchingSupabaseProfile === 'primary'}
                      onClick={() => handleSwitchSupabaseProfile('primary')}
                    >
                      {switchingSupabaseProfile === 'primary' ? 'Switching...' : 'Use Primary'}
                    </Button>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="h-100">
                  <Card.Body className="py-2">
                    <div className="d-flex align-items-center justify-content-between">
                      <strong>Backup</strong>
                      <div className="d-flex align-items-center gap-2">
                        {supabaseProfileStatus?.profiles?.backup?.ready
                          ? <Badge bg="success">Ready</Badge>
                          : supabaseProfileStatus?.profiles?.backup?.exists
                            ? <Badge bg="warning" text="dark">Incomplete</Badge>
                            : <Badge bg="secondary">Missing</Badge>}
                        {supabaseProfileStatus?.activeProfile === 'backup' && (
                          <span
                            title="Active profile"
                            aria-label="Active profile"
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              display: 'inline-block',
                              backgroundColor: '#22c55e',
                              boxShadow: '0 0 0 2px rgba(34, 197, 94, 0.18)'
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <small className="text-muted d-block mt-1">
                      {supabaseProfileStatus?.profiles?.backup?.supabaseUrl || '-'}
                    </small>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline-primary"
                      disabled={!supabaseProfileStatus?.profiles?.backup?.ready || switchingSupabaseProfile === 'backup'}
                      onClick={() => handleSwitchSupabaseProfile('backup')}
                    >
                      {switchingSupabaseProfile === 'backup' ? 'Switching...' : 'Use Backup'}
                    </Button>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        <Card className="mb-3">
          <Card.Body className="py-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="mb-0">TMDB Key (Movie/TV)</h6>
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={loadingTmdb || savingTmdb || updatingTmdb || testingTmdb}
                onClick={() => loadTmdbKeyStatus()}
              >
                {loadingTmdb ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <small className="text-muted d-block">
              Source: {tmdbStatus.keySource === 'table' ? 'Settings (encrypted)' : tmdbStatus.keySource === 'env' ? 'Env fallback' : '-'}
            </small>
            <small className="text-muted d-block mb-2">
              Status: {tmdbStatus.configured ? 'Configured' : 'Not configured'} · Last4: {tmdbStatus.keyLast4 ? `****${tmdbStatus.keyLast4}` : '-'}
              {' · '}Owner: {tmdbStatus.updatedByDisplayName || '-'}
            </small>

            <Form onSubmit={handleSaveTmdb}>
              <Row className="g-2 align-items-end">
                <Col md={6}>
                  <Form.Label>TMDB API Key</Form.Label>
                  <Form.Control
                    type="password"
                    placeholder="Masukkan TMDB API key"
                    value={tmdbForm.apiKey}
                    onChange={(e) => setTmdbForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    autoComplete="off"
                  />
                </Col>
                <Col md={2}>
                  <Form.Check
                    type="switch"
                    id="tmdb-key-active"
                    label="Aktif"
                    checked={!!tmdbForm.isActive}
                    disabled={tmdbStatus.keySource !== 'table' && tmdbStatus.configured}
                    onChange={(e) => setTmdbForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                  />
                </Col>
                <Col md={4}>
                  <div className="d-grid d-md-flex gap-2">
                    <Button type="submit" disabled={savingTmdb || loadingTmdb}>
                      {savingTmdb ? <Spinner animation="border" size="sm" /> : 'Simpan TMDB'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline-primary"
                      disabled={testingTmdb || loadingTmdb}
                      onClick={handleTestTmdb}
                    >
                      {testingTmdb ? 'Testing...' : 'Test'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline-danger"
                      disabled={!tmdbStatus.configured || updatingTmdb || savingTmdb}
                      onClick={requestDeleteTmdb}
                    >
                      {updatingTmdb ? '...' : 'Hapus'}
                    </Button>
                  </div>
                </Col>
              </Row>
            </Form>
            {tmdbStatus.keySource === 'env' && (
              <small className="text-warning d-block mt-2">
                TMDB saat ini dari env fallback. Hapus dari Settings tidak akan menghapus nilai di file env.
              </small>
            )}
            {tmdbTestResult && (
              <small className="text-muted d-block mt-2">
                Test OK ({tmdbTestResult.keySource || '-'}) · secure image base: {tmdbTestResult.imagesSecureBaseUrl || '-'}
                {Array.isArray(tmdbTestResult.posterSizes) && tmdbTestResult.posterSizes.length > 0
                  ? ` · poster sizes: ${tmdbTestResult.posterSizes.join(', ')}`
                  : ''}
              </small>
            )}
          </Card.Body>
        </Card>

        <Alert variant="secondary">
          API key disimpan terenkripsi di server. Nilai full key tidak pernah ditampilkan lagi setelah disimpan.
        </Alert>

        <Form className="mb-4" onSubmit={handleSave}>
          <Row className="g-2 align-items-end">
            <Col md={3}>
              <Form.Label>Provider</Form.Label>
              <Form.Select
                value={form.provider}
                onChange={(e) => setForm((prev) => ({ ...prev, provider: e.target.value }))}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md={5}>
              <Form.Label>API Key</Form.Label>
              <Form.Control
                type="password"
                placeholder="Masukkan API key provider"
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                autoComplete="off"
              />
            </Col>
            <Col md={2}>
              <Form.Check
                type="switch"
                id="provider-key-active"
                label="Aktif"
                checked={!!form.isActive}
                onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              />
            </Col>
            <Col md={2}>
              <Button type="submit" className="w-100" disabled={saving || loading}>
                {saving ? <Spinner animation="border" size="sm" /> : 'Simpan Key'}
              </Button>
            </Col>
          </Row>
        </Form>

        <div className="d-flex align-items-center justify-content-between mb-2">
          <h6 className="mb-0">Provider Key Status</h6>
          <small className="text-muted">Free tier only dapat diatur per provider</small>
        </div>
        {loading ? (
          <Alert variant="info" className="mb-0">Memuat konfigurasi provider key...</Alert>
        ) : (
          <Table responsive bordered hover size="sm" className="mb-0 align-middle">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Last 4</th>
                <th>Active</th>
                <th>Free Only</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isBusy = busyProvider === row.provider
                const isTesting = testingProvider === row.provider
                const detected = detectedModelsByProvider[row.provider]
                return (
                  <React.Fragment key={row.provider}>
                    <tr>
                      <td>{row.provider}</td>
                      <td>{row.configured ? (row.userDisplayName || '-') : 'Not configured'}</td>
                      <td>
                        {row.configured
                          ? <Badge bg="success">Configured</Badge>
                          : <Badge bg="secondary">Not configured</Badge>}
                      </td>
                      <td>{row.keyLast4 ? `****${row.keyLast4}` : '-'}</td>
                      <td>
                        <Form.Check
                          type="switch"
                          id={`active-${row.provider}`}
                          checked={!!row.isActive}
                          disabled={!row.configured || isBusy}
                          onChange={(e) => handleToggleActive(row.provider, e.target.checked)}
                        />
                      </td>
                      <td>
                        <Form.Check
                          type="switch"
                          id={`free-only-${row.provider}`}
                          checked={isFreeOnlyForProvider(row.provider)}
                          onChange={(e) => setFreeOnlyForProvider(row.provider, e.target.checked)}
                        />
                      </td>
                      <td className="d-flex gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          disabled={!row.configured || isTesting}
                          onClick={() => handleTestProvider(row.provider)}
                        >
                          {isTesting ? 'Testing...' : 'Test'}
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          disabled={!row.configured || isBusy}
                          onClick={() => requestDelete(row.provider)}
                        >
                          {isBusy ? '...' : 'Hapus'}
                        </Button>
                      </td>
                    </tr>
                    {detected && (
                      <tr>
                        <td colSpan={7}>
                          {detected.loading && (
                            <small className="text-muted">Mendeteksi model provider...</small>
                          )}
                          {!detected.loading && detected.error && (
                            <small className="text-danger">{detected.error}</small>
                          )}
                          {!detected.loading && !detected.error && (
                            <div>
                              <small className="text-muted d-block mb-1">
                                Terdeteksi {detected.models?.length || 0} model
                                {detected.source ? ` (${detected.source})` : ''}
                                {detected.freeOnlyRequested && detected.freeFilterApplied ? ' - free tier filter aktif' : ''}
                                {Array.isArray(detected.models)
                                  ? ` - vision: ${detected.models.filter((m) => m?.supportsVision === true).length}`
                                  : ''}
                              </small>
                              <div className="d-flex gap-1 flex-wrap">
                                {(detected.models || []).map((m) => (
                                  <Badge
                                    bg={m?.isFeatured === true || isFeaturedModel(row.provider, m?.id) ? 'warning' : 'light'}
                                    text="dark"
                                    key={`${row.provider}-${m.id}`}
                                  >
                                    {m?.isFeatured === true || isFeaturedModel(row.provider, m?.id) ? `* ${m.id}` : m.id}
                                    {m.isFree === true ? ' (free)' : ''}
                                    {m.supportsVision === true ? ' (vision)' : ''}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </Table>
        )}
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
            <strong className="me-auto">Konfirmasi</strong>
          </Toast.Header>
          <Toast.Body className={toastState.bg === 'warning' ? 'text-dark' : 'text-white'}>
            <div>{toastState.message}</div>
            {toastState.mode === 'confirm' && confirmAction && (
              <div className="d-flex gap-2 justify-content-end mt-3">
                <Button size="sm" variant="outline-secondary" onClick={closeToast}>Batal</Button>
                <Button size="sm" variant="danger" onClick={confirmDelete}>Hapus</Button>
              </div>
            )}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </Card>
  )
}
