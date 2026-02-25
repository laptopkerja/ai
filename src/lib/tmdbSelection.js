const TMDB_SELECTION_STORAGE_KEY = 'tmdb_generate_selection_v1'
const TMDB_PREFS_STORAGE_KEY = 'tmdb_generate_prefs_v2'
const TMDB_LEGACY_PREFS_STORAGE_KEY = 'tmdb_generate_prefs_v1'
const TMDB_MAX_SELECTED_IMAGES = 5
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
const TMDB_FACT_LOCK_FIELDS_DISABLED_FOR_TV = new Set(['budget', 'revenue'])
const TMDB_FACT_LOCK_FIELDS_DISABLED_FOR_MOVIE = new Set(['networks'])

const TMDB_DEFAULT_PREFS = {
  enabled: true,
  mediaType: 'multi',
  region: 'US',
  language: 'en-US',
  query: '',
  year: '',
  referenceScope: 'series',
  spoilerLevel: 'light'
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidHttpUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch (e) {
    return false
  }
}

function normalizeMediaType(raw) {
  const value = String(raw || 'multi').trim().toLowerCase()
  if (value === 'movie' || value === 'tv' || value === 'multi') return value
  return 'multi'
}

function normalizeRegion(raw) {
  const value = String(raw || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(value) ? value : 'US'
}

function normalizeLanguage(raw) {
  const value = String(raw || '').trim()
  return /^[a-z]{2}-[A-Z]{2}$/.test(value) ? value : 'en-US'
}

function normalizeYear(raw) {
  const value = String(raw || '').trim()
  return /^\d{4}$/.test(value) ? value : ''
}

function normalizeReferenceScope(raw) {
  const value = String(raw || '').trim().toLowerCase()
  return TMDB_TV_REFERENCE_SCOPES.includes(value) ? value : 'series'
}

function normalizeSpoilerLevel(raw) {
  const value = String(raw || '').trim().toLowerCase()
  return TMDB_SPOILER_LEVELS.includes(value) ? value : 'light'
}

function normalizeRules(raw) {
  const input = isPlainObject(raw) ? raw : {}
  return {
    factual_only_from_tmdb: input.factual_only_from_tmdb !== false,
    no_hallucination: input.no_hallucination !== false,
    spoilerLevel: normalizeSpoilerLevel(input.spoilerLevel || input.spoiler_level || 'light')
  }
}

function normalizeFactLocks(raw, mediaType = 'multi') {
  const input = isPlainObject(raw) ? raw : {}
  const safeMediaType = normalizeMediaType(mediaType)
  const out = {}
  for (const key of TMDB_FACT_LOCK_FIELDS) { // eslint-disable-line no-restricted-syntax
    if (safeMediaType === 'tv' && TMDB_FACT_LOCK_FIELDS_DISABLED_FOR_TV.has(key)) {
      continue // eslint-disable-line no-continue
    }
    if (safeMediaType === 'movie' && TMDB_FACT_LOCK_FIELDS_DISABLED_FOR_MOVIE.has(key)) {
      continue // eslint-disable-line no-continue
    }
    out[key] = input[key] !== false
  }
  return out
}

function normalizeFactLocksForRequest(factLocks, mediaType = 'multi') {
  const normalized = normalizeFactLocks(factLocks, mediaType)
  const safeMediaType = normalizeMediaType(mediaType)
  if (safeMediaType !== 'tv') {
    if (safeMediaType === 'movie') {
      delete normalized.networks
    }
    const creatorProvided = isPlainObject(factLocks) && Object.prototype.hasOwnProperty.call(factLocks, 'creator')
    const directorProvided = isPlainObject(factLocks) && Object.prototype.hasOwnProperty.call(factLocks, 'director')
    if (creatorProvided && !directorProvided) {
      normalized.director = factLocks.creator !== false
    }
    return normalized
  }
  const creatorValue = isPlainObject(factLocks) && Object.prototype.hasOwnProperty.call(factLocks, 'creator')
    ? factLocks.creator !== false
    : (normalized.director !== false)
  const { director, ...rest } = normalized
  delete rest.budget
  delete rest.revenue
  return { ...rest, creator: creatorValue }
}

function normalizeScopeLabels(raw, mediaType = 'multi') {
  if (normalizeMediaType(mediaType) !== 'tv') return null
  if (!isPlainObject(raw)) return null
  const season = String(raw.season || '').trim()
  const episode = String(raw.episode || '').trim()
  if (!season && !episode) return null
  return {
    ...(season ? { season } : {}),
    ...(episode ? { episode } : {})
  }
}

function inferMediaTypeFromSelection({
  explicitMediaType = 'multi',
  candidate = null,
  movieOrTv = null,
  tvContext = null
} = {}) {
  const explicit = normalizeMediaType(explicitMediaType)
  if (explicit === 'movie' || explicit === 'tv') return explicit

  const candidateMediaType = normalizeMediaType(candidate?.mediaType || candidate?.type || candidate?.entityType || 'multi')
  if (candidateMediaType === 'movie' || candidateMediaType === 'tv') return candidateMediaType

  const payload = isPlainObject(movieOrTv) ? movieOrTv : {}
  const hasTvSignals = !!(
    String(payload.creator || '').trim()
    || (Array.isArray(payload.creator_list) && payload.creator_list.length > 0)
    || (Array.isArray(payload.networks) && payload.networks.length > 0)
    || Number(payload.season_count || 0) > 0
    || Number(payload.episode_count || 0) > 0
    || String(payload.reference_scope || '').trim()
    || isPlainObject(tvContext)
  )
  if (hasTvSignals) return 'tv'

  const hasMovieSignals = !!(
    String(payload.director || '').trim()
    || (Array.isArray(payload.director_list) && payload.director_list.length > 0)
    || Number(payload.revenue || 0) > 0
    || Number(payload.budget || 0) > 0
  )
  if (hasMovieSignals) return 'movie'

  return explicit
}

function normalizeSelectedImages(raw) {
  const rows = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const item of rows) { // eslint-disable-line no-restricted-syntax
    const url = typeof item === 'string'
      ? String(item || '').trim()
      : String(item?.url || '').trim()
    if (!url || !isValidHttpUrl(url)) continue // eslint-disable-line no-continue
    const key = `url:${url}`
    if (seen.has(key)) continue // eslint-disable-line no-continue
    seen.add(key)
    out.push({
      type: 'url',
      url,
      source: typeof item === 'object' && item?.source ? String(item.source) : 'tmdb'
    })
    if (out.length >= TMDB_MAX_SELECTED_IMAGES) break
  }
  return out
}

function normalizeCandidate(raw) {
  if (!isPlainObject(raw)) return null
  const tmdbIdNum = Number(raw.tmdbId || raw.tmdb_id || 0)
  const tmdbId = Number.isInteger(tmdbIdNum) && tmdbIdNum > 0 ? tmdbIdNum : null
  const mediaType = normalizeMediaType(raw.mediaType || raw.type || raw.entityType || 'multi')
  const title = String(raw.title || '').trim()
  const year = normalizeYear(raw.year || '')
  const posterUrl = String(raw.posterUrl || raw.poster_url || '').trim()
  const ratingValue = Number(raw.rating)
  const rating = Number.isFinite(ratingValue) ? Number(ratingValue.toFixed(1)) : null
  return {
    ...(tmdbId ? { tmdbId } : {}),
    mediaType,
    title,
    year,
    ...(posterUrl && isValidHttpUrl(posterUrl) ? { posterUrl } : {}),
    ...(rating !== null ? { rating } : {})
  }
}

function normalizeSearchMeta(raw) {
  if (!isPlainObject(raw)) return null
  const countRaw = Number(raw.count)
  const count = Number.isFinite(countRaw) ? Math.max(0, Math.min(10, Math.floor(countRaw))) : 0
  const query = String(raw.query || '').trim()
  const languageCode = normalizeLanguage(raw.languageCode || raw.language || 'en-US')
  const region = normalizeRegion(raw.region || 'US')
  const keySource = String(raw.keySource || '').trim() || null
  return {
    count,
    query,
    languageCode,
    region,
    ...(keySource ? { keySource } : {})
  }
}

function normalizeSeasonData(raw) {
  if (!isPlainObject(raw)) return null
  const numberRaw = Number(raw.number ?? raw.season_number ?? 0)
  const number = Number.isInteger(numberRaw) && numberRaw > 0 ? numberRaw : null
  if (!number) return null
  const episodeCountRaw = Number(raw.episodeCount ?? raw.episode_count ?? 0)
  return {
    number,
    name: String(raw.name || '').trim(),
    airDate: String(raw.airDate || raw.air_date || '').trim(),
    overview: String(raw.overview || '').trim(),
    episodeCount: Number.isFinite(episodeCountRaw) && episodeCountRaw > 0 ? Math.floor(episodeCountRaw) : null
  }
}

function normalizeEpisodeData(raw) {
  if (!isPlainObject(raw)) return null
  const numberRaw = Number(raw.number ?? raw.episode_number ?? 0)
  const number = Number.isInteger(numberRaw) && numberRaw > 0 ? numberRaw : null
  if (!number) return null
  const runtimeRaw = Number(raw.runtime ?? 0)
  const voteAverageRaw = Number(raw.voteAverage ?? raw.vote_average ?? 0)
  return {
    number,
    name: String(raw.name || '').trim(),
    airDate: String(raw.airDate || raw.air_date || '').trim(),
    overview: String(raw.overview || '').trim(),
    runtime: Number.isFinite(runtimeRaw) && runtimeRaw > 0 ? Math.floor(runtimeRaw) : null,
    voteAverage: Number.isFinite(voteAverageRaw) && voteAverageRaw > 0 ? Number(voteAverageRaw.toFixed(1)) : null,
    episodeType: String(raw.episodeType || raw.episode_type || '').trim().toLowerCase() || null
  }
}

function normalizeTvContext(raw) {
  if (!isPlainObject(raw)) return null
  const season = normalizeSeasonData(raw.season)
  const episode = normalizeEpisodeData(raw.episode)
  const seasonOptions = Array.isArray(raw.seasonOptions)
    ? raw.seasonOptions.map((x) => normalizeSeasonData(x)).filter(Boolean)
    : []
  const episodeOptions = Array.isArray(raw.episodeOptions)
    ? raw.episodeOptions.map((x) => normalizeEpisodeData(x)).filter(Boolean)
    : []
  const seasonCountRaw = Number(raw.seasonCount ?? raw.season_count ?? 0)
  const episodeCountRaw = Number(raw.episodeCount ?? raw.episode_count ?? 0)
  return {
    referenceScope: normalizeReferenceScope(raw.referenceScope || raw.reference_scope || 'series'),
    spoilerLevel: normalizeSpoilerLevel(raw.spoilerLevel || raw.spoiler_level || 'light'),
    seasonCount: Number.isFinite(seasonCountRaw) && seasonCountRaw > 0 ? Math.floor(seasonCountRaw) : null,
    episodeCount: Number.isFinite(episodeCountRaw) && episodeCountRaw > 0 ? Math.floor(episodeCountRaw) : null,
    episodeType: String(raw.episodeType || raw.episode_type || '').trim().toLowerCase() || null,
    season,
    episode,
    seasonOptions,
    episodeOptions
  }
}

function normalizeTmdbSelection(input) {
  if (!isPlainObject(input)) return null
  const tmdbIdNum = Number(input.tmdbId || input.tmdb_id || input.movieOrTv?.tmdb_id || 0)
  const tmdbId = Number.isInteger(tmdbIdNum) && tmdbIdNum > 0 ? tmdbIdNum : null
  if (!tmdbId) return null

  const movieOrTv = isPlainObject(input.movieOrTv) ? input.movieOrTv : null
  const candidate = normalizeCandidate(input.candidate)
  const tvContext = normalizeTvContext(input.tvContext)
  const mediaTypeRaw = String(input.mediaType || input.entityType || input.type || '').trim().toLowerCase()
  const mediaType = inferMediaTypeFromSelection({
    explicitMediaType: mediaTypeRaw,
    candidate,
    movieOrTv,
    tvContext
  })
  const scopeLabels = normalizeScopeLabels(input.scopeLabels, mediaType)
  const title = String(
    input.title
    || movieOrTv?.title
    || ''
  ).trim()
  const releaseDate = String(
    input.releaseDate
    || movieOrTv?.release_date
    || ''
  ).trim()
  const year = normalizeYear(input.year || String(releaseDate || '').slice(0, 4))
  const query = String(input.query || title || '').trim()
  const rules = normalizeRules({
    ...(isPlainObject(input.rules) ? input.rules : {}),
    spoilerLevel: input?.rules?.spoilerLevel
      || input?.rules?.spoiler_level
      || tvContext?.spoilerLevel
      || input.spoilerLevel
      || input.spoiler_level
      || 'light'
  })
  const factLocks = normalizeFactLocks(input.factLocks, mediaType)
  const selectedImages = normalizeSelectedImages(input.selectedImages)
  const searchMeta = normalizeSearchMeta(input.searchMeta)
  const season = mediaType === 'tv' ? normalizeSeasonData(input.season || tvContext?.season) : null
  const episode = mediaType === 'tv' ? normalizeEpisodeData(input.episode || tvContext?.episode) : null
  const referenceScope = normalizeReferenceScope(
    input.referenceScope
    || input.reference_scope
    || tvContext?.referenceScope
    || 'series'
  )

  return {
    tmdbId,
    mediaType,
    entityType: mediaTypeRaw === 'movie' || mediaTypeRaw === 'tv' ? mediaTypeRaw : mediaType,
    title,
    query,
    year,
    releaseDate,
    region: normalizeRegion(input.region),
    language: normalizeLanguage(input.language || input.languageCode),
    rules,
    referenceScope,
    season,
    episode,
    factLocks,
    selectedImages,
    candidate,
    searchMeta,
    movieOrTv,
    tvContext: mediaType === 'tv' ? tvContext : null,
    scopeLabels,
    debug: isPlainObject(input.debug) ? input.debug : null,
    updatedAt: new Date().toISOString()
  }
}

export function buildTmdbGenerateRequestFromSelection(selectionInput) {
  const selection = normalizeTmdbSelection(selectionInput)
  if (!selection?.tmdbId) return { tmdb: { enabled: false } }

  const mediaTypeRaw = String(selection.entityType || selection.mediaType || 'multi').trim().toLowerCase()
  const mediaType = normalizeMediaType(mediaTypeRaw)
  const query = String(selection.query || selection.title || '').trim()
  const year = normalizeYear(selection.year || '')
  const region = normalizeRegion(selection.region || '')
  const language = normalizeLanguage(selection.language || selection.languageCode || '')
  const rules = normalizeRules(selection.rules)
  const factLocks = normalizeFactLocksForRequest(selection.factLocks, mediaType)
  const selectedImages = normalizeSelectedImages(selection.selectedImages)
  const request = {
    tmdb: {
      enabled: true,
      mediaType,
      tmdbId: Number(selection.tmdbId),
      ...(query ? { query } : {}),
      ...(year ? { year } : {}),
      ...(region ? { region } : {}),
      ...(language ? { language } : {}),
      rules,
      factLocks,
      ...(selectedImages.length ? { selectedImages } : {})
    }
  }

  if (mediaType === 'tv') {
    const referenceScope = normalizeReferenceScope(
      selection.referenceScope
      || selection.tvContext?.referenceScope
      || 'series'
    )
    request.tmdb.referenceScope = referenceScope

    const season = normalizeSeasonData(selection.season || selection.tvContext?.season)
    const episode = normalizeEpisodeData(selection.episode || selection.tvContext?.episode)

    if (referenceScope === 'season' || referenceScope === 'episode') {
      if (season?.number) {
        request.tmdb.season = season
        request.tmdb.seasonNumber = Number(season.number)
      }
    }
    if (referenceScope === 'episode') {
      if (episode?.number) {
        request.tmdb.episode = episode
        request.tmdb.episodeNumber = Number(episode.number)
      }
    }
    const scopeLabels = normalizeScopeLabels(selection.scopeLabels, mediaType)
    if (scopeLabels) {
      request.tmdb.scopeLabels = scopeLabels
    }
  }

  return request
}

export function readTmdbFinderPrefs() {
  if (typeof window === 'undefined') return { ...TMDB_DEFAULT_PREFS }
  try {
    const rawCurrent = JSON.parse(window.localStorage.getItem(TMDB_PREFS_STORAGE_KEY) || '{}')
    const rawLegacy = JSON.parse(window.localStorage.getItem(TMDB_LEGACY_PREFS_STORAGE_KEY) || '{}')
    const merged = isPlainObject(rawCurrent) ? rawCurrent : {}
    const legacy = isPlainObject(rawLegacy) ? rawLegacy : {}
    return {
      enabled: typeof merged.enabled === 'boolean'
        ? merged.enabled
        : (typeof legacy.enabled === 'boolean' ? legacy.enabled : TMDB_DEFAULT_PREFS.enabled),
      mediaType: normalizeMediaType(merged.mediaType || legacy.mediaType || TMDB_DEFAULT_PREFS.mediaType),
      region: normalizeRegion(merged.region || legacy.region || TMDB_DEFAULT_PREFS.region),
      language: normalizeLanguage(merged.language || legacy.language || TMDB_DEFAULT_PREFS.language),
      query: String(merged.query || '').trim(),
      year: normalizeYear(merged.year || ''),
      referenceScope: normalizeReferenceScope(
        merged.referenceScope
        || merged.reference_scope
        || legacy.referenceScope
        || TMDB_DEFAULT_PREFS.referenceScope
      ),
      spoilerLevel: normalizeSpoilerLevel(
        merged.spoilerLevel
        || merged.spoiler_level
        || legacy.spoilerLevel
        || TMDB_DEFAULT_PREFS.spoilerLevel
      )
    }
  } catch (e) {
    return { ...TMDB_DEFAULT_PREFS }
  }
}

export function writeTmdbFinderPrefs(nextPrefs = {}) {
  if (typeof window === 'undefined') return
  const prev = readTmdbFinderPrefs()
  const merged = {
    enabled: typeof nextPrefs.enabled === 'boolean' ? nextPrefs.enabled : prev.enabled,
    mediaType: normalizeMediaType(nextPrefs.mediaType || prev.mediaType),
    region: normalizeRegion(nextPrefs.region || prev.region),
    language: normalizeLanguage(nextPrefs.language || prev.language),
    query: String(nextPrefs.query ?? prev.query ?? '').trim(),
    year: normalizeYear(nextPrefs.year ?? prev.year ?? ''),
    referenceScope: normalizeReferenceScope(nextPrefs.referenceScope ?? prev.referenceScope ?? 'series'),
    spoilerLevel: normalizeSpoilerLevel(nextPrefs.spoilerLevel ?? prev.spoilerLevel ?? 'light')
  }
  try {
    window.localStorage.setItem(TMDB_PREFS_STORAGE_KEY, JSON.stringify(merged))
  } catch (e) {}
}

export function readTmdbGenerateSelection() {
  if (typeof window === 'undefined') return null
  try {
    const raw = JSON.parse(window.localStorage.getItem(TMDB_SELECTION_STORAGE_KEY) || 'null')
    return normalizeTmdbSelection(raw)
  } catch (e) {
    return null
  }
}

export function writeTmdbGenerateSelection(selection) {
  if (typeof window === 'undefined') return null
  const normalized = normalizeTmdbSelection(selection)
  try {
    if (!normalized) {
      window.localStorage.removeItem(TMDB_SELECTION_STORAGE_KEY)
      return null
    }
    window.localStorage.setItem(TMDB_SELECTION_STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  } catch (e) {
    return null
  }
}

export function clearTmdbGenerateSelection() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TMDB_SELECTION_STORAGE_KEY)
  } catch (e) {}
}

export {
  TMDB_MAX_SELECTED_IMAGES,
  TMDB_FACT_LOCK_FIELDS,
  TMDB_TV_REFERENCE_SCOPES,
  TMDB_SPOILER_LEVELS
}
