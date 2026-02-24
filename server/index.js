/* Backend server
   - Provides POST /api/generate with real provider calls when keys are available
   - Falls back to mocked content when provider key is unavailable and fallback is enabled
*/
import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import bodyParser from 'body-parser'
import { v4 as uuidv4 } from 'uuid'
import { createClient } from '@supabase/supabase-js'
import { compilePrompt, defaultTemplateForConfig } from '../shared/lib/promptCompiler.js'
import fs from 'fs'
import path from 'path'
import normalizePreset from '../shared/lib/normalizePreset.js'
import applyOverrides from '../shared/lib/applyOverrides.js'
import validateTemplate from '../shared/lib/validateTemplate.js'
import { dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { encryptProviderApiKey, decryptProviderApiKey, hasProviderKeyEncryptionKey } from './lib/providerKeysCrypto.js'
import { generateStructuredWithProvider, isVisionCapableModel, isVisionProviderImplemented } from './lib/aiProviders.js'
import { detectProviderModels } from './lib/providerModelDiscovery.js'
import applyGenerationQualityGuardrails from './lib/generationQuality.js'
import lintPresetAgainstPlatformContract from '../src/lib/presetPlatformLint.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

const PRESETS_DATA_DIR = path.resolve(process.cwd(), 'data')
const PRESETS_DATA_FILE = path.join(PRESETS_DATA_DIR, 'presets.json')
const ENV_PRIMARY_FILE = path.resolve(process.cwd(), '.env.primary')
const ENV_BACKUP_FILE = path.resolve(process.cwd(), '.env.backup')
const ENV_ACTIVE_FILE = path.resolve(process.cwd(), '.env')
const SWITCH_ENV_SCRIPT_FILE = path.resolve(process.cwd(), 'scripts', 'switch-env.mjs')
const SUPABASE_PROFILE_FILES = {
  primary: ENV_PRIMARY_FILE,
  backup: ENV_BACKUP_FILE
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(PRESETS_DATA_DIR)) fs.mkdirSync(PRESETS_DATA_DIR, { recursive: true })
  } catch (e) { }
}

function readStoredPresets() {
  // prefer data/presets.json, fallback to public file
  try {
    if (fs.existsSync(PRESETS_DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PRESETS_DATA_FILE, 'utf8'))
      if (Array.isArray(raw)) return raw
    }
  } catch (e) {}
  // fallback to public bundled presets
  try {
    const p = path.resolve(process.cwd(), 'public', 'example-format-template-converted-by-script.json')
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(raw)) return raw
    }
  } catch (e) {}
  return []
}

function writeStoredPresets(arr) {
  try {
    ensureDataDir()
    fs.writeFileSync(PRESETS_DATA_FILE, JSON.stringify(arr, null, 2), 'utf8')
    return true
  } catch (e) {
    console.error('Failed to write presets file', e)
    return false
  }
}

function bumpVersion(versionStr) {
  // simple semver bump (patch)
  try {
    const parts = String(versionStr || '1.0.0').split('.').map(n=>parseInt(n||0,10))
    while (parts.length<3) parts.push(0)
    parts[2] = (parts[2]||0) + 1
    return parts.join('.')
  } catch (e) { return '1.0.1' }
}

// Load .env for server (development). In production use platform env vars.
dotenv.config()
// Import admin router after env is loaded to ensure service role key is available
const { default: adminRouter } = await import('./admin-auth.js')

const app = express()
const PORT = process.env.PORT || 3000
const MAX_SIGNUP_USERS = Number(process.env.MAX_SIGNUP_USERS || 4)
const REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS = String(process.env.REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS || 'true').toLowerCase() !== 'false'
const ENABLE_PUBLIC_SIGNUP = String(process.env.ENABLE_PUBLIC_SIGNUP || 'false').toLowerCase() === 'true'
const ENFORCE_AUTH_EMAIL_ALLOWLIST = String(process.env.ENFORCE_AUTH_EMAIL_ALLOWLIST || 'true').toLowerCase() !== 'false'
const CORS_ALLOW_ALL_ORIGINS = String(process.env.CORS_ALLOW_ALL_ORIGINS || 'false').toLowerCase() === 'true'
const STRICT_SECRET_ENV_GUARD = String(process.env.STRICT_SECRET_ENV_GUARD || 'true').toLowerCase() !== 'false'
const SERVICE_ROLE_ROTATION_DAYS = Math.max(1, Number(process.env.SERVICE_ROLE_ROTATION_DAYS || 30))
const SUPABASE_SERVICE_ROLE_ROTATED_AT = String(process.env.SUPABASE_SERVICE_ROLE_ROTATED_AT || '').trim()
const DEFAULT_DEV_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174'
]
const AUTH_ALLOWED_EMAILS = parseEmailAllowlist(
  process.env.AUTH_ALLOWED_EMAILS
  || process.env.ALLOWED_LOGIN_EMAILS
  || process.env.LOGIN_EMAIL_ALLOWLIST
  || ''
)
const MAX_IMAGE_REFERENCES = Number(process.env.MAX_IMAGE_REFERENCES || 5)
const MAX_IMAGE_URL_LENGTH = Number(process.env.MAX_IMAGE_URL_LENGTH || 2048)
const MAX_IMAGE_DATA_URL_LENGTH = Number(process.env.MAX_IMAGE_DATA_URL_LENGTH || 1_500_000)
const ALLOW_SERVER_PROVIDER_KEY_FALLBACK = String(process.env.ALLOW_SERVER_PROVIDER_KEY_FALLBACK || 'true').toLowerCase() !== 'false'
const ENABLE_REAL_PROVIDER_CALLS = String(process.env.ENABLE_REAL_PROVIDER_CALLS || 'true').toLowerCase() !== 'false'
const ALLOW_MOCK_FALLBACK_ON_PROVIDER_ERROR = String(process.env.ALLOW_MOCK_FALLBACK_ON_PROVIDER_ERROR || 'false').toLowerCase() === 'true'
const ALLOW_TEXT_FALLBACK_ON_UNSUPPORTED_VISION_PROVIDER = String(process.env.ALLOW_TEXT_FALLBACK_ON_UNSUPPORTED_VISION_PROVIDER || 'true').toLowerCase() !== 'false'
const TMDB_AUTO_ENRICH_ENABLED = String(process.env.TMDB_AUTO_ENRICH_ENABLED || 'true').toLowerCase() !== 'false'
const TMDB_OVERVIEW_MAX_CHARS = Math.max(120, Number(process.env.TMDB_OVERVIEW_MAX_CHARS || 360))
const TMDB_TV_REFERENCE_SCOPES = ['series', 'season', 'episode']
const TMDB_SPOILER_LEVELS = ['no_spoiler', 'light', 'full']
const TMDB_FACT_LOCK_FIELDS = [
  'title',
  'tagline',
  'release_date',
  'runtime',
  'genres',
  'director',
  'cast_top',
  'overview',
  'keywords',
  'certification_id',
  'production_companies',
  'networks',
  'production_countries',
  'vote_average',
  'budget',
  'revenue',
  'status',
  'original_language',
  'watch_providers_id',
  'trailer'
]
const TMDB_CONTEXT_FACT_LOCK_MAP = {
  title: 'title',
  tagline: 'tagline',
  release_date: 'releaseDate',
  runtime: 'runtime',
  genres: 'genres',
  director: 'directorsOrCreators',
  cast_top: 'cast',
  overview: 'overview',
  keywords: 'keywords',
  certification_id: 'certificationId',
  production_companies: 'productionCompanies',
  networks: 'networks',
  production_countries: 'productionCountries',
  vote_average: 'rating',
  budget: 'budget',
  revenue: 'revenue',
  status: 'status',
  original_language: 'originalLanguage',
  watch_providers_id: 'watchProviders',
  trailer: 'trailer'
}
const TMDB_BROWSE_CATEGORY_MAP = {
  movie: {
    popular: 'popular',
    top_rated: 'top_rated',
    now_playing: 'now_playing',
    upcoming: 'upcoming'
  },
  tv: {
    popular: 'popular',
    top_rated: 'top_rated',
    airing_today: 'airing_today',
    on_tv: 'on_the_air',
    on_the_air: 'on_the_air'
  }
}
const TMDB_BROWSE_MAX_PAGE = Math.max(1, Number(process.env.TMDB_BROWSE_MAX_PAGE || 500))
const TMDB_MOVIE_GENRE_ID_MAP = {
  12: 'Adventure',
  14: 'Fantasy',
  16: 'Animation',
  18: 'Drama',
  27: 'Horror',
  28: 'Action',
  35: 'Comedy',
  36: 'History',
  37: 'Western',
  53: 'Thriller',
  80: 'Crime',
  99: 'Documentary',
  878: 'Science Fiction',
  9648: 'Mystery',
  10402: 'Music',
  10749: 'Romance',
  10751: 'Family',
  10752: 'War',
  10770: 'TV Movie'
}
const TMDB_TV_GENRE_ID_MAP = {
  16: 'Animation',
  18: 'Drama',
  35: 'Comedy',
  37: 'Western',
  80: 'Crime',
  99: 'Documentary',
  9648: 'Mystery',
  10751: 'Family',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics'
}
const ENABLE_SUPABASE_DUAL_WRITE = String(process.env.ENABLE_SUPABASE_DUAL_WRITE || 'true').toLowerCase() !== 'false'
const SUPPORTED_PROVIDERS = ['Gemini', 'OpenAI', 'OpenRouter', 'Groq', 'Cohere AI', 'DeepSeek', 'Hugging Face']
const PROVIDER_ENV_KEY_MAP = {
  Gemini: 'GEMINI_API_KEY',
  OpenAI: 'OPENAI_API_KEY',
  OpenRouter: 'OPENROUTER_API_KEY',
  Groq: 'GROQ_API_KEY',
  'Cohere AI': 'COHERE_API_KEY',
  DeepSeek: 'DEEPSEEK_API_KEY',
  'Hugging Face': 'HUGGINGFACE_API_KEY'
}
const TEAM_PRESET_TABLE = 'team_presets'
const TEAM_PRESET_VERSION_TABLE = 'team_preset_versions'
const TEAM_INTEGRATION_KEY_TABLE = 'team_integration_keys'
const TMDB_INTEGRATION_KEY_NAME = 'tmdb_api_key'
const TEAM_PRESET_VERSION_LIMIT = Math.max(5, Number(process.env.TEAM_PRESET_VERSION_LIMIT || 20))
const TEAM_PRESET_ALLOWED_ACTIONS = new Set(['create', 'edit', 'clone', 'import', 'rollback', 'seed'])
const DASHBOARD_ALERT_TABLE = 'dashboard_alerts'
const DASHBOARD_SNAPSHOT_TABLE = 'dashboard_snapshots'
const DASHBOARD_ALLOWED_ALERT_STATUS = new Set(['open', 'acknowledged', 'resolved'])
const DASHBOARD_ALERT_SEVERITY = new Set(['secondary', 'info', 'warning', 'danger', 'success'])
const CORS_ALLOWED_ORIGINS = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS || '')
const CORS_EFFECTIVE_ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS.size
  ? CORS_ALLOWED_ORIGINS
  : new Set(DEFAULT_DEV_CORS_ORIGINS.map((origin) => normalizeOrigin(origin)).filter(Boolean))

const LEAKED_SERVICE_ROLE_ENV_KEYS = detectLeakedServiceRoleEnvKeys()
if (LEAKED_SERVICE_ROLE_ENV_KEYS.length) {
  const message = `Detected forbidden service-role key env exposure via VITE_*: ${LEAKED_SERVICE_ROLE_ENV_KEYS.join(', ')}`
  if (STRICT_SECRET_ENV_GUARD) {
    throw new Error(message)
  }
  console.warn(`[security] ${message}`)
}

app.use(cors({
  origin(origin, callback) {
    if (CORS_ALLOW_ALL_ORIGINS) return callback(null, true)
    if (!origin) return callback(null, true)
    const normalized = normalizeOrigin(origin)
    if (normalized && CORS_EFFECTIVE_ALLOWED_ORIGINS.has(normalized)) {
      return callback(null, true)
    }
    return callback(null, false)
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token', 'x-internal-token'],
  optionsSuccessStatus: 204
}))
app.use(bodyParser.json({ limit: process.env.API_JSON_LIMIT || '8mb' }))

// Mount admin router (server-only endpoints). Protect these with ADMIN_INTERNAL_TOKEN env.
app.use('/admin', adminRouter)

app.get('/health', (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'api',
    time: new Date().toISOString()
  })
})

app.get('/api/health', (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'api',
    time: new Date().toISOString()
  })
})

function sendOk(res, data, status = 200) {
  return res.status(status).json({ ok: true, data })
}

function sendError(res, status, code, message, details = undefined) {
  const body = { ok: false, error: { code, message } }
  if (details !== undefined) body.error.details = details
  return res.status(status).json(body)
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pathExists(obj, dotPath) {
  if (!dotPath || !isPlainObject(obj)) return false
  const parts = String(dotPath).split('.')
  let cur = obj
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isIndex = /^\d+$/.test(part)
    if (isIndex) {
      const idx = Number(part)
      if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) return false
      cur = cur[idx]
      continue
    }
    if (cur == null || typeof cur !== 'object' || !(part in cur)) return false
    cur = cur[part]
  }
  return true
}

function validateOverridePaths(config, override) {
  if (!override) return []
  const invalid = []
  for (const key of Object.keys(override)) {
    if (!pathExists(config, key)) invalid.push(key)
  }
  return invalid
}

async function loadPresetById(id, userId = '') {
  const presetId = String(id || '').trim()
  if (!presetId) return null

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from(TEAM_PRESET_TABLE)
        .select('preset,preset_id')
        .eq('preset_id', presetId)
        .maybeSingle()

      if (!error && data?.preset) {
        return normalizePreset({ ...data.preset, id: data.preset_id || data?.preset?.id || presetId })
      }
    } catch (e) {}
  }

  try {
    const stored = readStoredPresets()
    if (Array.isArray(stored)) {
      const found = stored.find((x) => x.id === presetId)
      if (found) return found
    }
  } catch (e) {}
  return null
}

function validateManualConfig(config) {
  const errs = []
  if (!isPlainObject(config)) {
    return ['manualConfig must be an object']
  }
  if (!String(config.topic || '').trim()) errs.push('topic is required')
  if (!String(config.platform || '').trim()) errs.push('platform is required')
  if (!String(config.language || '').trim()) errs.push('language is required')
  const length = config?.contentStructure?.length
  if (length && !['short', 'medium', 'long'].includes(length)) {
    errs.push('contentStructure.length must be one of short|medium|long')
  }
  if (config.keywords && !Array.isArray(config.keywords)) errs.push('keywords must be an array')
  if (config.keywords && Array.isArray(config.keywords) && config.keywords.some((x) => typeof x !== 'string')) errs.push('keywords items must be strings')
  if (config.cta && !Array.isArray(config.cta)) errs.push('cta must be an array')
  if (config.cta && Array.isArray(config.cta)) {
    const badCta = config.cta.some((x) => !isPlainObject(x) || typeof x.text !== 'string')
    if (badCta) errs.push('cta items must be objects with string text')
  }
  if (config.constraints && !isPlainObject(config.constraints)) errs.push('constraints must be an object')
  if (config.meta && !isPlainObject(config.meta)) errs.push('meta must be an object')
  return errs
}

function isValidHttpUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch (e) {
    return false
  }
}

function sanitizeImageReferences(input) {
  if (input === undefined || input === null) return { data: [] }
  if (!Array.isArray(input)) {
    return { error: 'imageReferences must be an array' }
  }
  if (input.length > MAX_IMAGE_REFERENCES) {
    return { error: `imageReferences max is ${MAX_IMAGE_REFERENCES}` }
  }

  const out = []
  const errs = []
  input.forEach((item, idx) => {
    if (!isPlainObject(item)) {
      errs.push(`imageReferences.${idx} must be an object`)
      return
    }
    const type = String(item.type || '').toLowerCase()
    if (type === 'url') {
      const url = String(item.url || '').trim()
      if (!url) {
        errs.push(`imageReferences.${idx}.url is required`)
        return
      }
      if (url.length > MAX_IMAGE_URL_LENGTH) {
        errs.push(`imageReferences.${idx}.url is too long`)
        return
      }
      if (!isValidHttpUrl(url)) {
        errs.push(`imageReferences.${idx}.url must start with http:// or https://`)
        return
      }
      out.push({ type: 'url', url })
      return
    }

    if (type === 'data_url') {
      const dataUrl = String(item.dataUrl || '')
      if (!dataUrl) {
        errs.push(`imageReferences.${idx}.dataUrl is required`)
        return
      }
      if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl)) {
        errs.push(`imageReferences.${idx}.dataUrl must be a valid image data URL`)
        return
      }
      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        errs.push(`imageReferences.${idx}.dataUrl is too large`)
        return
      }
      const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)
      out.push({
        type: 'data_url',
        dataUrl,
        mimeType: mimeMatch?.[1] || null,
        name: item.name ? String(item.name).slice(0, 120) : null,
        sizeBytes: Number.isFinite(Number(item.sizeBytes)) ? Number(item.sizeBytes) : null
      })
      return
    }

    errs.push(`imageReferences.${idx}.type must be url or data_url`)
  })

  if (errs.length) return { error: 'imageReferences validation failed', details: errs }
  return { data: out }
}

function mergeUniqueImageReferences(baseRefs = [], incomingRefs = [], maxItems = MAX_IMAGE_REFERENCES) {
  const out = []
  const seen = new Set()
  const all = [...(Array.isArray(baseRefs) ? baseRefs : []), ...(Array.isArray(incomingRefs) ? incomingRefs : [])]
  for (const ref of all) { // eslint-disable-line no-restricted-syntax
    if (!isPlainObject(ref)) continue // eslint-disable-line no-continue
    const type = String(ref.type || '').toLowerCase()
    if (type === 'url') {
      const url = String(ref.url || '').trim()
      if (!url) continue // eslint-disable-line no-continue
      const key = `url:${url}`
      if (seen.has(key)) continue // eslint-disable-line no-continue
      seen.add(key)
      out.push({ type: 'url', url })
    } else if (type === 'data_url') {
      const dataUrl = String(ref.dataUrl || '').trim()
      if (!dataUrl) continue // eslint-disable-line no-continue
      const key = `data:${dataUrl}`
      if (seen.has(key)) continue // eslint-disable-line no-continue
      seen.add(key)
      out.push({
        type: 'data_url',
        dataUrl,
        name: ref.name ? String(ref.name).slice(0, 120) : null,
        sizeBytes: Number.isFinite(Number(ref.sizeBytes)) ? Number(ref.sizeBytes) : null
      })
    }
    if (out.length >= Math.max(1, Number(maxItems || MAX_IMAGE_REFERENCES))) break
  }
  return out
}

function summarizeImageReferences(imageReferences) {
  if (!Array.isArray(imageReferences) || !imageReferences.length) return []
  return imageReferences.map((ref, idx) => {
    if (ref.type === 'url') return { index: idx + 1, type: 'url', url: ref.url }
    return {
      index: idx + 1,
      type: 'upload',
      name: ref.name || `image-${idx + 1}`,
      mimeType: ref.mimeType || null,
      sizeBytes: ref.sizeBytes || null
    }
  })
}

function appendImageReferencesToPrompt(prompt, imageReferences) {
  if (!Array.isArray(imageReferences) || !imageReferences.length) return prompt || ''
  const lines = imageReferences.map((ref, idx) => {
    if (ref.type === 'url') return `${idx + 1}. URL: ${ref.url}`
    const sizeKb = ref.sizeBytes ? Math.max(1, Math.round(ref.sizeBytes / 1024)) : null
    const sizeLabel = sizeKb ? `${sizeKb}KB` : 'unknown size'
    return `${idx + 1}. Upload: ${ref.name || `image-${idx + 1}`} (${sizeLabel})`
  })
  const visualBlock =
    `\n\nReferensi visual:\n${lines.map((x) => `- ${x}`).join('\n')}\n` +
    'Gunakan referensi visual di atas sebagai konteks objek, style, dan angle konten.'
  return `${prompt || ''}${visualBlock}`
}

function appendExtraInstructionToPrompt(prompt, extraInstruction) {
  const text = String(extraInstruction || '').trim()
  if (!text) return prompt || ''
  const block = `\n\nInstruksi tambahan user:\n${text}`
  return `${prompt || ''}${block}`
}

function normalizeTmdbText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function clipTmdbText(value, maxLength = TMDB_OVERVIEW_MAX_CHARS) {
  const text = normalizeTmdbText(value)
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(1, maxLength - 3)).trim()}...`
}

function normalizeTmdbFactLocks(raw, mediaType = 'multi') {
  const input = isPlainObject(raw) ? raw : {}
  const safeMediaType = String(mediaType || '').trim().toLowerCase()
  const out = {}
  for (const key of TMDB_FACT_LOCK_FIELDS) { // eslint-disable-line no-restricted-syntax
    if (safeMediaType === 'movie' && key === 'networks') {
      out[key] = false
      continue // eslint-disable-line no-continue
    }
    if (safeMediaType === 'tv' && (key === 'budget' || key === 'revenue')) {
      out[key] = false
      continue // eslint-disable-line no-continue
    }
    if (key === 'director') {
      if (Object.prototype.hasOwnProperty.call(input, 'creator')) {
        out[key] = input.creator !== false
      } else {
        out[key] = input[key] !== false
      }
      continue // eslint-disable-line no-continue
    }
    out[key] = input[key] !== false
  }
  return out
}

function hasTmdbContextValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => normalizeTmdbText(item).length > 0)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0
  }
  return normalizeTmdbText(value).length > 0
}

function normalizeTmdbPreference(raw) {
  const input = isPlainObject(raw) ? raw : {}
  const enabledRaw = input.enabled
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : null
  const query = normalizeTmdbText(input.query || '')
  const mediaTypeRaw = String(input.mediaType || input.type || 'multi').trim().toLowerCase()
  const mediaType = ['movie', 'tv', 'multi'].includes(mediaTypeRaw) ? mediaTypeRaw : 'multi'
  const yearRaw = String(input.year || '').trim()
  const year = /^\d{4}$/.test(yearRaw) ? yearRaw : ''
  const tmdbIdNum = Number(input.tmdbId || input.id || input.tmdb_id || 0)
  const tmdbId = Number.isInteger(tmdbIdNum) && tmdbIdNum > 0 ? tmdbIdNum : null
  const language = normalizeTmdbText(input.language || input.languageCode || '')
  const region = normalizeTmdbText(input.region || input.regionCode || '')
  const ruleSource = isPlainObject(input.rules) ? input.rules : {}
  const spoilerLevelRaw = String(
    ruleSource.spoilerLevel
    || ruleSource.spoiler_level
    || input.spoilerLevel
    || input.spoiler_level
    || 'light'
  ).trim().toLowerCase()
  const spoilerLevel = TMDB_SPOILER_LEVELS.includes(spoilerLevelRaw) ? spoilerLevelRaw : 'light'
  const referenceScopeRaw = String(input.referenceScope || input.reference_scope || input.scope || '').trim().toLowerCase()
  const referenceScope = TMDB_TV_REFERENCE_SCOPES.includes(referenceScopeRaw) ? referenceScopeRaw : 'series'
  const seasonNumberRaw = Number(
    input.seasonNumber
    ?? input.season_number
    ?? input?.season?.number
    ?? input?.season?.season_number
    ?? 0
  )
  const seasonNumber = Number.isInteger(seasonNumberRaw) && seasonNumberRaw > 0 ? seasonNumberRaw : null
  const episodeNumberRaw = Number(
    input.episodeNumber
    ?? input.episode_number
    ?? input?.episode?.number
    ?? input?.episode?.episode_number
    ?? 0
  )
  const episodeNumber = Number.isInteger(episodeNumberRaw) && episodeNumberRaw > 0 ? episodeNumberRaw : null
  const seasonInput = isPlainObject(input.season) ? input.season : {}
  const episodeInput = isPlainObject(input.episode) ? input.episode : {}
  const season = seasonNumber
    ? {
      number: seasonNumber,
      name: normalizeTmdbText(seasonInput.name || ''),
      airDate: normalizeTmdbText(seasonInput.airDate || seasonInput.air_date || ''),
      overview: clipTmdbText(seasonInput.overview || '', TMDB_OVERVIEW_MAX_CHARS),
      episodeCount: Number.isFinite(Number(seasonInput.episodeCount || seasonInput.episode_count))
        ? Math.max(0, Math.floor(Number(seasonInput.episodeCount || seasonInput.episode_count)))
        : null
    }
    : null
  const episode = episodeNumber
    ? {
      number: episodeNumber,
      name: normalizeTmdbText(episodeInput.name || ''),
      airDate: normalizeTmdbText(episodeInput.airDate || episodeInput.air_date || ''),
      overview: clipTmdbText(episodeInput.overview || '', TMDB_OVERVIEW_MAX_CHARS),
      runtime: Number.isFinite(Number(episodeInput.runtime)) ? Math.max(0, Math.floor(Number(episodeInput.runtime))) : null,
      voteAverage: Number.isFinite(Number(episodeInput.voteAverage || episodeInput.vote_average))
        ? Number(Number(episodeInput.voteAverage || episodeInput.vote_average).toFixed(1))
        : null,
      episodeType: normalizeTmdbText(episodeInput.episodeType || episodeInput.episode_type || '').toLowerCase()
    }
    : null
  const factLocks = normalizeTmdbFactLocks(input.factLocks, mediaType)
  const factualOnly = ruleSource.factual_only_from_tmdb !== false
    && input.factual_only_from_tmdb !== false
  const noHallucination = ruleSource.no_hallucination !== false
    && input.no_hallucination !== false
  const rawSelectedImages = Array.isArray(input.selectedImages) ? input.selectedImages : []
  const selectedImages = rawSelectedImages
    .map((item) => {
      if (typeof item === 'string') {
        const url = String(item || '').trim()
        if (!url || !isValidHttpUrl(url)) return null
        return { type: 'url', url, source: 'tmdb' }
      }
      if (!isPlainObject(item)) return null
      const url = String(item.url || '').trim()
      if (!url || !isValidHttpUrl(url)) return null
      return {
        type: 'url',
        url,
        source: String(item.source || 'tmdb').trim() || 'tmdb'
      }
    })
    .filter(Boolean)
    .slice(0, 5)
  return {
    enabled,
    query,
    mediaType,
    year,
    tmdbId,
    language,
    region,
    rules: {
      factual_only_from_tmdb: !!factualOnly,
      no_hallucination: !!noHallucination,
      spoilerLevel
    },
    referenceScope,
    season,
    episode,
    factLocks,
    selectedImages
  }
}

function isLikelyMovieTvText(text) {
  const hay = normalizeTmdbText(text).toLowerCase()
  if (!hay) return false
  const patterns = [
    /\bmovie\b/,
    /\bfilm\b/,
    /\bserial\b/,
    /\bseries\b/,
    /\banime\b/,
    /\bdrama\b/,
    /\bsitcom\b/,
    /\bseason\b/,
    /\bepisode\b/,
    /\bcast\b/,
    /\bsinopsis\b/,
    /\bpemeran\b/,
    /\btrailer\b/,
    /\bbox office\b/,
    /\bmovie slide\b/
  ]
  return patterns.some((re) => re.test(hay))
}

function toTmdbLanguageCode(language) {
  const raw = String(language || '').trim().toLowerCase()
  if (!raw) return 'en-US'
  if (/^[a-z]{2}-[a-z]{2}$/i.test(raw)) {
    const [lang, region] = raw.split('-')
    return `${lang.toLowerCase()}-${region.toUpperCase()}`
  }
  if (/^[a-z]{2}$/i.test(raw)) {
    const code = raw.toLowerCase()
    if (code === 'id') return 'id-ID'
    if (code === 'en') return 'en-US'
    if (code === 'ja') return 'ja-JP'
    if (code === 'ko') return 'ko-KR'
    return `${code}-${code.toUpperCase()}`
  }
  if (raw.startsWith('indo') || raw === 'id' || raw.startsWith('bahasa')) return 'id-ID'
  if (raw.startsWith('en')) return 'en-US'
  return 'en-US'
}

function normalizeTmdbRegionCode(region) {
  const raw = String(region || '').trim().toUpperCase()
  if (!raw) return ''
  if (!/^[A-Z]{2}$/.test(raw)) return ''
  return raw
}

function normalizeTmdbSearchResult(item, mediaTypeHint = 'multi') {
  if (!isPlainObject(item)) return null
  const inferredType = mediaTypeHint === 'movie' || mediaTypeHint === 'tv'
    ? mediaTypeHint
    : String(item.media_type || '').toLowerCase()
  if (!['movie', 'tv'].includes(inferredType)) return null
  return { ...item, media_type: inferredType }
}

function getTmdbReleaseDate(item) {
  return normalizeTmdbText(item?.release_date || item?.first_air_date || '')
}

function getTmdbYear(item) {
  const date = getTmdbReleaseDate(item)
  if (/^\d{4}/.test(date)) return date.slice(0, 4)
  return ''
}

function resolveTmdbPrimaryGenreFromIds(item, mediaType = 'movie') {
  const ids = Array.isArray(item?.genre_ids) ? item.genre_ids : []
  if (!ids.length) return ''
  const map = String(mediaType || '').trim().toLowerCase() === 'tv'
    ? TMDB_TV_GENRE_ID_MAP
    : TMDB_MOVIE_GENRE_ID_MAP
  for (const rawId of ids) { // eslint-disable-line no-restricted-syntax
    const id = Number(rawId || 0)
    if (!Number.isInteger(id) || id <= 0) continue
    const label = normalizeTmdbText(map[id] || '')
    if (label) return label
  }
  return ''
}

function buildTmdbPosterUrl(posterPath, size = 'w185') {
  const path = String(posterPath || '').trim()
  if (!path) return null
  return `https://image.tmdb.org/t/p/${size}${path}`
}

function buildTmdbImageUrl(path, size = 'original') {
  const p = String(path || '').trim()
  if (!p) return null
  return `https://image.tmdb.org/t/p/${size}${p}`
}

function buildTmdbSearchPath(mediaType) {
  if (mediaType === 'movie') return '/search/movie'
  if (mediaType === 'tv') return '/search/tv'
  return '/search/multi'
}

function buildTmdbSearchUrl({ apiKey, query, mediaType = 'multi', languageCode = 'en-US', year = '', page = 1 }) {
  const path = buildTmdbSearchPath(mediaType)
  const pageRaw = Number(page || 1)
  const safePage = Math.max(1, Math.min(Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 1, TMDB_BROWSE_MAX_PAGE))
  let url =
    `https://api.themoviedb.org/3${path}` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(query)}` +
    `&language=${encodeURIComponent(languageCode)}` +
    `&include_adult=false&page=${encodeURIComponent(String(safePage))}`
  if (/^\d{4}$/.test(String(year || '').trim())) {
    if (mediaType === 'movie') {
      url += `&year=${encodeURIComponent(String(year).trim())}`
    } else if (mediaType === 'tv') {
      url += `&first_air_date_year=${encodeURIComponent(String(year).trim())}`
    }
  }
  return url
}

function normalizeTmdbBrowseMediaType(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'tv') return 'tv'
  return 'movie'
}

function normalizeTmdbBrowseCategory(mediaType, rawCategory) {
  const safeType = normalizeTmdbBrowseMediaType(mediaType)
  const raw = String(rawCategory || '').trim().toLowerCase()
  const alias = raw.replace(/-/g, '_').replace(/\s+/g, '_')
  const map = TMDB_BROWSE_CATEGORY_MAP[safeType] || {}
  if (alias && map[alias]) return alias
  if (safeType === 'movie') return 'popular'
  return 'popular'
}

function buildTmdbBrowseUrl({
  apiKey,
  mediaType = 'movie',
  category = 'popular',
  languageCode = 'en-US',
  region = '',
  page = 1
}) {
  const safeType = normalizeTmdbBrowseMediaType(mediaType)
  const safeCategory = normalizeTmdbBrowseCategory(safeType, category)
  const endpointCategory = TMDB_BROWSE_CATEGORY_MAP[safeType]?.[safeCategory] || 'popular'
  const safePage = Math.max(1, Math.min(Number(page || 1) || 1, TMDB_BROWSE_MAX_PAGE))
  const safeRegion = normalizeTmdbRegionCode(region)
  let url =
    `https://api.themoviedb.org/3/${safeType}/${endpointCategory}` +
    `?api_key=${encodeURIComponent(String(apiKey || '').trim())}` +
    `&language=${encodeURIComponent(languageCode)}` +
    `&page=${encodeURIComponent(String(safePage))}`
  if (safeRegion) url += `&region=${encodeURIComponent(safeRegion)}`
  return { url, mediaType: safeType, category: safeCategory, endpointCategory }
}

function extractTmdbCertification(detail, mediaType, regionCode = 'ID') {
  const region = normalizeTmdbRegionCode(regionCode) || 'ID'
  if (!isPlainObject(detail)) return ''
  if (mediaType === 'movie') {
    const groups = Array.isArray(detail?.release_dates?.results) ? detail.release_dates.results : []
    const prioritizedRegions = [region, 'US', 'ID']
    for (const r of prioritizedRegions) { // eslint-disable-line no-restricted-syntax
      const row = groups.find((x) => String(x?.iso_3166_1 || '').toUpperCase() === r)
      const releases = Array.isArray(row?.release_dates) ? row.release_dates : []
      const cert = releases.map((x) => String(x?.certification || '').trim()).find(Boolean)
      if (cert) return cert
    }
    return ''
  }
  const ratings = Array.isArray(detail?.content_ratings?.results) ? detail.content_ratings.results : []
  const prioritizedRegions = [region, 'US', 'ID']
  for (const r of prioritizedRegions) { // eslint-disable-line no-restricted-syntax
    const row = ratings.find((x) => String(x?.iso_3166_1 || '').toUpperCase() === r)
    const rating = String(row?.rating || '').trim()
    if (rating) return rating
  }
  return ''
}

function extractTmdbTrailerUrl(detail, preferredLanguageCode = 'en-US') {
  const lang = String(preferredLanguageCode || 'en-US').slice(0, 2).toLowerCase()
  const videos = Array.isArray(detail?.videos?.results) ? detail.videos.results : []
  const trailers = videos.filter((x) => {
    if (!isPlainObject(x)) return false
    if (String(x.site || '').toLowerCase() !== 'youtube') return false
    if (String(x.type || '').toLowerCase() !== 'trailer') return false
    if (!String(x.key || '').trim()) return false
    return true
  })
  if (!trailers.length) return ''
  const sorted = [...trailers].sort((a, b) => {
    const aOfficial = a.official === true ? 1 : 0
    const bOfficial = b.official === true ? 1 : 0
    if (aOfficial !== bOfficial) return bOfficial - aOfficial
    const aLang = String(a.iso_639_1 || '').toLowerCase() === lang ? 1 : 0
    const bLang = String(b.iso_639_1 || '').toLowerCase() === lang ? 1 : 0
    if (aLang !== bLang) return bLang - aLang
    return Number(b.size || 0) - Number(a.size || 0)
  })
  const top = sorted[0]
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(top.key || '').trim())}`
}

function extractTmdbKeywords(detail, mediaType) {
  if (!isPlainObject(detail)) return []
  if (mediaType === 'movie') {
    const rows = Array.isArray(detail?.keywords?.keywords) ? detail.keywords.keywords : []
    return rows
      .map((x) => normalizeTmdbText(x?.name || ''))
      .filter(Boolean)
      .slice(0, 12)
  }
  const rows = Array.isArray(detail?.keywords?.results) ? detail.keywords.results : []
  return rows
    .map((x) => normalizeTmdbText(x?.name || ''))
    .filter(Boolean)
    .slice(0, 12)
}

function extractTmdbWatchProviders(detail, regionCode = 'ID') {
  const region = normalizeTmdbRegionCode(regionCode) || 'ID'
  const block = detail?.['watch/providers']?.results?.[region]
  if (!isPlainObject(block)) return []
  const providers = [
    ...(Array.isArray(block.flatrate) ? block.flatrate : []),
    ...(Array.isArray(block.rent) ? block.rent : []),
    ...(Array.isArray(block.buy) ? block.buy : [])
  ]
  const names = providers
    .map((x) => normalizeTmdbText(x?.provider_name || ''))
    .filter(Boolean)
  return Array.from(new Set(names)).slice(0, 12)
}

function extractTmdbRuntime(detail, mediaType) {
  if (!isPlainObject(detail)) return null
  if (mediaType === 'movie') {
    const runtime = Number(detail.runtime || 0)
    return Number.isFinite(runtime) && runtime > 0 ? runtime : null
  }
  const episodeRun = Array.isArray(detail.episode_run_time) ? detail.episode_run_time : []
  const runtime = Number(episodeRun.find((x) => Number.isFinite(Number(x)) && Number(x) > 0) || 0)
  return Number.isFinite(runtime) && runtime > 0 ? runtime : null
}

function buildTmdbImageOptions(detail, limit = 0) {
  const posters = Array.isArray(detail?.images?.posters) ? detail.images.posters : []
  const backdrops = Array.isArray(detail?.images?.backdrops) ? detail.images.backdrops : []
  const posterRows = posters.map((x) => ({
    source: 'poster',
    path: String(x?.file_path || '').trim(),
    width: Number(x?.width || 0) || null,
    height: Number(x?.height || 0) || null
  }))
  const backdropRows = backdrops.map((x) => ({
    source: 'backdrop',
    path: String(x?.file_path || '').trim(),
    width: Number(x?.width || 0) || null,
    height: Number(x?.height || 0) || null
  }))
  const merged = [...posterRows, ...backdropRows]
    .filter((x) => x.path)
  const normalizedLimit = Number(limit || 0)
  const shouldLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0
  const rows = shouldLimit ? merged.slice(0, Math.floor(normalizedLimit)) : merged
  return rows
    .map((x) => {
      const originalUrl = buildTmdbImageUrl(x.path, 'original')
      return {
        source: x.source,
        width: x.width,
        height: x.height,
        url: originalUrl,
        previewUrl: buildTmdbImageUrl(x.path, 'w300'),
        downloadUrl: buildTmdbImageUrl(x.path, 'w1280'),
        downloadFallbackUrl: originalUrl
      }
    })
}

function buildTmdbImageOptionFromPath(path, source = 'poster', width = null, height = null) {
  const filePath = String(path || '').trim()
  if (!filePath) return null
  const originalUrl = buildTmdbImageUrl(filePath, 'original')
  if (!originalUrl) return null
  return {
    source: source === 'backdrop' ? 'backdrop' : 'poster',
    width: Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : null,
    height: Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : null,
    url: originalUrl,
    previewUrl: buildTmdbImageUrl(filePath, 'w300'),
    downloadUrl: buildTmdbImageUrl(filePath, 'w1280'),
    downloadFallbackUrl: originalUrl
  }
}

function appendUniqueTmdbImageOptions(baseRows = [], extraRows = []) {
  const out = []
  const seen = new Set()
  const append = (rows) => {
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const url = String(row?.url || '').trim()
      if (!url || seen.has(url)) return
      seen.add(url)
      out.push(row)
    })
  }
  append(baseRows)
  append(extraRows)
  return out
}

function buildTmdbTvExtraImageOptions(detail, tvContext) {
  const extras = []
  const seasons = Array.isArray(detail?.seasons) ? detail.seasons : []
  seasons.forEach((season) => {
    const row = buildTmdbImageOptionFromPath(
      season?.poster_path,
      'poster',
      Number(season?.poster_width || 0) || null,
      Number(season?.poster_height || 0) || null
    )
    if (row) extras.push(row)
  })

  const contextSeason = isPlainObject(tvContext?.season) ? tvContext.season : null
  if (contextSeason?.posterPath) {
    const row = buildTmdbImageOptionFromPath(contextSeason.posterPath, 'poster')
    if (row) extras.push(row)
  }

  const contextEpisode = isPlainObject(tvContext?.episode) ? tvContext.episode : null
  if (contextEpisode?.stillPath) {
    const row = buildTmdbImageOptionFromPath(contextEpisode.stillPath, 'backdrop')
    if (row) extras.push(row)
  }

  const episodeOptions = Array.isArray(tvContext?.episodeOptions) ? tvContext.episodeOptions : []
  episodeOptions.forEach((episode) => {
    const row = buildTmdbImageOptionFromPath(episode?.stillPath, 'backdrop')
    if (row) extras.push(row)
  })

  return appendUniqueTmdbImageOptions([], extras)
}

function buildTmdbIncludeImageLanguageParam(languageCode = 'en-US') {
  const shortLang = String(languageCode || '').trim().slice(0, 2).toLowerCase()
  const values = ['null', shortLang, 'en', 'id', 'ja', 'ko']
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(values)).join(',')
}

function mergeTmdbImageArray(baseRows, extraRows) {
  const map = new Map()
  const appendRows = (rows) => {
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const path = String(row?.file_path || '').trim()
      if (!path) return
      if (!map.has(path)) map.set(path, row)
    })
  }
  appendRows(baseRows)
  appendRows(extraRows)
  return Array.from(map.values())
}

function mergeTmdbImagesIntoDetail(detail, imagePayload) {
  if (!isPlainObject(detail)) return detail
  const detailImages = isPlainObject(detail.images) ? detail.images : {}
  const sourceImages = isPlainObject(imagePayload) ? imagePayload : {}
  return {
    ...detail,
    images: {
      ...detailImages,
      posters: mergeTmdbImageArray(detailImages.posters, sourceImages.posters),
      backdrops: mergeTmdbImageArray(detailImages.backdrops, sourceImages.backdrops),
      logos: mergeTmdbImageArray(detailImages.logos, sourceImages.logos)
    }
  }
}

async function searchTmdbCandidates({
  apiKey,
  query,
  mediaType = 'multi',
  languageCode = 'en-US',
  year = '',
  page = 1,
  limit = 5
} = {}) {
  const cleanQuery = normalizeTmdbText(query)
  const cleanMediaType = ['movie', 'tv', 'multi'].includes(String(mediaType || '').trim().toLowerCase())
    ? String(mediaType || '').trim().toLowerCase()
    : 'multi'
  const cleanYear = /^\d{4}$/.test(String(year || '').trim()) ? String(year || '').trim() : ''
  const maxLimit = Math.max(1, Math.min(Number(limit || 5), 20))
  const safePage = Math.max(1, Math.min(Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1, TMDB_BROWSE_MAX_PAGE))
  if (!cleanQuery) return { ok: false, reason: 'query_empty', candidates: [] }
  if (!String(apiKey || '').trim()) return { ok: false, reason: 'key_missing', candidates: [] }

  const searchUrl = buildTmdbSearchUrl({
    apiKey: String(apiKey || '').trim(),
    query: cleanQuery,
    mediaType: cleanMediaType,
    languageCode,
    year: cleanYear,
    page: safePage
  })
  let responseBundle
  try {
    responseBundle = await fetchJsonWithTimeout(searchUrl, { method: 'GET', headers: { Accept: 'application/json' } }, 6500)
  } catch (e) {
    return { ok: false, reason: 'lookup_failed', candidates: [] }
  }
  if (!responseBundle?.response?.ok) {
    return {
      ok: false,
      reason: 'lookup_failed',
      status: Number(responseBundle?.response?.status || 0) || null,
      candidates: []
    }
  }

  const json = isPlainObject(responseBundle.json) ? responseBundle.json : {}
  const currentPageRaw = Number(json.page || safePage || 1)
  const currentPage = Math.max(1, Math.min(Number.isFinite(currentPageRaw) ? Math.floor(currentPageRaw) : 1, TMDB_BROWSE_MAX_PAGE))
  const totalPagesRaw = Number(json.total_pages || 1)
  const totalPages = Math.max(1, Math.min(Number.isFinite(totalPagesRaw) ? Math.floor(totalPagesRaw) : 1, TMDB_BROWSE_MAX_PAGE))
  const totalResultsRaw = Number(json.total_results || 0)
  const totalResults = Number.isFinite(totalResultsRaw) && totalResultsRaw > 0
    ? Math.floor(totalResultsRaw)
    : 0
  const rawResults = Array.isArray(json.results) ? json.results : []
  let normalized = rawResults
    .map((item) => normalizeTmdbSearchResult(item, cleanMediaType))
    .filter(Boolean)

  if (cleanYear && cleanMediaType === 'multi') {
    normalized = normalized.filter((item) => getTmdbYear(item) === cleanYear)
  }

  const candidates = normalized
    .slice(0, maxLimit)
    .map((item) => {
      const mediaTypeValue = String(item.media_type || '').toLowerCase()
      const title = normalizeTmdbText(item.title || item.name || '')
      const originalTitle = normalizeTmdbText(item.original_title || item.original_name || '')
      const releaseDate = getTmdbReleaseDate(item)
      const itemYear = getTmdbYear(item)
      const voteAverage = Number(item.vote_average || 0)
      const primaryGenre = resolveTmdbPrimaryGenreFromIds(item, mediaTypeValue)
      return {
        tmdbId: Number(item.id),
        mediaType: mediaTypeValue,
        title: title || cleanQuery,
        originalTitle: originalTitle || '',
        year: itemYear,
        releaseDate: releaseDate || '',
        rating: Number.isFinite(voteAverage) ? Number(voteAverage.toFixed(1)) : null,
        posterPath: String(item.poster_path || '').trim() || null,
        posterUrl: buildTmdbPosterUrl(item.poster_path, 'w185'),
        primaryGenre: primaryGenre || '',
        overview: clipTmdbText(item.overview || '', 220)
      }
    })
    .filter((item) => Number.isFinite(item.tmdbId) && item.tmdbId > 0)

  return {
    ok: true,
    reason: candidates.length ? 'ok' : 'not_found',
    page: currentPage,
    totalPages,
    totalResults,
    maxPage: TMDB_BROWSE_MAX_PAGE,
    candidates
  }
}

async function browseTmdbByCategory({
  apiKey,
  mediaType = 'movie',
  category = 'popular',
  languageCode = 'en-US',
  region = '',
  page = 1,
  limit = 10
} = {}) {
  const key = String(apiKey || '').trim()
  if (!key) return { ok: false, reason: 'key_missing', candidates: [] }
  const maxLimit = Math.max(1, Math.min(Number(limit || 10), 20))
  const browse = buildTmdbBrowseUrl({
    apiKey: key,
    mediaType,
    category,
    languageCode,
    region,
    page
  })

  let responseBundle
  try {
    responseBundle = await fetchJsonWithTimeout(
      browse.url,
      { method: 'GET', headers: { Accept: 'application/json' } },
      6500
    )
  } catch (e) {
    return { ok: false, reason: 'lookup_failed', candidates: [], mediaType: browse.mediaType, category: browse.category }
  }
  if (!responseBundle?.response?.ok) {
    return {
      ok: false,
      reason: 'lookup_failed',
      status: Number(responseBundle?.response?.status || 0) || null,
      candidates: [],
      mediaType: browse.mediaType,
      category: browse.category
    }
  }

  const json = isPlainObject(responseBundle.json) ? responseBundle.json : {}
  const currentPageRaw = Number(json.page || browse.page || 1)
  const currentPage = Math.max(1, Math.min(Number.isFinite(currentPageRaw) ? Math.floor(currentPageRaw) : 1, TMDB_BROWSE_MAX_PAGE))
  const totalPagesRaw = Number(json.total_pages || 1)
  const totalPages = Math.max(1, Math.min(Number.isFinite(totalPagesRaw) ? Math.floor(totalPagesRaw) : 1, TMDB_BROWSE_MAX_PAGE))
  const totalResultsRaw = Number(json.total_results || 0)
  const totalResults = Number.isFinite(totalResultsRaw) && totalResultsRaw > 0
    ? Math.floor(totalResultsRaw)
    : 0
  const rawResults = Array.isArray(json.results) ? json.results : []
  const candidates = rawResults
    .map((item) => normalizeTmdbSearchResult(item, browse.mediaType))
    .filter(Boolean)
    .slice(0, maxLimit)
    .map((item) => {
      const mediaTypeValue = String(item.media_type || browse.mediaType || '').toLowerCase()
      const title = normalizeTmdbText(item.title || item.name || '')
      const originalTitle = normalizeTmdbText(item.original_title || item.original_name || '')
      const releaseDate = getTmdbReleaseDate(item)
      const itemYear = getTmdbYear(item)
      const voteAverage = Number(item.vote_average || 0)
      const primaryGenre = resolveTmdbPrimaryGenreFromIds(item, mediaTypeValue || browse.mediaType)
      return {
        tmdbId: Number(item.id),
        mediaType: mediaTypeValue || browse.mediaType,
        title: title || '-',
        originalTitle: originalTitle || '',
        year: itemYear,
        releaseDate: releaseDate || '',
        rating: Number.isFinite(voteAverage) ? Number(voteAverage.toFixed(1)) : null,
        posterPath: String(item.poster_path || '').trim() || null,
        posterUrl: buildTmdbPosterUrl(item.poster_path, 'w185'),
        primaryGenre: primaryGenre || '',
        overview: clipTmdbText(item.overview || '', 220)
      }
    })
    .filter((item) => Number.isFinite(item.tmdbId) && item.tmdbId > 0)

  return {
    ok: true,
    reason: candidates.length ? 'ok' : 'not_found',
    mediaType: browse.mediaType,
    category: browse.category,
    endpointCategory: browse.endpointCategory,
    page: currentPage,
    totalPages,
    totalResults,
    maxPage: TMDB_BROWSE_MAX_PAGE,
    candidates
  }
}

async function fetchTmdbDetailById({ apiKey, tmdbId, mediaType = 'multi', languageCode = 'en-US' } = {}) {
  const id = Number(tmdbId || 0)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'invalid_id', mediaType: null, detail: null }
  const types = mediaType === 'movie' || mediaType === 'tv' ? [mediaType] : ['movie', 'tv']
  const includeImageLanguage = buildTmdbIncludeImageLanguageParam(languageCode)

  for (const type of types) { // eslint-disable-line no-restricted-syntax
    const appendToResponse = type === 'tv'
      ? 'aggregate_credits,credits,images,videos,keywords,watch/providers,content_ratings'
      : 'credits,images,videos,keywords,watch/providers,release_dates'
    const detailsUrl =
      `https://api.themoviedb.org/3/${type}/${encodeURIComponent(String(id))}` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&language=${encodeURIComponent(languageCode)}` +
      `&append_to_response=${encodeURIComponent(appendToResponse)}` +
      `&include_image_language=${encodeURIComponent(includeImageLanguage)}`
    const imagesUrl =
      `https://api.themoviedb.org/3/${type}/${encodeURIComponent(String(id))}/images` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&include_image_language=${encodeURIComponent(includeImageLanguage)}`
    try {
      const detailResponse = await fetchJsonWithTimeout(detailsUrl, { method: 'GET', headers: { Accept: 'application/json' } }, 6500) // eslint-disable-line no-await-in-loop
      if (detailResponse?.response?.ok && isPlainObject(detailResponse.json)) {
        let mergedDetail = detailResponse.json
        try {
          const imagesResponse = await fetchJsonWithTimeout(imagesUrl, { method: 'GET', headers: { Accept: 'application/json' } }, 6500) // eslint-disable-line no-await-in-loop
          if (imagesResponse?.response?.ok && isPlainObject(imagesResponse.json)) {
            mergedDetail = mergeTmdbImagesIntoDetail(mergedDetail, imagesResponse.json)
          }
        } catch (e) {}
        return { ok: true, reason: 'ok', mediaType: type, detail: mergedDetail }
      }
      const status = Number(detailResponse?.response?.status || 0)
      if (status === 404) continue // eslint-disable-line no-continue
    } catch (e) {}
  }
  return { ok: false, reason: 'not_found', mediaType: null, detail: null }
}

function inferTmdbEpisodeType({ episodeNumber = null, episodeCount = null } = {}) {
  const ep = Number(episodeNumber || 0)
  const total = Number(episodeCount || 0)
  if (!Number.isInteger(ep) || ep <= 0) return ''
  if (!Number.isInteger(total) || total <= 0) return ep === 1 ? 'premiere' : 'regular'
  if (ep === 1) return 'premiere'
  if (ep === total) return 'finale'
  if (total >= 6 && ep === Math.ceil(total / 2)) return 'midseason'
  return 'regular'
}

function buildTmdbTvSeasonOptions(detail) {
  const seasons = Array.isArray(detail?.seasons) ? detail.seasons : []
  return seasons
    .map((row) => {
      const number = Number(row?.season_number || 0)
      if (!Number.isInteger(number) || number < 0) return null
      return {
        number,
        name: normalizeTmdbText(row?.name || ''),
        airDate: normalizeTmdbText(row?.air_date || ''),
        overview: clipTmdbText(row?.overview || '', TMDB_OVERVIEW_MAX_CHARS),
        posterPath: String(row?.poster_path || '').trim() || '',
        episodeCount: Number.isFinite(Number(row?.episode_count))
          ? Math.max(0, Math.floor(Number(row.episode_count)))
          : 0
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number)
}

function buildTmdbTvEpisodeOptions(seasonDetail) {
  const episodes = Array.isArray(seasonDetail?.episodes) ? seasonDetail.episodes : []
  const episodeCount = episodes.length
  return episodes
    .map((row) => {
      const number = Number(row?.episode_number || 0)
      if (!Number.isInteger(number) || number <= 0) return null
      const runtimeValue = Number(row?.runtime || 0)
      const voteAverageValue = Number(row?.vote_average || 0)
      return {
        number,
        name: normalizeTmdbText(row?.name || ''),
        airDate: normalizeTmdbText(row?.air_date || ''),
        overview: clipTmdbText(row?.overview || '', TMDB_OVERVIEW_MAX_CHARS),
        stillPath: String(row?.still_path || '').trim() || '',
        runtime: Number.isFinite(runtimeValue) && runtimeValue > 0 ? Math.round(runtimeValue) : null,
        voteAverage: Number.isFinite(voteAverageValue) && voteAverageValue > 0
          ? Number(voteAverageValue.toFixed(1))
          : null,
        episodeType: inferTmdbEpisodeType({ episodeNumber: number, episodeCount })
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number)
}

async function fetchTmdbTvSeasonDetail({
  apiKey,
  tmdbId,
  seasonNumber,
  languageCode = 'en-US'
} = {}) {
  const id = Number(tmdbId || 0)
  const season = Number(seasonNumber || 0)
  if (!Number.isInteger(id) || id <= 0) return null
  if (!Number.isInteger(season) || season < 0) return null
  const url =
    `https://api.themoviedb.org/3/tv/${encodeURIComponent(String(id))}/season/${encodeURIComponent(String(season))}` +
    `?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(languageCode)}`
  try {
    const response = await fetchJsonWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json' } }, 6500)
    if (response?.response?.ok && isPlainObject(response?.json)) return response.json
  } catch (e) {}
  return null
}

async function fetchTmdbTvEpisodeDetail({
  apiKey,
  tmdbId,
  seasonNumber,
  episodeNumber,
  languageCode = 'en-US'
} = {}) {
  const id = Number(tmdbId || 0)
  const season = Number(seasonNumber || 0)
  const episode = Number(episodeNumber || 0)
  if (!Number.isInteger(id) || id <= 0) return null
  if (!Number.isInteger(season) || season < 0) return null
  if (!Number.isInteger(episode) || episode <= 0) return null
  const url =
    `https://api.themoviedb.org/3/tv/${encodeURIComponent(String(id))}/season/${encodeURIComponent(String(season))}` +
    `/episode/${encodeURIComponent(String(episode))}` +
    `?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(languageCode)}`
  try {
    const response = await fetchJsonWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json' } }, 6500)
    if (response?.response?.ok && isPlainObject(response?.json)) return response.json
  } catch (e) {}
  return null
}

async function resolveTmdbTvScopeContext({
  apiKey,
  tmdbId,
  detail,
  languageCode = 'en-US',
  preference = {}
} = {}) {
  const id = Number(tmdbId || detail?.id || 0)
  if (!Number.isInteger(id) || id <= 0) return null
  const pref = isPlainObject(preference) ? preference : {}
  const normalizedPref = normalizeTmdbPreference(pref)
  const requestedScope = TMDB_TV_REFERENCE_SCOPES.includes(String(normalizedPref.referenceScope || '').toLowerCase())
    ? String(normalizedPref.referenceScope || '').toLowerCase()
    : 'series'
  const spoilerLevel = TMDB_SPOILER_LEVELS.includes(String(normalizedPref?.rules?.spoilerLevel || '').toLowerCase())
    ? String(normalizedPref.rules.spoilerLevel).toLowerCase()
    : 'light'
  const seasonOptions = buildTmdbTvSeasonOptions(detail)
  const seriesSeasonCountRaw = Number(detail?.number_of_seasons || seasonOptions.length || 0)
  const seasonCount = Number.isFinite(seriesSeasonCountRaw) && seriesSeasonCountRaw > 0
    ? Math.floor(seriesSeasonCountRaw)
    : seasonOptions.length

  let resolvedScope = requestedScope
  let seasonNumber = Number(normalizedPref?.season?.number || 0)
  if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) seasonNumber = null
  if ((resolvedScope === 'season' || resolvedScope === 'episode') && !seasonNumber) {
    seasonNumber = seasonOptions.find((x) => x.number > 0)?.number || null
  }

  let seasonDetail = null
  let episodeOptions = []
  if (seasonNumber !== null) {
    seasonDetail = await fetchTmdbTvSeasonDetail({
      apiKey,
      tmdbId: id,
      seasonNumber,
      languageCode
    })
    if (seasonDetail) {
      episodeOptions = buildTmdbTvEpisodeOptions(seasonDetail)
    }
  }

  if ((resolvedScope === 'season' || resolvedScope === 'episode') && !seasonDetail) {
    resolvedScope = 'series'
    seasonNumber = null
  }

  let episodeNumber = Number(normalizedPref?.episode?.number || 0)
  if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) episodeNumber = null
  if (resolvedScope === 'episode' && !episodeNumber) {
    episodeNumber = episodeOptions[0]?.number || null
  }
  if (resolvedScope === 'episode' && !episodeNumber) {
    resolvedScope = 'season'
  }

  let episodeDetail = null
  if (resolvedScope === 'episode' && seasonNumber !== null && episodeNumber !== null) {
    episodeDetail = await fetchTmdbTvEpisodeDetail({
      apiKey,
      tmdbId: id,
      seasonNumber,
      episodeNumber,
      languageCode
    })
    if (!episodeDetail) {
      episodeDetail = (Array.isArray(seasonDetail?.episodes) ? seasonDetail.episodes : [])
        .find((row) => Number(row?.episode_number || 0) === episodeNumber) || null
    }
    if (!episodeDetail) {
      resolvedScope = 'season'
      episodeNumber = null
    }
  }

  const seasonFromOptions = seasonOptions.find((row) => row.number === seasonNumber) || null
  const seasonEpisodeCountRaw = Number(
    seasonDetail?.episode_count
    || seasonFromOptions?.episodeCount
    || episodeOptions.length
    || 0
  )
  const seasonEpisodeCount = Number.isFinite(seasonEpisodeCountRaw) && seasonEpisodeCountRaw > 0
    ? Math.floor(seasonEpisodeCountRaw)
    : (episodeOptions.length || null)

  const season = seasonNumber !== null
    ? {
      number: seasonNumber,
      name: normalizeTmdbText(seasonDetail?.name || seasonFromOptions?.name || ''),
      airDate: normalizeTmdbText(seasonDetail?.air_date || seasonFromOptions?.airDate || ''),
      overview: clipTmdbText(seasonDetail?.overview || seasonFromOptions?.overview || '', TMDB_OVERVIEW_MAX_CHARS),
      posterPath: String(seasonDetail?.poster_path || seasonFromOptions?.posterPath || '').trim() || '',
      episodeCount: seasonEpisodeCount
    }
    : null

  const episode = (resolvedScope === 'episode' && episodeNumber !== null && episodeDetail)
    ? {
      number: episodeNumber,
      name: normalizeTmdbText(episodeDetail?.name || ''),
      airDate: normalizeTmdbText(episodeDetail?.air_date || ''),
      overview: clipTmdbText(episodeDetail?.overview || '', TMDB_OVERVIEW_MAX_CHARS),
      stillPath: String(episodeDetail?.still_path || '').trim() || '',
      runtime: Number.isFinite(Number(episodeDetail?.runtime || 0)) && Number(episodeDetail?.runtime || 0) > 0
        ? Math.round(Number(episodeDetail.runtime))
        : null,
      voteAverage: Number.isFinite(Number(episodeDetail?.vote_average || 0)) && Number(episodeDetail?.vote_average || 0) > 0
        ? Number(Number(episodeDetail.vote_average).toFixed(1))
        : null
    }
    : null

  const episodeCount = seasonEpisodeCount
  const episodeType = (episode && episode.number)
    ? inferTmdbEpisodeType({ episodeNumber: episode.number, episodeCount })
    : ''

  return {
    referenceScope: resolvedScope,
    spoilerLevel,
    seasonCount,
    episodeCount: Number.isFinite(Number(episodeCount)) ? Number(episodeCount) : null,
    episodeType: normalizeTmdbText(episodeType).toLowerCase() || null,
    season,
    episode: episode ? { ...episode, episodeType: normalizeTmdbText(episodeType).toLowerCase() || null } : null,
    seasonOptions,
    episodeOptions
  }
}

function buildTmdbDetailPayload(detail, mediaType, { region = 'ID', languageCode = 'en-US' } = {}) {
  const safeType = mediaType === 'tv' ? 'tv' : 'movie'
  const title = normalizeTmdbText(detail?.title || detail?.name || '')
  const tagline = normalizeTmdbText(detail?.tagline || '')
  const releaseDate = normalizeTmdbText(detail?.release_date || detail?.first_air_date || '')
  const genres = (
    Array.isArray(detail?.genres)
      ? detail.genres.map((x) => normalizeTmdbText(x?.name || ''))
      : []
  ).filter(Boolean).slice(0, 8)
  const productionCompanies = (
    Array.isArray(detail?.production_companies)
      ? detail.production_companies.map((x) => normalizeTmdbText(x?.name || ''))
      : []
  ).filter(Boolean).slice(0, 12)
  const networks = (
    Array.isArray(detail?.networks)
      ? detail.networks.map((x) => normalizeTmdbText(x?.name || ''))
      : []
  ).filter(Boolean).slice(0, 12)
  const productionCountriesFromNames = (
    Array.isArray(detail?.production_countries)
      ? detail.production_countries.map((x) => normalizeTmdbText(x?.name || x?.iso_3166_1 || ''))
      : []
  ).filter(Boolean)
  const productionCountriesFromOrigin = (
    Array.isArray(detail?.origin_country)
      ? detail.origin_country.map((x) => normalizeTmdbText(x || ''))
      : []
  ).filter(Boolean)
  const productionCountries = Array.from(new Set([
    ...productionCountriesFromNames,
    ...productionCountriesFromOrigin
  ])).slice(0, 12)
  const castTop = pickTmdbTopCast(detail).slice(0, 6)
  const directorsOrCreators = pickTmdbDirectorsOrCreators(detail, safeType)
  const keywords = extractTmdbKeywords(detail, safeType)
  const certification = extractTmdbCertification(detail, safeType, region)
  const trailer = extractTmdbTrailerUrl(detail, languageCode)
  const watchProviders = extractTmdbWatchProviders(detail, region)
  const runtime = extractTmdbRuntime(detail, safeType)
  const ratingValue = Number(detail?.vote_average || 0)
  const rating = Number.isFinite(ratingValue) ? Number(ratingValue.toFixed(1)) : null
  const budgetValue = Number(detail?.budget || 0)
  const revenueValue = Number(detail?.revenue || 0)
  const budget = Number.isFinite(budgetValue) && budgetValue > 0 ? Math.round(budgetValue) : null
  const revenue = Number.isFinite(revenueValue) && revenueValue > 0 ? Math.round(revenueValue) : null
  const status = normalizeTmdbText(detail?.status || '')
  const originalLanguage = normalizeTmdbText(detail?.original_language || '')
  const tmdbId = Number(detail?.id || 0)
  const seasonCountRaw = Number(detail?.number_of_seasons || 0)
  const seasonCount = Number.isFinite(seasonCountRaw) && seasonCountRaw > 0 ? Math.floor(seasonCountRaw) : null
  const primaryMaker = directorsOrCreators[0] || ''
  const makerFields = safeType === 'tv'
    ? {
        creator: primaryMaker,
        creator_list: directorsOrCreators
      }
    : {
        director: primaryMaker,
        director_list: directorsOrCreators
      }
  const entity = {
    tmdb_id: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
    title: title || '-',
    tagline: tagline || '',
    release_date: releaseDate || '',
    runtime,
    genres,
    ...makerFields,
    cast_top: castTop,
    overview: clipTmdbText(detail?.overview || '', 600),
    keywords,
    certification_id: certification || '',
    production_companies: productionCompanies,
    networks,
    production_countries: productionCountries,
    vote_average: rating,
    budget,
    revenue,
    status: status || '',
    original_language: originalLanguage || '',
    trailer: trailer || '',
    watch_providers_id: watchProviders,
    season_count: seasonCount
  }
  return {
    entityType: safeType,
    movieOrTv: entity,
    imageOptions: buildTmdbImageOptions(detail),
    rules: {
      factual_only_from_tmdb: true,
      no_hallucination: true
    }
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch (e) {}
    return { response, json, text }
  } finally {
    clearTimeout(timeout)
  }
}

function pickTmdbBestResult(results, preferredMediaType = 'multi') {
  if (!Array.isArray(results) || !results.length) return null
  const candidates = results
    .filter((item) => isPlainObject(item))
    .filter((item) => ['movie', 'tv'].includes(String(item.media_type || preferredMediaType || '').toLowerCase()))
  if (!candidates.length) return null
  const scored = candidates.map((item) => {
    const type = String(item.media_type || preferredMediaType || '').toLowerCase()
    const popularity = Number(item.popularity || 0)
    const votes = Number(item.vote_count || 0)
    const score =
      popularity
      + Math.log10(Math.max(1, votes))
      + (preferredMediaType !== 'multi' && type === preferredMediaType ? 3 : 0)
    return { item, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.item || null
}

function pickTmdbDirectorsOrCreators(detail, mediaType) {
  if (!isPlainObject(detail)) return []
  const out = []
  if (mediaType === 'movie') {
    const crews = Array.isArray(detail?.credits?.crew) ? detail.credits.crew : []
    crews.forEach((person) => {
      if (!isPlainObject(person)) return
      const job = String(person.job || '').toLowerCase()
      const name = normalizeTmdbText(person.name || '')
      if (job === 'director' && name) out.push(name)
    })
  } else {
    const creators = Array.isArray(detail?.created_by) ? detail.created_by : []
    creators.forEach((person) => {
      const name = normalizeTmdbText(person?.name || '')
      if (name) out.push(name)
    })
    const crews = Array.isArray(detail?.credits?.crew) ? detail.credits.crew : []
    crews.forEach((person) => {
      if (!isPlainObject(person)) return
      const job = String(person.job || '').toLowerCase()
      const name = normalizeTmdbText(person.name || '')
      if ((job === 'creator' || job === 'director') && name) out.push(name)
    })
  }
  return Array.from(new Set(out)).slice(0, 4)
}

function pickTmdbTopCast(detail) {
  if (!isPlainObject(detail)) return []
  const castFromCredits = Array.isArray(detail?.credits?.cast) ? detail.credits.cast : []
  const castFromAggregate = Array.isArray(detail?.aggregate_credits?.cast) ? detail.aggregate_credits.cast : []
  const base = castFromCredits.length ? castFromCredits : castFromAggregate
  const names = base
    .map((person) => normalizeTmdbText(person?.name || person?.original_name || ''))
    .filter(Boolean)
  return Array.from(new Set(names)).slice(0, 6)
}

function buildTmdbPromptBlock(tmdbContext) {
  if (!tmdbContext?.used) return ''
  const lines = []
  lines.push(`- Type: ${tmdbContext.mediaType || '-'}`)
  lines.push(`- Judul resmi: ${tmdbContext.title || '-'}`)
  if (tmdbContext.originalTitle && tmdbContext.originalTitle !== tmdbContext.title) {
    lines.push(`- Judul asli: ${tmdbContext.originalTitle}`)
  }
  lines.push(`- Tahun rilis: ${tmdbContext.year || '-'}`)
  if (tmdbContext.releaseDate) {
    lines.push(`- Tanggal rilis: ${tmdbContext.releaseDate}`)
  }
  if (Number.isFinite(Number(tmdbContext.runtime)) && Number(tmdbContext.runtime) > 0) {
    lines.push(`- Runtime: ${Math.round(Number(tmdbContext.runtime))} menit`)
  }
  lines.push(`- Genre: ${Array.isArray(tmdbContext.genres) && tmdbContext.genres.length ? tmdbContext.genres.join(', ') : '-'}`)
  lines.push(`- Rating TMDB: ${Number.isFinite(Number(tmdbContext.rating)) ? Number(tmdbContext.rating).toFixed(1) : '-'} / 10`)
  if (Array.isArray(tmdbContext.cast) && tmdbContext.cast.length) {
    lines.push(`- Cast utama: ${tmdbContext.cast.join(', ')}`)
  }
  if (Array.isArray(tmdbContext.directorsOrCreators) && tmdbContext.directorsOrCreators.length) {
    const makerLabel = tmdbContext.mediaType === 'tv' ? 'Creator' : 'Sutradara'
    lines.push(`- ${makerLabel}: ${tmdbContext.directorsOrCreators.join(', ')}`)
  }
  if (tmdbContext.overview) {
    lines.push(`- Ringkasan: ${tmdbContext.overview}`)
  }
  if (tmdbContext.tagline) {
    lines.push(`- Tagline: ${tmdbContext.tagline}`)
  }
  if (Array.isArray(tmdbContext.keywords) && tmdbContext.keywords.length) {
    lines.push(`- Keywords: ${tmdbContext.keywords.join(', ')}`)
  }
  if (tmdbContext.certificationId) {
    lines.push(`- Certification: ${tmdbContext.certificationId}`)
  }
  if (Array.isArray(tmdbContext.productionCompanies) && tmdbContext.productionCompanies.length) {
    lines.push(`- Production Companies: ${tmdbContext.productionCompanies.join(', ')}`)
  }
  if (tmdbContext.mediaType === 'tv' && Array.isArray(tmdbContext.networks) && tmdbContext.networks.length) {
    lines.push(`- Networks: ${tmdbContext.networks.join(', ')}`)
  }
  if (Array.isArray(tmdbContext.productionCountries) && tmdbContext.productionCountries.length) {
    lines.push(`- Production Countries: ${tmdbContext.productionCountries.join(', ')}`)
  }
  if (tmdbContext.mediaType !== 'tv' && Number.isFinite(Number(tmdbContext.budget)) && Number(tmdbContext.budget) > 0) {
    lines.push(`- Budget (USD): ${Math.round(Number(tmdbContext.budget))}`)
  }
  if (tmdbContext.mediaType !== 'tv' && Number.isFinite(Number(tmdbContext.revenue)) && Number(tmdbContext.revenue) > 0) {
    lines.push(`- Revenue (USD): ${Math.round(Number(tmdbContext.revenue))}`)
  }
  if (tmdbContext.status) {
    lines.push(`- Status: ${tmdbContext.status}`)
  }
  if (tmdbContext.originalLanguage) {
    lines.push(`- Original Language: ${tmdbContext.originalLanguage}`)
  }
  if (Array.isArray(tmdbContext.watchProviders) && tmdbContext.watchProviders.length) {
    lines.push(`- Watch Providers: ${tmdbContext.watchProviders.join(', ')}`)
  }
  if (tmdbContext.trailer) {
    lines.push(`- Trailer: ${tmdbContext.trailer}`)
  }
  if (tmdbContext.mediaType === 'tv') {
    lines.push(`- Reference Scope TV: ${tmdbContext.referenceScope || 'series'}`)
    if (Number.isFinite(Number(tmdbContext.seasonCount)) && Number(tmdbContext.seasonCount) > 0) {
      lines.push(`- Total Season: ${Math.floor(Number(tmdbContext.seasonCount))}`)
    }
    if (tmdbContext.season && Number.isFinite(Number(tmdbContext.season.number))) {
      lines.push(`- Season: S${Math.floor(Number(tmdbContext.season.number))} ${tmdbContext.season.name ? `(${tmdbContext.season.name})` : ''}`.trim())
      if (tmdbContext.season.airDate) lines.push(`- Season Air Date: ${tmdbContext.season.airDate}`)
      if (tmdbContext.season.overview) lines.push(`- Season Overview: ${tmdbContext.season.overview}`)
      if (Number.isFinite(Number(tmdbContext.season.episodeCount)) && Number(tmdbContext.season.episodeCount) > 0) {
        lines.push(`- Episode Count (Season): ${Math.floor(Number(tmdbContext.season.episodeCount))}`)
      }
    }
    if (tmdbContext.episode && Number.isFinite(Number(tmdbContext.episode.number))) {
      lines.push(`- Episode: E${Math.floor(Number(tmdbContext.episode.number))} ${tmdbContext.episode.name ? `(${tmdbContext.episode.name})` : ''}`.trim())
      if (tmdbContext.episode.airDate) lines.push(`- Episode Air Date: ${tmdbContext.episode.airDate}`)
      if (Number.isFinite(Number(tmdbContext.episode.runtime)) && Number(tmdbContext.episode.runtime) > 0) {
        lines.push(`- Episode Runtime: ${Math.floor(Number(tmdbContext.episode.runtime))} menit`)
      }
      if (Number.isFinite(Number(tmdbContext.episode.voteAverage)) && Number(tmdbContext.episode.voteAverage) > 0) {
        lines.push(`- Episode Rating TMDB: ${Number(tmdbContext.episode.voteAverage).toFixed(1)} / 10`)
      }
      if (tmdbContext.episode.overview) lines.push(`- Episode Overview: ${tmdbContext.episode.overview}`)
    }
    if (Number.isFinite(Number(tmdbContext.episodeCount)) && Number(tmdbContext.episodeCount) > 0) {
      lines.push(`- Episode Count (Resolved): ${Math.floor(Number(tmdbContext.episodeCount))}`)
    }
    if (tmdbContext.episodeType) {
      lines.push(`- Episode Type: ${tmdbContext.episodeType}`)
    }
  }
  if (tmdbContext.rules?.factual_only_from_tmdb || tmdbContext.rules?.no_hallucination) {
    lines.push(`- Rules: factual_only_from_tmdb=${tmdbContext.rules?.factual_only_from_tmdb ? 'true' : 'false'}, no_hallucination=${tmdbContext.rules?.no_hallucination ? 'true' : 'false'}, spoilerLevel=${tmdbContext.rules?.spoilerLevel || 'light'}`)
  }
  const factLocks = normalizeTmdbFactLocks(tmdbContext?.factLocks, tmdbContext?.mediaType)
  const lockedFields = []
  const unlockedFields = []
  TMDB_FACT_LOCK_FIELDS.forEach((fieldKey) => {
    if (tmdbContext.mediaType === 'movie' && fieldKey === 'networks') return
    if (tmdbContext.mediaType === 'tv' && (fieldKey === 'budget' || fieldKey === 'revenue')) return
    const contextKey = TMDB_CONTEXT_FACT_LOCK_MAP[fieldKey]
    if (!contextKey) return
    const hasValue = hasTmdbContextValue(tmdbContext?.[contextKey])
    if (!hasValue) return
    if (factLocks[fieldKey] !== false) {
      lockedFields.push(fieldKey)
      return
    }
    unlockedFields.push(fieldKey)
  })
  if (lockedFields.length) {
    lines.push(`- Fact lock ON: ${lockedFields.join(', ')}`)
  }
  if (unlockedFields.length) {
    lines.push(`- Fact lock OFF: ${unlockedFields.join(', ')}`)
  }
  const lockInstruction = lockedFields.length
    ? `Field lock ON wajib mengikuti nilai TMDB persis (tanpa mengubah fakta).`
    : ''
  const unlockInstruction = unlockedFields.length
    ? `Field lock OFF boleh diparafrase, tetapi tetap tidak boleh bertentangan dengan TMDB.`
    : ''
  const spoilerLevel = String(tmdbContext?.rules?.spoilerLevel || 'light').trim().toLowerCase()
  const spoilerInstruction = spoilerLevel === 'no_spoiler'
    ? 'Mode no_spoiler: dilarang membocorkan twist, ending, reveal identitas, atau kejutan inti cerita.'
    : (spoilerLevel === 'light'
      ? 'Mode light spoiler: boleh konteks konflik umum, tetapi tetap dilarang membocorkan ending atau twist inti.'
      : 'Mode full spoiler: detail lengkap boleh, tetapi tetap wajib faktual dari data TMDB.')
  const scopeInstruction = tmdbContext.mediaType === 'tv'
    ? (String(tmdbContext.referenceScope || 'series').toLowerCase() === 'episode'
      ? 'Scope episode: wajib menyebut SxE dan fokus pada fakta episode terpilih.'
      : (String(tmdbContext.referenceScope || 'series').toLowerCase() === 'season'
        ? 'Scope season: fokus pada arc season terpilih; jangan mengarang detail adegan episode di luar data.'
        : 'Scope series: fokus gambaran serial secara umum; jangan mengarang detail episode spesifik.'))
    : ''
  return (
    `\n\nReferensi fakta Movie/TV (TMDB):\n${lines.join('\n')}\n` +
    `Gunakan data TMDB di atas sebagai referensi faktual. Jangan mengarang data film/series jika tidak ada di referensi. ${scopeInstruction} ${spoilerInstruction} ${lockInstruction} ${unlockInstruction}`.trim()
  )
}

function appendTmdbContextToPrompt(prompt, tmdbContext) {
  const block = buildTmdbPromptBlock(tmdbContext)
  if (!block) return prompt || ''
  return `${prompt || ''}${block}`
}

function buildTmdbMeta(tmdbContext) {
  if (!tmdbContext || typeof tmdbContext !== 'object') return null
  const normalizedFactLocks = normalizeTmdbFactLocks(tmdbContext.factLocks, tmdbContext.mediaType)
  if (tmdbContext.mediaType === 'movie') {
    delete normalizedFactLocks.networks
  }
  if (tmdbContext.mediaType === 'tv') {
    delete normalizedFactLocks.budget
    delete normalizedFactLocks.revenue
  }
  const base = {
    enabled: !!tmdbContext.enabled,
    used: !!tmdbContext.used,
    reason: tmdbContext.reason || null,
    keySource: tmdbContext.keySource || null,
    rules: isPlainObject(tmdbContext.rules) ? tmdbContext.rules : null,
    factLocks: normalizedFactLocks,
    selectedImagesCount: Array.isArray(tmdbContext.selectedImages) ? tmdbContext.selectedImages.length : 0
  }
  if (!tmdbContext.used) return base
  return {
    ...base,
    mediaType: tmdbContext.mediaType || null,
    query: tmdbContext.query || null,
    languageCode: tmdbContext.languageCode || null,
    region: tmdbContext.region || null,
    title: tmdbContext.title || null,
    originalTitle: tmdbContext.originalTitle || null,
    year: tmdbContext.year || null,
    releaseDate: tmdbContext.releaseDate || null,
    runtime: Number.isFinite(Number(tmdbContext.runtime)) ? Number(tmdbContext.runtime) : null,
    rating: Number.isFinite(Number(tmdbContext.rating)) ? Number(tmdbContext.rating) : null,
    tagline: tmdbContext.tagline || null,
    certificationId: tmdbContext.certificationId || null,
    status: tmdbContext.status || null,
    originalLanguage: tmdbContext.originalLanguage || null,
    ...(tmdbContext.mediaType !== 'tv'
      ? {
          budget: Number.isFinite(Number(tmdbContext.budget)) ? Number(tmdbContext.budget) : null,
          revenue: Number.isFinite(Number(tmdbContext.revenue)) ? Number(tmdbContext.revenue) : null
        }
      : {}),
    trailer: tmdbContext.trailer || null,
    genres: Array.isArray(tmdbContext.genres) ? tmdbContext.genres : [],
    keywords: Array.isArray(tmdbContext.keywords) ? tmdbContext.keywords : [],
    cast: Array.isArray(tmdbContext.cast) ? tmdbContext.cast : [],
    directorsOrCreators: Array.isArray(tmdbContext.directorsOrCreators) ? tmdbContext.directorsOrCreators : [],
    watchProviders: Array.isArray(tmdbContext.watchProviders) ? tmdbContext.watchProviders : [],
    productionCompanies: Array.isArray(tmdbContext.productionCompanies) ? tmdbContext.productionCompanies : [],
    ...(tmdbContext.mediaType === 'tv'
      ? {
          networks: Array.isArray(tmdbContext.networks) ? tmdbContext.networks : []
        }
      : {}),
    productionCountries: Array.isArray(tmdbContext.productionCountries) ? tmdbContext.productionCountries : [],
    referenceScope: tmdbContext.referenceScope || null,
    seasonCount: Number.isFinite(Number(tmdbContext.seasonCount)) ? Number(tmdbContext.seasonCount) : null,
    episodeCount: Number.isFinite(Number(tmdbContext.episodeCount)) ? Number(tmdbContext.episodeCount) : null,
    episodeType: tmdbContext.episodeType || null,
    season: isPlainObject(tmdbContext.season)
      ? {
          number: Number.isFinite(Number(tmdbContext.season.number)) ? Number(tmdbContext.season.number) : null,
          name: tmdbContext.season.name || null,
          airDate: tmdbContext.season.airDate || null,
          overview: tmdbContext.season.overview || null,
          episodeCount: Number.isFinite(Number(tmdbContext.season.episodeCount))
            ? Number(tmdbContext.season.episodeCount)
            : null
        }
      : null,
    episode: isPlainObject(tmdbContext.episode)
      ? {
          number: Number.isFinite(Number(tmdbContext.episode.number)) ? Number(tmdbContext.episode.number) : null,
          name: tmdbContext.episode.name || null,
          airDate: tmdbContext.episode.airDate || null,
          overview: tmdbContext.episode.overview || null,
          runtime: Number.isFinite(Number(tmdbContext.episode.runtime)) ? Number(tmdbContext.episode.runtime) : null,
          voteAverage: Number.isFinite(Number(tmdbContext.episode.voteAverage))
            ? Number(tmdbContext.episode.voteAverage)
            : null,
          episodeType: tmdbContext.episode.episodeType || null
        }
      : null,
    tmdbUrl: tmdbContext.tmdbUrl || null,
    tmdbId: Number.isFinite(Number(tmdbContext.tmdbId)) ? Number(tmdbContext.tmdbId) : null
  }
}

function buildVisionRoutingContext({ provider, model, imageReferences }) {
  const refs = Array.isArray(imageReferences) ? imageReferences : []
  const hasImageReferences = refs.length > 0
  const providerName = String(provider || '').trim() || null
  const modelName = String(model || '').trim() || null
  const warnings = []

  if (!hasImageReferences) {
    return {
      ok: true,
      warnings,
      vision: {
        hasImageReferences: false,
        mode: 'off',
        providerSupported: providerName ? isVisionProviderImplemented(providerName) : null,
        modelSupported: null
      }
    }
  }

  if (!providerName) {
    warnings.push('Provider tidak dipilih; referensi gambar diproses sebagai konteks teks.')
    return {
      ok: true,
      warnings,
      vision: {
        hasImageReferences: true,
        mode: 'text_fallback',
        providerSupported: null,
        modelSupported: null,
        reason: 'provider_missing'
      }
    }
  }

  const providerSupportsVision = isVisionProviderImplemented(providerName)
  if (!providerSupportsVision) {
    const warning = `Provider "${providerName}" belum diaktifkan untuk multimodal di server ini; referensi gambar diproses sebagai konteks teks.`
    if (!ALLOW_TEXT_FALLBACK_ON_UNSUPPORTED_VISION_PROVIDER) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: warning,
          details: ['provider']
        }
      }
    }
    warnings.push(warning)
    return {
      ok: true,
      warnings,
      vision: {
        hasImageReferences: true,
        mode: 'text_fallback',
        providerSupported: false,
        modelSupported: null,
        reason: 'provider_not_implemented'
      }
    }
  }

  const modelSupportsVision = isVisionCapableModel({ provider: providerName, model: modelName })
  if (!modelSupportsVision) {
    const resolvedModel = modelName || '(default)'
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Model "${resolvedModel}" tidak mendukung analisis gambar untuk provider "${providerName}". Pilih model vision atau hapus referensi gambar.`,
        details: ['model']
      }
    }
  }

  return {
    ok: true,
    warnings,
    vision: {
      hasImageReferences: true,
      mode: 'multimodal',
      providerSupported: true,
      modelSupported: true
    }
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function parseEmailAllowlist(raw) {
  const out = new Set()
  String(raw || '')
    .split(/[\s,;]+/)
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
    .forEach((item) => {
      if (isValidEmail(item)) out.add(item)
    })
  return out
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    return `${parsed.protocol}//${parsed.host}`.toLowerCase()
  } catch (e) {
    return ''
  }
}

function parseCorsAllowedOrigins(raw) {
  const out = new Set()
  String(raw || '')
    .split(/[\s,;]+/)
    .map((item) => normalizeOrigin(item))
    .filter(Boolean)
    .forEach((item) => out.add(item))
  return out
}

function detectLeakedServiceRoleEnvKeys() {
  const forbiddenKeys = [
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_SERVICE_ROLE'
  ]
  return forbiddenKeys.filter((key) => String(process.env[key] || '').trim())
}

function computeServiceRoleRotationStatus() {
  const rawDate = SUPABASE_SERVICE_ROLE_ROTATED_AT
  if (!rawDate) {
    return {
      configured: false,
      rotatedAt: null,
      daysSinceRotation: null,
      maxAgeDays: SERVICE_ROLE_ROTATION_DAYS,
      stale: null
    }
  }
  const parsedMs = Date.parse(rawDate)
  if (!Number.isFinite(parsedMs)) {
    return {
      configured: false,
      rotatedAt: rawDate,
      daysSinceRotation: null,
      maxAgeDays: SERVICE_ROLE_ROTATION_DAYS,
      stale: null
    }
  }
  const days = Math.floor((Date.now() - parsedMs) / (1000 * 60 * 60 * 24))
  const daysSinceRotation = Math.max(0, days)
  return {
    configured: true,
    rotatedAt: new Date(parsedMs).toISOString(),
    daysSinceRotation,
    maxAgeDays: SERVICE_ROLE_ROTATION_DAYS,
    stale: daysSinceRotation > SERVICE_ROLE_ROTATION_DAYS
  }
}

function resolveAuthUserEmail(user) {
  if (!user || typeof user !== 'object') return ''
  const candidate = (
    user.email
    || user.user_metadata?.email
    || user.email_change
    || user.new_email
    || ''
  )
  return normalizeEmail(candidate)
}

function getEffectiveSignupMaxUsers() {
  const allowlistCap = ENFORCE_AUTH_EMAIL_ALLOWLIST
    ? (AUTH_ALLOWED_EMAILS.size || 0)
    : MAX_SIGNUP_USERS
  const capped = Math.min(MAX_SIGNUP_USERS, allowlistCap || MAX_SIGNUP_USERS)
  return Math.max(0, Number(capped || 0))
}

function isAuthAllowlistMisconfigured() {
  return ENFORCE_AUTH_EMAIL_ALLOWLIST && AUTH_ALLOWED_EMAILS.size === 0
}

function evaluateAuthEmailPolicy(rawEmail) {
  const email = normalizeEmail(rawEmail)
  if (!ENFORCE_AUTH_EMAIL_ALLOWLIST) {
    return { ok: true, email }
  }
  if (isAuthAllowlistMisconfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'MISCONFIGURED',
      message: 'Auth email allowlist is enabled but AUTH_ALLOWED_EMAILS is empty'
    }
  }
  if (!email || !isValidEmail(email)) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid email format'
    }
  }
  if (!AUTH_ALLOWED_EMAILS.has(email)) {
    return {
      ok: false,
      status: 403,
      code: 'EMAIL_NOT_ALLOWED',
      message: 'Email is not allowed for this internal app'
    }
  }
  return { ok: true, email }
}

function isStrongEnoughPassword(password) {
  return typeof password === 'string' && password.length >= 8
}

function createSupabaseAdminClientFromValues(supabaseUrlRaw, serviceRoleRaw) {
  const supabaseUrl = String(supabaseUrlRaw || '').trim()
  const serviceRole = String(serviceRoleRaw || '').trim()
  if (!supabaseUrl || !serviceRole) return null
  return createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })
}

function createSupabaseAdminClient() {
  return createSupabaseAdminClientFromValues(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function parseEnvContent(rawText = '') {
  const out = {}
  const text = String(rawText || '')
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = String(line || '').trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

function isPlaceholderEnvValue(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return true
  if (v.includes('your-') || v.includes('your_')) return true
  if (v.includes('<') || v.includes('replace')) return true
  return false
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    return ''
  }
}

function readSupabaseProfileByName(profileName) {
  const normalized = String(profileName || '').trim().toLowerCase()
  const filePath = SUPABASE_PROFILE_FILES[normalized]
  if (!filePath) {
    return { ok: false, profile: normalized, filePath: '', exists: false, env: {}, text: '' }
  }
  const text = safeReadText(filePath)
  const exists = !!text
  const env = exists ? parseEnvContent(text) : {}
  return { ok: exists, profile: normalized, filePath, exists, env, text }
}

function buildSupabaseProfileStatus() {
  const activeText = safeReadText(ENV_ACTIVE_FILE)
  const activeEnv = parseEnvContent(activeText)
  const primary = readSupabaseProfileByName('primary')
  const backup = readSupabaseProfileByName('backup')
  let activeProfile = null
  if (activeText && primary.exists && activeText === primary.text) activeProfile = 'primary'
  else if (activeText && backup.exists && activeText === backup.text) activeProfile = 'backup'

  return {
    activeProfile,
    active: {
      supabaseUrl: activeEnv.SUPABASE_URL || activeEnv.VITE_SUPABASE_URL || '',
      apiUrl: activeEnv.VITE_API_URL || ''
    },
    dualWrite: {
      enabled: ENABLE_SUPABASE_DUAL_WRITE,
      mirrorProfile: supabaseMirrorInfo?.profile || null,
      mirrorReady: !!supabaseMirrorAdmin,
      reason: supabaseMirrorInfo?.reason || ''
    },
    profiles: {
      primary: {
        exists: primary.exists,
        ready: primary.exists
          && !isPlaceholderEnvValue(primary.env.SUPABASE_URL || primary.env.VITE_SUPABASE_URL)
          && !isPlaceholderEnvValue(primary.env.VITE_SUPABASE_ANON_KEY)
          && !isPlaceholderEnvValue(primary.env.SUPABASE_SERVICE_ROLE_KEY),
        supabaseUrl: primary.env.SUPABASE_URL || primary.env.VITE_SUPABASE_URL || '',
        apiUrl: primary.env.VITE_API_URL || ''
      },
      backup: {
        exists: backup.exists,
        ready: backup.exists
          && !isPlaceholderEnvValue(backup.env.SUPABASE_URL || backup.env.VITE_SUPABASE_URL)
          && !isPlaceholderEnvValue(backup.env.VITE_SUPABASE_ANON_KEY)
          && !isPlaceholderEnvValue(backup.env.SUPABASE_SERVICE_ROLE_KEY),
        supabaseUrl: backup.env.SUPABASE_URL || backup.env.VITE_SUPABASE_URL || '',
        apiUrl: backup.env.VITE_API_URL || ''
      }
    }
  }
}

function normalizeUrlForCompare(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return `${parsed.protocol}//${parsed.host}`.toLowerCase()
  } catch (e) {
    return raw.toLowerCase()
  }
}

function readSupabaseProfileCredentials(profileName) {
  const profile = readSupabaseProfileByName(profileName)
  const supabaseUrl = String(profile.env.SUPABASE_URL || profile.env.VITE_SUPABASE_URL || '').trim()
  const serviceRole = String(profile.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const anonKey = String(profile.env.VITE_SUPABASE_ANON_KEY || '').trim()
  const ready = profile.exists
    && !isPlaceholderEnvValue(supabaseUrl)
    && !isPlaceholderEnvValue(serviceRole)
    && !isPlaceholderEnvValue(anonKey)
  return {
    profile: String(profileName || '').trim().toLowerCase(),
    exists: profile.exists,
    ready,
    supabaseUrl,
    serviceRole,
    anonKey
  }
}

function resolveActiveSupabaseProfileName() {
  const activeUrl = normalizeUrlForCompare(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  if (!activeUrl) return null
  const primary = readSupabaseProfileCredentials('primary')
  const backup = readSupabaseProfileCredentials('backup')
  if (primary.ready && normalizeUrlForCompare(primary.supabaseUrl) === activeUrl) return 'primary'
  if (backup.ready && normalizeUrlForCompare(backup.supabaseUrl) === activeUrl) return 'backup'
  return null
}

function resolveMirrorSupabaseProfileName(activeProfileName) {
  const normalized = String(activeProfileName || '').trim().toLowerCase()
  if (normalized === 'primary') return 'backup'
  if (normalized === 'backup') return 'primary'
  return null
}

function createSupabaseMirrorAdminClient() {
  if (!ENABLE_SUPABASE_DUAL_WRITE) {
    return { client: null, profile: null, supabaseUrl: '', reason: 'disabled' }
  }
  const activeProfile = resolveActiveSupabaseProfileName()
  const mirrorProfile = resolveMirrorSupabaseProfileName(activeProfile)
  if (!mirrorProfile) {
    return { client: null, profile: null, supabaseUrl: '', reason: 'active_profile_unknown' }
  }
  const credentials = readSupabaseProfileCredentials(mirrorProfile)
  if (!credentials.ready) {
    return { client: null, profile: mirrorProfile, supabaseUrl: credentials.supabaseUrl || '', reason: 'mirror_profile_not_ready' }
  }
  const client = createSupabaseAdminClientFromValues(credentials.supabaseUrl, credentials.serviceRole)
  if (!client) {
    return { client: null, profile: mirrorProfile, supabaseUrl: credentials.supabaseUrl || '', reason: 'mirror_client_missing_credentials' }
  }
  return {
    client,
    profile: mirrorProfile,
    supabaseUrl: credentials.supabaseUrl,
    reason: 'ok'
  }
}

function applySupabaseRuntimeFromEnvMap(nextEnv = {}) {
  const targetKeys = [
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_API_URL',
    'VITE_API_URL_SECONDARY',
    'VITE_LOCAL_API_URL'
  ]
  for (const key of targetKeys) {
    if (Object.prototype.hasOwnProperty.call(nextEnv, key)) {
      process.env[key] = String(nextEnv[key] || '')
    }
  }
}

let supabaseAdmin = null
let supabaseMirrorAdmin = null
let supabaseMirrorInfo = {
  profile: null,
  supabaseUrl: '',
  reason: 'not_initialized'
}

function refreshSupabaseAdminClient() {
  supabaseAdmin = createSupabaseAdminClient()
  const mirror = createSupabaseMirrorAdminClient()
  supabaseMirrorAdmin = mirror.client || null
  supabaseMirrorInfo = {
    profile: mirror.profile || null,
    supabaseUrl: mirror.supabaseUrl || '',
    reason: mirror.reason || (mirror.client ? 'ok' : 'unknown')
  }
}

refreshSupabaseAdminClient()

async function replicateMutationToMirror(label, mutateFn) {
  if (!ENABLE_SUPABASE_DUAL_WRITE) return { attempted: false, mirrored: false, reason: 'disabled' }
  if (!supabaseMirrorAdmin) return { attempted: false, mirrored: false, reason: supabaseMirrorInfo.reason || 'mirror_not_configured' }
  try {
    const result = await mutateFn(supabaseMirrorAdmin)
    if (result?.error) {
      console.warn(`[dual-write] ${label} mirror error: ${sanitizeSupabaseError(result.error)}`)
      return { attempted: true, mirrored: false, reason: sanitizeSupabaseError(result.error), error: result.error }
    }
    return { attempted: true, mirrored: true, reason: 'ok', data: result?.data || null }
  } catch (e) {
    console.warn(`[dual-write] ${label} mirror exception: ${e?.message || e}`)
    return { attempted: true, mirrored: false, reason: e?.message || 'mirror_exception', error: e }
  }
}

async function switchSupabaseProfile(profileName) {
  const normalized = String(profileName || '').trim().toLowerCase()
  if (!['primary', 'backup'].includes(normalized)) {
    return { ok: false, status: 400, message: 'profile must be primary or backup' }
  }
  if (!fs.existsSync(SUPABASE_PROFILE_FILES[normalized])) {
    return { ok: false, status: 400, message: `Profile file not found: .env.${normalized}` }
  }
  const targetProfile = readSupabaseProfileByName(normalized)
  const resolvedUrl = String(targetProfile.env.SUPABASE_URL || targetProfile.env.VITE_SUPABASE_URL || '').trim()
  const missingKeys = []
  if (isPlaceholderEnvValue(resolvedUrl)) missingKeys.push('SUPABASE_URL|VITE_SUPABASE_URL')
  if (isPlaceholderEnvValue(targetProfile.env.SUPABASE_SERVICE_ROLE_KEY)) missingKeys.push('SUPABASE_SERVICE_ROLE_KEY')
  if (isPlaceholderEnvValue(targetProfile.env.VITE_SUPABASE_ANON_KEY)) missingKeys.push('VITE_SUPABASE_ANON_KEY')
  if (missingKeys.length) {
    return { ok: false, status: 400, message: `Profile .env.${normalized} belum valid: ${missingKeys.join(', ')}` }
  }
  if (!fs.existsSync(SWITCH_ENV_SCRIPT_FILE)) {
    return { ok: false, status: 500, message: 'switch-env script file is missing' }
  }

  try {
    await execFileAsync(process.execPath, [SWITCH_ENV_SCRIPT_FILE, normalized], {
      cwd: process.cwd(),
      windowsHide: true
    })
  } catch (e) {
    const stderr = String(e?.stderr || '').trim()
    const stdout = String(e?.stdout || '').trim()
    const errMessage = stderr || stdout || e?.message || 'Failed to switch env profile'
    return { ok: false, status: 500, message: errMessage }
  }

  const activeText = safeReadText(ENV_ACTIVE_FILE)
  const activeEnv = parseEnvContent(activeText)
  applySupabaseRuntimeFromEnvMap(activeEnv)
  refreshSupabaseAdminClient()

  return {
    ok: true,
    status: 200,
    data: {
      profile: normalized,
      activeSupabaseUrl: activeEnv.SUPABASE_URL || activeEnv.VITE_SUPABASE_URL || '',
      activeApiUrl: activeEnv.VITE_API_URL || '',
      frontendRuntime: {
        url: activeEnv.VITE_SUPABASE_URL || activeEnv.SUPABASE_URL || '',
        anonKey: activeEnv.VITE_SUPABASE_ANON_KEY || ''
      }
    }
  }
}

function sanitizeSupabaseError(err) {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  return err.message || 'Supabase operation failed'
}

function getBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || ''
  const headerText = String(authHeader || '')
  const match = headerText.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

async function resolveUserFromBearerToken(token) {
  if (!supabaseAdmin || !token) return { user: null, error: null }
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error) return { user: null, error }
  return { user: data?.user || null, error: null }
}

async function requireAuthenticatedUser(req, res, next) {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const token = getBearerToken(req)
    if (!token) return sendError(res, 401, 'UNAUTHORIZED', 'Bearer token is required')
    const { user, error } = await resolveUserFromBearerToken(token)
    if (error || !user) return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token')
    const emailPolicy = evaluateAuthEmailPolicy(resolveAuthUserEmail(user))
    if (!emailPolicy.ok) {
      return sendError(
        res,
        Number(emailPolicy.status || 403),
        emailPolicy.code || 'FORBIDDEN',
        emailPolicy.message || 'Email is not allowed'
      )
    }
    req.authUser = user
    req.authToken = token
    return next()
  } catch (e) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token')
  }
}

async function resolveOptionalAuthenticatedUser(req) {
  try {
    if (!supabaseAdmin) return null
    const token = getBearerToken(req)
    if (!token) return null
    const { user, error } = await resolveUserFromBearerToken(token)
    if (error || !user) return null
    const emailPolicy = evaluateAuthEmailPolicy(resolveAuthUserEmail(user))
    if (!emailPolicy.ok) return null
    return user
  } catch (e) {
    return null
  }
}

const sensitiveAuthMiddleware = REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS
  ? requireAuthenticatedUser
  : (_req, _res, next) => next()

function isMissingRelationError(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))
}

const TEAM_PRESET_SELECT_COLUMNS = [
  'id',
  'preset_id',
  'title',
  'preset',
  'version',
  'created_by_user_id',
  'created_by_display_name',
  'updated_by_user_id',
  'updated_by_display_name',
  'last_action',
  'last_action_at',
  'last_cloned_from_preset_id',
  'created_at',
  'updated_at'
].join(',')

function normalizeTeamPresetAction(value, fallback = 'edit') {
  const normalizedFallback = TEAM_PRESET_ALLOWED_ACTIONS.has(String(fallback || '').toLowerCase())
    ? String(fallback || '').toLowerCase()
    : 'edit'
  const normalized = String(value || '').trim().toLowerCase()
  if (!TEAM_PRESET_ALLOWED_ACTIONS.has(normalized)) return normalizedFallback
  return normalized
}

function parsePresetMutationPayload(body, defaultAction = 'edit') {
  const raw = isPlainObject(body) ? body : {}
  const fromWrapper = isPlainObject(raw.preset) ? raw.preset : null
  const incomingPreset = fromWrapper || raw
  const action = normalizeTeamPresetAction(
    raw.action || raw.source || raw.intent || raw._action || defaultAction,
    defaultAction
  )
  const cloneFromPresetId = String(raw.cloneFromPresetId || raw.cloneFrom || '').trim() || null
  return { incomingPreset, action, cloneFromPresetId }
}

function mapTeamVersionRow(row, presetId = '') {
  if (!isPlainObject(row) || !isPlainObject(row.snapshot)) return null
  const normalizedPreset = normalizePreset({
    ...row.snapshot,
    id: presetId || row.snapshot?.id
  })
  return {
    snapshotId: row.id,
    source: String(row.action || 'edit'),
    version: normalizedPreset.version || `v${Number(row.snapshot_version || 1)}`,
    savedAt: row.created_at || null,
    title: normalizedPreset.title || '',
    actorDisplayName: row.actor_display_name || null,
    preset: normalizedPreset
  }
}

function getDisplayNameFromAuthUser(user) {
  const meta = isPlainObject(user?.user_metadata) ? user.user_metadata : {}
  const raw = String(
    meta.display_name ||
    meta.full_name ||
    meta.name ||
    user?.email ||
    'unknown'
  ).trim()
  return raw || 'unknown'
}

function pickProfileDisplayName(profileRow) {
  if (!isPlainObject(profileRow)) return ''
  const candidates = [
    'user_display_name',
    'User Display Name',
    'user display name',
    'display_name',
    'Display Name',
    'display name',
    'full_name',
    'Full Name',
    'name',
    'Name'
  ]
  for (const key of candidates) {
    const value = String(profileRow?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

async function getProfileDisplayNameByUserId(userId) {
  if (!supabaseAdmin || !userId) return ''
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error || !data) return ''
    return pickProfileDisplayName(data)
  } catch (e) {
    return ''
  }
}

async function getProfileDisplayNameMapByUserIds(userIds = []) {
  if (!supabaseAdmin || !Array.isArray(userIds) || !userIds.length) return {}
  const ids = Array.from(new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 500)
  if (!ids.length) return {}
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .in('id', ids)
    if (error || !Array.isArray(data)) return {}
    const out = {}
    data.forEach((row) => {
      const id = String(row?.id || '').trim()
      const label = pickProfileDisplayName(row)
      if (id && label) out[id] = label
    })

    const missingIds = ids.filter((id) => !String(out[id] || '').trim())
    if (missingIds.length && supabaseAdmin?.auth?.admin?.getUserById) {
      await Promise.all(
        missingIds.map(async (userId) => {
          try {
            const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId)
            if (authErr || !authData?.user) return
            const candidate = String(
              authData.user?.user_metadata?.display_name ||
              authData.user?.user_metadata?.full_name ||
              authData.user?.user_metadata?.name ||
              ''
            ).trim()
            if (candidate) out[userId] = candidate
          } catch (e) {}
        })
      )
    }

    return out
  } catch (e) {
    return {}
  }
}

async function resolveActorDisplayName(actorUser) {
  const userId = String(actorUser?.id || '').trim()
  if (userId) {
    const fromProfile = await getProfileDisplayNameByUserId(userId)
    if (fromProfile) return fromProfile
  }
  return getDisplayNameFromAuthUser(actorUser)
}

function normalizeAlertStatus(value, fallback = 'open') {
  const normalized = String(value || '').trim().toLowerCase()
  if (DASHBOARD_ALLOWED_ALERT_STATUS.has(normalized)) return normalized
  const nextFallback = String(fallback || '').trim().toLowerCase()
  return DASHBOARD_ALLOWED_ALERT_STATUS.has(nextFallback) ? nextFallback : 'open'
}

function normalizeAlertSeverity(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (DASHBOARD_ALERT_SEVERITY.has(normalized)) return normalized
  return 'warning'
}

function normalizeAlertKey(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  return raw
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140)
}

function normalizeAlertMessage(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, 400)
}

function normalizeAlertContext(value) {
  if (!isPlainObject(value)) return {}
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (e) {
    return {}
  }
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item))
  if (!isPlainObject(value)) return value
  const out = {}
  Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      out[key] = canonicalizeJson(value[key])
    })
  return out
}

function stableJsonStringify(value) {
  try {
    return JSON.stringify(canonicalizeJson(value))
  } catch (e) {
    return '{}'
  }
}

function buildAlertEventSignature(payload) {
  const source = String(payload?.source || 'dashboard').trim().slice(0, 40) || 'dashboard'
  const severity = normalizeAlertSeverity(payload?.severity || 'warning')
  const message = normalizeAlertMessage(payload?.message || '')
  const context = normalizeAlertContext(payload?.context)
  return `${source}|${severity}|${message}|${stableJsonStringify(context)}`
}

function mapDashboardAlertRow(row) {
  if (!isPlainObject(row)) return null
  return {
    id: row.id,
    alertKey: row.alert_key || '',
    source: row.source || 'dashboard',
    status: normalizeAlertStatus(row.status),
    severity: normalizeAlertSeverity(row.severity),
    message: row.message || '',
    context: isPlainObject(row.context) ? row.context : {},
    count: Number(row.count || 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastSeenAt: row.last_seen_at || null,
    createdByDisplayName: row.created_by_display_name || null,
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedByDisplayName: row.acknowledged_by_display_name || null,
    resolvedAt: row.resolved_at || null,
    resolvedByDisplayName: row.resolved_by_display_name || null
  }
}

function mapDashboardSnapshotRow(row) {
  if (!isPlainObject(row)) return null
  return {
    id: row.id,
    snapshotDate: row.snapshot_date || null,
    windowDays: Number(row.window_days || 7),
    sourceScope: row.source_scope || 'all',
    decisionScope: row.decision_scope || 'all',
    summary: isPlainObject(row.summary) ? row.summary : {},
    generatedByUserId: row.generated_by_user_id || null,
    generatedByDisplayName: row.generated_by_display_name || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }
}

function normalizeSnapshotScope(value, fallback = 'all') {
  const normalized = String(value || '').trim().toLowerCase()
  if (['all', 'supabase', 'local'].includes(normalized)) return normalized
  return fallback
}

function mapTeamPresetRow(row) {
  if (!isPlainObject(row) || !isPlainObject(row.preset)) return null
  const normalized = normalizePreset({
    ...row.preset,
    id: row.preset_id || row.preset?.id
  })
  normalized.title = String(row.title || normalized.title || normalized.label || normalized.id || '').trim() || normalized.title
  const fallbackAction = row.last_cloned_from_preset_id ? 'clone' : 'edit'
  const lastAction = String(row.last_action || fallbackAction).trim() || fallbackAction
  const updatedByDisplayName = row.updated_by_display_name || row.created_by_display_name || null
  const lastActionAt = (
    row.last_action_at ||
    row.updated_at ||
    normalized?.meta?.updatedAt ||
    normalized?.meta?.createdAt ||
    null
  )
  return {
    ...normalized,
    _teamVersion: Number(row.version || 1),
    _lastAction: lastAction,
    _lastActionAt: lastActionAt,
    _createdAt: row.created_at || null,
    _updatedAt: row.updated_at || null,
    _updatedByUserId: row.updated_by_user_id || null,
    _createdByUserId: row.created_by_user_id || null,
    _updatedByDisplayName: updatedByDisplayName,
    _createdByDisplayName: row.created_by_display_name || null,
    _lastClonedFromPresetId: row.last_cloned_from_preset_id || null
  }
}

async function listTeamPresetsFromSupabase() {
  if (!supabaseAdmin) return { rows: [], error: null }
  const { data, error } = await supabaseAdmin
    .from(TEAM_PRESET_TABLE)
    .select(TEAM_PRESET_SELECT_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (error) return { rows: [], error }
  const rows = (Array.isArray(data) ? data : []).map((row) => mapTeamPresetRow(row)).filter(Boolean)
  return { rows, error: null }
}

async function getTeamPresetRowByPresetId(presetId) {
  if (!supabaseAdmin || !presetId) return { row: null, error: null }
  const { data, error } = await supabaseAdmin
    .from(TEAM_PRESET_TABLE)
    .select(TEAM_PRESET_SELECT_COLUMNS)
    .eq('preset_id', presetId)
    .maybeSingle()
  if (error) return { row: null, error }
  return { row: data || null, error: null }
}

async function upsertTeamPresetRowOnClient(client, teamRow) {
  if (!client || !isPlainObject(teamRow) || !isPlainObject(teamRow.preset)) {
    return { data: null, error: null }
  }
  const payload = {
    id: teamRow.id || undefined,
    preset_id: teamRow.preset_id || teamRow.preset?.id,
    title: teamRow.title || teamRow.preset?.title || teamRow.preset?.label || teamRow.preset?.id || '',
    preset: normalizePreset({
      ...teamRow.preset,
      id: teamRow.preset_id || teamRow.preset?.id
    }),
    version: Number(teamRow.version || 1),
    created_by_user_id: teamRow.created_by_user_id || null,
    created_by_display_name: teamRow.created_by_display_name || null,
    updated_by_user_id: teamRow.updated_by_user_id || null,
    updated_by_display_name: teamRow.updated_by_display_name || null,
    last_action: teamRow.last_action || 'edit',
    last_action_at: teamRow.last_action_at || teamRow.updated_at || null,
    last_cloned_from_preset_id: teamRow.last_cloned_from_preset_id || null,
    created_at: teamRow.created_at || null,
    updated_at: teamRow.updated_at || null
  }
  const { data, error } = await client
    .from(TEAM_PRESET_TABLE)
    .upsert([payload], { onConflict: 'preset_id' })
    .select(TEAM_PRESET_SELECT_COLUMNS)
    .maybeSingle()
  if (error) return { data: null, error }
  return { data: data || null, error: null }
}

async function upsertTeamPresetVersionSnapshotOnClient(client, teamRow, action, actorUser, actorDisplayNameInput = null) {
  if (!client || !teamRow?.id || !isPlainObject(teamRow?.preset)) return { error: null, data: null }
  const actorDisplayName = String(actorDisplayNameInput || getDisplayNameFromAuthUser(actorUser) || 'unknown').trim() || 'unknown'
  const teamVersion = Number(teamRow.version || 1)
  const normalizedAction = normalizeTeamPresetAction(action, 'edit')
  const insertPayload = {
    team_preset_id: teamRow.id,
    snapshot_version: teamVersion,
    action: normalizedAction,
    snapshot: normalizePreset({
      ...teamRow.preset,
      id: teamRow.preset_id || teamRow.preset?.id
    }),
    actor_user_id: actorUser?.id || null,
    actor_display_name: actorDisplayName
  }
  const { error: insertErr } = await client
    .from(TEAM_PRESET_VERSION_TABLE)
    .insert([insertPayload])

  if (insertErr) return { error: insertErr, data: null }

  const { data: existing, error: listErr } = await client
    .from(TEAM_PRESET_VERSION_TABLE)
    .select('id,created_at')
    .eq('team_preset_id', teamRow.id)
    .order('created_at', { ascending: false })

  if (listErr || !Array.isArray(existing) || existing.length <= TEAM_PRESET_VERSION_LIMIT) {
    return { error: listErr || null, data: null }
  }
  const removeIds = existing.slice(TEAM_PRESET_VERSION_LIMIT).map((row) => row.id).filter(Boolean)
  if (!removeIds.length) return { error: null, data: null }

  const { error: pruneErr } = await client
    .from(TEAM_PRESET_VERSION_TABLE)
    .delete()
    .in('id', removeIds)
  return { error: pruneErr || null, data: null }
}

async function upsertTeamPresetVersionSnapshot(teamRow, action, actorUser, actorDisplayNameInput = null) {
  if (!supabaseAdmin || !teamRow?.id || !isPlainObject(teamRow?.preset)) return { error: null }
  const primary = await upsertTeamPresetVersionSnapshotOnClient(
    supabaseAdmin,
    teamRow,
    action,
    actorUser,
    actorDisplayNameInput
  )
  if (primary?.error) return { error: primary.error }

  await replicateMutationToMirror('team-presets.version-snapshot', async (mirrorClient) => {
    const mirroredPreset = await upsertTeamPresetRowOnClient(mirrorClient, teamRow)
    if (mirroredPreset?.error) return { error: mirroredPreset.error }
    const mirrorTeamRow = mirroredPreset?.data || teamRow
    return upsertTeamPresetVersionSnapshotOnClient(
      mirrorClient,
      mirrorTeamRow,
      action,
      actorUser,
      actorDisplayNameInput
    )
  })
  return { error: null }
}

async function seedTeamPresetsIfNeeded(actorUser, options = {}) {
  if (!supabaseAdmin) return { rows: [], error: null }
  const current = Array.isArray(options?.existingRows)
    ? { rows: options.existingRows, error: null }
    : await listTeamPresetsFromSupabase()
  if (current.error) return current

  const seedsRaw = readStoredPresets()
  if (!Array.isArray(seedsRaw) || !seedsRaw.length) return current
  const currentIds = new Set(
    (Array.isArray(current.rows) ? current.rows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  )
  const seedPresets = seedsRaw
    .map((item) => normalizePreset(item))
    .filter((item) => item && !validateTemplate(item).length)
  const missingSeedPresets = seedPresets.filter((preset) => !currentIds.has(String(preset.id || '').trim()))
  if (!missingSeedPresets.length) return current

  const actorDisplayName = await resolveActorDisplayName(actorUser)
  const nowIso = new Date().toISOString()

  const insertRows = missingSeedPresets
    .map((preset) => ({
      preset_id: preset.id,
      title: preset.title || preset.label || preset.id,
      preset,
      version: 1,
      created_by_user_id: actorUser?.id || null,
      created_by_display_name: actorDisplayName,
      updated_by_user_id: actorUser?.id || null,
      updated_by_display_name: actorDisplayName,
      last_action: 'create',
      last_action_at: nowIso,
      last_cloned_from_preset_id: null,
      created_at: nowIso,
      updated_at: nowIso
    }))

  const { error: seedErr } = await supabaseAdmin
    .from(TEAM_PRESET_TABLE)
    .upsert(insertRows, { onConflict: 'preset_id' })

  if (seedErr) return { rows: [], error: seedErr }

  const seededRows = await listTeamPresetsFromSupabase()
  if (seededRows.error) return seededRows

  if (actorUser?.id) {
    for (const preset of missingSeedPresets) { // eslint-disable-line no-restricted-syntax
      try {
        const teamRow = await getTeamPresetRowByPresetId(preset.id) // eslint-disable-line no-await-in-loop
        if (teamRow?.row) await upsertTeamPresetVersionSnapshot(teamRow.row, 'seed', actorUser, actorDisplayName) // eslint-disable-line no-await-in-loop
      } catch (e) {}
    }
  }

  return seededRows
}

function normalizeProvider(provider) {
  return String(provider || '').trim()
}

function isSupportedProvider(provider) {
  return SUPPORTED_PROVIDERS.includes(provider)
}

function getServerProviderApiKey(provider) {
  const envKey = PROVIDER_ENV_KEY_MAP[provider]
  if (!envKey) return null
  const value = String(process.env[envKey] || '').trim()
  return value || null
}

function getServerTmdbApiKey() {
  const value = String(process.env.TMDB_API_KEY || '').trim()
  return value || null
}

async function getActiveUserProviderKeyRow(userId, provider) {
  if (!supabaseAdmin || !userId || !provider) return null
  const { data, error } = await supabaseAdmin
    .from('user_provider_keys')
    .select('provider,key_ciphertext,key_iv,key_tag,key_last4,is_active,updated_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    console.warn('Failed to read user_provider_keys:', sanitizeSupabaseError(error))
    return null
  }
  return data || null
}

async function getUserProviderKeyRow(userId, provider) {
  if (!supabaseAdmin || !userId || !provider) return null
  const { data, error } = await supabaseAdmin
    .from('user_provider_keys')
    .select('provider,key_ciphertext,key_iv,key_tag,key_last4,is_active,updated_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (error) {
    console.warn('Failed to read user_provider_keys (generic):', sanitizeSupabaseError(error))
    return null
  }
  return data || null
}

async function resolveGenerateKeySource(req, providerRaw) {
  const provider = normalizeProvider(providerRaw)
  if (!isSupportedProvider(provider)) {
    return { keySource: 'server_fallback', providerApiKey: null }
  }

  const token = getBearerToken(req)
  let authUser = null
  if (token) {
    const { user } = await resolveUserFromBearerToken(token)
    authUser = user
  }

  if (authUser?.id) {
    const userRow = await getActiveUserProviderKeyRow(authUser.id, provider)
    if (userRow) {
      try {
        const decrypted = decryptProviderApiKey(userRow)
        if (String(decrypted || '').trim()) {
          return { keySource: 'user', providerApiKey: decrypted }
        }
      } catch (e) {
        console.warn('Failed to decrypt user provider key:', e.message || e)
      }
    }
  }

  const serverApiKey = getServerProviderApiKey(provider)
  if (serverApiKey) {
    return { keySource: 'server_fallback', providerApiKey: serverApiKey }
  }

  if (ALLOW_SERVER_PROVIDER_KEY_FALLBACK) {
    return { keySource: 'server_fallback', providerApiKey: null }
  }

  return { keySource: 'not_configured', providerApiKey: null }
}

function mapProviderKeyRow(row) {
  if (!row) return null
  return {
    provider: row.provider,
    configured: true,
    keyLast4: row.key_last4 || null,
    isActive: !!row.is_active,
    updatedAt: row.updated_at || null,
    userDisplayName: row.user_display_name || null
  }
}

function isMissingTableInSchemaCacheError(error, tableName) {
  const table = String(tableName || '').trim().toLowerCase()
  if (!table) return false
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  return (
    message.includes(`could not find the table 'public.${table}'`)
    || (message.includes('relation') && message.includes(table) && message.includes('does not exist'))
    || (details.includes('relation') && details.includes(table) && details.includes('does not exist'))
    || (hint.includes('relation') && hint.includes(table) && hint.includes('does not exist'))
  )
}

function isMissingTeamIntegrationColumnError(error, columnName) {
  const column = String(columnName || '').trim().toLowerCase()
  if (!column) return false
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  return (
    (message.includes(column) || details.includes(column) || hint.includes(column))
    && (message.includes('schema cache') || message.includes('column') || details.includes('column') || hint.includes('column'))
  )
}

function isMissingTeamIntegrationCompatColumnError(error) {
  return (
    isMissingTeamIntegrationColumnError(error, 'updated_by_display_name')
    || isMissingTeamIntegrationColumnError(error, 'updated_by_user_id')
    || isMissingTeamIntegrationColumnError(error, 'key_version')
  )
}

function mapTmdbIntegrationKeyRow(row) {
  if (!row) return null
  return {
    keyName: TMDB_INTEGRATION_KEY_NAME,
    configured: true,
    keyLast4: row.key_last4 || null,
    isActive: !!row.is_active,
    updatedAt: row.updated_at || null,
    updatedByDisplayName: row.updated_by_display_name || null,
    keySource: 'table'
  }
}

function buildTmdbIntegrationEnvFallbackStatus() {
  const envKey = getServerTmdbApiKey()
  if (!envKey) return null
  return {
    keyName: TMDB_INTEGRATION_KEY_NAME,
    configured: true,
    keyLast4: envKey.slice(-4),
    isActive: true,
    updatedAt: null,
    updatedByDisplayName: 'ENV',
    keySource: 'env'
  }
}

function buildTmdbIntegrationMissingTableMessage() {
  return 'TMDB key storage table belum ada. Jalankan scripts/create_team_integration_keys.sql di Supabase SQL Editor.'
}

async function getTmdbIntegrationKeyRowCompat(client = supabaseAdmin) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured') }
  const selectWithMeta = 'key_name,key_ciphertext,key_iv,key_tag,key_version,key_last4,is_active,updated_at,updated_by_display_name'
  const selectBase = 'key_name,key_ciphertext,key_iv,key_tag,key_last4,is_active,updated_at'
  const first = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .select(selectWithMeta)
    .eq('key_name', TMDB_INTEGRATION_KEY_NAME)
    .maybeSingle()

  if (!first.error) return { data: first.data || null, error: null, degraded: false, missingTable: false }
  if (isMissingTableInSchemaCacheError(first.error, TEAM_INTEGRATION_KEY_TABLE)) {
    return { data: null, error: first.error, degraded: false, missingTable: true }
  }
  if (!isMissingTeamIntegrationCompatColumnError(first.error)) {
    return { data: null, error: first.error, degraded: false, missingTable: false }
  }

  const fallback = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .select(selectBase)
    .eq('key_name', TMDB_INTEGRATION_KEY_NAME)
    .maybeSingle()
  if (fallback.error) {
    if (isMissingTableInSchemaCacheError(fallback.error, TEAM_INTEGRATION_KEY_TABLE)) {
      return { data: null, error: fallback.error, degraded: true, missingTable: true }
    }
    return { data: null, error: fallback.error, degraded: true, missingTable: false }
  }
  const mapped = fallback.data ? { ...fallback.data, updated_by_display_name: null, key_version: 1 } : null
  return { data: mapped, error: null, degraded: true, missingTable: false }
}

async function upsertTmdbIntegrationKeyCompat(payload, client = supabaseAdmin) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured'), missingTable: false }
  const selectWithMeta = 'key_name,key_last4,is_active,updated_at,updated_by_display_name'
  const selectBase = 'key_name,key_last4,is_active,updated_at'
  const first = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .upsert([payload], { onConflict: 'key_name' })
    .select(selectWithMeta)
    .single()
  if (!first.error) return { data: first.data || null, error: null, missingTable: false }
  if (isMissingTableInSchemaCacheError(first.error, TEAM_INTEGRATION_KEY_TABLE)) {
    return { data: null, error: first.error, missingTable: true }
  }
  if (!isMissingTeamIntegrationCompatColumnError(first.error)) {
    return { data: null, error: first.error, missingTable: false }
  }

  const fallbackPayload = { ...payload }
  delete fallbackPayload.updated_by_user_id
  delete fallbackPayload.updated_by_display_name
  delete fallbackPayload.key_version
  const fallback = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .upsert([fallbackPayload], { onConflict: 'key_name' })
    .select(selectBase)
    .single()
  if (fallback.error) {
    if (isMissingTableInSchemaCacheError(fallback.error, TEAM_INTEGRATION_KEY_TABLE)) {
      return { data: null, error: fallback.error, missingTable: true }
    }
    return { data: null, error: fallback.error, missingTable: false }
  }
  return { data: { ...(fallback.data || {}), updated_by_display_name: null }, error: null, missingTable: false }
}

async function updateTmdbIntegrationKeyActiveCompat({ isActive, actorUserId, actorDisplayName }, client = supabaseAdmin) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured'), missingTable: false }
  const updatePayload = {
    is_active: !!isActive,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actorUserId || null,
    updated_by_display_name: actorDisplayName || null
  }
  const selectWithMeta = 'key_name,key_last4,is_active,updated_at,updated_by_display_name'
  const selectBase = 'key_name,key_last4,is_active,updated_at'
  const first = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .update(updatePayload)
    .eq('key_name', TMDB_INTEGRATION_KEY_NAME)
    .select(selectWithMeta)
    .maybeSingle()
  if (!first.error) return { data: first.data || null, error: null, missingTable: false }
  if (isMissingTableInSchemaCacheError(first.error, TEAM_INTEGRATION_KEY_TABLE)) {
    return { data: null, error: first.error, missingTable: true }
  }
  if (!isMissingTeamIntegrationCompatColumnError(first.error)) {
    return { data: null, error: first.error, missingTable: false }
  }

  const fallbackUpdatePayload = { ...updatePayload }
  delete fallbackUpdatePayload.updated_by_user_id
  delete fallbackUpdatePayload.updated_by_display_name
  const fallback = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .update(fallbackUpdatePayload)
    .eq('key_name', TMDB_INTEGRATION_KEY_NAME)
    .select(selectBase)
    .maybeSingle()
  if (fallback.error) {
    if (isMissingTableInSchemaCacheError(fallback.error, TEAM_INTEGRATION_KEY_TABLE)) {
      return { data: null, error: fallback.error, missingTable: true }
    }
    return { data: null, error: fallback.error, missingTable: false }
  }
  return { data: fallback.data ? { ...fallback.data, updated_by_display_name: null } : null, error: null, missingTable: false }
}

async function deleteTmdbIntegrationKeyCompat(client = supabaseAdmin) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured'), missingTable: false }
  const result = await client
    .from(TEAM_INTEGRATION_KEY_TABLE)
    .delete()
    .eq('key_name', TMDB_INTEGRATION_KEY_NAME)
    .select('id')
  if (result.error && isMissingTableInSchemaCacheError(result.error, TEAM_INTEGRATION_KEY_TABLE)) {
    return { data: null, error: result.error, missingTable: true }
  }
  return { data: result.data || null, error: result.error || null, missingTable: false }
}

async function resolveTmdbApiKeyContext() {
  const fallbackEnvKey = getServerTmdbApiKey()
  if (!supabaseAdmin) {
    if (fallbackEnvKey) {
      return { apiKey: fallbackEnvKey, keySource: 'env', configured: true, isActive: true, reason: 'env_fallback' }
    }
    return { apiKey: '', keySource: 'none', configured: false, isActive: false, reason: 'not_configured' }
  }

  const lookup = await getTmdbIntegrationKeyRowCompat(supabaseAdmin)
  if (!lookup.error && lookup.data) {
    const row = lookup.data
    if (!row.is_active) {
      return { apiKey: '', keySource: 'table', configured: true, isActive: false, reason: 'inactive' }
    }
    if (!hasProviderKeyEncryptionKey()) {
      return { apiKey: '', keySource: 'table', configured: true, isActive: true, reason: 'encryption_missing' }
    }
    try {
      const decrypted = decryptProviderApiKey(row)
      if (String(decrypted || '').trim()) {
        return { apiKey: String(decrypted || '').trim(), keySource: 'table', configured: true, isActive: true, reason: 'ok' }
      }
      return { apiKey: '', keySource: 'table', configured: true, isActive: true, reason: 'empty_key' }
    } catch (e) {
      return { apiKey: '', keySource: 'table', configured: true, isActive: true, reason: 'decrypt_failed' }
    }
  }

  if (fallbackEnvKey) {
    return { apiKey: fallbackEnvKey, keySource: 'env', configured: true, isActive: true, reason: 'env_fallback' }
  }

  if (lookup.error && !lookup.missingTable) {
    return { apiKey: '', keySource: 'none', configured: false, isActive: false, reason: 'lookup_failed' }
  }
  return { apiKey: '', keySource: 'none', configured: false, isActive: false, reason: 'not_configured' }
}

async function fetchTmdbEnrichmentContext({
  topic = '',
  extraInstruction = '',
  language = '',
  preference = null
} = {}) {
  const pref = normalizeTmdbPreference(preference)
  const enabled = pref.enabled === null ? TMDB_AUTO_ENRICH_ENABLED : !!pref.enabled
  if (!enabled) {
    return {
      enabled,
      used: false,
      reason: 'disabled',
      rules: pref.rules,
      factLocks: pref.factLocks,
      selectedImages: pref.selectedImages
    }
  }

  const topicText = normalizeTmdbText(topic)
  const instructionText = normalizeTmdbText(extraInstruction)
  const combinedIntentText = [topicText, instructionText].filter(Boolean).join(' ')
  const hasIntent = isLikelyMovieTvText(combinedIntentText)
  const query = normalizeTmdbText(pref.query || topicText)
  const languageCode = toTmdbLanguageCode(pref.language || language)
  const region = normalizeTmdbRegionCode(pref.region)
  const mediaType = pref.mediaType || 'multi'
  const prefYear = pref.year || ''

  if (!query && !pref.tmdbId) {
    return {
      enabled,
      used: false,
      reason: 'query_empty',
      rules: pref.rules,
      factLocks: pref.factLocks,
      selectedImages: pref.selectedImages
    }
  }
  if (!pref.query && !pref.tmdbId && !hasIntent) {
    return {
      enabled,
      used: false,
      reason: 'no_intent',
      rules: pref.rules,
      factLocks: pref.factLocks,
      selectedImages: pref.selectedImages
    }
  }

  const keyCtx = await resolveTmdbApiKeyContext()
  if (!keyCtx.apiKey) {
    return {
      enabled,
      used: false,
      reason: keyCtx.reason || 'no_key',
      keySource: keyCtx.keySource || 'none',
      languageCode,
      region,
      rules: pref.rules,
      factLocks: pref.factLocks,
      selectedImages: pref.selectedImages
    }
  }

  const apiKey = keyCtx.apiKey
  let candidate = null
  let bestType = mediaType === 'tv' ? 'tv' : 'movie'
  let detailJson = {}

  if (pref.tmdbId) {
    const detailLookup = await fetchTmdbDetailById({
      apiKey,
      tmdbId: pref.tmdbId,
      mediaType,
      languageCode
    })
    if (!detailLookup.ok || !isPlainObject(detailLookup.detail)) {
      return {
        enabled,
        used: false,
        reason: detailLookup.reason || 'lookup_failed',
        keySource: keyCtx.keySource,
        query,
        tmdbId: pref.tmdbId,
        languageCode,
        region,
        rules: pref.rules,
        factLocks: pref.factLocks,
        selectedImages: pref.selectedImages
      }
    }
    bestType = detailLookup.mediaType === 'tv' ? 'tv' : 'movie'
    detailJson = detailLookup.detail
    candidate = {
      id: pref.tmdbId,
      media_type: bestType,
      title: detailJson.title || detailJson.name || query,
      name: detailJson.name || detailJson.title || query,
      original_title: detailJson.original_title || detailJson.original_name || '',
      original_name: detailJson.original_name || detailJson.original_title || '',
      release_date: detailJson.release_date || detailJson.first_air_date || '',
      first_air_date: detailJson.first_air_date || detailJson.release_date || '',
      vote_average: detailJson.vote_average || 0,
      overview: detailJson.overview || '',
      poster_path: detailJson.poster_path || null
    }
  } else {
    const searchLookup = await searchTmdbCandidates({
      apiKey,
      query,
      mediaType,
      languageCode,
      year: prefYear,
      limit: 20
    })
    if (!searchLookup.ok) {
      return {
        enabled,
        used: false,
        reason: searchLookup.reason || 'lookup_failed',
        keySource: keyCtx.keySource,
        query,
        languageCode,
        region,
        rules: pref.rules,
        factLocks: pref.factLocks,
        selectedImages: pref.selectedImages
      }
    }
    const best = pickTmdbBestResult(
      (searchLookup.candidates || []).map((item) => ({
        id: item.tmdbId,
        media_type: item.mediaType,
        title: item.title,
        name: item.title,
        original_title: item.originalTitle,
        original_name: item.originalTitle,
        release_date: item.releaseDate,
        first_air_date: item.releaseDate,
        vote_average: item.rating,
        overview: item.overview,
        poster_path: item.posterPath || null
      })),
      mediaType
    )
    if (!best?.id) {
      return {
        enabled,
        used: false,
        reason: 'not_found',
        keySource: keyCtx.keySource,
        query,
        languageCode,
        region,
        rules: pref.rules,
        factLocks: pref.factLocks,
        selectedImages: pref.selectedImages
      }
    }
    bestType = String(best.media_type || mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie'
    candidate = best
    const detailLookup = await fetchTmdbDetailById({
      apiKey,
      tmdbId: Number(best.id),
      mediaType: bestType,
      languageCode
    })
    if (detailLookup.ok && isPlainObject(detailLookup.detail)) {
      detailJson = detailLookup.detail
      bestType = detailLookup.mediaType === 'tv' ? 'tv' : 'movie'
    }
  }

  const title = normalizeTmdbText(
    detailJson.title
    || detailJson.name
    || candidate?.title
    || candidate?.name
  )
  const originalTitle = normalizeTmdbText(
    detailJson.original_title
    || detailJson.original_name
    || candidate?.original_title
    || candidate?.original_name
  )
  const releaseDate = normalizeTmdbText(
    detailJson.release_date
    || detailJson.first_air_date
    || candidate?.release_date
    || candidate?.first_air_date
  )
  const releaseYear = /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : ''
  const genres = (
    Array.isArray(detailJson.genres)
      ? detailJson.genres.map((g) => normalizeTmdbText(g?.name || ''))
      : []
  ).filter(Boolean).slice(0, 5)
  const ratingValue = Number(detailJson.vote_average || candidate?.vote_average || 0)
  const rating = Number.isFinite(ratingValue) ? Number(ratingValue.toFixed(1)) : null
  const cast = pickTmdbTopCast(detailJson)
  const directorsOrCreators = pickTmdbDirectorsOrCreators(detailJson, bestType)
  const overview = clipTmdbText(detailJson.overview || candidate?.overview || '', TMDB_OVERVIEW_MAX_CHARS)
  const tagline = normalizeTmdbText(detailJson.tagline || '')
  const keywords = extractTmdbKeywords(detailJson, bestType)
  const certificationId = extractTmdbCertification(detailJson, bestType, region || 'ID')
  const trailer = extractTmdbTrailerUrl(detailJson, languageCode)
  const watchProviders = extractTmdbWatchProviders(detailJson, region || 'ID')
  const runtime = extractTmdbRuntime(detailJson, bestType)
  const productionCompanies = (
    Array.isArray(detailJson?.production_companies)
      ? detailJson.production_companies.map((x) => normalizeTmdbText(x?.name || ''))
      : []
  ).filter(Boolean).slice(0, 12)
  const networks = (
    Array.isArray(detailJson?.networks)
      ? detailJson.networks.map((x) => normalizeTmdbText(x?.name || ''))
      : []
  ).filter(Boolean).slice(0, 12)
  const productionCountriesFromNames = (
    Array.isArray(detailJson?.production_countries)
      ? detailJson.production_countries.map((x) => normalizeTmdbText(x?.name || x?.iso_3166_1 || ''))
      : []
  ).filter(Boolean)
  const productionCountriesFromOrigin = (
    Array.isArray(detailJson?.origin_country)
      ? detailJson.origin_country.map((x) => normalizeTmdbText(x || ''))
      : []
  ).filter(Boolean)
  const productionCountries = Array.from(new Set([
    ...productionCountriesFromNames,
    ...productionCountriesFromOrigin
  ])).slice(0, 12)
  const budgetValue = Number(detailJson?.budget || 0)
  const revenueValue = Number(detailJson?.revenue || 0)
  const budget = Number.isFinite(budgetValue) && budgetValue > 0 ? Math.round(budgetValue) : null
  const revenue = Number.isFinite(revenueValue) && revenueValue > 0 ? Math.round(revenueValue) : null
  const statusText = normalizeTmdbText(detailJson?.status || '')
  const originalLanguage = normalizeTmdbText(detailJson?.original_language || '')
  const tmdbId = Number(detailJson.id || candidate?.id || pref.tmdbId || 0)
  const tmdbUrl = tmdbId > 0 ? `https://www.themoviedb.org/${bestType}/${encodeURIComponent(String(tmdbId))}` : null
  const tvScopeContext = (bestType === 'tv' && tmdbId > 0)
    ? await resolveTmdbTvScopeContext({
        apiKey,
        tmdbId,
        detail: detailJson,
        languageCode,
        preference: pref
      })
    : null
  const seasonCountFromDetail = Number(detailJson?.number_of_seasons || 0)
  const seasonCount = Number.isFinite(seasonCountFromDetail) && seasonCountFromDetail > 0
    ? Math.floor(seasonCountFromDetail)
    : (Number.isFinite(Number(tvScopeContext?.seasonCount)) ? Number(tvScopeContext.seasonCount) : null)
  const episodeCount = Number.isFinite(Number(tvScopeContext?.episodeCount))
    ? Number(tvScopeContext.episodeCount)
    : null
  const episodeType = normalizeTmdbText(tvScopeContext?.episodeType || '').toLowerCase() || null
  const season = isPlainObject(tvScopeContext?.season)
    ? {
        number: Number.isFinite(Number(tvScopeContext.season.number)) ? Number(tvScopeContext.season.number) : null,
        name: normalizeTmdbText(tvScopeContext.season.name || ''),
        airDate: normalizeTmdbText(tvScopeContext.season.airDate || ''),
        overview: clipTmdbText(tvScopeContext.season.overview || '', TMDB_OVERVIEW_MAX_CHARS),
        episodeCount: Number.isFinite(Number(tvScopeContext.season.episodeCount))
          ? Number(tvScopeContext.season.episodeCount)
          : null
      }
    : null
  const episode = isPlainObject(tvScopeContext?.episode)
    ? {
        number: Number.isFinite(Number(tvScopeContext.episode.number)) ? Number(tvScopeContext.episode.number) : null,
        name: normalizeTmdbText(tvScopeContext.episode.name || ''),
        airDate: normalizeTmdbText(tvScopeContext.episode.airDate || ''),
        overview: clipTmdbText(tvScopeContext.episode.overview || '', TMDB_OVERVIEW_MAX_CHARS),
        runtime: Number.isFinite(Number(tvScopeContext.episode.runtime)) ? Number(tvScopeContext.episode.runtime) : null,
        voteAverage: Number.isFinite(Number(tvScopeContext.episode.voteAverage))
          ? Number(tvScopeContext.episode.voteAverage)
          : null,
        episodeType: normalizeTmdbText(tvScopeContext.episode.episodeType || '').toLowerCase() || null
      }
    : null
  const spoilerLevel = TMDB_SPOILER_LEVELS.includes(String(tvScopeContext?.spoilerLevel || pref?.rules?.spoilerLevel || '').toLowerCase())
    ? String(tvScopeContext?.spoilerLevel || pref?.rules?.spoilerLevel || '').toLowerCase()
    : 'light'
  const effectiveRules = {
    factual_only_from_tmdb: pref.rules?.factual_only_from_tmdb !== false,
    no_hallucination: pref.rules?.no_hallucination !== false,
    spoilerLevel
  }

  return {
    enabled,
    used: true,
    reason: 'ok',
    keySource: keyCtx.keySource,
    mediaType: bestType,
    query,
    title: title || query || 'Movie/TV',
    originalTitle: originalTitle || '',
    year: releaseYear,
    releaseDate: releaseDate || '',
    runtime,
    genres,
    rating,
    cast,
    directorsOrCreators,
    overview,
    tagline,
    keywords,
    certificationId,
    trailer,
    watchProviders,
    productionCompanies,
    networks,
    productionCountries,
    budget,
    revenue,
    status: statusText || '',
    originalLanguage: originalLanguage || '',
    tmdbId: tmdbId > 0 ? tmdbId : null,
    tmdbUrl,
    languageCode,
    region: region || null,
    rules: effectiveRules,
    referenceScope: bestType === 'tv'
      ? (tvScopeContext?.referenceScope || 'series')
      : null,
    seasonCount,
    episodeCount,
    episodeType,
    season,
    episode,
    tvContext: tvScopeContext || null,
    factLocks: pref.factLocks,
    selectedImages: pref.selectedImages
  }
}

function isMissingProviderKeyDisplayNameColumnError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  return (
    message.includes('user_display_name') &&
    (message.includes('schema cache') || message.includes('column') || details.includes('column') || hint.includes('column'))
  )
}

function isMissingProviderKeyVersionColumnError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  return (
    message.includes('key_version') &&
    (message.includes('schema cache') || message.includes('column') || details.includes('column') || hint.includes('column'))
  )
}

function isMissingProviderKeyCompatColumnError(error) {
  return isMissingProviderKeyDisplayNameColumnError(error) || isMissingProviderKeyVersionColumnError(error)
}

async function listUserProviderKeyRowsCompat(userId) {
  const selectWithName = 'provider,key_last4,is_active,updated_at,user_display_name'
  const selectBase = 'provider,key_last4,is_active,updated_at'
  const first = await supabaseAdmin
    .from('user_provider_keys')
    .select(selectWithName)
    .eq('user_id', userId)

  if (!first.error) return { data: first.data || [], error: null }
  if (!isMissingProviderKeyDisplayNameColumnError(first.error)) {
    return { data: [], error: first.error }
  }

  const fallback = await supabaseAdmin
    .from('user_provider_keys')
    .select(selectBase)
    .eq('user_id', userId)
  if (fallback.error) return { data: [], error: fallback.error }
  const mapped = (fallback.data || []).map((row) => ({ ...row, user_display_name: null }))
  return { data: mapped, error: null }
}

async function upsertUserProviderKeyCompat(payload, client = supabaseAdmin) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured') }
  const selectWithName = 'provider,key_last4,is_active,updated_at,user_display_name'
  const selectBase = 'provider,key_last4,is_active,updated_at'
  const first = await client
    .from('user_provider_keys')
    .upsert([payload], { onConflict: 'user_id,provider' })
    .select(selectWithName)
    .single()
  if (!first.error) return { data: first.data, error: null }
  if (!isMissingProviderKeyCompatColumnError(first.error)) {
    return { data: null, error: first.error }
  }

  const fallbackPayload = { ...payload }
  delete fallbackPayload.key_version
  delete fallbackPayload.user_display_name
  const fallback = await client
    .from('user_provider_keys')
    .upsert([fallbackPayload], { onConflict: 'user_id,provider' })
    .select(selectBase)
    .single()
  if (fallback.error) return { data: null, error: fallback.error }
  return { data: { ...(fallback.data || {}), user_display_name: null }, error: null }
}

async function updateUserProviderKeyActiveCompat(userId, provider, isActive, client = supabaseAdmin) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured') }
  const selectWithName = 'provider,key_last4,is_active,updated_at,user_display_name'
  const selectBase = 'provider,key_last4,is_active,updated_at'
  const first = await client
    .from('user_provider_keys')
    .update({ is_active: isActive })
    .eq('user_id', userId)
    .eq('provider', provider)
    .select(selectWithName)
    .maybeSingle()
  if (!first.error) return { data: first.data, error: null }
  if (!isMissingProviderKeyDisplayNameColumnError(first.error)) {
    return { data: null, error: first.error }
  }

  const fallback = await client
    .from('user_provider_keys')
    .update({ is_active: isActive })
    .eq('user_id', userId)
    .eq('provider', provider)
    .select(selectBase)
    .maybeSingle()
  if (fallback.error) return { data: null, error: fallback.error }
  return { data: fallback.data ? { ...fallback.data, user_display_name: null } : null, error: null }
}

function isMissingGenerationUserDisplayNameColumnError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  return (
    message.includes('user_display_name')
    && (message.includes('schema cache') || message.includes('column') || details.includes('column') || hint.includes('column'))
  )
}

async function insertGenerationRowCompatOnClient(client, row) {
  if (!client) return { data: null, error: new Error('Supabase client is not configured'), degraded: false }
  const first = await client.from('generations').insert([row]).select('*').maybeSingle()
  if (!first.error) return { data: first.data || null, error: null, degraded: false }
  if (!isMissingGenerationUserDisplayNameColumnError(first.error)) {
    return { data: null, error: first.error, degraded: false }
  }
  const fallbackRow = { ...row }
  delete fallbackRow.user_display_name
  const fallback = await client.from('generations').insert([fallbackRow]).select('*').maybeSingle()
  if (fallback.error) return { data: null, error: fallback.error, degraded: true }
  return { data: fallback.data || null, error: null, degraded: true }
}

function mapGenerationRow(row) {
  if (!isPlainObject(row)) return null
  return {
    id: row.id || null,
    user_id: row.user_id || null,
    user_display_name: row.user_display_name || null,
    topic: row.topic || '',
    platform: row.platform || '',
    provider: row.provider || '',
    result: row.result || null,
    created_at: row.created_at || null
  }
}

function hasOwnKey(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key)
}

function slugifyForBlogger(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96)
}

function buildFallbackBloggerPack({ topic, title }) {
  const fallbackSlug = slugifyForBlogger(topic || title || 'artikel-blogger') || 'artikel-blogger'
  const safeSlug = fallbackSlug.split('-').filter(Boolean).slice(0, 12).join('-') || 'artikel-blogger'
  return {
    slug: safeSlug,
    internalLinks: [
      `/p/${safeSlug}.html`,
      `/p/${safeSlug}-checklist.html`
    ],
    externalReferences: [
      'https://developers.google.com/search/docs/fundamentals/seo-starter-guide'
    ],
    featuredSnippet: `Apa inti topik ${topic || 'ini'}? Fokus pada langkah praktis, struktur rapi, dan jawaban yang langsung menyelesaikan intent pencarian.`
  }
}

function mergeProviderResult(baseResult, providerResult) {
  if (!providerResult) return baseResult
  const platform = String(providerResult.platform || baseResult.platform || '').trim()
  const isBlogger = platform.toLowerCase() === 'blog blogger'
  const runtime = providerResult._providerRuntime && typeof providerResult._providerRuntime === 'object'
    ? providerResult._providerRuntime
    : null
  const mergedAudio = isBlogger
    ? ''
    : (hasOwnKey(providerResult, 'audioRecommendation')
      ? (providerResult.audioRecommendation || baseResult.audioRecommendation)
      : baseResult.audioRecommendation)

  const merged = {
    ...baseResult,
    title: providerResult.title || baseResult.title,
    hook: providerResult.hook || baseResult.hook,
    narrator: providerResult.narrator || baseResult.narrator,
    description: providerResult.description || baseResult.description,
    hashtags: Array.isArray(providerResult.hashtags) && providerResult.hashtags.length
      ? providerResult.hashtags
      : baseResult.hashtags,
    audioRecommendation: mergedAudio,
    meta: {
      ...(baseResult.meta || {}),
      providerCall: 'real',
      providerRequest: runtime
        ? {
            elapsedMs: Number.isFinite(Number(runtime.elapsedMs)) ? Number(runtime.elapsedMs) : null,
            attemptsUsed: Number.isFinite(Number(runtime.attemptsUsed)) ? Number(runtime.attemptsUsed) : 1,
            structuredMode: runtime.structuredMode === null ? null : !!runtime.structuredMode,
            timeoutMs: Number.isFinite(Number(runtime.timeoutMs)) ? Number(runtime.timeoutMs) : null,
            retryCount: Number.isFinite(Number(runtime.retryCount)) ? Number(runtime.retryCount) : null,
            retryBackoffMs: Number.isFinite(Number(runtime.retryBackoffMs)) ? Number(runtime.retryBackoffMs) : null
          }
        : null
    }
  }

  if (isBlogger) {
    const fallbackPack = buildFallbackBloggerPack({
      topic: providerResult.topic || baseResult.topic || baseResult.meta?.topic || '',
      title: merged.title
    })
    merged.slug = String(providerResult.slug || baseResult.slug || fallbackPack.slug).trim() || fallbackPack.slug
    merged.internalLinks = Array.isArray(providerResult.internalLinks) && providerResult.internalLinks.length
      ? providerResult.internalLinks
      : (Array.isArray(baseResult.internalLinks) && baseResult.internalLinks.length ? baseResult.internalLinks : fallbackPack.internalLinks)
    merged.externalReferences = Array.isArray(providerResult.externalReferences) && providerResult.externalReferences.length
      ? providerResult.externalReferences
      : (Array.isArray(baseResult.externalReferences) && baseResult.externalReferences.length ? baseResult.externalReferences : fallbackPack.externalReferences)
    merged.featuredSnippet = String(providerResult.featuredSnippet || baseResult.featuredSnippet || fallbackPack.featuredSnippet).trim()
  }

  return merged
}

function makeGeneratePromptContext(normalizedConfig) {
  const n = normalizedConfig || {}
  const strategyTone = Array.isArray(n.strategy?.emotionTriggers) && n.strategy.emotionTriggers.length
    ? n.strategy.emotionTriggers.join(', ')
    : ''
  return {
    topic: n.topic || n.title || '',
    platform: n.platform || '',
    language: n.language || '',
    tone: n.tone || strategyTone
  }
}

function resolveConstraintsForbiddenWords(normalizedConfig) {
  const words = normalizedConfig?.constraints?.forbiddenWords
  if (!Array.isArray(words)) return []
  return words
    .map((x) => String(x || '').trim())
    .filter(Boolean)
}

function buildQualityContext(genPayload) {
  const normalizedConfig = genPayload?.normalizedConfig || {}
  const promptContext = makeGeneratePromptContext(normalizedConfig)
  const ctaTexts = Array.isArray(normalizedConfig?.cta)
    ? normalizedConfig.cta.map((x) => String(x?.text || '').trim()).filter(Boolean)
    : []
  const keywords = Array.isArray(normalizedConfig?.keywords)
    ? normalizedConfig.keywords.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const goals = Array.isArray(normalizedConfig?.strategy?.goals)
    ? normalizedConfig.strategy.goals.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  return {
    platform: promptContext.platform,
    language: promptContext.language,
    tone: promptContext.tone,
    topic: promptContext.topic,
    contentLength: normalizedConfig?.contentStructure?.length || 'short',
    audioLengthSec: Number(normalizedConfig?.audio?.lengthSec || 0),
    ctaTexts,
    keywords,
    goals,
    targetAudience: String(normalizedConfig?.strategy?.targetAudience || '').trim(),
    constraintsForbiddenWords: resolveConstraintsForbiddenWords(normalizedConfig)
  }
}

function applyQualityToGeneratedResult(result, genPayload) {
  return applyGenerationQualityGuardrails(result, buildQualityContext(genPayload))
}

function mockGenerate(data) {
  const id = uuidv4()
  // data may be legacy form values or normalized payload
  let topic = data.topic
  let platform = data.platform
  let tone = data.tone
  let language = data.language
  if (data.normalizedConfig) {
    const n = data.normalizedConfig
    topic = n.topic || n.title || topic
    platform = n.platform || platform
    const strategyTone = Array.isArray(n.strategy?.emotionTriggers) && n.strategy.emotionTriggers.length
      ? n.strategy.emotionTriggers.join(', ')
      : null
    tone = n.tone || strategyTone || tone
    language = n.language || language
  }
  let title = `${platform} - ${topic} (${tone || ''})`
  if (data.normalizedConfig && data.normalizedConfig.title) {
    title = data.normalizedConfig.title
  }

  // Ensure we have a safe topic string for fallbacks
  const safeTopic = (topic && String(topic).trim()) || 'konten menarik'

  // Prefer explicit values from normalizedConfig if provided
  let hook = data.normalizedConfig?.hook || data.normalizedConfig?.examples?.[0]?.hook || ''
  let narrator = data.normalizedConfig?.narrator || data.normalizedConfig?.script || ''

  // Fallback generated hook/narrator based on language and topic
  if (!hook) hook = language === 'Indonesia' ? `Cek ini: ${safeTopic}!` : `Check this out: ${safeTopic}!`
  if (!narrator) {
    narrator = language === 'Indonesia'
      ? `Halo semuanya, hari ini kita bahas: ${safeTopic}. Jangan lupa follow!`
      : `Hey everyone, today we talk about ${safeTopic}. Don't forget to follow!`
  }
  const description = `${title} - Deskripsi singkat untuk platform ${platform}`
  // Prefer preset-defined hashtags, then payload hashtags, otherwise fallback defaults
  let hashtags = []
  if (data.normalizedConfig) {
    const n = data.normalizedConfig
    if (Array.isArray(n.hashtags) && n.hashtags.length) hashtags = n.hashtags.slice()
    else if (n.seo && Array.isArray(n.seo.hashtags) && n.seo.hashtags.length) hashtags = n.seo.hashtags.slice()
  }
  if (!hashtags.length && Array.isArray(data.hashtags) && data.hashtags.length) hashtags = data.hashtags.slice()
  if (!hashtags.length) hashtags = ['#promo', '#viral', '#content']
  // normalize format and uniqueness
  hashtags = hashtags.map(h => String(h).trim()).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`).filter((v,i,a)=>a.indexOf(v)===i).slice(0,30)
  // Simple audio recommendation logic based on platform
  let audioRecommendation = 'Neutral background music'
  if (platform === 'TikTok') audioRecommendation = 'Energetic pop beat'
  else if (platform === 'YouTube Short') audioRecommendation = 'Upbeat electronic loop'
  else if (platform === 'YouTube Long') audioRecommendation = 'Calm cinematic background'
  else if (platform === 'Instagram Reels') audioRecommendation = 'Trendy beat'
  else if (platform === 'Shopee') audioRecommendation = 'Bright promo jingle'
  else if (platform === 'Tokopedia') audioRecommendation = 'Bright marketplace promo beat'
  else if (platform === 'Lazada') audioRecommendation = 'Fast catchy sales jingle'
  else if (platform === 'Threads') audioRecommendation = 'Minimal lo-fi groove'
  else if (platform === 'WhatsApp Channel') audioRecommendation = 'Warm ambient pulse'
  else if (platform === 'Telegram') audioRecommendation = 'Clean modern synth pad'
  else if (platform === 'LinkedIn') audioRecommendation = 'Professional light corporate bed'
  else if (platform === 'X (Twitter)') audioRecommendation = 'Short punchy trend pulse'
  else if (platform === 'SoundCloud') audioRecommendation = 'Indie electronic groove'
  else if (platform === 'Blog Blogger') audioRecommendation = ''
  const bloggerPack = platform === 'Blog Blogger'
    ? buildFallbackBloggerPack({ topic: safeTopic, title })
    : null
  const imageReferencesMeta = summarizeImageReferences(data.imageReferences)
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter((x) => typeof x === 'string' && x.trim()) : []
  const visionMeta = data.vision && typeof data.vision === 'object' ? data.vision : null
  const tmdbMeta = buildTmdbMeta(data.tmdb)

  // Include provider, model and language in meta so frontend can display badges
  // Expect compiled prompt to be provided by caller in data.prompt (server compiles once)
  const finalPrompt = data.prompt || ''
  return {
    id,
    title,
    hook,
    narrator,
    description,
    hashtags,
    audioRecommendation,
    ...(bloggerPack
      ? {
          slug: bloggerPack.slug,
          internalLinks: bloggerPack.internalLinks,
          externalReferences: bloggerPack.externalReferences,
          featuredSnippet: bloggerPack.featuredSnippet
        }
      : {}),
    prompt: finalPrompt,
    platform,
    meta: {
      provider: data.provider,
      model: data.model,
      keySource: data.keySource || 'server_fallback',
      providerCall: 'mock',
      language: data.language || language || null,
      tone: tone || null,
      platform,
      imageReferencesCount: imageReferencesMeta.length,
      imageReferences: imageReferencesMeta,
      warnings,
      vision: visionMeta,
      tmdb: tmdbMeta
    }
  }
}

app.get(['/api/auth/signup-policy', '/api/public/signup-policy'], async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    if (isAuthAllowlistMisconfigured()) {
      return sendError(res, 503, 'MISCONFIGURED', 'Auth email allowlist is enabled but AUTH_ALLOWED_EMAILS is empty')
    }

    const { data: profileRows, error } = await supabaseAdmin.from('profiles').select('id,email')
    if (error) {
      return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read signup policy')
    }
    const rows = Array.isArray(profileRows) ? profileRows : []
    const currentUsers = ENFORCE_AUTH_EMAIL_ALLOWLIST
      ? rows.filter((row) => AUTH_ALLOWED_EMAILS.has(normalizeEmail(row?.email))).length
      : rows.length
    const maxUsers = getEffectiveSignupMaxUsers()
    const remaining = Math.max(maxUsers - currentUsers, 0)
    return sendOk(res, {
      maxUsers,
      currentUsers,
      remaining,
      signupOpen: ENABLE_PUBLIC_SIGNUP && remaining > 0,
      publicSignupEnabled: ENABLE_PUBLIC_SIGNUP,
      allowlistEnabled: ENFORCE_AUTH_EMAIL_ALLOWLIST,
      allowlistConfigured: AUTH_ALLOWED_EMAILS.size > 0,
      allowlistCount: AUTH_ALLOWED_EMAILS.size
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read signup policy')
  }
})

app.post(['/api/auth/sign-up', '/api/public/sign-up'], async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    if (!ENABLE_PUBLIC_SIGNUP) {
      return sendError(res, 403, 'SIGNUP_DISABLED', 'Pendaftaran akun dinonaktifkan. Hubungi owner untuk invite/manual account.')
    }

    const { email, password } = req.body || {}
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid email format')
    }
    const emailPolicy = evaluateAuthEmailPolicy(normalizedEmail)
    if (!emailPolicy.ok) {
      return sendError(
        res,
        Number(emailPolicy.status || 400),
        emailPolicy.code || 'VALIDATION_ERROR',
        emailPolicy.message || 'Email policy validation failed'
      )
    }
    if (!isStrongEnoughPassword(password)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Password must be at least 8 characters')
    }

    const { data: profileRows, error: countErr } = await supabaseAdmin.from('profiles').select('id,email')
    if (countErr) {
      return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to validate signup limit')
    }
    const rows = Array.isArray(profileRows) ? profileRows : []
    const currentUsers = ENFORCE_AUTH_EMAIL_ALLOWLIST
      ? rows.filter((row) => AUTH_ALLOWED_EMAILS.has(normalizeEmail(row?.email))).length
      : rows.length
    const maxUsers = getEffectiveSignupMaxUsers()

    if (currentUsers >= maxUsers) {
      return sendError(res, 409, 'LIMIT_REACHED', `Registration limit reached (maximum ${maxUsers} users)`)
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: false
    })
    if (createErr) {
      return sendError(res, 400, 'AUTH_ERROR', createErr.message || 'Failed to create user')
    }

    try {
      if (created?.user?.id) {
        const profileRow = { id: created.user.id, email: created.user.email }
        await supabaseAdmin.from('profiles').upsert([profileRow])
        await replicateMutationToMirror('profiles.sign-up-upsert', async (mirrorClient) => {
          return mirrorClient.from('profiles').upsert([profileRow]).select('id').maybeSingle()
        })
      }
    } catch (e) {
      // Non-fatal bookkeeping failure.
    }

    return sendOk(res, {
      userId: created?.user?.id || null,
      email: created?.user?.email || normalizedEmail,
      requiresEmailConfirmation: true
    }, 201)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to sign up user')
  }
})

app.get(['/api/auth/session-access', '/api/session-access'], requireAuthenticatedUser, async (req, res) => {
  const email = resolveAuthUserEmail(req.authUser)
  return sendOk(res, {
    allowed: true,
    userId: req.authUser?.id || null,
    email: email || null
  })
})

app.get('/api/settings/supabase-profile', requireAuthenticatedUser, async (req, res) => {
  try {
    const status = buildSupabaseProfileStatus()
    return sendOk(res, status)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read Supabase profile status')
  }
})

app.get('/api/settings/security-posture', requireAuthenticatedUser, async (req, res) => {
  try {
    const rotation = computeServiceRoleRotationStatus()
    const posture = {
      serviceRoleConfigured: !isPlaceholderEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
      providerKeyEncryptionConfigured: hasProviderKeyEncryptionKey(),
      strictSecretEnvGuard: STRICT_SECRET_ENV_GUARD,
      leakedServiceRoleEnvKeys: LEAKED_SERVICE_ROLE_ENV_KEYS,
      requireAuthForSensitiveEndpoints: REQUIRE_AUTH_FOR_SENSITIVE_ENDPOINTS,
      publicSignupEnabled: ENABLE_PUBLIC_SIGNUP,
      allowlistEnabled: ENFORCE_AUTH_EMAIL_ALLOWLIST,
      allowlistCount: AUTH_ALLOWED_EMAILS.size,
      corsAllowAllOrigins: CORS_ALLOW_ALL_ORIGINS,
      corsAllowedOrigins: Array.from(CORS_EFFECTIVE_ALLOWED_ORIGINS),
      serviceRoleRotation: rotation
    }
    return sendOk(res, posture)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read security posture')
  }
})

app.post('/api/settings/supabase-profile/switch', requireAuthenticatedUser, async (req, res) => {
  try {
    const profile = String(req.body?.profile || '').trim().toLowerCase()
    if (!profile) return sendError(res, 400, 'VALIDATION_ERROR', 'profile is required')
    const switched = await switchSupabaseProfile(profile)
    if (!switched.ok) {
      const status = Number(switched.status || 500)
      const code = status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'
      return sendError(res, status, code, switched.message || 'Failed to switch Supabase profile')
    }
    return sendOk(res, {
      ...switched.data,
      status: buildSupabaseProfileStatus(),
      note: 'Profile switched. Frontend akan reload untuk menerapkan Supabase runtime baru.'
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to switch Supabase profile')
  }
})

app.post('/api/generations/save', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const payload = isPlainObject(req.body) ? req.body : {}
    const rawEntry = isPlainObject(payload.entry) ? payload.entry : payload
    const fallbackTopic = String(rawEntry?.result?.title || rawEntry?.result?.topic || '').trim()
    const topic = String(rawEntry.topic || fallbackTopic || '').trim()
    const platform = String(rawEntry.platform || rawEntry?.result?.platform || '').trim()
    const provider = String(rawEntry.provider || rawEntry?.result?.meta?.provider || '').trim()
    const result = rawEntry.result
    const createdAtRaw = String(rawEntry.created_at || '').trim()
    const createdAt = createdAtRaw && Number.isFinite(Date.parse(createdAtRaw))
      ? new Date(createdAtRaw).toISOString()
      : new Date().toISOString()

    if (!isPlainObject(result) && !Array.isArray(result) && typeof result !== 'string') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'result is required')
    }

    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const row = {
      user_id: req.authUser.id,
      user_display_name: String(rawEntry.user_display_name || actorDisplayName || '').trim() || null,
      topic: (topic || 'Untitled').slice(0, 600),
      platform: (platform || 'unknown').slice(0, 120),
      provider: (provider || 'unknown').slice(0, 120),
      result: result ?? null,
      created_at: createdAt
    }

    const primary = await insertGenerationRowCompatOnClient(supabaseAdmin, row)
    if (primary.error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to save generation: ${sanitizeSupabaseError(primary.error)}`)
    }

    const mirror = await replicateMutationToMirror('generations.save', async (mirrorClient) => {
      return insertGenerationRowCompatOnClient(mirrorClient, row)
    })

    return sendOk(res, {
      row: mapGenerationRow(primary.data || row),
      degraded: !!primary.degraded,
      mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    }, 201)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save generation')
  }
})

app.get('/api/settings/provider-keys', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }

    const userId = req.authUser?.id
    const { data, error } = await listUserProviderKeyRowsCompat(userId)

    if (error) {
      return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read provider keys')
    }

    const byProvider = new Map((data || []).map((row) => [row.provider, row]))
    const out = SUPPORTED_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider)
      if (!row) {
        return { provider, configured: false, keyLast4: null, isActive: false, updatedAt: null, userDisplayName: null }
      }
      return mapProviderKeyRow(row)
    })

    return sendOk(res, out)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read provider keys')
  }
})

app.post('/api/settings/provider-keys', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    if (!hasProviderKeyEncryptionKey()) {
      return sendError(res, 503, 'MISCONFIGURED', 'Provider key encryption is not configured')
    }

    const provider = normalizeProvider(req.body?.provider)
    const apiKey = String(req.body?.apiKey || '').trim()
    const isActive = req.body?.isActive !== false

    if (!provider) return sendError(res, 400, 'VALIDATION_ERROR', 'provider is required')
    if (!isSupportedProvider(provider)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'provider is not supported')
    }
    if (!apiKey) return sendError(res, 400, 'VALIDATION_ERROR', 'apiKey is required')
    if (apiKey.length < 16 || apiKey.length > 512) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'apiKey length is invalid')
    }

    const encrypted = encryptProviderApiKey(apiKey)
    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const payload = {
      user_id: req.authUser.id,
      provider,
      ...encrypted,
      key_version: 1,
      key_last4: apiKey.slice(-4),
      is_active: !!isActive,
      user_display_name: actorDisplayName
    }

    const { data, error } = await upsertUserProviderKeyCompat(payload, supabaseAdmin)

    if (error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to save provider key: ${sanitizeSupabaseError(error)}`)
    }

    const mirror = await replicateMutationToMirror('provider-keys.upsert', async (mirrorClient) => {
      return upsertUserProviderKeyCompat(payload, mirrorClient)
    })

    return sendOk(res, {
      ...mapProviderKeyRow(data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save provider key')
  }
})

app.patch('/api/settings/provider-keys/:provider/active', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const provider = normalizeProvider(req.params.provider)
    const isActive = req.body?.isActive

    if (!provider) return sendError(res, 400, 'VALIDATION_ERROR', 'provider is required')
    if (!isSupportedProvider(provider)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'provider is not supported')
    }
    if (typeof isActive !== 'boolean') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'isActive must be boolean')
    }

    const { data, error } = await updateUserProviderKeyActiveCompat(req.authUser.id, provider, isActive, supabaseAdmin)

    if (error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to update provider key: ${sanitizeSupabaseError(error)}`)
    }
    if (!data) {
      return sendError(res, 404, 'NOT_FOUND', 'Provider key not found')
    }

    const mirror = await replicateMutationToMirror('provider-keys.update-active', async (mirrorClient) => {
      return updateUserProviderKeyActiveCompat(req.authUser.id, provider, isActive, mirrorClient)
    })

    return sendOk(res, {
      ...mapProviderKeyRow(data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update provider key')
  }
})

app.delete('/api/settings/provider-keys/:provider', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const provider = normalizeProvider(req.params.provider)
    if (!provider) return sendError(res, 400, 'VALIDATION_ERROR', 'provider is required')
    if (!isSupportedProvider(provider)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'provider is not supported')
    }

    const { data, error } = await supabaseAdmin
      .from('user_provider_keys')
      .delete()
      .eq('user_id', req.authUser.id)
      .eq('provider', provider)
      .select('id')

    if (error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to delete provider key: ${sanitizeSupabaseError(error)}`)
    }

    const mirror = await replicateMutationToMirror('provider-keys.delete', async (mirrorClient) => {
      return mirrorClient
        .from('user_provider_keys')
        .delete()
        .eq('user_id', req.authUser.id)
        .eq('provider', provider)
        .select('id')
    })

    return sendOk(res, {
      provider,
      deleted: Array.isArray(data) ? data.length > 0 : false,
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete provider key')
  }
})

app.post('/api/settings/provider-keys/:provider/test', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }

    const provider = normalizeProvider(req.params.provider)
    const freeOnly = req.body?.freeOnly !== false

    if (!provider) return sendError(res, 400, 'VALIDATION_ERROR', 'provider is required')
    if (!isSupportedProvider(provider)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'provider is not supported')
    }
    const requestedLimit = Number(req.body?.limit)
    const defaultLimit = provider === 'OpenRouter' ? 400 : 100
    const maxAllowed = provider === 'OpenRouter' ? 500 : 200
    const maxModels = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit, maxAllowed)
    )

    const row = await getUserProviderKeyRow(req.authUser.id, provider)
    let apiKey = ''
    let keySource = 'user'
    let configured = false
    let isActive = false

    if (row) {
      if (!hasProviderKeyEncryptionKey()) {
        return sendError(res, 503, 'MISCONFIGURED', 'Provider key encryption is not configured')
      }
      try {
        apiKey = decryptProviderApiKey(row)
      } catch (e) {
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to decrypt provider key')
      }
      configured = true
      isActive = !!row.is_active
      keySource = 'user'
    } else {
      const serverApiKey = getServerProviderApiKey(provider)
      if (!serverApiKey) return sendError(res, 404, 'NOT_FOUND', 'Provider key not found')
      if (!ALLOW_SERVER_PROVIDER_KEY_FALLBACK) {
        return sendError(res, 400, 'KEY_NOT_CONFIGURED', `Provider key for ${provider} is not configured`)
      }
      apiKey = serverApiKey
      configured = false
      isActive = false
      keySource = 'server_fallback'
    }

    try {
      const detected = await detectProviderModels({ provider, apiKey, freeOnly })
      const models = Array.isArray(detected.models) ? detected.models.slice(0, maxModels) : []
      return sendOk(res, {
        provider,
        configured,
        isActive,
        keySource,
        source: detected.source,
        freeOnlyRequested: !!freeOnly,
        freeFilterApplied: !!detected.freeFilterApplied,
        count: models.length,
        models
      })
    } catch (providerErr) {
      return sendError(res, 502, 'PROVIDER_API_ERROR', providerErr?.message || 'Failed to fetch provider models')
    }
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to test provider key')
  }
})

app.get('/api/settings/tmdb-key', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }

    const lookup = await getTmdbIntegrationKeyRowCompat(supabaseAdmin)
    if (lookup.error && lookup.missingTable) {
      return sendError(res, 503, 'MISCONFIGURED', buildTmdbIntegrationMissingTableMessage())
    }
    if (lookup.error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read TMDB key: ${sanitizeSupabaseError(lookup.error)}`)
    }

    if (lookup.data) {
      return sendOk(res, mapTmdbIntegrationKeyRow(lookup.data))
    }

    const envFallback = buildTmdbIntegrationEnvFallbackStatus()
    if (envFallback) return sendOk(res, envFallback)
    return sendOk(res, {
      keyName: TMDB_INTEGRATION_KEY_NAME,
      configured: false,
      keyLast4: null,
      isActive: false,
      updatedAt: null,
      updatedByDisplayName: null,
      keySource: 'none'
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read TMDB key')
  }
})

app.post('/api/settings/tmdb-key', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    if (!hasProviderKeyEncryptionKey()) {
      return sendError(res, 503, 'MISCONFIGURED', 'Provider key encryption is not configured')
    }

    const apiKey = String(req.body?.apiKey || '').trim()
    const isActive = req.body?.isActive !== false
    if (!apiKey) return sendError(res, 400, 'VALIDATION_ERROR', 'apiKey is required')
    if (apiKey.length < 16 || apiKey.length > 512) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'apiKey length is invalid')
    }

    const encrypted = encryptProviderApiKey(apiKey)
    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const payload = {
      key_name: TMDB_INTEGRATION_KEY_NAME,
      ...encrypted,
      key_version: 1,
      key_last4: apiKey.slice(-4),
      is_active: !!isActive,
      updated_by_user_id: req.authUser.id,
      updated_by_display_name: actorDisplayName,
      updated_at: new Date().toISOString()
    }

    const primary = await upsertTmdbIntegrationKeyCompat(payload, supabaseAdmin)
    if (primary.error && primary.missingTable) {
      return sendError(res, 503, 'MISCONFIGURED', buildTmdbIntegrationMissingTableMessage())
    }
    if (primary.error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to save TMDB key: ${sanitizeSupabaseError(primary.error)}`)
    }

    const mirror = await replicateMutationToMirror('tmdb-key.upsert', async (mirrorClient) => {
      return upsertTmdbIntegrationKeyCompat(payload, mirrorClient)
    })

    return sendOk(res, {
      ...(mapTmdbIntegrationKeyRow(primary.data) || {
        keyName: TMDB_INTEGRATION_KEY_NAME,
        configured: true,
        keyLast4: apiKey.slice(-4),
        isActive: !!isActive,
        updatedAt: payload.updated_at,
        updatedByDisplayName: actorDisplayName,
        keySource: 'table'
      }),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save TMDB key')
  }
})

app.patch('/api/settings/tmdb-key/active', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const isActive = req.body?.isActive
    if (typeof isActive !== 'boolean') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'isActive must be boolean')
    }

    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const primary = await updateTmdbIntegrationKeyActiveCompat({
      isActive,
      actorUserId: req.authUser.id,
      actorDisplayName
    }, supabaseAdmin)
    if (primary.error && primary.missingTable) {
      return sendError(res, 503, 'MISCONFIGURED', buildTmdbIntegrationMissingTableMessage())
    }
    if (primary.error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to update TMDB key: ${sanitizeSupabaseError(primary.error)}`)
    }
    if (!primary.data) {
      return sendError(res, 404, 'NOT_FOUND', 'TMDB key not found')
    }

    const mirror = await replicateMutationToMirror('tmdb-key.update-active', async (mirrorClient) => {
      return updateTmdbIntegrationKeyActiveCompat({
        isActive,
        actorUserId: req.authUser.id,
        actorDisplayName
      }, mirrorClient)
    })

    return sendOk(res, {
      ...mapTmdbIntegrationKeyRow(primary.data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update TMDB key')
  }
})

app.delete('/api/settings/tmdb-key', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }

    const primary = await deleteTmdbIntegrationKeyCompat(supabaseAdmin)
    if (primary.error && primary.missingTable) {
      return sendError(res, 503, 'MISCONFIGURED', buildTmdbIntegrationMissingTableMessage())
    }
    if (primary.error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to delete TMDB key: ${sanitizeSupabaseError(primary.error)}`)
    }

    const mirror = await replicateMutationToMirror('tmdb-key.delete', async (mirrorClient) => {
      return deleteTmdbIntegrationKeyCompat(mirrorClient)
    })

    return sendOk(res, {
      keyName: TMDB_INTEGRATION_KEY_NAME,
      deleted: Array.isArray(primary.data) ? primary.data.length > 0 : false,
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete TMDB key')
  }
})

app.post('/api/settings/tmdb-key/test', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const lookup = await getTmdbIntegrationKeyRowCompat(supabaseAdmin)
    if (lookup.error && lookup.missingTable) {
      return sendError(res, 503, 'MISCONFIGURED', buildTmdbIntegrationMissingTableMessage())
    }
    if (lookup.error) {
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read TMDB key: ${sanitizeSupabaseError(lookup.error)}`)
    }

    let apiKey = ''
    let keySource = 'none'
    let configured = false
    let isActive = false

    if (lookup.data) {
      if (!hasProviderKeyEncryptionKey()) {
        return sendError(res, 503, 'MISCONFIGURED', 'Provider key encryption is not configured')
      }
      try {
        apiKey = decryptProviderApiKey(lookup.data)
      } catch (e) {
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to decrypt TMDB key')
      }
      keySource = 'table'
      configured = true
      isActive = !!lookup.data.is_active
    } else {
      const envKey = getServerTmdbApiKey()
      if (!envKey) return sendError(res, 404, 'NOT_FOUND', 'TMDB key not found')
      apiKey = envKey
      keySource = 'env'
      configured = true
      isActive = true
    }

    const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
    const rawBody = await response.text()
    let parsed = {}
    try {
      parsed = rawBody ? JSON.parse(rawBody) : {}
    } catch (e) {}

    if (!response.ok) {
      const errMessage = String(
        parsed?.status_message
        || parsed?.statusMessage
        || `TMDB API error (${response.status})`
      ).trim() || 'TMDB API error'
      return sendError(res, 502, 'TMDB_API_ERROR', errMessage, { status: response.status, keySource })
    }

    return sendOk(res, {
      configured,
      isActive,
      keySource,
      statusCode: response.status,
      imagesSecureBaseUrl: parsed?.images?.secure_base_url || parsed?.images?.base_url || null,
      posterSizes: Array.isArray(parsed?.images?.poster_sizes) ? parsed.images.poster_sizes.slice(0, 8) : []
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to test TMDB key')
  }
})

app.post('/api/tmdb/search', sensitiveAuthMiddleware, async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {}
    const pref = normalizeTmdbPreference(body)
    const query = normalizeTmdbText(pref.query || body.title || '')
    if (!query) return sendError(res, 400, 'VALIDATION_ERROR', 'query is required')

    const limitRaw = Number(body.limit)
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 14, 20))
    const pageRaw = Number(body.page)
    const page = Math.max(1, Math.min(Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 1, TMDB_BROWSE_MAX_PAGE))
    const languageCode = toTmdbLanguageCode(pref.language || body.language || 'en-US')
    const region = normalizeTmdbRegionCode(pref.region || body.region || '')
    const mediaType = pref.mediaType || 'multi'
    const year = pref.year || ''

    const keyCtx = await resolveTmdbApiKeyContext()
    if (!keyCtx.apiKey) {
      return sendError(
        res,
        400,
        'KEY_NOT_CONFIGURED',
        'TMDB key belum dikonfigurasi. Atur dulu di Settings.',
        { reason: keyCtx.reason || 'no_key', keySource: keyCtx.keySource || 'none' }
      )
    }

    const found = await searchTmdbCandidates({
      apiKey: keyCtx.apiKey,
      query,
      mediaType,
      languageCode,
      year,
      page,
      limit
    })
    if (!found.ok) {
      return sendError(res, 502, 'TMDB_API_ERROR', 'Gagal mencari data TMDB', {
        reason: found.reason || 'lookup_failed',
        status: found.status || null
      })
    }

    return sendOk(res, {
      query,
      mediaType,
      year: year || null,
      page: Number.isFinite(Number(found.page)) ? Number(found.page) : page,
      totalPages: Number.isFinite(Number(found.totalPages)) ? Number(found.totalPages) : 1,
      totalResults: Number.isFinite(Number(found.totalResults)) ? Number(found.totalResults) : 0,
      maxPage: Number.isFinite(Number(found.maxPage)) ? Number(found.maxPage) : TMDB_BROWSE_MAX_PAGE,
      languageCode,
      region: region || null,
      keySource: keyCtx.keySource || 'none',
      count: Array.isArray(found.candidates) ? found.candidates.length : 0,
      candidates: Array.isArray(found.candidates) ? found.candidates : []
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to search TMDB')
  }
})

app.post('/api/tmdb/browse', sensitiveAuthMiddleware, async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {}
    const mediaType = normalizeTmdbBrowseMediaType(body.mediaType || body.entityType || 'movie')
    const category = normalizeTmdbBrowseCategory(mediaType, body.category || 'popular')
    const limitRaw = Number(body.limit)
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 12, 20))
    const pageRaw = Number(body.page)
    const page = Math.max(1, Math.min(Number.isFinite(pageRaw) ? pageRaw : 1, TMDB_BROWSE_MAX_PAGE))
    const languageCode = toTmdbLanguageCode(body.language || body.languageCode || 'en-US')
    const region = normalizeTmdbRegionCode(body.region || body.regionCode || '')

    const keyCtx = await resolveTmdbApiKeyContext()
    if (!keyCtx.apiKey) {
      return sendError(
        res,
        400,
        'KEY_NOT_CONFIGURED',
        'TMDB key belum dikonfigurasi. Atur dulu di Settings.',
        { reason: keyCtx.reason || 'no_key', keySource: keyCtx.keySource || 'none' }
      )
    }

    const found = await browseTmdbByCategory({
      apiKey: keyCtx.apiKey,
      mediaType,
      category,
      languageCode,
      region,
      page,
      limit
    })
    if (!found.ok) {
      return sendError(res, 502, 'TMDB_API_ERROR', 'Gagal memuat kategori TMDB', {
        reason: found.reason || 'lookup_failed',
        status: found.status || null
      })
    }

    return sendOk(res, {
      mediaType: found.mediaType || mediaType,
      category: found.category || category,
      endpointCategory: found.endpointCategory || null,
      page: Number.isFinite(Number(found.page)) ? Number(found.page) : page,
      totalPages: Number.isFinite(Number(found.totalPages)) ? Number(found.totalPages) : 1,
      totalResults: Number.isFinite(Number(found.totalResults)) ? Number(found.totalResults) : 0,
      maxPage: Number.isFinite(Number(found.maxPage)) ? Number(found.maxPage) : TMDB_BROWSE_MAX_PAGE,
      languageCode,
      region: region || null,
      keySource: keyCtx.keySource || 'none',
      count: Array.isArray(found.candidates) ? found.candidates.length : 0,
      candidates: Array.isArray(found.candidates) ? found.candidates : []
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to browse TMDB category')
  }
})

app.post('/api/tmdb/detail', sensitiveAuthMiddleware, async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {}
    const pref = normalizeTmdbPreference(body)
    const tmdbId = Number(pref.tmdbId || body.tmdbId || body.id || 0)
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'tmdbId is required')
    }

    const mediaType = pref.mediaType || 'multi'
    const region = normalizeTmdbRegionCode(pref.region || body.region || '') || 'ID'
    const languageCode = toTmdbLanguageCode(pref.language || body.language || 'en-US')

    const keyCtx = await resolveTmdbApiKeyContext()
    if (!keyCtx.apiKey) {
      return sendError(
        res,
        400,
        'KEY_NOT_CONFIGURED',
        'TMDB key belum dikonfigurasi. Atur dulu di Settings.',
        { reason: keyCtx.reason || 'no_key', keySource: keyCtx.keySource || 'none' }
      )
    }

    const detailLookup = await fetchTmdbDetailById({
      apiKey: keyCtx.apiKey,
      tmdbId,
      mediaType,
      languageCode
    })
    if (!detailLookup.ok || !isPlainObject(detailLookup.detail)) {
      return sendError(res, 404, 'NOT_FOUND', 'Detail TMDB tidak ditemukan')
    }

    const payload = buildTmdbDetailPayload(detailLookup.detail, detailLookup.mediaType, {
      region,
      languageCode
    })
    payload.rules = {
      ...(isPlainObject(payload.rules) ? payload.rules : {}),
      factual_only_from_tmdb: pref.rules?.factual_only_from_tmdb !== false,
      no_hallucination: pref.rules?.no_hallucination !== false,
      spoilerLevel: TMDB_SPOILER_LEVELS.includes(String(pref?.rules?.spoilerLevel || '').toLowerCase())
        ? String(pref.rules.spoilerLevel).toLowerCase()
        : 'light'
    }
    if (String(payload.entityType || '').trim().toLowerCase() === 'tv') {
      const tvContext = await resolveTmdbTvScopeContext({
        apiKey: keyCtx.apiKey,
        tmdbId,
        detail: detailLookup.detail,
        languageCode,
        preference: pref
      })
      if (tvContext) {
        payload.tvContext = tvContext
        payload.rules.spoilerLevel = tvContext.spoilerLevel || payload.rules.spoilerLevel || 'light'
        payload.movieOrTv = {
          ...(isPlainObject(payload.movieOrTv) ? payload.movieOrTv : {}),
          reference_scope: tvContext.referenceScope || 'series',
          season_count: Number.isFinite(Number(tvContext.seasonCount))
            ? Number(tvContext.seasonCount)
            : (Number.isFinite(Number(payload?.movieOrTv?.season_count)) ? Number(payload.movieOrTv.season_count) : null),
          episode_count: Number.isFinite(Number(tvContext.episodeCount)) ? Number(tvContext.episodeCount) : null,
          episode_type: tvContext.episodeType || null,
          season_overview: tvContext?.season?.overview || '',
          episode_overview: tvContext?.episode?.overview || ''
        }
        const tvExtraImageOptions = buildTmdbTvExtraImageOptions(detailLookup.detail, tvContext)
        if (tvExtraImageOptions.length) {
          payload.imageOptions = appendUniqueTmdbImageOptions(payload.imageOptions, tvExtraImageOptions)
        }
      }
    }

    return sendOk(res, {
      ...payload,
      debug: {
        keySource: keyCtx.keySource || 'none',
        timestamp: new Date().toISOString(),
        languageCode,
        region
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read TMDB detail')
  }
})

app.post('/api/history/user-display-names', sensitiveAuthMiddleware, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const payload = isPlainObject(req.body) ? req.body : {}
    const rawIds = Array.isArray(payload.userIds) ? payload.userIds : []
    const userIds = Array.from(new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 500)
    if (!userIds.length) return sendOk(res, {})
    const displayNameMap = await getProfileDisplayNameMapByUserIds(userIds)
    return sendOk(res, displayNameMap)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to resolve history display names')
  }
})

app.post('/api/generate', sensitiveAuthMiddleware, async (req, res) => {
  try {
    const payload = req.body || {}
    const mode = payload.mode || (payload.presetId ? 'preset' : 'manual')
    const provider = payload.provider || null
    const model = payload.model || null
    let override = payload.override
    let extraInstruction = String(payload.extraInstruction || '').trim()
    const tmdbPreference = normalizeTmdbPreference(payload.tmdb)
    const imageRefsResult = sanitizeImageReferences(payload.imageReferences)

    if (!['manual', 'preset'].includes(mode)) {
      return sendError(res, 400, 'BAD_REQUEST', 'mode must be either manual or preset')
    }
    if (override !== undefined && !isPlainObject(override)) {
      return sendError(res, 400, 'BAD_REQUEST', 'override must be an object')
    }
    if (imageRefsResult.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', imageRefsResult.error, imageRefsResult.details)
    }
    const mergedImageRefs = mergeUniqueImageReferences(
      imageRefsResult.data,
      tmdbPreference.selectedImages,
      MAX_IMAGE_REFERENCES
    )
    const mergedImageRefsResult = sanitizeImageReferences(mergedImageRefs)
    if (mergedImageRefsResult.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', mergedImageRefsResult.error, mergedImageRefsResult.details)
    }
    const imageReferences = mergedImageRefsResult.data
    if (provider && !isSupportedProvider(provider)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'provider is not supported')
    }
    const visionRouting = buildVisionRoutingContext({ provider, model, imageReferences })
    if (!visionRouting.ok) {
      return sendError(
        res,
        400,
        visionRouting.error.code || 'VALIDATION_ERROR',
        visionRouting.error.message || 'Validation failed',
        visionRouting.error.details
      )
    }
    const providerContext = await resolveGenerateKeySource(req, provider)
    if (provider && providerContext.keySource === 'not_configured') {
      return sendError(res, 400, 'KEY_NOT_CONFIGURED', `Provider key for ${provider} is not configured`)
    }

    async function generateUsingProviderOrMock(genPayload) {
      const baseResult = mockGenerate(genPayload)
      if (!ENABLE_REAL_PROVIDER_CALLS || !provider || !providerContext.providerApiKey) {
        return applyQualityToGeneratedResult(baseResult, genPayload)
      }

      try {
        const promptContext = makeGeneratePromptContext(genPayload.normalizedConfig)
        const providerResult = await generateStructuredWithProvider({
          provider,
          model,
          apiKey: providerContext.providerApiKey,
          prompt: genPayload.prompt,
          platform: promptContext.platform,
          topic: promptContext.topic,
          language: promptContext.language,
          imageReferences: genPayload.vision?.mode === 'multimodal' ? genPayload.imageReferences : [],
          fallback: {
            title: baseResult.title,
            hook: baseResult.hook,
            narrator: baseResult.narrator,
            description: baseResult.description,
            hashtags: baseResult.hashtags,
            audioRecommendation: baseResult.audioRecommendation,
            slug: baseResult.slug,
            internalLinks: baseResult.internalLinks,
            externalReferences: baseResult.externalReferences,
            featuredSnippet: baseResult.featuredSnippet
          }
        })
        const merged = mergeProviderResult(baseResult, providerResult)
        return applyQualityToGeneratedResult(merged, genPayload)
      } catch (e) {
        if (ALLOW_MOCK_FALLBACK_ON_PROVIDER_ERROR) {
          const fallbackResult = {
            ...baseResult,
            meta: {
              ...(baseResult.meta || {}),
              providerCall: 'mock_fallback',
              providerError: String(e?.message || e || 'Provider call failed').slice(0, 180)
            }
          }
          return applyQualityToGeneratedResult(fallbackResult, genPayload)
        }
        const providerDetails = isPlainObject(e?.details) ? e.details : {}
        const providerErr = new Error(`Provider generation failed: ${e?.message || e || 'Unknown error'}`)
        providerErr.code = 'PROVIDER_API_ERROR'
        providerErr.details = {
          providerCode: String(e?.code || '').trim() || 'PROVIDER_API_ERROR',
          classification: String(e?.classification || providerDetails.classification || '').trim() || null,
          retryable: e?.retryable === true || providerDetails.retryable === true,
          status: Number(providerDetails.status || 0) || null,
          provider: provider || null,
          model: model || null
        }
        throw providerErr
      }
    }

    if (mode === 'preset') {
      const presetId = payload.presetId
      if (!presetId) return sendError(res, 400, 'BAD_REQUEST', 'presetId is required for preset mode')
      const authUser = await resolveOptionalAuthenticatedUser(req)
      const presetRaw = await loadPresetById(presetId, authUser?.id || '')
      if (!presetRaw) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

      let normalized = normalizePreset(presetRaw)
      // Backward compatibility: some clients used topic in preset payload.
      // Canonical preset schema has no top-level topic, so fold any topic-ish input
      // into extraInstruction and remove it from override before path validation.
      const legacyTopLevelTopic = String(payload.topic || '').trim()
      if (legacyTopLevelTopic) {
        extraInstruction = [extraInstruction, legacyTopLevelTopic].filter(Boolean).join('\n')
      }
      if (override && isPlainObject(override)) {
        const nextOverride = { ...override }
        const extractedTopicLines = []
        const collectTopicText = (value) => {
          if (value === null || value === undefined) return
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            const text = String(value).trim()
            if (text) extractedTopicLines.push(text)
          }
        }

        collectTopicText(nextOverride.topic)
        delete nextOverride.topic

        for (const key of Object.keys(nextOverride)) {
          if (!String(key).startsWith('topic.')) continue
          collectTopicText(nextOverride[key])
          delete nextOverride[key]
        }

        if (extractedTopicLines.length) {
          extraInstruction = [extraInstruction, ...extractedTopicLines].filter(Boolean).join('\n')
        }
        override = Object.keys(nextOverride).length ? nextOverride : undefined
      }

      if (override) {
        const invalidOverridePaths = validateOverridePaths(normalized, override)
        if (invalidOverridePaths.length) {
          return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid override path(s)', invalidOverridePaths)
        }
        normalized = applyOverrides(normalized, override)
      }
      const strategyTone = Array.isArray(normalized.strategy?.emotionTriggers) && normalized.strategy.emotionTriggers.length
        ? normalized.strategy.emotionTriggers.join(', ')
        : ''
      const promptInput = { ...normalized, tone: normalized.tone || strategyTone }

      const postErrs = validateTemplate(normalized)
      if (postErrs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Preset validation failed after overrides', postErrs)
      }
      const contractLint = lintPresetAgainstPlatformContract(normalized)
      if (Array.isArray(contractLint?.errors) && contractLint.errors.length) {
        return sendError(
          res,
          400,
          'PRESET_CONTRACT_REJECTED',
          'Preset ditolak karena melanggar kontrak platform.',
          {
            presetId: String(normalized?.id || presetId || '').trim() || null,
            platform: String(normalized?.platform || '').trim() || null,
            errors: contractLint.errors,
            warnings: Array.isArray(contractLint.warnings) ? contractLint.warnings : [],
            action: {
              canEdit: true,
              canDelete: true,
              tip: 'Buka halaman Templates lalu Edit untuk perbaiki field yang disebutkan, atau Hapus preset jika sudah tidak dipakai.'
            }
          }
        )
      }

      const tpl = defaultTemplateForConfig(normalized)
      const basePrompt = compilePrompt(tpl, promptInput)
      const withInstructionPrompt = appendExtraInstructionToPrompt(basePrompt, extraInstruction)
      const tmdbContext = await fetchTmdbEnrichmentContext({
        topic: promptInput?.topic || normalized?.topic || '',
        extraInstruction,
        language: promptInput?.language || normalized?.language || '',
        preference: tmdbPreference
      })
      const withTmdbPrompt = appendTmdbContextToPrompt(withInstructionPrompt, tmdbContext)
      const finalPrompt = appendImageReferencesToPrompt(withTmdbPrompt, imageReferences)
      const genPayload = {
        normalizedConfig: promptInput,
        provider,
        model,
        prompt: finalPrompt,
        imageReferences,
        warnings: visionRouting.warnings,
        vision: visionRouting.vision,
        keySource: providerContext.keySource,
        tmdb: tmdbContext
      }
      const generated = await generateUsingProviderOrMock(genPayload)
      return sendOk(res, generated)
    }

    // manual mode
    let manualConfig = payload.manualConfig || payload.normalizedConfig || null
    if (!manualConfig && payload.topic) {
      // backward compatibility for old clients sending top-level fields
      manualConfig = {
        topic: payload.topic,
        platform: payload.platform,
        language: payload.language,
        tone: payload.tone,
        contentStructure: { length: payload.length || 'short', format: payload.formatOutput || 'text' }
      }
    }
    const manualErrs = validateManualConfig(manualConfig)
    if (manualErrs.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Manual payload validation failed', manualErrs)
    }

    let normalized = manualConfig
    if (override) {
      const invalidOverridePaths = validateOverridePaths(normalized, override)
      if (invalidOverridePaths.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid override path(s)', invalidOverridePaths)
      }
      normalized = applyOverrides(normalized, override)
    }
    const postOverrideErrs = validateManualConfig(normalized)
    if (postOverrideErrs.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Manual payload validation failed after overrides', postOverrideErrs)
    }

    const tpl = defaultTemplateForConfig(normalized)
    const basePrompt = compilePrompt(tpl, normalized)
    const tmdbContext = await fetchTmdbEnrichmentContext({
      topic: normalized?.topic || normalized?.title || '',
      extraInstruction,
      language: normalized?.language || '',
      preference: tmdbPreference
    })
    const withTmdbPrompt = appendTmdbContextToPrompt(basePrompt, tmdbContext)
    const finalPrompt = appendImageReferencesToPrompt(withTmdbPrompt, imageReferences)
    const genPayload = {
      normalizedConfig: normalized,
      provider,
      model,
      prompt: finalPrompt,
      imageReferences,
      warnings: visionRouting.warnings,
      vision: visionRouting.vision,
      keySource: providerContext.keySource,
      tmdb: tmdbContext
    }
    const generated = await generateUsingProviderOrMock(genPayload)
    return sendOk(res, generated)
  } catch (err) {
    if (err?.code === 'PROVIDER_API_ERROR') {
      const details = isPlainObject(err?.details) ? err.details : undefined
      const classification = String(details?.classification || '').toLowerCase()
      let status = 502
      if (classification === 'timeout') status = 504
      else if (classification === 'rate_limit') status = 429
      return sendError(res, status, 'PROVIDER_API_ERROR', err.message || 'Provider call failed', details)
    }
    console.error(err)
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error')
  }
})

// Presets API with team-shared Supabase storage and local fallback.
app.get('/api/presets', async (req, res) => {
  try {
    const authUser = await resolveOptionalAuthenticatedUser(req)
    if (supabaseAdmin && authUser?.id) {
      let load = await listTeamPresetsFromSupabase()
      if (load.error) {
        if (isMissingRelationError(load.error)) {
          return sendError(
            res,
            503,
            'MISCONFIGURED',
            `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
          )
        }
        return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read presets: ${sanitizeSupabaseError(load.error)}`)
      }

      load = await seedTeamPresetsIfNeeded(authUser, { existingRows: load.rows })
      if (load.error) {
        if (isMissingRelationError(load.error)) {
          return sendError(
            res,
            503,
            'MISCONFIGURED',
            `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
          )
        }
        return sendError(res, 500, 'INTERNAL_ERROR', `Failed to seed presets: ${sanitizeSupabaseError(load.error)}`)
      }
      return sendOk(res, load.rows || [])
    }

    const list = readStoredPresets()
    return sendOk(res, list)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read presets')
  }
})

// Backward compatibility for clients that still call workflow endpoints.
app.get('/api/presets/workflow', requireAuthenticatedUser, async (req, res) => {
  return sendOk(res, {})
})

app.patch('/api/presets/:id/workflow', requireAuthenticatedUser, async (req, res) => {
  return sendOk(res, { deprecated: true, mode: 'team_shared' })
})

app.get('/api/presets/:id/versions', requireAuthenticatedUser, async (req, res) => {
  try {
    const presetId = String(req.params.id || '').trim()
    if (!presetId) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')

    const lookup = await getTeamPresetRowByPresetId(presetId)
    if (lookup.error) {
      if (isMissingRelationError(lookup.error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read preset versions: ${sanitizeSupabaseError(lookup.error)}`)
    }
    if (!lookup.row?.id) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

    const { data, error } = await supabaseAdmin
      .from(TEAM_PRESET_VERSION_TABLE)
      .select('id,snapshot_version,action,snapshot,actor_user_id,actor_display_name,created_at')
      .eq('team_preset_id', lookup.row.id)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset version table "${TEAM_PRESET_VERSION_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read preset versions: ${sanitizeSupabaseError(error)}`)
    }

    const rows = (Array.isArray(data) ? data : [])
      .map((row) => mapTeamVersionRow(row, presetId))
      .filter(Boolean)

    return sendOk(res, rows)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read preset versions')
  }
})

app.post('/api/presets/:id/rollback', requireAuthenticatedUser, async (req, res) => {
  try {
    const presetId = String(req.params.id || '').trim()
    const snapshotId = String(req.body?.snapshotId || '').trim()
    if (!presetId) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')
    if (!snapshotId) return sendError(res, 400, 'VALIDATION_ERROR', 'snapshotId is required')

    const teamLookup = await getTeamPresetRowByPresetId(presetId)
    if (teamLookup.error) {
      if (isMissingRelationError(teamLookup.error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to rollback preset: ${sanitizeSupabaseError(teamLookup.error)}`)
    }
    if (!teamLookup.row?.id) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

    const { data: snapshotRow, error: snapshotErr } = await supabaseAdmin
      .from(TEAM_PRESET_VERSION_TABLE)
      .select('id,snapshot,action,snapshot_version')
      .eq('id', snapshotId)
      .eq('team_preset_id', teamLookup.row.id)
      .maybeSingle()

    if (snapshotErr) {
      if (isMissingRelationError(snapshotErr)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset version table "${TEAM_PRESET_VERSION_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to rollback preset: ${sanitizeSupabaseError(snapshotErr)}`)
    }
    if (!snapshotRow?.snapshot) return sendError(res, 404, 'NOT_FOUND', 'Snapshot not found')

    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const existingPreset = normalizePreset({
      ...(teamLookup.row.preset || {}),
      id: teamLookup.row.preset_id || presetId
    })
    const nowIso = new Date().toISOString()
    const restored = normalizePreset({
      ...(snapshotRow.snapshot || {}),
      id: presetId
    })
    restored.version = bumpVersion(existingPreset.version || restored.version || '1.0.0')
    restored.meta = {
      ...(existingPreset?.meta || {}),
      ...(restored?.meta || {}),
      createdAt: existingPreset?.meta?.createdAt || restored?.meta?.createdAt || nowIso,
      updatedAt: nowIso,
      createdBy: existingPreset?.meta?.createdBy || restored?.meta?.createdBy || actorDisplayName
    }

    const errs = validateTemplate(restored)
    if (errs.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Validation failed', errs)

    const { data: updatedRow, error: saveErr } = await supabaseAdmin
      .from(TEAM_PRESET_TABLE)
      .update({
        preset_id: presetId,
        title: restored.title || restored.label || presetId,
        preset: restored,
        version: Number(teamLookup.row.version || 1) + 1,
        updated_by_user_id: req.authUser.id,
        updated_by_display_name: actorDisplayName,
        last_action: 'rollback',
        last_action_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', teamLookup.row.id)
      .select(TEAM_PRESET_SELECT_COLUMNS)
      .maybeSingle()

    if (saveErr) {
      if (isMissingRelationError(saveErr)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to rollback preset: ${sanitizeSupabaseError(saveErr)}`)
    }
    if (!updatedRow?.id) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

    const rollbackVersionWrite = await upsertTeamPresetVersionSnapshot(updatedRow, 'rollback', req.authUser, actorDisplayName)
    if (rollbackVersionWrite?.error && isMissingRelationError(rollbackVersionWrite.error)) {
      return sendError(
        res,
        503,
        'MISCONFIGURED',
        `Preset version table "${TEAM_PRESET_VERSION_TABLE}" belum tersedia. Jalankan SQL migration.`
      )
    }
    return sendOk(res, mapTeamPresetRow(updatedRow))
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to rollback preset')
  }
})

app.get('/api/presets/:id', async (req, res) => {
  try {
    const presetId = String(req.params.id || '').trim()
    if (!presetId) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')
    const authUser = await resolveOptionalAuthenticatedUser(req)

    if (supabaseAdmin && authUser?.id) {
      const lookup = await getTeamPresetRowByPresetId(presetId)
      if (lookup.error) {
        if (isMissingRelationError(lookup.error)) {
          return sendError(
            res,
            503,
            'MISCONFIGURED',
            `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
          )
        }
        return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read presets: ${sanitizeSupabaseError(lookup.error)}`)
      }
      if (!lookup.row?.preset) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')
      return sendOk(res, mapTeamPresetRow(lookup.row))
    }

    const list = readStoredPresets()
    const found = list.find((item) => item?.id === presetId)
    if (!found) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')
    return sendOk(res, normalizePreset(found))
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read presets')
  }
})

app.post('/api/presets', requireAuthenticatedUser, async (req, res) => {
  try {
    const { incomingPreset, action, cloneFromPresetId } = parsePresetMutationPayload(req.body, 'create')
    const normalized = normalizePreset(incomingPreset)
    const errs = validateTemplate(normalized)
    if (errs.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Validation failed', errs)

    const existing = await getTeamPresetRowByPresetId(normalized.id)
    if (existing.error) {
      if (isMissingRelationError(existing.error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Save failed: ${sanitizeSupabaseError(existing.error)}`)
    }
    if (existing.row?.id) return sendError(res, 409, 'CONFLICT', 'Preset with same id exists')

    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const nowIso = new Date().toISOString()
    normalized.meta = {
      ...(normalized.meta || {}),
      createdAt: normalized?.meta?.createdAt || nowIso,
      updatedAt: nowIso,
      createdBy: normalized?.meta?.createdBy || actorDisplayName
    }

    const actionNormalized = normalizeTeamPresetAction(action, 'create')
    const { data: savedRow, error: saveErr } = await supabaseAdmin
      .from(TEAM_PRESET_TABLE)
      .insert([{
        preset_id: normalized.id,
        title: normalized.title || normalized.label || normalized.id,
        preset: normalized,
        version: 1,
        created_by_user_id: req.authUser.id,
        created_by_display_name: actorDisplayName,
        updated_by_user_id: req.authUser.id,
        updated_by_display_name: actorDisplayName,
        last_action: actionNormalized,
        last_action_at: nowIso,
        last_cloned_from_preset_id: actionNormalized === 'clone' ? cloneFromPresetId : null,
        created_at: nowIso,
        updated_at: nowIso
      }])
      .select(TEAM_PRESET_SELECT_COLUMNS)
      .maybeSingle()

    if (saveErr) {
      if (isMissingRelationError(saveErr)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Save failed: ${sanitizeSupabaseError(saveErr)}`)
    }
    if (!savedRow?.id) return sendError(res, 500, 'INTERNAL_ERROR', 'Save failed')

    const versionWrite = await upsertTeamPresetVersionSnapshot(savedRow, actionNormalized, req.authUser, actorDisplayName)
    if (versionWrite?.error && isMissingRelationError(versionWrite.error)) {
      return sendError(
        res,
        503,
        'MISCONFIGURED',
        `Preset version table "${TEAM_PRESET_VERSION_TABLE}" belum tersedia. Jalankan SQL migration.`
      )
    }
    return sendOk(res, mapTeamPresetRow(savedRow), 201)
  } catch (e) {
    console.error(e)
    return sendError(res, 500, 'INTERNAL_ERROR', 'Save failed')
  }
})

app.patch('/api/presets/:id', requireAuthenticatedUser, async (req, res) => {
  try {
    const routeId = String(req.params.id || '').trim()
    if (!routeId) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')

    const existingLookup = await getTeamPresetRowByPresetId(routeId)
    if (existingLookup.error) {
      if (isMissingRelationError(existingLookup.error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Update failed: ${sanitizeSupabaseError(existingLookup.error)}`)
    }
    if (!existingLookup.row?.id || !existingLookup.row?.preset) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

    const { incomingPreset, action, cloneFromPresetId } = parsePresetMutationPayload(req.body, 'edit')
    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const nowIso = new Date().toISOString()

    const existing = normalizePreset({ ...(existingLookup.row.preset || {}), id: existingLookup.row.preset_id || routeId })
    const mergedRaw = {
      ...existing,
      ...(isPlainObject(incomingPreset) ? incomingPreset : {})
    }
    const normalized = normalizePreset(mergedRaw)
    normalized.version = bumpVersion(existing.version || normalized.version || '1.0.0')
    normalized.meta = {
      ...(existing.meta || {}),
      ...(normalized.meta || {}),
      createdAt: existing?.meta?.createdAt || normalized?.meta?.createdAt || nowIso,
      updatedAt: nowIso,
      createdBy: existing?.meta?.createdBy || normalized?.meta?.createdBy || actorDisplayName
    }
    const errs = validateTemplate(normalized)
    if (errs.length) return sendError(res, 400, 'VALIDATION_ERROR', 'Validation failed', errs)

    const targetId = String(normalized.id || '').trim() || routeId
    if (targetId !== routeId) {
      const targetLookup = await getTeamPresetRowByPresetId(targetId)
      if (targetLookup.error) {
        if (isMissingRelationError(targetLookup.error)) {
          return sendError(
            res,
            503,
            'MISCONFIGURED',
            `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
          )
        }
        return sendError(res, 500, 'INTERNAL_ERROR', `Update failed: ${sanitizeSupabaseError(targetLookup.error)}`)
      }
      if (targetLookup.row?.id && targetLookup.row.id !== existingLookup.row.id) {
        return sendError(res, 409, 'CONFLICT', 'Preset with same id exists')
      }
    }

    const actionNormalized = normalizeTeamPresetAction(action, 'edit')
    const { data: updatedRow, error: saveErr } = await supabaseAdmin
      .from(TEAM_PRESET_TABLE)
      .update({
        preset_id: targetId,
        title: normalized.title || normalized.label || targetId,
        preset: normalized,
        version: Number(existingLookup.row.version || 1) + 1,
        updated_by_user_id: req.authUser.id,
        updated_by_display_name: actorDisplayName,
        last_action: actionNormalized,
        last_action_at: nowIso,
        last_cloned_from_preset_id: actionNormalized === 'clone'
          ? (cloneFromPresetId || routeId)
          : existingLookup.row.last_cloned_from_preset_id || null,
        updated_at: nowIso
      })
      .eq('id', existingLookup.row.id)
      .select(TEAM_PRESET_SELECT_COLUMNS)
      .maybeSingle()

    if (saveErr) {
      if (isMissingRelationError(saveErr)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Update failed: ${sanitizeSupabaseError(saveErr)}`)
    }
    if (!updatedRow?.id) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

    const versionWrite = await upsertTeamPresetVersionSnapshot(updatedRow, actionNormalized, req.authUser, actorDisplayName)
    if (versionWrite?.error && isMissingRelationError(versionWrite.error)) {
      return sendError(
        res,
        503,
        'MISCONFIGURED',
        `Preset version table "${TEAM_PRESET_VERSION_TABLE}" belum tersedia. Jalankan SQL migration.`
      )
    }
    return sendOk(res, mapTeamPresetRow(updatedRow))
  } catch (e) {
    console.error(e)
    return sendError(res, 500, 'INTERNAL_ERROR', 'Update failed')
  }
})

app.delete('/api/presets/:id', requireAuthenticatedUser, async (req, res) => {
  try {
    const presetId = String(req.params.id || '').trim()
    if (!presetId) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')

    const { data, error } = await supabaseAdmin
      .from(TEAM_PRESET_TABLE)
      .delete()
      .eq('preset_id', presetId)
      .select('id,preset_id')

    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Preset storage table "${TEAM_PRESET_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Delete failed: ${sanitizeSupabaseError(error)}`)
    }
    if (!Array.isArray(data) || !data.length) return sendError(res, 404, 'NOT_FOUND', 'Preset not found')

    const mirror = await replicateMutationToMirror('team-presets.delete', async (mirrorClient) => {
      return mirrorClient
        .from(TEAM_PRESET_TABLE)
        .delete()
        .eq('preset_id', presetId)
        .select('id,preset_id')
    })

    return sendOk(res, {
      deleted: true,
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    console.error(e)
    return sendError(res, 500, 'INTERNAL_ERROR', 'Delete failed')
  }
})

app.get('/api/dashboard/alerts', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const statusRaw = String(req.query?.status || '').trim().toLowerCase()
    const status = statusRaw ? normalizeAlertStatus(statusRaw, '') : ''
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 100) || 100, 200))

    let query = supabaseAdmin
      .from(DASHBOARD_ALERT_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (status && DASHBOARD_ALLOWED_ALERT_STATUS.has(status)) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard alerts table "${DASHBOARD_ALERT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read dashboard alerts: ${sanitizeSupabaseError(error)}`)
    }

    const rank = { open: 1, acknowledged: 2, resolved: 3 }
    const rows = (Array.isArray(data) ? data : [])
      .map((row) => mapDashboardAlertRow(row))
      .filter(Boolean)
      .sort((a, b) => {
        const left = rank[a.status] || 99
        const right = rank[b.status] || 99
        if (left !== right) return left - right
        return Date.parse(String(b.updatedAt || '')) - Date.parse(String(a.updatedAt || ''))
      })

    return sendOk(res, rows)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read dashboard alerts')
  }
})

app.post('/api/dashboard/alerts/sync', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }

    const incoming = Array.isArray(req.body?.alerts) ? req.body.alerts : []
    if (incoming.length > 80) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'alerts max is 80')
    }
    if (!incoming.length) return sendOk(res, [])

    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const normalized = incoming.map((item, idx) => {
      const key = normalizeAlertKey(item?.key || item?.alertKey || item?.ruleKey)
      const message = normalizeAlertMessage(item?.message || item?.text)
      const severity = normalizeAlertSeverity(item?.severity || item?.variant)
      const source = String(item?.source || 'dashboard').trim().slice(0, 40) || 'dashboard'
      const context = normalizeAlertContext(item?.context)
      if (!key) return { error: `alerts.${idx}.key is required` }
      if (!message) return { error: `alerts.${idx}.message is required` }
      return { key, message, severity, source, context }
    })

    const invalid = normalized.filter((x) => x?.error).map((x) => x.error)
    if (invalid.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid alert payload', invalid)
    }

    const keys = Array.from(new Set(normalized.map((x) => x.key))).slice(0, 80)
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from(DASHBOARD_ALERT_TABLE)
      .select('*')
      .in('alert_key', keys)

    if (existingErr) {
      if (isMissingRelationError(existingErr)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard alerts table "${DASHBOARD_ALERT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to sync dashboard alerts: ${sanitizeSupabaseError(existingErr)}`)
    }

    const existingByKey = new Map((Array.isArray(existingRows) ? existingRows : []).map((row) => [String(row.alert_key || ''), row]))
    const nowIso = new Date().toISOString()
    const upsertRows = normalized.map((item) => {
      const existing = existingByKey.get(item.key)
      const existingStatus = normalizeAlertStatus(existing?.status || 'open')
      const existingSignature = buildAlertEventSignature(existing || {})
      const incomingSignature = buildAlertEventSignature(item)
      const changedEvent = !existing || existingSignature !== incomingSignature
      const shouldReopen = existingStatus === 'resolved' || (existingStatus === 'acknowledged' && changedEvent)
      const shouldIncrementCount = !existing || shouldReopen || changedEvent
      const nextStatus = shouldReopen ? 'open' : existingStatus
      const row = {
        alert_key: item.key,
        source: item.source,
        status: nextStatus,
        severity: item.severity,
        message: item.message,
        context: item.context,
        count: shouldIncrementCount
          ? Math.max(1, Number(existing?.count || 0) + 1)
          : Math.max(1, Number(existing?.count || 1)),
        created_by_user_id: existing?.created_by_user_id || req.authUser.id,
        created_by_display_name: existing?.created_by_display_name || actorDisplayName,
        acknowledged_by_user_id: shouldReopen ? null : (existing?.acknowledged_by_user_id || null),
        acknowledged_by_display_name: shouldReopen ? null : (existing?.acknowledged_by_display_name || null),
        acknowledged_at: shouldReopen ? null : (existing?.acknowledged_at || null),
        resolved_by_user_id: shouldReopen ? null : (existing?.resolved_by_user_id || null),
        resolved_by_display_name: shouldReopen ? null : (existing?.resolved_by_display_name || null),
        resolved_at: shouldReopen ? null : (existing?.resolved_at || null),
        last_seen_at: nowIso,
        created_at: existing?.created_at || nowIso,
        updated_at: shouldIncrementCount ? nowIso : (existing?.updated_at || nowIso)
      }
      if (existing?.id) row.id = existing.id
      return row
    })

    const { data: savedRows, error: saveErr } = await supabaseAdmin
      .from(DASHBOARD_ALERT_TABLE)
      .upsert(upsertRows, { onConflict: 'alert_key' })
      .select('*')

    if (saveErr) {
      if (isMissingRelationError(saveErr)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard alerts table "${DASHBOARD_ALERT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to sync dashboard alerts: ${sanitizeSupabaseError(saveErr)}`)
    }

    const mirror = await replicateMutationToMirror('dashboard-alerts.sync', async (mirrorClient) => {
      return mirrorClient
        .from(DASHBOARD_ALERT_TABLE)
        .upsert(upsertRows, { onConflict: 'alert_key' })
        .select('id,alert_key')
    })

    const rows = (Array.isArray(savedRows) ? savedRows : [])
      .map((row) => mapDashboardAlertRow(row))
      .filter(Boolean)
    return sendOk(res, {
      rows,
      mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to sync dashboard alerts')
  }
})

app.post('/api/dashboard/alerts/:id/ack', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const id = String(req.params.id || '').trim()
    if (!id) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')
    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from(DASHBOARD_ALERT_TABLE)
      .update({
        status: 'acknowledged',
        acknowledged_by_user_id: req.authUser.id,
        acknowledged_by_display_name: actorDisplayName,
        acknowledged_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard alerts table "${DASHBOARD_ALERT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to acknowledge alert: ${sanitizeSupabaseError(error)}`)
    }
    if (!data) return sendError(res, 404, 'NOT_FOUND', 'Alert not found')

    const mirrorPatch = {
      status: 'acknowledged',
      acknowledged_by_user_id: req.authUser.id,
      acknowledged_by_display_name: actorDisplayName,
      acknowledged_at: nowIso,
      updated_at: nowIso
    }
    const mirror = await replicateMutationToMirror('dashboard-alerts.ack', async (mirrorClient) => {
      return mirrorClient
        .from(DASHBOARD_ALERT_TABLE)
        .update(mirrorPatch)
        .eq('alert_key', data.alert_key)
        .select('id,alert_key')
        .maybeSingle()
    })

    return sendOk(res, {
      ...mapDashboardAlertRow(data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to acknowledge alert')
  }
})

app.post('/api/dashboard/alerts/:id/resolve', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const id = String(req.params.id || '').trim()
    if (!id) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')
    const actorDisplayName = await resolveActorDisplayName(req.authUser)
    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from(DASHBOARD_ALERT_TABLE)
      .update({
        status: 'resolved',
        resolved_by_user_id: req.authUser.id,
        resolved_by_display_name: actorDisplayName,
        resolved_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard alerts table "${DASHBOARD_ALERT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to resolve alert: ${sanitizeSupabaseError(error)}`)
    }
    if (!data) return sendError(res, 404, 'NOT_FOUND', 'Alert not found')

    const mirrorPatch = {
      status: 'resolved',
      resolved_by_user_id: req.authUser.id,
      resolved_by_display_name: actorDisplayName,
      resolved_at: nowIso,
      updated_at: nowIso
    }
    const mirror = await replicateMutationToMirror('dashboard-alerts.resolve', async (mirrorClient) => {
      return mirrorClient
        .from(DASHBOARD_ALERT_TABLE)
        .update(mirrorPatch)
        .eq('alert_key', data.alert_key)
        .select('id,alert_key')
        .maybeSingle()
    })

    return sendOk(res, {
      ...mapDashboardAlertRow(data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to resolve alert')
  }
})

app.post('/api/dashboard/alerts/:id/reopen', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const id = String(req.params.id || '').trim()
    if (!id) return sendError(res, 400, 'VALIDATION_ERROR', 'id is required')
    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from(DASHBOARD_ALERT_TABLE)
      .update({
        status: 'open',
        acknowledged_by_user_id: null,
        acknowledged_by_display_name: null,
        acknowledged_at: null,
        resolved_by_user_id: null,
        resolved_by_display_name: null,
        resolved_at: null,
        updated_at: nowIso,
        last_seen_at: nowIso
      })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard alerts table "${DASHBOARD_ALERT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to reopen alert: ${sanitizeSupabaseError(error)}`)
    }
    if (!data) return sendError(res, 404, 'NOT_FOUND', 'Alert not found')

    const mirrorPatch = {
      status: 'open',
      acknowledged_by_user_id: null,
      acknowledged_by_display_name: null,
      acknowledged_at: null,
      resolved_by_user_id: null,
      resolved_by_display_name: null,
      resolved_at: null,
      updated_at: nowIso,
      last_seen_at: nowIso
    }
    const mirror = await replicateMutationToMirror('dashboard-alerts.reopen', async (mirrorClient) => {
      return mirrorClient
        .from(DASHBOARD_ALERT_TABLE)
        .update(mirrorPatch)
        .eq('alert_key', data.alert_key)
        .select('id,alert_key')
        .maybeSingle()
    })

    return sendOk(res, {
      ...mapDashboardAlertRow(data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to reopen alert')
  }
})

app.get('/api/dashboard/snapshots', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 30) || 30, 120))
    const windowDays = Number(req.query?.windowDays || 0)
    const sourceScope = normalizeSnapshotScope(req.query?.sourceScope, '')
    const decisionScope = String(req.query?.decisionScope || '').trim().toLowerCase()

    let query = supabaseAdmin
      .from(DASHBOARD_SNAPSHOT_TABLE)
      .select('*')
      .order('snapshot_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (Number.isFinite(windowDays) && windowDays > 0) query = query.eq('window_days', Math.max(1, Math.min(windowDays, 90)))
    if (sourceScope) query = query.eq('source_scope', sourceScope)
    if (decisionScope && ['all', 'go', 'revise', 'block'].includes(decisionScope)) query = query.eq('decision_scope', decisionScope)

    const { data, error } = await query
    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard snapshots table "${DASHBOARD_SNAPSHOT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to read dashboard snapshots: ${sanitizeSupabaseError(error)}`)
    }
    const rows = (Array.isArray(data) ? data : []).map((row) => mapDashboardSnapshotRow(row)).filter(Boolean)
    return sendOk(res, rows)
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read dashboard snapshots')
  }
})

app.post('/api/dashboard/snapshots/run', requireAuthenticatedUser, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return sendError(res, 503, 'MISCONFIGURED', 'Supabase admin client is not configured')
    }
    const payload = isPlainObject(req.body) ? req.body : {}
    const summary = normalizeAlertContext(payload.summary)
    if (!isPlainObject(summary) || !Object.keys(summary).length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'summary is required')
    }
    const windowDays = Math.max(1, Math.min(Number(payload.windowDays || 7) || 7, 90))
    const sourceScope = normalizeSnapshotScope(payload.sourceScope, 'all')
    const decisionScope = String(payload.decisionScope || 'all').trim().toLowerCase()
    if (!['all', 'go', 'revise', 'block'].includes(decisionScope)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'decisionScope is invalid')
    }

    const now = new Date()
    const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.snapshotDate || '').trim())
      ? String(payload.snapshotDate || '').trim()
      : now.toISOString().slice(0, 10)
    const nowIso = now.toISOString()
    const actorDisplayName = await resolveActorDisplayName(req.authUser)

    const upsertRow = {
      snapshot_date: snapshotDate,
      window_days: windowDays,
      source_scope: sourceScope,
      decision_scope: decisionScope,
      summary,
      generated_by_user_id: req.authUser.id,
      generated_by_display_name: actorDisplayName,
      created_at: nowIso,
      updated_at: nowIso
    }

    const { data, error } = await supabaseAdmin
      .from(DASHBOARD_SNAPSHOT_TABLE)
      .upsert([upsertRow], { onConflict: 'snapshot_date,window_days,source_scope,decision_scope' })
      .select('*')
      .maybeSingle()

    if (error) {
      if (isMissingRelationError(error)) {
        return sendError(
          res,
          503,
          'MISCONFIGURED',
          `Dashboard snapshots table "${DASHBOARD_SNAPSHOT_TABLE}" belum tersedia. Jalankan SQL migration.`
        )
      }
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to save dashboard snapshot: ${sanitizeSupabaseError(error)}`)
    }

    const mirror = await replicateMutationToMirror('dashboard-snapshots.run', async (mirrorClient) => {
      return mirrorClient
        .from(DASHBOARD_SNAPSHOT_TABLE)
        .upsert([upsertRow], { onConflict: 'snapshot_date,window_days,source_scope,decision_scope' })
        .select('id')
        .maybeSingle()
    })

    return sendOk(res, {
      ...mapDashboardSnapshotRow(data),
      _mirror: {
        enabled: ENABLE_SUPABASE_DUAL_WRITE,
        profile: supabaseMirrorInfo.profile || null,
        attempted: !!mirror.attempted,
        mirrored: !!mirror.mirrored,
        reason: mirror.reason || ''
      }
    })
  } catch (e) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save dashboard snapshot')
  }
})

function tryListen(port, attempts = 0) {
  const server = app.listen(port, () => {
    console.log(`Mock server running on http://localhost:${port}`)
  })

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attempts < 5) {
      const nextPort = Number(port) + 1
      console.warn(`Port ${port} in use, trying ${nextPort}...`)
      // give a small delay before retrying
      setTimeout(() => tryListen(nextPort, attempts + 1), 200)
    } else {
      console.error('Server failed to start:', err)
      process.exit(1)
    }
  })
}

function isMainModule() {
  const argvEntry = String(process.argv?.[1] || '').trim()
  if (!argvEntry) return false
  const entryUrl = pathToFileURL(path.resolve(argvEntry)).href
  return import.meta.url === entryUrl
}

function shouldStartLocalServer() {
  if (String(process.env.DISABLE_LOCAL_SERVER_BOOT || '').toLowerCase() === 'true') return false
  return isMainModule()
}

function startServer(port = PORT) {
  return tryListen(port)
}

if (shouldStartLocalServer()) {
  startServer(PORT)
}

export { app, tryListen, startServer }
export default app
