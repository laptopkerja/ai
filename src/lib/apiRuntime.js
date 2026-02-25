import axios from 'axios'

const API_BASE_OVERRIDE_STORAGE_KEY = 'api_base_override_v1'
const API_BASE_SECONDARY_STORAGE_KEY = 'api_base_secondary_v1'
const API_ALLOW_LOCAL_FALLBACK_STORAGE_KEY = 'api_allow_local_fallback_v1'
const API_LAST_HEALTHY_STORAGE_KEY = 'api_last_healthy_v1'
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504])
const IS_DEV_RUNTIME = !!import.meta.env.DEV
const DEV_DEFAULT_API_BASE = 'http://localhost:3000'
const NO_API_BASE_CONFIG_ERROR =
  'Backend URL belum dikonfigurasi. Isi VITE_API_URL (production) atau set Backend Routing di Settings.'

const ENV_PRIMARY_API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL || (IS_DEV_RUNTIME ? DEV_DEFAULT_API_BASE : ''))
const ENV_SECONDARY_API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL_SECONDARY || '')
const ENV_LOCAL_API_BASE = normalizeApiBase(import.meta.env.VITE_LOCAL_API_URL || (IS_DEV_RUNTIME ? DEV_DEFAULT_API_BASE : ''))

function hasWindow() {
  return typeof window !== 'undefined'
}

function readStorage(key) {
  if (!hasWindow()) return ''
  try {
    return String(window.localStorage.getItem(key) || '').trim()
  } catch (e) {
    return ''
  }
}

function writeStorage(key, value) {
  if (!hasWindow()) return
  try {
    if (value === '' || value == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(value))
  } catch (e) {}
}

function readBooleanStorage(key, fallbackValue = true) {
  const raw = readStorage(key)
  if (!raw) return !!fallbackValue
  return raw === '1' || raw.toLowerCase() === 'true'
}

function unique(list = []) {
  const out = []
  const seen = new Set()
  list.forEach((item) => {
    const key = String(item || '').trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  })
  return out
}

function withLeadingSlash(path) {
  const value = String(path || '').trim()
  if (!value) return '/'
  return value.startsWith('/') ? value : `/${value}`
}

function canTryLocalFallback(base) {
  const normalized = normalizeApiBase(base)
  if (!normalized) return false
  let parsed
  try {
    parsed = new URL(normalized)
  } catch (e) {
    return false
  }
  const host = String(parsed.hostname || '').toLowerCase()
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (!isLocalHost) return false

  if (!hasWindow()) return true
  const currentHost = String(window.location?.hostname || '').toLowerCase()
  const currentProtocol = String(window.location?.protocol || '').toLowerCase()
  const isCurrentLocal = currentHost === 'localhost' || currentHost === '127.0.0.1'
  if (parsed.protocol === 'https:') return true
  if (currentProtocol === 'http:') return true
  return isCurrentLocal
}

function buildCandidateList(config, includeLocalFallback = true) {
  const allowLocalFallback = config.allowLocalFallback !== false
  const seeds = [
    config.override,
    config.envPrimary,
    config.secondary,
    config.envSecondary
  ]

  if (includeLocalFallback && allowLocalFallback && canTryLocalFallback(config.localFallback)) {
    seeds.push(config.localFallback)
  }

  const ordered = unique(seeds.map((value) => normalizeApiBase(value)).filter(Boolean))
  const lastHealthy = normalizeApiBase(config.lastHealthyBase)
  if (!lastHealthy) return ordered
  if (!ordered.includes(lastHealthy)) return ordered
  return [lastHealthy, ...ordered.filter((item) => item !== lastHealthy)]
}

function shouldRetryStatus(status) {
  const code = Number(status || 0)
  return RETRYABLE_STATUS.has(code)
}

function isTimeoutError(err) {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '').toLowerCase()
  return code === 'econnaborted' || message.includes('timeout') || message.includes('timed out')
}

function retryDelay(baseDelayMs, attemptIndex) {
  const base = Math.max(80, Number(baseDelayMs || 350))
  const idx = Math.max(0, Number(attemptIndex || 0))
  return base * (idx + 1)
}

async function sleep(ms) {
  const wait = Math.max(0, Number(ms || 0))
  if (!wait) return
  await new Promise((resolve) => setTimeout(resolve, wait))
}

function buildAbsoluteUrl(base, path) {
  return `${normalizeApiBase(base)}${withLeadingSlash(path)}`
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 12000) {
  const timeout = Math.max(500, Number(timeoutMs || 12000))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function mapProbeError(err) {
  if (!err) return 'Network error'
  if (err.name === 'AbortError') return 'Timeout'
  return err.message || 'Network error'
}

function safeText(value) {
  return String(value || '').trim()
}

function isNetworkLikeError(message = '') {
  const msg = String(message || '').toLowerCase()
  return msg.includes('network error')
    || msg.includes('failed to fetch')
    || msg.includes('net::')
    || msg.includes('cors')
}

function joinSentence(base, suffix) {
  const left = safeText(base)
  const right = safeText(suffix)
  if (!left) return right
  if (!right) return left
  const normalizedLeft = /[.!?]$/.test(left) ? left : `${left}.`
  return `${normalizedLeft} ${right}`
}

function normalizeConfig(configOverride = null) {
  const base = getApiRuntimeConfig()
  if (!configOverride || typeof configOverride !== 'object') return base
  return {
    ...base,
    override: configOverride.override !== undefined ? normalizeApiBase(configOverride.override) : base.override,
    secondary: configOverride.secondary !== undefined ? normalizeApiBase(configOverride.secondary) : base.secondary,
    allowLocalFallback: configOverride.allowLocalFallback !== undefined
      ? !!configOverride.allowLocalFallback
      : base.allowLocalFallback
  }
}

function markHealthy(base) {
  const normalized = normalizeApiBase(base)
  if (!normalized) return
  writeStorage(API_LAST_HEALTHY_STORAGE_KEY, normalized)
}

export function normalizeApiBase(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const looksLocalNoProtocol = /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(raw)
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : (looksLocalNoProtocol ? `http://${raw}` : `https://${raw}`)
  try {
    const parsed = new URL(withProtocol)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${pathname}`
  } catch (e) {
    return ''
  }
}

export function getApiRuntimeConfig() {
  return {
    envPrimary: ENV_PRIMARY_API_BASE,
    envSecondary: ENV_SECONDARY_API_BASE,
    localFallback: ENV_LOCAL_API_BASE,
    override: normalizeApiBase(readStorage(API_BASE_OVERRIDE_STORAGE_KEY)),
    secondary: normalizeApiBase(readStorage(API_BASE_SECONDARY_STORAGE_KEY)),
    allowLocalFallback: readBooleanStorage(API_ALLOW_LOCAL_FALLBACK_STORAGE_KEY, IS_DEV_RUNTIME),
    lastHealthyBase: normalizeApiBase(readStorage(API_LAST_HEALTHY_STORAGE_KEY))
  }
}

export function saveApiRuntimeConfig(config = {}) {
  const normalized = normalizeConfig(config)
  writeStorage(API_BASE_OVERRIDE_STORAGE_KEY, normalized.override || '')
  writeStorage(API_BASE_SECONDARY_STORAGE_KEY, normalized.secondary || '')
  writeStorage(API_ALLOW_LOCAL_FALLBACK_STORAGE_KEY, normalized.allowLocalFallback ? '1' : '0')
}

export function clearApiRuntimeConfig() {
  writeStorage(API_BASE_OVERRIDE_STORAGE_KEY, '')
  writeStorage(API_BASE_SECONDARY_STORAGE_KEY, '')
  writeStorage(API_ALLOW_LOCAL_FALLBACK_STORAGE_KEY, '')
  writeStorage(API_LAST_HEALTHY_STORAGE_KEY, '')
}

export function getApiBaseCandidates({ includeLocalFallback = true, configOverride = null } = {}) {
  return buildCandidateList(normalizeConfig(configOverride), includeLocalFallback)
}

export function getCurrentApiBase() {
  const candidates = getApiBaseCandidates()
  return candidates[0] || ''
}

export async function probeApiBase(base, { timeoutMs = 2500 } = {}) {
  const normalized = normalizeApiBase(base)
  if (!normalized) return { ok: false, base: '', status: 0, error: 'URL backend tidak valid' }
  try {
    const response = await fetchWithTimeout(buildAbsoluteUrl(normalized, '/health'), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, timeoutMs)

    if (!response.ok) {
      return {
        ok: false,
        base: normalized,
        status: response.status,
        error: `HTTP ${response.status}`
      }
    }

    markHealthy(normalized)
    return {
      ok: true,
      base: normalized,
      status: response.status,
      error: ''
    }
  } catch (err) {
    return {
      ok: false,
      base: normalized,
      status: 0,
      error: mapProbeError(err)
    }
  }
}

export async function probeApiCandidates(configOverride = null, { timeoutMs = 2500, includeLocalFallback = true } = {}) {
  const candidates = getApiBaseCandidates({ includeLocalFallback, configOverride })
  if (!candidates.length) {
    return {
      ok: false,
      activeBase: '',
      checked: [{
        ok: false,
        base: '',
        status: 0,
        error: NO_API_BASE_CONFIG_ERROR
      }]
    }
  }
  const checked = []
  for (const base of candidates) {
    const item = await probeApiBase(base, { timeoutMs })
    checked.push(item)
    if (item.ok) {
      return { ok: true, activeBase: item.base, checked }
    }
  }
  return { ok: false, activeBase: '', checked }
}

export async function apiFetch(path, init = {}, options = {}) {
  const timeoutMs = Math.max(800, Number(options.timeoutMs || 15000))
  const retryAttempts = Math.max(0, Number(options.retryAttempts ?? 0))
  const retryDelayMs = Math.max(80, Number(options.retryDelayMs || 350))
  const includeLocalFallback = options.includeLocalFallback !== false
  const configOverride = options.configOverride || null
  const candidates = getApiBaseCandidates({ includeLocalFallback, configOverride })
  if (!candidates.length) {
    throw new Error(NO_API_BASE_CONFIG_ERROR)
  }
  const requestPath = withLeadingSlash(path)

  let lastError = null
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const base = candidates[idx]
    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(buildAbsoluteUrl(base, requestPath), init, timeoutMs)
        const retryableStatus = shouldRetryStatus(response.status)
        if (!retryableStatus) {
          markHealthy(base)
          return response
        }
        lastError = new Error(`HTTP ${response.status}`)
        const hasNextAttempt = attempt < retryAttempts
        if (hasNextAttempt) {
          await sleep(retryDelay(retryDelayMs, attempt))
          continue
        }
        const hasNextBase = idx < candidates.length - 1
        if (!hasNextBase) {
          markHealthy(base)
          return response
        }
        break
      } catch (err) {
        lastError = err
        const retryableErr = isTimeoutError(err)
        const hasNextAttempt = attempt < retryAttempts
        if (retryableErr && hasNextAttempt) {
          await sleep(retryDelay(retryDelayMs, attempt))
          continue
        }
        const hasNextBase = idx < candidates.length - 1
        if (!hasNextBase) throw err
        break
      }
    }
  }

  throw lastError || new Error('Semua endpoint backend tidak dapat diakses')
}

export function humanizeApiError(err, options = {}) {
  const fallback = safeText(options.fallback) || 'Terjadi kesalahan saat memproses permintaan.'
  const status = Number(err?.response?.status || err?.status || 0)
  const data = err?.response?.data
  const apiError = data && typeof data === 'object' ? (data.error || {}) : {}
  const code = safeText(apiError?.code).toUpperCase()
  const message = safeText(apiError?.message || data?.message || err?.message)
  const classification = safeText(apiError?.details?.classification).toLowerCase()

  if (!status) {
    const rawMsg = safeText(err?.message || '')
    const errCode = safeText(err?.code).toLowerCase()
    if (errCode === 'econnaborted' || rawMsg.toLowerCase().includes('timeout') || rawMsg.toLowerCase().includes('timed out')) {
      return 'Koneksi timeout. Server atau provider terlalu lama merespons. Coba ulang atau ganti model.'
    }
    if (isNetworkLikeError(rawMsg)) {
      return 'Backend tidak bisa dihubungi. Periksa URL backend di Settings atau jalankan backend lokal.'
    }
    return message || fallback
  }

  if (status === 401) {
    return 'Sesi login tidak valid atau sudah habis. Silakan login ulang.'
  }

  if (status === 403) {
    if (code === 'EMAIL_NOT_ALLOWED') {
      return 'Akun ini tidak masuk allowlist internal. Hubungi owner aplikasi.'
    }
    return message || 'Akses ditolak oleh server.'
  }

  if (status === 404) {
    return message || 'Endpoint tidak ditemukan di backend.'
  }

  if (status === 429 || classification === 'rate_limit') {
    return joinSentence(
      message || 'Request dibatasi sementara oleh provider (rate limit)',
      'Tunggu 15-30 detik lalu coba lagi, atau ganti model/provider.'
    )
  }

  if (status === 503) {
    const lowered = message.toLowerCase()
    if (lowered.includes('supabase admin client')) {
      return 'Supabase admin client belum dikonfigurasi di backend.'
    }
    if (lowered.includes('encryption')) {
      return 'Enkripsi API key provider belum dikonfigurasi di backend.'
    }
    return message || 'Layanan backend sedang tidak tersedia (503).'
  }

  if (status === 400 && code === 'KEY_NOT_CONFIGURED') {
    return 'API key provider belum dikonfigurasi. Buka Settings lalu simpan key provider terlebih dulu.'
  }

  if (status === 400 && code === 'VALIDATION_ERROR') {
    const details = Array.isArray(apiError?.details) ? apiError.details.filter(Boolean) : []
    if (details.length) {
      return `${message || 'Validasi gagal'} (${details.join('; ')})`
    }
    return message || 'Validasi request gagal.'
  }

  if (status === 400 && code === 'PRESET_CONTRACT_REJECTED') {
    const details = apiError?.details && typeof apiError.details === 'object' ? apiError.details : {}
    const platformText = safeText(details.platform)
    const problems = Array.isArray(details.errors) ? details.errors.filter(Boolean) : []
    const warnings = Array.isArray(details.warnings) ? details.warnings.filter(Boolean) : []
    const tip = safeText(details?.action?.tip)
    const problemText = problems.length ? problems.join('; ') : 'Field preset belum sesuai kontrak platform.'
    const warningText = warnings.length ? ` Peringatan: ${warnings.join('; ')}` : ''
    const platformSuffix = platformText ? ` (${platformText})` : ''
    const tipText = tip ? ` ${tip}` : ' Buka Templates untuk Edit atau Hapus preset ini.'
    return `Preset ditolak${platformSuffix}: ${problemText}.${warningText}${tipText}`
  }

  if (status === 400 && (code === 'PROVIDER_AUTH_ERROR' || classification === 'auth')) {
    return joinSentence(
      message || 'Autentikasi ke provider gagal',
      'API key provider kemungkinan tidak valid, nonaktif, atau salah akun. Buka Settings, simpan ulang key, lalu klik Test provider.'
    )
  }

  if (status === 400 && (code === 'PROVIDER_MODEL_NOT_FOUND' || classification === 'model')) {
    return joinSentence(
      message || 'Model provider tidak ditemukan',
      'Pilih model lain atau refresh daftar model dari provider.'
    )
  }

  if (status === 400 && (code === 'PROVIDER_BAD_REQUEST' || classification === 'bad_request')) {
    return joinSentence(
      message || 'Request ke provider tidak valid',
      'Periksa konfigurasi model/provider lalu coba lagi.'
    )
  }

  if (status === 502 || status === 504 || classification === 'timeout' || classification === 'json_invalid') {
    if (classification === 'json_invalid') {
      return joinSentence(
        message || 'Respons provider tidak valid JSON',
        'Coba ulang, atau ganti model/provider di Settings.'
      )
    }
    if (classification === 'timeout' || status === 504) {
      return joinSentence(
        message || 'Provider timeout',
        'Coba ulang, atau pilih model yang lebih ringan.'
      )
    }
    return joinSentence(
      message || 'Provider AI gagal merespons',
      'Coba ulang atau ganti model/provider.'
    )
  }

  return message || fallback
}

export async function apiAxios(requestConfig = {}, options = {}) {
  const timeoutMs = Math.max(800, Number(options.timeoutMs || 15000))
  const retryAttempts = Math.max(0, Number(options.retryAttempts ?? 0))
  const retryDelayMs = Math.max(80, Number(options.retryDelayMs || 350))
  const includeLocalFallback = options.includeLocalFallback !== false
  const configOverride = options.configOverride || null
  const candidates = getApiBaseCandidates({ includeLocalFallback, configOverride })
  if (!candidates.length) {
    throw new Error(NO_API_BASE_CONFIG_ERROR)
  }

  const rawUrl = String(requestConfig.url || '').trim()
  if (/^https?:\/\//i.test(rawUrl)) {
    return axios({
      ...requestConfig,
      timeout: requestConfig.timeout ?? timeoutMs
    })
  }
  const requestPath = withLeadingSlash(rawUrl)

  let lastError = null
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const base = candidates[idx]
    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      try {
        const response = await axios({
          ...requestConfig,
          baseURL: base,
          url: requestPath,
          timeout: requestConfig.timeout ?? timeoutMs
        })
        markHealthy(base)
        return response
      } catch (err) {
        lastError = err
        const status = Number(err?.response?.status || 0)
        const retryable = !status || shouldRetryStatus(status) || isTimeoutError(err)
        const hasNextAttempt = attempt < retryAttempts
        if (retryable && hasNextAttempt) {
          await sleep(retryDelay(retryDelayMs, attempt))
          continue
        }
        const hasNextBase = idx < candidates.length - 1
        if (!retryable || !hasNextBase) throw err
        break
      }
    }
  }
  throw lastError || new Error('Semua endpoint backend tidak dapat diakses')
}
