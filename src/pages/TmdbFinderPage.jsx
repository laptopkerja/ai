import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Accordion, Alert, Badge, Button, Card, Col, Form, Nav, Pagination, Row, Spinner, Tab, Toast } from 'react-bootstrap'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { supabase } from '../supabase/client'
import { apiAxios } from '../lib/apiRuntime'
import {
  buildTmdbGenerateRequestFromSelection,
  TMDB_FACT_LOCK_FIELDS,
  TMDB_MAX_SELECTED_IMAGES,
  TMDB_SPOILER_LEVELS,
  TMDB_TV_REFERENCE_SCOPES,
  clearTmdbGenerateSelection,
  readTmdbFinderPrefs,
  readTmdbGenerateSelection,
  writeTmdbFinderPrefs,
  writeTmdbGenerateSelection
} from '../lib/tmdbSelection'

const TMDB_LANG_OPTIONS = ['en-US', 'id-ID', 'es-ES', 'ar-SA', 'hi-IN', 'ja-JP', 'ko-KR']
const TMDB_REGION_OPTIONS = ['US', 'ID', 'GB', 'JP', 'KR', 'IN', 'MY', 'SG']
const TMDB_FACT_LOCK_LABELS = {
  title: 'Title',
  tagline: 'Tagline',
  release_date: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  director: 'Director (Movie) / Creator (TV)',
  cast_top: 'Cast Top',
  overview: 'Overview',
  keywords: 'Keywords',
  certification_id: 'Certification',
  production_companies: 'Production Companies',
  networks: 'Networks',
  production_countries: 'Production Countries',
  vote_average: 'Vote Average',
  budget: 'Budget',
  revenue: 'Revenue',
  status: 'Status',
  original_language: 'Original Language',
  watch_providers_id: 'Watch Providers',
  trailer: 'Trailer'
}
const TMDB_CANDIDATE_FILTER_OPTIONS = [
  { key: 'hasPoster', label: 'Has Poster' },
  { key: 'hasTrailer', label: 'Has Trailer' },
  { key: 'hasWatchProviders', label: 'Has Watch Providers' }
]
const TMDB_COMPLETENESS_FIELDS_MOVIE = [
  'title',
  'release_date',
  'runtime',
  'genres',
  'director',
  'cast_top',
  'overview',
  'keywords',
  'certification_id',
  'watch_providers_id',
  'trailer',
  'production_companies',
  'production_countries',
  'vote_average'
]
const TMDB_COMPLETENESS_FIELDS_TV = [
  'title',
  'release_date',
  'runtime',
  'genres',
  'creator',
  'cast_top',
  'overview',
  'keywords',
  'certification_id',
  'watch_providers_id',
  'trailer',
  'networks',
  'production_companies',
  'production_countries',
  'vote_average'
]
const TMDB_TV_REFERENCE_SCOPE_LABELS = {
  series: 'Series',
  season: 'Season',
  episode: 'Episode'
}
const TMDB_SPOILER_LABELS = {
  no_spoiler: 'No Spoiler',
  light: 'Light',
  full: 'Full'
}
const TMDB_BROWSE_CATEGORIES = {
  movie: [
    { key: 'popular', label: 'Popular' },
    { key: 'top_rated', label: 'Top Rated' },
    { key: 'now_playing', label: 'Now Playing' },
    { key: 'upcoming', label: 'Upcoming' }
  ],
  tv: [
    { key: 'popular', label: 'Terpopular' },
    { key: 'top_rated', label: 'Top Rated' },
    { key: 'airing_today', label: 'Airing Today' },
    { key: 'on_tv', label: 'On TV' }
  ]
}
const TMDB_BROWSE_DEFAULT = { mediaType: 'movie', category: 'popular' }
const TMDB_BROWSE_PAGE_WINDOW = 5
const TMDB_BROWSE_STATE_STORAGE_KEY = 'tmdb_finder_browse_state_v1'
const TMDB_BROWSE_ACCORDION_STATE_STORAGE_KEY = 'tmdb_finder_browse_accordion_state_v1'
const TMDB_SEARCH_PAGE_STATE_STORAGE_KEY = 'tmdb_finder_search_page_state_v1'
const TMDB_SCOPE_HELP_TEXT = [
  'Series: membahas seluruh serial (all season), tanpa season/episode spesifik.',
  'Season: membahas 1 season terpilih dan semua episodenya.',
  'Episode: membahas 1 episode spesifik dalam season terpilih.'
]

function createCandidateKey(item) {
  const type = String(item?.mediaType || '').trim().toLowerCase()
  const id = Number(item?.tmdbId || 0)
  if (!type || !Number.isInteger(id) || id <= 0) return ''
  return `${type}:${id}`
}

function resolvePrimaryGenre(value) {
  if (Array.isArray(value)) {
    const first = String(value.find((item) => String(item || '').trim()) || '').trim()
    return first || ''
  }
  const raw = String(value || '').trim()
  if (!raw) return ''
  const first = raw.split(',').map((item) => item.trim()).find(Boolean)
  return first || raw
}

function parseTmdbQueryInput(rawInput) {
  const raw = String(rawInput || '').trim()
  if (!raw) return { query: '', tmdbId: null }
  const idPattern = /\b(?:tmdb|id)\s*[:#=\-]?\s*(\d{1,12})\b/i
  const match = raw.match(idPattern)
  if (!match) return { query: raw, tmdbId: null }
  const tmdbId = normalizePositiveInt(match[1])
  const queryWithoutId = raw
    .replace(match[0], ' ')
    .replace(/[|,;]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return {
    query: queryWithoutId,
    tmdbId
  }
}

function mapApiError(err, fallback = 'Request failed') {
  const status = Number(err?.response?.status || 0)
  const code = String(err?.response?.data?.error?.code || '').trim()
  const message = String(err?.response?.data?.error?.message || err?.message || fallback).trim()
  if (status === 401) return 'Sesi login sudah habis. Silakan login ulang.'
  if (code === 'KEY_NOT_CONFIGURED') return 'TMDB key belum dikonfigurasi. Isi dulu di Settings.'
  return message || fallback
}

function formatMoney(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '-'
  return `$${new Intl.NumberFormat('en-US').format(Math.round(num))}`
}

function slugifyDownloadName(value, fallback = 'movie-title') {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || fallback
}

function buildTmdbImageUrlFromPath(path, size = 'w300') {
  const filePath = String(path || '').trim()
  if (!filePath) return ''
  return `https://image.tmdb.org/t/p/${size}${filePath}`
}

function getFactLockFieldsForEntityType(entityType = 'multi') {
  const safeType = String(entityType || '').trim().toLowerCase()
  if (safeType === 'tv') {
    return TMDB_FACT_LOCK_FIELDS.filter((field) => field !== 'budget' && field !== 'revenue')
  }
  if (safeType === 'movie') {
    return TMDB_FACT_LOCK_FIELDS.filter((field) => field !== 'networks')
  }
  return TMDB_FACT_LOCK_FIELDS
}

function normalizeFactLocksForState(raw, entityType = 'multi') {
  const source = raw && typeof raw === 'object' ? raw : {}
  const safeType = String(entityType || '').trim().toLowerCase()
  return TMDB_FACT_LOCK_FIELDS.reduce((acc, field) => {
    if (safeType === 'tv' && (field === 'budget' || field === 'revenue')) {
      return acc
    }
    if (safeType === 'movie' && field === 'networks') {
      return acc
    }
    acc[field] = source[field] !== false
    return acc
  }, {})
}

function hasFilledTmdbValue(value) {
  if (Array.isArray(value)) return value.some((item) => String(item || '').trim())
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return String(value || '').trim().length > 0
}

function isSparseTmdbDetailMovieOrTv(movieOrTv) {
  if (!movieOrTv || typeof movieOrTv !== 'object') return true
  const hasOverview = String(movieOrTv.overview || '').trim().length > 0
  const hasTagline = String(movieOrTv.tagline || '').trim().length > 0
  const hasWatchProviders = Array.isArray(movieOrTv.watch_providers_id)
    && movieOrTv.watch_providers_id.some((item) => String(item || '').trim())
  // Sparse berarti ketiganya kosong; biasanya indikasi detail belum tersinkron penuh.
  return !hasOverview && !hasTagline && !hasWatchProviders
}

function createCandidateCapability(item) {
  return {
    hasPoster: !!String(item?.posterUrl || '').trim(),
    hasTrailer: false,
    hasWatchProviders: false,
    primaryGenre: resolvePrimaryGenre(item?.primaryGenre || item?.genres),
    resolved: false
  }
}

function buildCandidateFromTmdbDetailPayload(payload, { fallbackMediaType = 'multi', fallbackTitle = '', tmdbId = null } = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const movieOrTv = safePayload.movieOrTv && typeof safePayload.movieOrTv === 'object' ? safePayload.movieOrTv : {}
  const entityType = String(safePayload.entityType || fallbackMediaType || 'movie').trim().toLowerCase() === 'tv'
    ? 'tv'
    : 'movie'
  const releaseDate = String(movieOrTv.release_date || '').trim()
  const year = /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : ''
  const rating = Number(movieOrTv.vote_average || 0)
  const detailTmdbId = normalizePositiveInt(movieOrTv.tmdb_id || tmdbId)
  const primaryGenre = resolvePrimaryGenre(movieOrTv.genres)
  const imageOptions = Array.isArray(safePayload.imageOptions) ? safePayload.imageOptions : []
  const posterOption = imageOptions.find((row) => String(row?.source || '').trim().toLowerCase() === 'poster')
  const posterUrl = String(posterOption?.previewUrl || posterOption?.url || '').trim()
  return {
    tmdbId: detailTmdbId || normalizePositiveInt(tmdbId) || 0,
    mediaType: entityType,
    title: String(movieOrTv.title || fallbackTitle || '').trim() || `TMDB #${detailTmdbId || tmdbId || ''}`,
    originalTitle: '',
    year,
    releaseDate,
    rating: Number.isFinite(rating) ? Number(rating.toFixed(1)) : null,
    posterPath: null,
    posterUrl: posterUrl || null,
    primaryGenre: primaryGenre || '',
    overview: String(movieOrTv.overview || '').trim()
  }
}

function normalizeBrowseMediaType(value) {
  return String(value || '').trim().toLowerCase() === 'tv' ? 'tv' : 'movie'
}

function normalizeBrowseCategory(mediaType, value) {
  const safeType = normalizeBrowseMediaType(mediaType)
  const list = TMDB_BROWSE_CATEGORIES[safeType] || []
  const key = String(value || '').trim().toLowerCase()
  if (list.some((item) => item.key === key)) return key
  return list[0]?.key || 'popular'
}

function normalizeReferenceScope(value) {
  const key = String(value || '').trim().toLowerCase()
  return TMDB_TV_REFERENCE_SCOPES.includes(key) ? key : 'series'
}

function normalizeSpoilerLevel(value) {
  const key = String(value || '').trim().toLowerCase()
  return TMDB_SPOILER_LEVELS.includes(key) ? key : 'light'
}

function normalizePositiveInt(value) {
  const raw = Number(value || 0)
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

function normalizeTvScopeContext(input = {}) {
  const tv = input && typeof input === 'object' ? input : {}
  const seasonOptions = Array.isArray(tv.seasonOptions) ? tv.seasonOptions : []
  const episodeOptions = Array.isArray(tv.episodeOptions) ? tv.episodeOptions : []
  const season = tv.season && typeof tv.season === 'object' ? tv.season : null
  const episode = tv.episode && typeof tv.episode === 'object' ? tv.episode : null
  return {
    referenceScope: normalizeReferenceScope(tv.referenceScope || 'series'),
    spoilerLevel: normalizeSpoilerLevel(tv.spoilerLevel || 'light'),
    seasonCount: normalizePositiveInt(tv.seasonCount),
    episodeCount: normalizePositiveInt(tv.episodeCount),
    episodeType: String(tv.episodeType || '').trim().toLowerCase() || null,
    season: season
      ? {
          number: normalizePositiveInt(season.number),
          name: String(season.name || '').trim(),
          airDate: String(season.airDate || '').trim(),
          overview: String(season.overview || '').trim(),
          episodeCount: normalizePositiveInt(season.episodeCount)
        }
      : null,
    episode: episode
      ? {
          number: normalizePositiveInt(episode.number),
          name: String(episode.name || '').trim(),
          airDate: String(episode.airDate || '').trim(),
          overview: String(episode.overview || '').trim(),
          runtime: normalizePositiveInt(episode.runtime),
          voteAverage: Number.isFinite(Number(episode.voteAverage))
            ? Number(Number(episode.voteAverage).toFixed(1))
            : null,
          episodeType: String(episode.episodeType || '').trim().toLowerCase() || null
        }
      : null,
    seasonOptions: seasonOptions
      .map((row) => {
        const number = normalizePositiveInt(row?.number)
        if (!number) return null
        return {
          number,
          name: String(row?.name || '').trim(),
          airDate: String(row?.airDate || '').trim(),
          overview: String(row?.overview || '').trim(),
          episodeCount: normalizePositiveInt(row?.episodeCount)
        }
      })
      .filter(Boolean),
    episodeOptions: episodeOptions
      .map((row) => {
        const number = normalizePositiveInt(row?.number)
        if (!number) return null
        return {
          number,
          name: String(row?.name || '').trim(),
          airDate: String(row?.airDate || '').trim(),
          overview: String(row?.overview || '').trim(),
          runtime: normalizePositiveInt(row?.runtime),
          voteAverage: Number.isFinite(Number(row?.voteAverage))
            ? Number(Number(row.voteAverage).toFixed(1))
            : null,
          episodeType: String(row?.episodeType || '').trim().toLowerCase() || null
        }
      })
      .filter(Boolean)
  }
}

function buildTvSelectionLabels({
  referenceScope = 'series',
  season = null,
  episode = null
} = {}) {
  const scope = normalizeReferenceScope(referenceScope)
  const seasonNumber = normalizePositiveInt(season?.number)
  const seasonName = String(season?.name || '').trim()
  const seasonLabel = seasonNumber
    ? `S${seasonNumber}${seasonName ? ` · ${seasonName}` : ''}`
    : '-'

  if (scope === 'series') {
    return {
      season: 'All Season',
      episode: 'All Episode'
    }
  }

  if (scope === 'season') {
    return {
      season: seasonLabel,
      episode: seasonLabel !== '-' ? `${seasonLabel} · All Episode` : 'All Episode'
    }
  }

  const episodeNumber = normalizePositiveInt(episode?.number)
  const episodeName = String(episode?.name || '').trim()
  const episodeBase = episodeNumber
    ? `E${episodeNumber}${episodeName ? ` · ${episodeName}` : ''}`
    : '-'
  return {
    season: seasonLabel,
    episode: seasonLabel !== '-' ? `${seasonLabel} · ${episodeBase}` : episodeBase
  }
}

function sanitizeMovieOrTvForSelection(movieOrTv, entityType, tvMeta = {}) {
  const source = movieOrTv && typeof movieOrTv === 'object' ? movieOrTv : {}
  const safeType = String(entityType || '').trim().toLowerCase()
  if (safeType !== 'tv') {
    const next = { ...source }
    delete next.networks
    delete next.reference_scope
    delete next.season_count
    delete next.episode_count
    delete next.episode_type
    delete next.season_overview
    delete next.episode_overview
    delete next.season_label
    delete next.episode_label
    return Object.keys(next).length ? next : null
  }

  const scope = normalizeReferenceScope(tvMeta.referenceScope || source.reference_scope || 'series')
  const seasonCount = normalizePositiveInt(tvMeta.seasonCount ?? source.season_count)
  const episodeCount = normalizePositiveInt(tvMeta.episodeCount ?? source.episode_count)
  const episodeType = String(tvMeta.episodeType || source.episode_type || '').trim().toLowerCase() || null
  const seasonOverview = String(tvMeta.seasonOverview || source.season_overview || '').trim()
  const episodeOverview = String(tvMeta.episodeOverview || source.episode_overview || '').trim()
  const seasonLabel = String(tvMeta.seasonLabel || source.season_label || '').trim()
  const episodeLabel = String(tvMeta.episodeLabel || source.episode_label || '').trim()

  const next = {
    ...source,
    reference_scope: scope,
    season_count: seasonCount ?? null,
    episode_count: episodeCount ?? null,
    episode_type: episodeType || null,
    season_overview: seasonOverview,
    episode_overview: episodeOverview,
    season_label: seasonLabel || '',
    episode_label: episodeLabel || ''
  }
  delete next.budget
  delete next.revenue
  return Object.keys(next).length ? next : null
}

function readTmdbBrowseState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = JSON.parse(window.localStorage.getItem(TMDB_BROWSE_STATE_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return null
    const mediaType = normalizeBrowseMediaType(raw.mediaType)
    const category = normalizeBrowseCategory(mediaType, raw.category)
    const pageRaw = Number(raw.page || 1)
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1
    return { mediaType, category, page }
  } catch (e) {
    return null
  }
}

function writeTmdbBrowseState(state) {
  if (typeof window === 'undefined') return
  try {
    const mediaType = normalizeBrowseMediaType(state?.mediaType)
    const category = normalizeBrowseCategory(mediaType, state?.category)
    const pageRaw = Number(state?.page || 1)
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1
    window.localStorage.setItem(
      TMDB_BROWSE_STATE_STORAGE_KEY,
      JSON.stringify({ mediaType, category, page })
    )
  } catch (e) {}
}

function readTmdbBrowseAccordionOpenState() {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(TMDB_BROWSE_ACCORDION_STATE_STORAGE_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
    return true
  } catch (e) {
    return true
  }
}

function writeTmdbBrowseAccordionOpenState(isOpen) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TMDB_BROWSE_ACCORDION_STATE_STORAGE_KEY, isOpen ? '1' : '0')
  } catch (e) {}
}

function readTmdbSearchPageState() {
  if (typeof window === 'undefined') return 1
  try {
    const raw = Number(window.localStorage.getItem(TMDB_SEARCH_PAGE_STATE_STORAGE_KEY) || '1')
    if (!Number.isFinite(raw)) return 1
    return Math.max(1, Math.floor(raw))
  } catch (e) {
    return 1
  }
}

function writeTmdbSearchPageState(page) {
  if (typeof window === 'undefined') return
  try {
    const safe = Math.max(1, Math.floor(Number(page || 1) || 1))
    window.localStorage.setItem(TMDB_SEARCH_PAGE_STATE_STORAGE_KEY, String(safe))
  } catch (e) {}
}

export default function TmdbFinderPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const initialPrefs = useMemo(() => readTmdbFinderPrefs(), [])
  const initialSelection = useMemo(() => readTmdbGenerateSelection(), [])
  const initialBrowseState = useMemo(() => readTmdbBrowseState(), [])
  const initialBrowseAccordionOpen = useMemo(() => readTmdbBrowseAccordionOpenState(), [])
  const initialSearchPage = useMemo(() => readTmdbSearchPageState(), [])
  const seededQuery = String(location?.state?.seedQuery || '').trim()

  const [mediaType, setMediaType] = useState(initialSelection?.entityType || initialPrefs.mediaType || 'multi')
  const [query, setQuery] = useState(seededQuery || '')
  const [year, setYear] = useState('')
  const [region, setRegion] = useState(initialSelection?.region || initialPrefs.region || 'US')
  const [language, setLanguage] = useState(initialSelection?.language || initialPrefs.language || 'en-US')
  const [referenceScope, setReferenceScope] = useState(
    normalizeReferenceScope(initialSelection?.referenceScope || initialPrefs.referenceScope || 'series')
  )
  const [spoilerLevel, setSpoilerLevel] = useState(
    normalizeSpoilerLevel(initialSelection?.rules?.spoilerLevel || initialPrefs.spoilerLevel || 'light')
  )
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState(
    normalizePositiveInt(initialSelection?.season?.number || initialSelection?.tvContext?.season?.number)
  )
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState(
    normalizePositiveInt(initialSelection?.episode?.number || initialSelection?.tvContext?.episode?.number)
  )
  const [tvSeasonOptions, setTvSeasonOptions] = useState(
    () => normalizeTvScopeContext(initialSelection?.tvContext || {}).seasonOptions || []
  )
  const [tvEpisodeOptions, setTvEpisodeOptions] = useState(
    () => normalizeTvScopeContext(initialSelection?.tvContext || {}).episodeOptions || []
  )
  const [factLocks, setFactLocks] = useState(() => normalizeFactLocksForState(
    initialSelection?.factLocks,
    initialSelection?.entityType || initialSelection?.mediaType || 'multi'
  ))

  const [searching, setSearching] = useState(false)
  const [probingCandidateMeta, setProbingCandidateMeta] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [candidateCapabilities, setCandidateCapabilities] = useState({})
  const [candidateFilters, setCandidateFilters] = useState({
    hasPoster: false,
    hasTrailer: false,
    hasWatchProviders: false
  })
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState(null)
  const [selectedImages, setSelectedImages] = useState(initialSelection?.selectedImages || [])
  const [searchMeta, setSearchMeta] = useState(initialSelection?.searchMeta || null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [scopeHelpToastVisible, setScopeHelpToastVisible] = useState(false)
  const [floatingAlerts, setFloatingAlerts] = useState([])
  const candidateProbeRequestRef = useRef(0)
  const languageRegionRefreshReadyRef = useRef(false)
  const tvEpisodeOptionsCacheRef = useRef(new Map())
  const floatingAlertIdRef = useRef(0)
  const floatingAlertTimersRef = useRef({})
  const lastErrorFloatingRef = useRef('')
  const lastNoticeFloatingRef = useRef('')
  const initialBrowseLoadedRef = useRef(false)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseItems, setBrowseItems] = useState([])
  const initialBrowseMediaType = normalizeBrowseMediaType(
    initialBrowseState?.mediaType || initialSelection?.entityType || TMDB_BROWSE_DEFAULT.mediaType
  )
  const initialBrowseCategory = normalizeBrowseCategory(
    initialBrowseMediaType,
    initialBrowseState?.category || TMDB_BROWSE_DEFAULT.category
  )
  const initialBrowsePage = Math.max(1, Number(initialBrowseState?.page || 1) || 1)
  const [browseMeta, setBrowseMeta] = useState({
    mediaType: initialBrowseMediaType,
    category: initialBrowseCategory
  })
  const [browsePicker, setBrowsePicker] = useState({
    mediaType: initialBrowseMediaType,
    category: initialBrowseCategory
  })
  const [browsePager, setBrowsePager] = useState({
    page: initialBrowsePage,
    totalPages: 1,
    totalResults: 0,
    maxPage: 500
  })
  const [activeImageTab, setActiveImageTab] = useState('poster')
  const [payloadPreviewMode, setPayloadPreviewMode] = useState('strict')
  const [browseAccordionOpen, setBrowseAccordionOpen] = useState(initialBrowseAccordionOpen)
  const [cardDataMode, setCardDataMode] = useState('browse')
  const [searchPager, setSearchPager] = useState({
    page: initialSearchPage,
    totalPages: 1,
    totalResults: 0,
    maxPage: 500
  })

  const latestUiContextRef = useRef(null)
  latestUiContextRef.current = {
    cardDataMode,
    query,
    selectedCandidateKey,
    browseMediaType: browsePicker?.mediaType,
    browseCategory: browsePicker?.category
  }

  useEffect(() => {
    writeTmdbFinderPrefs({
      enabled: true,
      mediaType,
      query: '',
      year: '',
      region,
      language,
      referenceScope,
      spoilerLevel
    })
  }, [language, mediaType, referenceScope, region, spoilerLevel])

  useEffect(() => {
    if (!languageRegionRefreshReadyRef.current) {
      languageRegionRefreshReadyRef.current = true
      return
    }
    const refreshTimer = setTimeout(async () => {
      const ctx = latestUiContextRef.current || {}
      const activeMode = String(ctx.cardDataMode || '').trim().toLowerCase()
      const activeQuery = String(ctx.query || '').trim()
      const preferredCandidateKey = String(ctx.selectedCandidateKey || '').trim()
      setError('')
      setNotice(`Memuat ulang data untuk ${language} / ${region}...`)
      if (activeMode === 'search' && activeQuery) {
        await handleSearch({
          page: 1,
          silent: true,
          preferCandidateKey: preferredCandidateKey,
          isAutoRefresh: true
        })
        return
      }
      await handleBrowseCategory(
        ctx.browseMediaType || browsePicker?.mediaType || 'movie',
        ctx.browseCategory || browsePicker?.category || 'popular',
        {
          autoSelect: true,
          page: 1,
          silent: true,
          preferCandidateKey: preferredCandidateKey,
          isAutoRefresh: true
        }
      )
    }, 350)
    return () => clearTimeout(refreshTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, region])

  useEffect(() => {
    const stateObj = location?.state && typeof location.state === 'object' ? location.state : null
    if (!stateObj || !Object.prototype.hasOwnProperty.call(stateObj, 'seedQuery')) return
    const nextState = { ...stateObj }
    delete nextState.seedQuery
    navigate(location.pathname, {
      replace: true,
      state: Object.keys(nextState).length ? nextState : null
    })
  }, [location.pathname, location.state, navigate])

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

  function buildTvEpisodeCacheKey({ tmdbId, seasonNumber, languageCode, regionCode }) {
    const safeTmdbId = normalizePositiveInt(tmdbId)
    const safeSeasonNumber = normalizePositiveInt(seasonNumber)
    const safeLanguage = String(languageCode || language || '').trim().toLowerCase()
    const safeRegion = String(regionCode || region || '').trim().toUpperCase()
    if (!safeTmdbId || !safeSeasonNumber || !safeLanguage || !safeRegion) return ''
    return `${safeTmdbId}:${safeLanguage}:${safeRegion}:S${safeSeasonNumber}`
  }

  function readCachedTvEpisodeOptions({ tmdbId, seasonNumber, languageCode, regionCode }) {
    const key = buildTvEpisodeCacheKey({ tmdbId, seasonNumber, languageCode, regionCode })
    if (!key) return []
    const cached = tvEpisodeOptionsCacheRef.current.get(key)
    if (!Array.isArray(cached) || !cached.length) return []
    return cached.map((item) => ({ ...item }))
  }

  function writeCachedTvEpisodeOptions({ tmdbId, seasonNumber, episodeOptions, languageCode, regionCode }) {
    const key = buildTvEpisodeCacheKey({ tmdbId, seasonNumber, languageCode, regionCode })
    if (!key) return
    const normalized = normalizeTvScopeContext({ episodeOptions }).episodeOptions || []
    tvEpisodeOptionsCacheRef.current.set(key, normalized.map((item) => ({ ...item })))
  }

  function seedTvEpisodeOptionsFromCache({ tmdbId, seasonNumber }) {
    const safeTmdbId = normalizePositiveInt(tmdbId)
    const safeSeason = normalizePositiveInt(seasonNumber)
    if (!safeTmdbId || !safeSeason) return []
    const cached = readCachedTvEpisodeOptions({ tmdbId: safeTmdbId, seasonNumber: safeSeason })
    if (cached.length) setTvEpisodeOptions(cached)
    return cached
  }

  function removeFloatingAlert(alertId) {
    const id = Number(alertId || 0)
    if (!id) return
    setFloatingAlerts((prev) => prev.filter((item) => item.id !== id))
    const timer = floatingAlertTimersRef.current[id]
    if (timer) {
      clearTimeout(timer)
      delete floatingAlertTimersRef.current[id]
    }
  }

  function resolveFloatingAlertBehavior(variant, optionsOrDuration) {
    const level = String(variant || 'warning').trim().toLowerCase()
    const stickyByLevel = level === 'warning' || level === 'danger'
    const hasDurationNumber = Number.isFinite(Number(optionsOrDuration))
    const options = optionsOrDuration && typeof optionsOrDuration === 'object' ? optionsOrDuration : {}
    const hasExplicitAutohide = typeof options.autohide === 'boolean'
    const hasExplicitDuration = hasDurationNumber || Number.isFinite(Number(options.durationMs))

    const autohide = hasExplicitAutohide
      ? options.autohide
      : !stickyByLevel
    const duration = hasExplicitDuration
      ? Math.max(0, Math.round(hasDurationNumber ? Number(optionsOrDuration) : Number(options.durationMs)))
      : (autohide ? (level === 'success' ? 3000 : 2800) : 0)
    return { autohide, duration }
  }

  function pushFloatingAlert(message, variant = 'warning', optionsOrDuration) {
    const text = String(message || '').trim()
    if (!text) return
    const behavior = resolveFloatingAlertBehavior(variant, optionsOrDuration)
    const id = floatingAlertIdRef.current + 1
    floatingAlertIdRef.current = id
    setFloatingAlerts((prev) => [...prev, { id, message: text, variant }].slice(-4))
    if (behavior.autohide && behavior.duration > 0) {
      const timer = setTimeout(() => {
        removeFloatingAlert(id)
      }, behavior.duration)
      floatingAlertTimersRef.current[id] = timer
    }
  }

  useEffect(() => {
    const text = String(error || '').trim()
    if (!text) {
      lastErrorFloatingRef.current = ''
      return
    }
    if (lastErrorFloatingRef.current === text) return
    lastErrorFloatingRef.current = text
    pushFloatingAlert(text, 'danger')
  }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const text = String(notice || '').trim()
    if (!text) {
      lastNoticeFloatingRef.current = ''
      return
    }
    if (lastNoticeFloatingRef.current === text) return
    lastNoticeFloatingRef.current = text
    pushFloatingAlert(text, 'info')
  }, [notice]) // eslint-disable-line react-hooks/exhaustive-deps

  function showScopeHelpToast() {
    setScopeHelpToastVisible(true)
  }

  function validateTvScopeBeforeApply() {
    const scope = normalizeReferenceScope(referenceScope)
    const detailType = String(detailData?.entityType || '').trim().toLowerCase()
    const selectionType = String(selectionPayload?.entityType || '').trim().toLowerCase()
    const isTv = detailType === 'tv' || selectionType === 'tv'
    if (!isTv) return null
    const seasonNumber = normalizePositiveInt(
      selectedSeasonNumber
      || detailData?.tvContext?.season?.number
    )
    const episodeNumber = normalizePositiveInt(
      selectedEpisodeNumber
      || detailData?.tvContext?.episode?.number
    )
    if ((scope === 'season' || scope === 'episode') && !seasonNumber) {
      return 'Pilih Season dulu sebelum gunakan data TMDB.'
    }
    if (scope === 'episode' && !episodeNumber) {
      return 'Pilih Episode dulu sebelum gunakan data TMDB.'
    }
    return null
  }

  useEffect(() => {
    return () => {
      Object.values(floatingAlertTimersRef.current).forEach((timer) => {
        clearTimeout(timer)
      })
      floatingAlertTimersRef.current = {}
    }
  }, [])

  async function fetchTmdbDetail(candidate, options = {}) {
    if (!candidate?.tmdbId) return
    const candidateMediaType = String(candidate.mediaType || mediaType || 'multi').trim().toLowerCase()
    const isTv = candidateMediaType === 'tv'
    const nextScope = normalizeReferenceScope(options.referenceScope ?? referenceScope)
    const nextSpoilerLevel = normalizeSpoilerLevel(options.spoilerLevel ?? spoilerLevel)
    const nextSeasonNumber = Object.prototype.hasOwnProperty.call(options, 'seasonNumber')
      ? normalizePositiveInt(options.seasonNumber)
      : normalizePositiveInt(selectedSeasonNumber)
    const nextEpisodeNumber = Object.prototype.hasOwnProperty.call(options, 'episodeNumber')
      ? normalizePositiveInt(options.episodeNumber)
      : normalizePositiveInt(selectedEpisodeNumber)
    const scopePayload = {}
    if (isTv) {
      scopePayload.referenceScope = nextScope
      scopePayload.rules = {
        factual_only_from_tmdb: true,
        no_hallucination: true,
        spoilerLevel: nextSpoilerLevel
      }
      if (nextScope === 'season' || nextScope === 'episode') {
        if (nextSeasonNumber) scopePayload.seasonNumber = nextSeasonNumber
      }
      if (nextScope === 'episode' && nextEpisodeNumber) {
        scopePayload.episodeNumber = nextEpisodeNumber
      }
    }

    setDetailLoading(true)
    setError('')
    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      const resp = await apiAxios({
        method: 'post',
        url: '/api/tmdb/detail',
        data: {
          tmdbId: Number(candidate.tmdbId),
          mediaType: candidateMediaType,
          region,
          language,
          ...scopePayload
        },
        ...requestConfig
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error(resp.data?.error?.message || 'Gagal memuat detail TMDB')
      }
      const payload = resp.data.data
      const tvScope = normalizeTvScopeContext(payload?.tvContext || {})
      if (String(payload?.entityType || '').trim().toLowerCase() === 'tv') {
        const resolvedTmdbId = normalizePositiveInt(payload?.movieOrTv?.tmdb_id || candidate?.tmdbId)
        const resolvedSeasonNumber = normalizePositiveInt(tvScope.season?.number || nextSeasonNumber)
        if (resolvedTmdbId && resolvedSeasonNumber) {
          writeCachedTvEpisodeOptions({
            tmdbId: resolvedTmdbId,
            seasonNumber: resolvedSeasonNumber,
            episodeOptions: tvScope.episodeOptions || [],
            languageCode: language,
            regionCode: region
          })
        }
        setReferenceScope(tvScope.referenceScope || nextScope)
        setSpoilerLevel(tvScope.spoilerLevel || nextSpoilerLevel)
        setSelectedSeasonNumber(normalizePositiveInt(tvScope.season?.number))
        setSelectedEpisodeNumber(normalizePositiveInt(tvScope.episode?.number))
        setTvSeasonOptions(tvScope.seasonOptions || [])
        setTvEpisodeOptions(tvScope.episodeOptions || [])
      } else {
        setTvSeasonOptions([])
        setTvEpisodeOptions([])
        setSelectedSeasonNumber(null)
        setSelectedEpisodeNumber(null)
      }
      setDetailData(payload)
      const imageOptions = Array.isArray(payload.imageOptions) ? payload.imageOptions : []
      const optionUrlSet = new Set(imageOptions.map((x) => String(x?.url || '').trim()).filter(Boolean))
      setSelectedImages((prev) => {
        const filtered = (Array.isArray(prev) ? prev : [])
          .filter((x) => optionUrlSet.has(String(x?.url || '').trim()))
          .slice(0, TMDB_MAX_SELECTED_IMAGES)
        return filtered
      })
      return payload
    } catch (err) {
      setError(mapApiError(err, 'Gagal memuat detail TMDB'))
      setDetailData(null)
      return null
    } finally {
      setDetailLoading(false)
    }
  }

  async function hydrateCandidateCapabilities(rows, requestId) {
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) {
      if (candidateProbeRequestRef.current === requestId) {
        setCandidateCapabilities({})
      }
      return
    }

    setProbingCandidateMeta(true)
    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      const checks = await Promise.all(list.map(async (item) => {
        const key = createCandidateKey(item)
        const base = createCandidateCapability(item)
        if (!key) return null
        if (!Number.isInteger(Number(item?.tmdbId))) {
          return { key, ...base, resolved: true }
        }
        try {
          const resp = await apiAxios({
            method: 'post',
            url: '/api/tmdb/detail',
            data: {
              tmdbId: Number(item.tmdbId),
              mediaType: String(item.mediaType || mediaType || 'multi').trim().toLowerCase(),
              region,
              language
            },
            ...requestConfig
          })
          const payload = resp?.data?.data
          const watchProviders = Array.isArray(payload?.movieOrTv?.watch_providers_id)
            ? payload.movieOrTv.watch_providers_id.filter((x) => String(x || '').trim())
            : []
          const trailer = String(payload?.movieOrTv?.trailer || '').trim()
          const imageOptions = Array.isArray(payload?.imageOptions) ? payload.imageOptions : []
          const hasPosterFromDetail = imageOptions.some((x) => String(x?.url || '').trim())
          const primaryGenre = resolvePrimaryGenre(payload?.movieOrTv?.genres)
          return {
            key,
            hasPoster: base.hasPoster || hasPosterFromDetail,
            hasTrailer: !!trailer,
            hasWatchProviders: watchProviders.length > 0,
            primaryGenre: primaryGenre || base.primaryGenre || '',
            resolved: true
          }
        } catch (e) {
          return { key, ...base, resolved: true }
        }
      }))

      if (candidateProbeRequestRef.current !== requestId) return
      const nextMap = {}
      checks.forEach((row) => {
        if (!row?.key) return
        nextMap[row.key] = {
          hasPoster: !!row.hasPoster,
          hasTrailer: !!row.hasTrailer,
          hasWatchProviders: !!row.hasWatchProviders,
          resolved: row.resolved !== false
        }
      })
      setCandidateCapabilities(nextMap)
    } finally {
      if (candidateProbeRequestRef.current === requestId) {
        setProbingCandidateMeta(false)
      }
    }
  }

  function toggleCandidateFilter(filterKey) {
    if (!TMDB_CANDIDATE_FILTER_OPTIONS.some((item) => item.key === filterKey)) return
    setCandidateFilters((prev) => ({ ...prev, [filterKey]: !prev[filterKey] }))
  }

  function toggleFactLock(fieldKey) {
    if (!TMDB_FACT_LOCK_FIELDS.includes(fieldKey)) return
    setFactLocks((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }))
  }

  async function applyTvScopeControl(next = {}) {
    const activeCandidate = candidates.find((item) => createCandidateKey(item) === selectedCandidateKey) || null
    if (!activeCandidate) return
    const candidateType = String(activeCandidate.mediaType || detailData?.entityType || mediaType || '').trim().toLowerCase()
    if (candidateType !== 'tv') return

    let nextScope = normalizeReferenceScope(
      Object.prototype.hasOwnProperty.call(next, 'referenceScope') ? next.referenceScope : referenceScope
    )
    const nextSpoiler = normalizeSpoilerLevel(
      Object.prototype.hasOwnProperty.call(next, 'spoilerLevel') ? next.spoilerLevel : spoilerLevel
    )
    let nextSeason = Object.prototype.hasOwnProperty.call(next, 'seasonNumber')
      ? normalizePositiveInt(next.seasonNumber)
      : normalizePositiveInt(selectedSeasonNumber)
    let nextEpisode = Object.prototype.hasOwnProperty.call(next, 'episodeNumber')
      ? normalizePositiveInt(next.episodeNumber)
      : normalizePositiveInt(selectedEpisodeNumber)
    const activeTmdbId = normalizePositiveInt(detailData?.movieOrTv?.tmdb_id || activeCandidate?.tmdbId)

    if (nextScope === 'series') {
      nextSeason = null
      nextEpisode = null
    } else if (nextScope === 'season') {
      if (!nextSeason) nextSeason = normalizePositiveInt(tvSeasonOptions?.[0]?.number)
      if (!nextSeason) {
        pushFloatingAlert('Season tidak tersedia untuk scope Season. Pilih kandidat TV lain atau ganti language/region.', 'warning')
        return
      }
      seedTvEpisodeOptionsFromCache({ tmdbId: activeTmdbId, seasonNumber: nextSeason })
      nextEpisode = null
    } else if (nextScope === 'episode') {
      if (!nextSeason) nextSeason = normalizePositiveInt(tvSeasonOptions?.[0]?.number)
      if (!nextSeason) {
        pushFloatingAlert('Pilih Season dulu sebelum masuk ke scope Episode.', 'warning')
        return
      }
      const cachedEpisodeOptions = seedTvEpisodeOptionsFromCache({ tmdbId: activeTmdbId, seasonNumber: nextSeason })
      if (!nextEpisode && cachedEpisodeOptions.length) {
        nextEpisode = normalizePositiveInt(cachedEpisodeOptions[0]?.number)
      }
      if (!nextEpisode) nextEpisode = normalizePositiveInt(tvEpisodeOptions?.[0]?.number)
      if (!nextEpisode) {
        pushFloatingAlert('Episode belum tersedia. Pilih Season yang punya episode, lalu pilih Episode.', 'warning')
        return
      }
    }

    setReferenceScope(nextScope)
    setSpoilerLevel(nextSpoiler)
    setSelectedSeasonNumber(nextSeason)
    setSelectedEpisodeNumber(nextEpisode)
    await fetchTmdbDetail(activeCandidate, {
      referenceScope: nextScope,
      spoilerLevel: nextSpoiler,
      seasonNumber: nextSeason,
      episodeNumber: nextEpisode
    })
  }

  async function handleTvScopeChange(value) {
    const nextScope = normalizeReferenceScope(value)
    const currentTmdbId = normalizePositiveInt(detailData?.movieOrTv?.tmdb_id || detailSelectedCandidate?.tmdbId)
    const currentSeason = normalizePositiveInt(selectedSeasonNumber)
    if (nextScope === 'episode' && currentTmdbId && currentSeason) {
      seedTvEpisodeOptionsFromCache({ tmdbId: currentTmdbId, seasonNumber: currentSeason })
    }
    await applyTvScopeControl({ referenceScope: value })
  }

  async function handleTvSeasonChange(value) {
    const seasonNumber = normalizePositiveInt(value)
    if (!seasonNumber) {
      pushFloatingAlert('Pilih Season yang valid.', 'warning')
      return
    }
    const currentTmdbId = normalizePositiveInt(detailData?.movieOrTv?.tmdb_id || detailSelectedCandidate?.tmdbId)
    if (currentTmdbId) {
      const cachedEpisodeOptions = seedTvEpisodeOptionsFromCache({ tmdbId: currentTmdbId, seasonNumber })
      if (!cachedEpisodeOptions.length) setTvEpisodeOptions([])
    }
    setSelectedEpisodeNumber(null)
    await applyTvScopeControl({
      referenceScope: 'season',
      seasonNumber,
      episodeNumber: null
    })
  }

  async function handleTvEpisodeChange(value) {
    const episodeNumber = normalizePositiveInt(value)
    if (!episodeNumber) {
      pushFloatingAlert('Pilih Episode yang valid.', 'warning')
      return
    }
    await applyTvScopeControl({
      referenceScope: 'episode',
      episodeNumber
    })
  }

  const filteredCandidates = useMemo(() => {
    if (!Array.isArray(candidates) || !candidates.length) return []
    return candidates.filter((item) => {
      const key = createCandidateKey(item)
      const cap = key ? candidateCapabilities[key] : null
      const effective = cap || createCandidateCapability(item)
      if (candidateFilters.hasPoster && !effective.hasPoster) return false
      if (candidateFilters.hasTrailer && effective.resolved && !effective.hasTrailer) return false
      if (candidateFilters.hasWatchProviders && effective.resolved && !effective.hasWatchProviders) return false
      return true
    })
  }, [candidateCapabilities, candidateFilters, candidates])
  const isSearchCardMode = cardDataMode === 'search'
  const cardDisplayItems = filteredCandidates

  const detailCompleteness = useMemo(() => {
    const movie = detailData?.movieOrTv
    const isTv = String(detailData?.entityType || '').trim().toLowerCase() === 'tv'
    const fields = isTv ? TMDB_COMPLETENESS_FIELDS_TV : TMDB_COMPLETENESS_FIELDS_MOVIE
    const total = fields.length
    if (!movie || typeof movie !== 'object') {
      return { total, filled: 0, percent: 0, variant: 'secondary' }
    }
    const filled = fields.reduce((sum, field) => {
      return sum + (hasFilledTmdbValue(movie[field]) ? 1 : 0)
    }, 0)
    const percent = total > 0 ? Math.round((filled / total) * 100) : 0
    const variant = percent >= 85 ? 'success' : (percent >= 60 ? 'warning' : 'danger')
    return { total, filled, percent, variant }
  }, [detailData?.entityType, detailData?.movieOrTv])

  const browseCategoryLabel = useMemo(() => {
    const type = normalizeBrowseMediaType(browseMeta.mediaType)
    const category = normalizeBrowseCategory(type, browseMeta.category)
    const list = TMDB_BROWSE_CATEGORIES[type] || []
    return list.find((item) => item.key === category)?.label || category
  }, [browseMeta.category, browseMeta.mediaType])

  const browsePageItems = useMemo(() => {
    const total = Math.max(1, Number(browsePager?.totalPages || 1))
    const current = Math.max(1, Math.min(Number(browsePager?.page || 1), total))
    const half = Math.floor(TMDB_BROWSE_PAGE_WINDOW / 2)
    let start = Math.max(1, current - half)
    let end = Math.min(total, start + TMDB_BROWSE_PAGE_WINDOW - 1)
    start = Math.max(1, end - TMDB_BROWSE_PAGE_WINDOW + 1)
    const out = []
    for (let page = start; page <= end; page += 1) out.push(page)
    return out
  }, [browsePager?.page, browsePager?.totalPages])

  const searchPageItems = useMemo(() => {
    const total = Math.max(1, Number(searchPager?.totalPages || 1))
    const current = Math.max(1, Math.min(Number(searchPager?.page || 1), total))
    const half = Math.floor(TMDB_BROWSE_PAGE_WINDOW / 2)
    let start = Math.max(1, current - half)
    let end = Math.min(total, start + TMDB_BROWSE_PAGE_WINDOW - 1)
    start = Math.max(1, end - TMDB_BROWSE_PAGE_WINDOW + 1)
    const out = []
    for (let page = start; page <= end; page += 1) out.push(page)
    return out
  }, [searchPager?.page, searchPager?.totalPages])

  const browseTrailingPageItems = useMemo(() => {
    const total = Math.max(1, Number(browsePager?.totalPages || 1))
    const lastWindowPage = browsePageItems[browsePageItems.length - 1] || 0
    const start = Math.max(1, total - 1)
    const out = []
    for (let page = start; page <= total; page += 1) {
      if (page <= lastWindowPage) continue
      if (browsePageItems.includes(page)) continue
      out.push(page)
    }
    return out
  }, [browsePageItems, browsePager?.totalPages])

  const searchTrailingPageItems = useMemo(() => {
    const total = Math.max(1, Number(searchPager?.totalPages || 1))
    const lastWindowPage = searchPageItems[searchPageItems.length - 1] || 0
    const start = Math.max(1, total - 1)
    const out = []
    for (let page = start; page <= total; page += 1) {
      if (page <= lastWindowPage) continue
      if (searchPageItems.includes(page)) continue
      out.push(page)
    }
    return out
  }, [searchPageItems, searchPager?.totalPages])

  const showTrailingEllipsis = useMemo(() => {
    if (!browseTrailingPageItems.length) return false
    const lastWindowPage = browsePageItems[browsePageItems.length - 1] || 0
    return browseTrailingPageItems[0] > (lastWindowPage + 1)
  }, [browsePageItems, browseTrailingPageItems])

  const showSearchTrailingEllipsis = useMemo(() => {
    if (!searchTrailingPageItems.length) return false
    const lastWindowPage = searchPageItems[searchPageItems.length - 1] || 0
    return searchTrailingPageItems[0] > (lastWindowPage + 1)
  }, [searchPageItems, searchTrailingPageItems])

  useEffect(() => {
    if (!initialSelection?.tmdbId) return
    const candidate = {
      tmdbId: Number(initialSelection.tmdbId),
      mediaType: String(initialSelection.entityType || initialSelection.mediaType || mediaType || 'multi').trim().toLowerCase()
    }
    const initialScope = normalizeReferenceScope(
      initialSelection?.referenceScope
      || initialSelection?.tvContext?.referenceScope
      || 'series'
    )
    const initialSpoiler = normalizeSpoilerLevel(
      initialSelection?.rules?.spoilerLevel
      || initialSelection?.tvContext?.spoilerLevel
      || 'light'
    )
    const initialSeason = normalizePositiveInt(
      initialSelection?.season?.number
      || initialSelection?.tvContext?.season?.number
    )
    const initialEpisode = normalizePositiveInt(
      initialSelection?.episode?.number
      || initialSelection?.tvContext?.episode?.number
    )
    setFactLocks(normalizeFactLocksForState(
      initialSelection?.factLocks,
      initialSelection?.entityType || initialSelection?.mediaType || mediaType
    ))
    setReferenceScope(initialScope)
    setSpoilerLevel(initialSpoiler)
    setSelectedSeasonNumber(initialSeason)
    setSelectedEpisodeNumber(initialEpisode)
    const savedTvContext = normalizeTvScopeContext(initialSelection?.tvContext || {})
    setTvSeasonOptions(savedTvContext.seasonOptions || [])
    setTvEpisodeOptions(savedTvContext.episodeOptions || [])
    setSelectedCandidateKey(createCandidateKey(candidate))
    setSelectedImages(Array.isArray(initialSelection.selectedImages) ? initialSelection.selectedImages.slice(0, TMDB_MAX_SELECTED_IMAGES) : [])
    fetchTmdbDetail(candidate, {
      referenceScope: initialScope,
      spoilerLevel: initialSpoiler,
      seasonNumber: initialSeason,
      episodeNumber: initialEpisode
    })
    const key = createCandidateKey(candidate)
    if (key) {
      setCandidateCapabilities({
        [key]: {
          hasPoster: !!String(initialSelection?.candidate?.posterUrl || '').trim(),
          hasTrailer: !!String(initialSelection?.movieOrTv?.trailer || '').trim(),
          hasWatchProviders: Array.isArray(initialSelection?.movieOrTv?.watch_providers_id)
            && initialSelection.movieOrTv.watch_providers_id.some((x) => String(x || '').trim()),
          primaryGenre: resolvePrimaryGenre(initialSelection?.movieOrTv?.genres),
          resolved: true
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (initialBrowseLoadedRef.current) return
    initialBrowseLoadedRef.current = true
    handleBrowseCategory(initialBrowseMediaType, initialBrowseCategory, {
      silent: true,
      autoSelect: false,
      page: initialBrowsePage
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelection?.tmdbId])

  useEffect(() => {
    writeTmdbBrowseState({
      mediaType: browsePicker.mediaType,
      category: browsePicker.category,
      page: browsePager.page
    })
  }, [browsePager.page, browsePicker.category, browsePicker.mediaType])

  useEffect(() => {
    writeTmdbBrowseAccordionOpenState(browseAccordionOpen)
  }, [browseAccordionOpen])

  useEffect(() => {
    writeTmdbSearchPageState(searchPager.page)
  }, [searchPager.page])

  function handleBrowseAccordionSelect(eventKey) {
    setBrowseAccordionOpen(String(eventKey || '') === 'tmdb-browse')
  }

  async function handleSearch(options = {}) {
    const parsedInput = parseTmdbQueryInput(query)
    const cleanQuery = String(parsedInput.query || '').trim()
    const parsedTmdbId = normalizePositiveInt(parsedInput.tmdbId)
    const requestedPage = Math.max(1, Number(options?.page || searchPager.page || 1) || 1)
    const silent = options && options.silent === true
    const preferredCandidateKey = String(options?.preferCandidateKey || '').trim()
    const isAutoRefresh = options && options.isAutoRefresh === true
    if (!cleanQuery && !parsedTmdbId) {
      if (!silent) setError('Judul Film/Series wajib diisi sebelum cari TMDB.')
      return
    }
    const requestId = candidateProbeRequestRef.current + 1
    candidateProbeRequestRef.current = requestId
    setCardDataMode('search')
    setSearching(true)
    setError('')
    if (!silent) setNotice('')
    setCandidates([])
    setCandidateCapabilities({})
    setProbingCandidateMeta(false)
    setSelectedCandidateKey('')
    setDetailData(null)
    setSelectedImages([])
    setSearchMeta(null)
    setSearchPager((prev) => ({ ...prev, page: requestedPage, totalPages: 1, totalResults: 0 }))
    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}

      if (parsedTmdbId) {
        const detailResp = await apiAxios({
          method: 'post',
          url: '/api/tmdb/detail',
          data: {
            tmdbId: parsedTmdbId,
            mediaType,
            region,
            language
          },
          ...requestConfig
        })
        if (!detailResp.data?.ok || !detailResp.data?.data) {
          throw new Error(detailResp.data?.error?.message || 'Gagal memuat detail TMDB dari ID')
        }
        const detailPayload = detailResp.data.data
        const detailCandidate = buildCandidateFromTmdbDetailPayload(detailPayload, {
          fallbackMediaType: mediaType,
          fallbackTitle: cleanQuery || `TMDB #${parsedTmdbId}`,
          tmdbId: parsedTmdbId
        })
        const rows = [detailCandidate].filter((item) => Number.isFinite(Number(item?.tmdbId)) && Number(item.tmdbId) > 0)
        setSearchMeta({
          count: rows.length,
          query: cleanQuery ? `${cleanQuery} · id:${parsedTmdbId}` : `id:${parsedTmdbId}`,
          languageCode: String(detailResp.data.data?.debug?.languageCode || language).trim(),
          region: String(region || '').trim(),
          keySource: String(detailResp.data.data?.debug?.keySource || '').trim() || null
        })
        setSearchPager({ page: 1, totalPages: 1, totalResults: rows.length, maxPage: 1 })
        setCandidates(rows)
        const baseCapabilities = rows.reduce((acc, item) => {
          const key = createCandidateKey(item)
          if (!key) return acc
          acc[key] = createCandidateCapability(item)
          return acc
        }, {})
        setCandidateCapabilities(baseCapabilities)
        if (!rows.length) {
          setNotice('ID TMDB valid tetapi kandidat tidak bisa dipetakan.')
          return
        }
        const preferred = preferredCandidateKey
          ? rows.find((item) => createCandidateKey(item) === preferredCandidateKey)
          : null
        const target = preferred || rows[0]
        const key = createCandidateKey(target)
        setSelectedCandidateKey(key)
        setDetailData(detailPayload)
        const detailTvScope = normalizeTvScopeContext(detailPayload?.tvContext || {})
        if (String(detailPayload?.entityType || '').trim().toLowerCase() === 'tv') {
          setReferenceScope(detailTvScope.referenceScope || normalizeReferenceScope(referenceScope))
          setSpoilerLevel(detailTvScope.spoilerLevel || normalizeSpoilerLevel(spoilerLevel))
          setSelectedSeasonNumber(normalizePositiveInt(detailTvScope.season?.number))
          setSelectedEpisodeNumber(normalizePositiveInt(detailTvScope.episode?.number))
          setTvSeasonOptions(detailTvScope.seasonOptions || [])
          setTvEpisodeOptions(detailTvScope.episodeOptions || [])
        } else {
          setTvSeasonOptions([])
          setTvEpisodeOptions([])
          setSelectedSeasonNumber(null)
          setSelectedEpisodeNumber(null)
        }
        const detailImageOptions = Array.isArray(detailPayload.imageOptions) ? detailPayload.imageOptions : []
        const optionUrlSet = new Set(detailImageOptions.map((x) => String(x?.url || '').trim()).filter(Boolean))
        setSelectedImages((prev) => {
          const filtered = (Array.isArray(prev) ? prev : [])
            .filter((x) => optionUrlSet.has(String(x?.url || '').trim()))
            .slice(0, TMDB_MAX_SELECTED_IMAGES)
          return filtered
        })
        if (isAutoRefresh) {
          setNotice(
            preferred
              ? `Data diperbarui sesuai ${language}/${region}. Kandidat aktif dipertahankan.`
              : `Data diperbarui sesuai ${language}/${region}. Kandidat aktif disesuaikan.`
          )
        }
        return
      }

      const resp = await apiAxios({
        method: 'post',
        url: '/api/tmdb/search',
        data: {
          query: cleanQuery,
          mediaType,
          ...(year ? { year } : {}),
          region,
          language,
          page: requestedPage,
          limit: 14
        },
        ...requestConfig
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error(resp.data?.error?.message || 'Gagal mencari TMDB')
      }
      const rows = Array.isArray(resp.data.data.candidates) ? resp.data.data.candidates : []
      setSearchMeta({
        count: Number(resp.data.data.count || rows.length || 0),
        query: String(resp.data.data.query || cleanQuery).trim(),
        languageCode: String(resp.data.data.languageCode || language).trim(),
        region: String(resp.data.data.region || region).trim(),
        keySource: String(resp.data.data.keySource || '').trim() || null
      })
      const resolvedPage = Math.max(1, Number(resp.data.data.page || requestedPage) || requestedPage)
      const resolvedMaxPage = Math.max(1, Number(resp.data.data.maxPage || 500) || 500)
      const resolvedTotalPages = Math.max(
        1,
        Math.min(Number(resp.data.data.totalPages || 1) || 1, resolvedMaxPage)
      )
      const resolvedTotalResults = Math.max(0, Number(resp.data.data.totalResults || 0) || 0)
      setSearchPager({
        page: Math.min(resolvedPage, resolvedTotalPages),
        totalPages: resolvedTotalPages,
        totalResults: resolvedTotalResults,
        maxPage: resolvedMaxPage
      })
      setCandidates(rows)
      const baseCapabilities = rows.reduce((acc, item) => {
        const key = createCandidateKey(item)
        if (!key) return acc
        acc[key] = createCandidateCapability(item)
        return acc
      }, {})
      setCandidateCapabilities(baseCapabilities)
      if (!rows.length) {
        setNotice(
          isAutoRefresh
            ? `Tidak ada hasil untuk ${language}/${region}. Coba language/region lain.`
            : 'TMDB tidak menemukan kandidat untuk query ini.'
        )
        return
      }
      hydrateCandidateCapabilities(rows, requestId)
      const preferred = preferredCandidateKey
        ? rows.find((item) => createCandidateKey(item) === preferredCandidateKey)
        : null
      const target = preferred || rows[0]
      const key = createCandidateKey(target)
      setSelectedCandidateKey(key)
      await fetchTmdbDetail(target)
      if (isAutoRefresh) {
        setNotice(
          preferred
            ? `Data diperbarui sesuai ${language}/${region}. Kandidat aktif dipertahankan.`
            : `Data diperbarui sesuai ${language}/${region}. Kandidat aktif disesuaikan.`
        )
      }
    } catch (err) {
      setError(mapApiError(err, 'Gagal mencari TMDB'))
    } finally {
      setSearching(false)
    }
  }

  async function handleBrowseCategory(nextMediaType, nextCategory, options = {}) {
    const safeMediaType = normalizeBrowseMediaType(nextMediaType)
    const safeCategory = normalizeBrowseCategory(safeMediaType, nextCategory)
    const requestedPage = Math.max(1, Number(options?.page || 1) || 1)
    const preferredCandidateKey = String(options?.preferCandidateKey || '').trim()
    const isAutoRefresh = options && options.isAutoRefresh === true
    const requestId = candidateProbeRequestRef.current + 1
    candidateProbeRequestRef.current = requestId

    const silent = options && options.silent === true
    const autoSelect = !options || options.autoSelect !== false

    setCardDataMode('browse')
    setBrowseLoading(true)
    setError('')
    if (!silent) setNotice('')
    setBrowseMeta({ mediaType: safeMediaType, category: safeCategory })
    setBrowsePicker({ mediaType: safeMediaType, category: safeCategory })

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      const resp = await apiAxios({
        method: 'post',
        url: '/api/tmdb/browse',
        data: {
          mediaType: safeMediaType,
          category: safeCategory,
          page: requestedPage,
          language,
          region,
          limit: 14
        },
        ...requestConfig
      })
      if (!resp.data?.ok || !resp.data?.data) {
        throw new Error(resp.data?.error?.message || 'Gagal memuat kategori TMDB')
      }
      const rows = Array.isArray(resp.data.data.candidates) ? resp.data.data.candidates : []
      const resolvedMediaType = String(resp.data.data.mediaType || safeMediaType).trim().toLowerCase() === 'tv' ? 'tv' : 'movie'
      const resolvedCategory = normalizeBrowseCategory(resolvedMediaType, String(resp.data.data.category || safeCategory).trim().toLowerCase())
      const resolvedPage = Math.max(1, Number(resp.data.data.page || requestedPage) || requestedPage)
      const resolvedMaxPage = Math.max(1, Number(resp.data.data.maxPage || 500) || 500)
      const resolvedTotalPages = Math.max(
        1,
        Math.min(Number(resp.data.data.totalPages || 1) || 1, resolvedMaxPage)
      )
      const resolvedTotalResults = Math.max(0, Number(resp.data.data.totalResults || 0) || 0)
      setBrowseItems(rows)
      setBrowseMeta({
        mediaType: resolvedMediaType,
        category: resolvedCategory
      })
      setBrowsePicker({
        mediaType: resolvedMediaType,
        category: resolvedCategory
      })
      setBrowsePager({
        page: Math.min(resolvedPage, resolvedTotalPages),
        totalPages: resolvedTotalPages,
        totalResults: resolvedTotalResults,
        maxPage: resolvedMaxPage
      })

      const baseCapabilities = rows.reduce((acc, item) => {
        const key = createCandidateKey(item)
        if (!key) return acc
        acc[key] = createCandidateCapability(item)
        return acc
      }, {})
      setCandidateCapabilities(baseCapabilities)
      setProbingCandidateMeta(false)
      setCandidates(rows)
      setSearchMeta({
        count: Number(resp.data.data.count || rows.length || 0),
        query: `[${resolvedMediaType.toUpperCase()}] ${resolvedCategory} · page ${Math.min(resolvedPage, resolvedTotalPages)}`,
        languageCode: String(resp.data.data.languageCode || language).trim(),
        region: String(resp.data.data.region || region).trim(),
        keySource: String(resp.data.data.keySource || '').trim() || null
      })

      if (!rows.length) {
        setSelectedCandidateKey('')
        setDetailData(null)
        setSelectedImages([])
        setNotice(
          isAutoRefresh
            ? `Tidak ada hasil kategori ini untuk ${language}/${region}. Coba language/region lain.`
            : 'Kategori TMDB ini belum punya hasil untuk language/region saat ini.'
        )
        return
      }

      hydrateCandidateCapabilities(rows, requestId)
      if (autoSelect) {
        const preferred = preferredCandidateKey
          ? rows.find((item) => createCandidateKey(item) === preferredCandidateKey)
          : null
        const target = preferred || rows[0]
        const key = createCandidateKey(target)
        setSelectedCandidateKey(key)
        setSelectedImages([])
        await fetchTmdbDetail(target)
        if (isAutoRefresh) {
          setNotice(
            preferred
              ? `Data diperbarui sesuai ${language}/${region}. Kandidat aktif dipertahankan.`
              : `Data diperbarui sesuai ${language}/${region}. Kandidat aktif disesuaikan.`
          )
        }
      } else {
        const activeInRows = rows.find((item) => createCandidateKey(item) === selectedCandidateKey) || null
        const shouldHydrateActive = !!activeInRows && isSparseTmdbDetailMovieOrTv(detailData?.movieOrTv)
        const shouldHydrateFirst = !activeInRows && !detailData

        if (shouldHydrateActive) {
          await fetchTmdbDetail(activeInRows)
        } else if (shouldHydrateFirst) {
          const first = rows[0]
          const key = createCandidateKey(first)
          setSelectedCandidateKey(key)
          setSelectedImages([])
          await fetchTmdbDetail(first)
        }
      }
    } catch (err) {
      setError(mapApiError(err, 'Gagal memuat kategori TMDB'))
    } finally {
      setBrowseLoading(false)
    }
  }

  function handleBrowseMediaTypeChange(nextMediaType) {
    const safeMediaType = normalizeBrowseMediaType(nextMediaType)
    const defaultCategory = normalizeBrowseCategory(safeMediaType, '')
    setBrowsePicker({
      mediaType: safeMediaType,
      category: defaultCategory
    })
    handleBrowseCategory(safeMediaType, defaultCategory, { autoSelect: false, page: 1 })
  }

  function handleBrowseCategoryChange(nextCategory) {
    const safeMediaType = normalizeBrowseMediaType(browsePicker?.mediaType || 'movie')
    const safeCategory = normalizeBrowseCategory(safeMediaType, nextCategory)
    setBrowsePicker({
      mediaType: safeMediaType,
      category: safeCategory
    })
    handleBrowseCategory(safeMediaType, safeCategory, { autoSelect: false, page: 1 })
  }

  function handleBrowsePageChange(nextPage) {
    const totalPages = Math.max(1, Number(browsePager?.totalPages || 1))
    const targetPage = Math.max(1, Math.min(Number(nextPage || 1) || 1, totalPages))
    const currentPage = Math.max(1, Math.min(Number(browsePager?.page || 1) || 1, totalPages))
    if (targetPage === currentPage || browseLoading) return
    handleBrowseCategory(browsePicker.mediaType, browsePicker.category, { autoSelect: false, page: targetPage, silent: true })
  }

  function handleSearchPageChange(nextPage) {
    const totalPages = Math.max(1, Number(searchPager?.totalPages || 1))
    const targetPage = Math.max(1, Math.min(Number(nextPage || 1) || 1, totalPages))
    const currentPage = Math.max(1, Math.min(Number(searchPager?.page || 1) || 1, totalPages))
    if (targetPage === currentPage || searching) return
    handleSearch({ page: targetPage, silent: true })
  }

  function handleSwitchToBrowseCards() {
    handleBrowseCategory(
      browsePicker.mediaType,
      browsePicker.category,
      { autoSelect: false, page: Math.max(1, Number(browsePager?.page || 1) || 1), silent: true }
    )
  }

  async function handleSelectCandidate(item) {
    const key = createCandidateKey(item)
    setSelectedCandidateKey(key)
    setSelectedImages([])
    await fetchTmdbDetail(item)
  }

  function toggleImageSelection(imageUrl) {
    const url = String(imageUrl || '').trim()
    if (!url) return
    setError('')
    setSelectedImages((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const exists = list.some((x) => String(x?.url || '') === url)
      if (exists) {
        return list.filter((x) => String(x?.url || '') !== url)
      }
      if (list.length >= TMDB_MAX_SELECTED_IMAGES) {
        setError(`Maksimal ${TMDB_MAX_SELECTED_IMAGES} gambar TMDB yang bisa dipakai.`)
        return list
      }
      return [...list, { type: 'url', url, source: 'tmdb' }]
    })
  }

  function buildSelectionPayload() {
    const selectedCandidate = candidates.find((item) => createCandidateKey(item) === selectedCandidateKey) || null
    const tmdbId = Number(
      detailData?.movieOrTv?.tmdb_id
      || selectedCandidate?.tmdbId
      || initialSelection?.tmdbId
      || 0
    )
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null
    const releaseDate = String(
      detailData?.movieOrTv?.release_date
      || selectedCandidate?.releaseDate
      || initialSelection?.releaseDate
      || ''
    ).trim()
    const selectedTitle = String(
      detailData?.movieOrTv?.title
      || selectedCandidate?.title
      || initialSelection?.title
      || query
      || ''
    ).trim()
    const selectedYear = String(selectedCandidate?.year || '').trim()
    const releaseYear = /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : ''
    const normalizedYear = /^\d{4}$/.test(selectedYear)
      ? selectedYear
      : (releaseYear || (/^\d{4}$/.test(String(year || '').trim()) ? String(year || '').trim() : ''))
    const candidate = selectedCandidate
      ? {
        tmdbId: Number(selectedCandidate.tmdbId || tmdbId),
        mediaType: String(selectedCandidate.mediaType || detailData?.entityType || mediaType || 'multi').trim().toLowerCase(),
        title: String(selectedCandidate.title || detailData?.movieOrTv?.title || '').trim(),
        year: String(selectedCandidate.year || '').trim(),
        rating: Number.isFinite(Number(selectedCandidate.rating)) ? Number(selectedCandidate.rating) : null,
        posterUrl: String(selectedCandidate.posterUrl || '').trim()
      }
      : (initialSelection?.candidate || null)
    const entityType = String(
      detailData?.entityType
      || selectedCandidate?.mediaType
      || initialSelection?.entityType
      || mediaType
      || 'movie'
    ).trim().toLowerCase() === 'tv' ? 'tv' : 'movie'
    const isTvEntity = entityType === 'tv'
    const tvContext = isTvEntity
      ? normalizeTvScopeContext(detailData?.tvContext || initialSelection?.tvContext || {})
      : null
    const effectiveRules = {
      factual_only_from_tmdb: detailData?.rules?.factual_only_from_tmdb !== false,
      no_hallucination: detailData?.rules?.no_hallucination !== false,
      spoilerLevel: normalizeSpoilerLevel(
        detailData?.rules?.spoilerLevel
        || tvContext?.spoilerLevel
        || spoilerLevel
        || 'light'
      )
    }
    const effectiveReferenceScope = isTvEntity
      ? normalizeReferenceScope(
          tvContext?.referenceScope
          || referenceScope
          || 'series'
        )
      : null
    const selectedSeason = normalizePositiveInt(selectedSeasonNumber)
    const selectedEpisode = normalizePositiveInt(selectedEpisodeNumber)
    const seasonFromContext = tvContext?.season && normalizePositiveInt(tvContext.season.number)
      ? tvContext.season
      : null
    const seasonFromOptions = Array.isArray(tvContext?.seasonOptions)
      ? (tvContext.seasonOptions.find((row) => normalizePositiveInt(row?.number) === selectedSeason) || null)
      : null
    const effectiveSeason = isTvEntity && (effectiveReferenceScope === 'season' || effectiveReferenceScope === 'episode')
      ? (
          seasonFromContext
          || seasonFromOptions
          || (selectedSeason ? { number: selectedSeason } : null)
        )
      : null
    const episodeFromContext = tvContext?.episode && normalizePositiveInt(tvContext.episode.number)
      ? tvContext.episode
      : null
    const episodeFromOptions = Array.isArray(tvContext?.episodeOptions)
      ? (tvContext.episodeOptions.find((row) => normalizePositiveInt(row?.number) === selectedEpisode) || null)
      : null
    const effectiveEpisode = isTvEntity && effectiveReferenceScope === 'episode'
      ? (
          episodeFromContext
          || episodeFromOptions
          || (selectedEpisode ? { number: selectedEpisode } : null)
        )
      : null
    const scopeLabels = isTvEntity
      ? buildTvSelectionLabels({
          referenceScope: effectiveReferenceScope,
          season: effectiveSeason,
          episode: effectiveEpisode
        })
      : null
    const sourceMovieOrTv = detailData?.movieOrTv || initialSelection?.movieOrTv || null
    const normalizedMovieOrTv = sanitizeMovieOrTvForSelection(
      sourceMovieOrTv,
      entityType,
      isTvEntity
        ? {
            referenceScope: effectiveReferenceScope,
            seasonCount: tvContext?.seasonCount,
            episodeCount: tvContext?.episodeCount,
            episodeType: tvContext?.episodeType,
            seasonOverview: effectiveSeason?.overview,
            episodeOverview: effectiveEpisode?.overview,
            seasonLabel: scopeLabels?.season,
            episodeLabel: scopeLabels?.episode
          }
        : {}
    )
    return {
      tmdbId,
      entityType,
      title: selectedTitle,
      query: selectedTitle,
      year: normalizedYear,
      releaseDate,
      region,
      language,
      rules: effectiveRules,
      ...(isTvEntity ? { referenceScope: effectiveReferenceScope } : {}),
      ...(isTvEntity && effectiveSeason ? { season: effectiveSeason } : {}),
      ...(isTvEntity && effectiveEpisode ? { episode: effectiveEpisode } : {}),
      ...(isTvEntity && scopeLabels ? { scopeLabels } : {}),
      factLocks: normalizeFactLocksForState(factLocks, entityType),
      selectedImages,
      candidate,
      searchMeta: searchMeta || initialSelection?.searchMeta || null,
      movieOrTv: normalizedMovieOrTv,
      ...(isTvEntity ? { tvContext: detailData?.tvContext || initialSelection?.tvContext || null } : {}),
      debug: detailData?.debug || null
    }
  }

  function persistSelectionToGenerate({ navigateBack = false } = {}) {
    const scopeValidationError = validateTvScopeBeforeApply()
    if (scopeValidationError) {
      pushFloatingAlert(scopeValidationError, 'warning')
      return false
    }

    const payload = buildSelectionPayload()
    if (!payload) {
      pushFloatingAlert('Pilih kandidat TMDB terlebih dulu.', 'warning')
      return false
    }
    const saved = writeTmdbGenerateSelection(payload)
    if (!saved) {
      pushFloatingAlert('Gagal menyimpan pilihan TMDB ke local storage.', 'danger')
      return false
    }
    if (navigateBack) {
      navigate('/generate', { state: { tmdbSelectionUpdatedAt: Date.now() } })
      return true
    }
    setNotice('Data TMDB sudah diterapkan ke Generate. Anda bisa lanjut eksplor kandidat lain.')
    return true
  }

  function handleUseForGenerate() {
    persistSelectionToGenerate({ navigateBack: true })
  }

  function handleApplyWithoutBack() {
    persistSelectionToGenerate({ navigateBack: false })
  }

  function handleClearSelection() {
    clearTmdbGenerateSelection()
    writeTmdbFinderPrefs({ query: '', year: '' })
    setSelectedImages([])
    setDetailData(null)
    setFactLocks(normalizeFactLocksForState(null, mediaType))
    setQuery('')
    setYear('')
    setReferenceScope('series')
    setSpoilerLevel('light')
    setSelectedSeasonNumber(null)
    setSelectedEpisodeNumber(null)
    setTvSeasonOptions([])
    setTvEpisodeOptions([])
    setSelectedCandidateKey('')
    setCardDataMode('browse')
    setSearchPager({ page: 1, totalPages: 1, totalResults: 0, maxPage: 500 })
    setNotice('Pilihan TMDB dihapus dari Generate.')
  }

  const selectionPayload = buildSelectionPayload()
  const detailSelectedCandidate = candidates.find((item) => createCandidateKey(item) === selectedCandidateKey) || null
  const detailImageOptions = useMemo(() => {
    return (Array.isArray(detailData?.imageOptions) ? detailData.imageOptions : [])
      .filter((item) => String(item?.url || '').trim())
  }, [detailData?.imageOptions])
  const detailPosterOptions = useMemo(() => {
    return detailImageOptions.filter((item) => String(item?.source || '').trim().toLowerCase() === 'poster')
  }, [detailImageOptions])
  const detailBackdropOptions = useMemo(() => {
    return detailImageOptions.filter((item) => String(item?.source || '').trim().toLowerCase() === 'backdrop')
  }, [detailImageOptions])
  useEffect(() => {
    if (activeImageTab === 'poster' && detailPosterOptions.length > 0) return
    if (activeImageTab === 'backdrop' && detailBackdropOptions.length > 0) return
    if (detailPosterOptions.length > 0) {
      setActiveImageTab('poster')
      return
    }
    if (detailBackdropOptions.length > 0) {
      setActiveImageTab('backdrop')
      return
    }
    setActiveImageTab('poster')
  }, [activeImageTab, detailBackdropOptions.length, detailPosterOptions.length])
  const detailOverviewPosterUrl = useMemo(() => {
    const isTv = String(detailData?.entityType || detailSelectedCandidate?.mediaType || '').trim().toLowerCase() === 'tv'
    if (isTv) {
      const seasonPosterPath = String(detailData?.tvContext?.season?.posterPath || '').trim()
      const seasonPosterUrl = seasonPosterPath ? buildTmdbImageUrlFromPath(seasonPosterPath, 'w300') : ''
      if (seasonPosterUrl) return seasonPosterUrl
    }
    const candidatePoster = String(detailSelectedCandidate?.posterUrl || '').trim()
    if (candidatePoster) return candidatePoster
    const imageOptions = detailImageOptions
    const posterOption = imageOptions.find((item) => {
      const source = String(item?.source || '').trim().toLowerCase()
      const resolvedUrl = String(item?.previewUrl || item?.url || '').trim()
      return source === 'poster' && resolvedUrl
    })
    if (posterOption) return String(posterOption.previewUrl || posterOption.url || '').trim()
    const fallbackOption = imageOptions.find((item) => String(item?.previewUrl || item?.url || '').trim())
    return fallbackOption ? String(fallbackOption.previewUrl || fallbackOption.url || '').trim() : ''
  }, [detailData?.entityType, detailData?.tvContext?.season?.posterPath, detailImageOptions, detailSelectedCandidate?.mediaType, detailSelectedCandidate?.posterUrl])
  const detailEntityType = String(
    detailData?.entityType
    || detailSelectedCandidate?.mediaType
    || selectionPayload?.entityType
    || mediaType
    || 'multi'
  ).trim().toLowerCase()
  const isTvDetail = detailEntityType === 'tv'
  const factLockFields = useMemo(
    () => getFactLockFieldsForEntityType(detailEntityType),
    [detailEntityType]
  )
  const factLockEnabledCount = factLockFields.reduce((sum, field) => {
    return sum + (factLocks[field] !== false ? 1 : 0)
  }, 0)
  const payloadPreviewStrict = selectionPayload
    ? buildTmdbGenerateRequestFromSelection(selectionPayload)
    : null
  const payloadPreviewDebug = useMemo(() => {
    if (!selectionPayload) return null
    return {
      selection: selectionPayload,
      debug: detailData?.debug || null
    }
  }, [detailData?.debug, selectionPayload])
  const payloadPreview = payloadPreviewMode === 'debug' ? payloadPreviewDebug : payloadPreviewStrict
  const tvContext = useMemo(
    () => normalizeTvScopeContext(detailData?.tvContext || {}),
    [detailData?.tvContext]
  )
  const tvDetailScopeKey = useMemo(
    () => normalizeReferenceScope(tvContext.referenceScope || referenceScope),
    [referenceScope, tvContext.referenceScope]
  )
  const tvScopeLabel = TMDB_TV_REFERENCE_SCOPE_LABELS[tvContext.referenceScope] || tvContext.referenceScope || '-'
  const tvSpoilerLabel = TMDB_SPOILER_LABELS[tvContext.spoilerLevel] || tvContext.spoilerLevel || '-'
  const tvSelectionLabels = useMemo(() => {
    if (!isTvDetail) return { season: '-', episode: '-' }
    const base = buildTvSelectionLabels({
      referenceScope: tvContext.referenceScope || referenceScope,
      season: tvContext.season,
      episode: tvContext.episode
    })
    const seasonLabelFromPayload = String(detailData?.movieOrTv?.season_label || '').trim()
    const episodeLabelFromPayload = String(detailData?.movieOrTv?.episode_label || '').trim()
    return {
      season: seasonLabelFromPayload || base.season || '-',
      episode: episodeLabelFromPayload || base.episode || '-'
    }
  }, [detailData?.movieOrTv?.episode_label, detailData?.movieOrTv?.season_label, isTvDetail, referenceScope, tvContext.episode, tvContext.referenceScope, tvContext.season])
  const tvScopeHeaderBadge = useMemo(() => {
    if (!isTvDetail) return ''
    if (tvDetailScopeKey === 'episode') {
      const episodeLabel = String(tvSelectionLabels.episode || '').trim()
      return `Scope: Episode · ${episodeLabel && episodeLabel !== '-' ? episodeLabel : 'Pilih Episode'}`
    }
    if (tvDetailScopeKey === 'season') {
      const seasonLabel = String(tvSelectionLabels.season || '').trim()
      return `Scope: Season · ${seasonLabel && seasonLabel !== '-' ? seasonLabel : 'Pilih Season'}`
    }
    return 'Scope: Series · All Season'
  }, [isTvDetail, tvDetailScopeKey, tvSelectionLabels.episode, tvSelectionLabels.season])
  const detailMakerLabel = isTvDetail ? 'Creator' : 'Director'
  const detailMakerValue = isTvDetail
    ? (
        detailData?.movieOrTv?.creator
        || (Array.isArray(detailData?.movieOrTv?.creator_list) ? detailData.movieOrTv.creator_list[0] : '')
        || detailData?.movieOrTv?.director
        || '-'
      )
    : (
        detailData?.movieOrTv?.director
        || (Array.isArray(detailData?.movieOrTv?.director_list) ? detailData.movieOrTv.director_list[0] : '')
        || '-'
      )
  const seasonSelectValue = useMemo(() => {
    if (!isTvDetail) return ''
    return selectedSeasonNumber ? String(selectedSeasonNumber) : ''
  }, [isTvDetail, selectedSeasonNumber])
  const episodeSelectValue = useMemo(() => {
    if (!isTvDetail) return ''
    return selectedEpisodeNumber ? String(selectedEpisodeNumber) : ''
  }, [isTvDetail, selectedEpisodeNumber])
  const tvScopeKey = useMemo(() => normalizeReferenceScope(referenceScope), [referenceScope])
  const seasonControlEnabled = isTvDetail && (tvScopeKey === 'season' || tvScopeKey === 'episode')
  const episodeControlEnabled = isTvDetail && tvScopeKey === 'episode'
  const showSeasonScopedDetails = isTvDetail && (tvDetailScopeKey === 'season' || tvDetailScopeKey === 'episode')
  const showEpisodeScopedDetails = isTvDetail && tvDetailScopeKey === 'episode'
  const handleDownloadTmdbImage = async (item, event) => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const rawEntityType = String(
      detailData?.entityType || detailSelectedCandidate?.mediaType || selectionPayload?.entityType || 'movie'
    ).trim().toLowerCase()
    const safeEntityType = rawEntityType === 'tv' ? 'tv' : 'movie'
    const rawTitle = String(detailData?.movieOrTv?.title || detailSelectedCandidate?.title || '').trim()
    const safeTitle = slugifyDownloadName(rawTitle, 'title')
    const releaseDate = String(detailData?.movieOrTv?.release_date || '').trim()
    const selectedYear = String(detailSelectedCandidate?.year || '').trim()
    const safeYear = /^\d{4}$/.test(selectedYear)
      ? selectedYear
      : ((/^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : 'unknown-year'))
    const fileBase = [safeEntityType, safeTitle, safeYear].filter(Boolean).join('-')
    const direct1280Url = String(item?.downloadUrl || '').trim()
    const fallbackUrl = String(item?.downloadFallbackUrl || item?.url || '').trim()
    const candidateUrls = Array.from(new Set([direct1280Url, fallbackUrl].filter(Boolean)))
    if (!candidateUrls.length) return

    let downloaded = false
    for (let i = 0; i < candidateUrls.length; i += 1) {
      const imageUrl = candidateUrls[i]
      const isFallback = i > 0
      try {
        const resp = await fetch(imageUrl)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const blob = await resp.blob()
        const objectUrl = window.URL.createObjectURL(blob)
        const extension = String(blob.type || '').toLowerCase().includes('png') ? 'png' : 'jpg'
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = `${fileBase}.${extension}`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        window.URL.revokeObjectURL(objectUrl)
        if (isFallback) {
          setNotice('w1280 tidak tersedia. File diunduh menggunakan fallback original.')
        }
        downloaded = true
        break
      } catch (err) {
        continue
      }
    }

    if (!downloaded) {
      const openUrl = fallbackUrl || direct1280Url
      if (openUrl) window.open(openUrl, '_blank', 'noopener,noreferrer')
      setNotice('Gagal download otomatis. Gambar dibuka di tab baru, lalu simpan manual.')
    }
  }
  const renderTmdbImageTab = (items, groupKey, emptyLabel) => {
    if (!Array.isArray(items) || !items.length) {
      return <small className="text-muted tmdb-image-tab-empty">{emptyLabel}</small>
    }
    return (
      <div className="tmdb-image-group-scroll">
        <div className={`tmdb-image-grid ${groupKey === 'backdrop' ? 'is-backdrop-grid' : 'is-poster-grid'}`}>
          {items.map((item, idx) => {
            const source = String(item?.source || '').trim().toLowerCase()
            const sourceClass = source === 'backdrop' ? 'is-backdrop' : 'is-poster'
            const url = String(item?.url || '').trim()
            const previewUrl = String(item?.previewUrl || url).trim()
            const active = selectedImages.some((x) => String(x?.url || '') === url)
            return (
              <div
                key={`${groupKey}-${url}-${idx}`}
                className={`tmdb-image-item ${sourceClass} ${active ? 'is-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => toggleImageSelection(url)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleImageSelection(url)
                  }
                }}
                title={active ? 'Hapus dari pilihan' : 'Pilih gambar ini'}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt={`${groupKey}-${idx + 1}`} />
                ) : (
                  <span>No Image</span>
                )}
                <button
                  type="button"
                  className="tmdb-image-download"
                  onClick={(event) => handleDownloadTmdbImage(item, event)}
                  title="Download 1280p"
                >
                  <Icon icon="line-md:downloading" width="20" height="20" />
                </button>
                {active && (
                  <span className="tmdb-image-check">
                    <Icon icon="material-symbols:check-circle" width="16" height="16" />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="tmdb-finder-page">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <h4 className="mb-0">TMDB Finder</h4>
          <small className="text-muted">Cari Movie/TV, pilih detail + gambar, lalu kirim ke Generate.</small>
        </div>
        <div className="d-flex gap-2">
          <Button type="button" variant="outline-secondary" size="sm" onClick={() => navigate('/generate')}>
            Kembali ke Generate
          </Button>
        </div>
      </div>

      {!!floatingAlerts.length && (
        <div className="tmdb-floating-alerts" aria-live="polite" aria-atomic="true">
          {floatingAlerts.map((item) => (
            <Alert
              key={item.id}
              variant={item.variant || 'warning'}
              dismissible
              onClose={() => removeFloatingAlert(item.id)}
              className="tmdb-floating-alert py-2 px-3 mb-2"
            >
              {item.message}
            </Alert>
          ))}
        </div>
      )}

      <Accordion
        className="mb-3"
        activeKey={browseAccordionOpen ? 'tmdb-browse' : null}
        onSelect={handleBrowseAccordionSelect}
      >
        <Accordion.Item eventKey="tmdb-browse">
          <Accordion.Header>
            <div className="tmdb-browse-accordion-header">
              <span>Kartu Movie/TV</span>
              <small className="text-muted">
                {isSearchCardMode
                  ? `Search: ${String(searchMeta?.query || query || '-').trim() || '-'}`
                  : `Aktif: ${String(browseMeta.mediaType || 'movie').toUpperCase()} · ${browseCategoryLabel}`}
              </small>
            </div>
          </Accordion.Header>
          <Accordion.Body>
            <div className="tmdb-search-controls mb-3">
              <Row className="g-2 align-items-end">
                <Col md={2} className="tmdb-search-type-col">
                  <Form.Label>Tipe</Form.Label>
                  <Form.Select size="sm" value={mediaType} onChange={(e) => setMediaType(String(e.target.value || 'multi'))}>
                    <option value="multi">Multi</option>
                    <option value="movie">Movie</option>
                    <option value="tv">TV</option>
                  </Form.Select>
                </Col>
                <Col md={4} className="tmdb-search-query-col">
                  <Form.Label>Judul Film/Series</Form.Label>
                  <Form.Control
                    size="sm"
                    type="text"
                    placeholder="Masukkan judul... atau id:27205 / tmdb:27205"
                    value={query}
                    onChange={(e) => setQuery(String(e.target.value || ''))}
                  />
                </Col>
                <Col md={1} className="tmdb-search-year-col">
                  <Form.Label>Tahun</Form.Label>
                  <Form.Control
                    size="sm"
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    value={year}
                    onChange={(e) => setYear(String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4))}
                  />
                </Col>
                <Col md={2} className="tmdb-search-language-col">
                  <Form.Label>Language</Form.Label>
                  <Form.Select size="sm" value={language} onChange={(e) => setLanguage(String(e.target.value || 'en-US'))}>
                    {TMDB_LANG_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Form.Select>
                </Col>
                <Col md={1} className="tmdb-search-region-col">
                  <Form.Label>Region</Form.Label>
                  <Form.Select size="sm" value={region} onChange={(e) => setRegion(String(e.target.value || 'ID'))}>
                    {TMDB_REGION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Form.Select>
                </Col>
                <Col md={2} className="d-grid tmdb-search-submit-col">
                  <Button type="button" variant="primary" size="sm" onClick={handleSearch} disabled={searching}>
                    {searching ? <Spinner animation="border" size="sm" /> : 'Cari TMDB'}
                  </Button>
                </Col>
              </Row>
            </div>
            {!isSearchCardMode && (
              <div className="tmdb-browse-actions mb-2">
                <Row className="g-2 align-items-end">
                  <Col md={3} className="tmdb-browse-type-col">
                    <Form.Label className="mb-1">Tipe</Form.Label>
                    <Form.Select
                      size="sm"
                      value={browsePicker.mediaType}
                      onChange={(e) => handleBrowseMediaTypeChange(e.target.value)}
                    >
                      <option value="movie">Movie</option>
                      <option value="tv">TV</option>
                    </Form.Select>
                  </Col>
                  <Col md={5} className="tmdb-browse-category-col">
                    <Form.Label className="mb-1">Kategori</Form.Label>
                    <Form.Select
                      size="sm"
                      value={browsePicker.category}
                      onChange={(e) => handleBrowseCategoryChange(e.target.value)}
                    >
                      {(TMDB_BROWSE_CATEGORIES[normalizeBrowseMediaType(browsePicker.mediaType)] || []).map((item) => (
                        <option key={`${browsePicker.mediaType}-${item.key}`} value={item.key}>{item.label}</option>
                      ))}
                    </Form.Select>
                  </Col>
                </Row>
              </div>
            )}
            {isSearchCardMode && (
              <div className="tmdb-search-card-toolbar mb-2">
                <small className="text-muted">
                  Mode pencarian aktif. Hasil kartu mengikuti input `Cari TMDB`.
                </small>
                <Button
                  type="button"
                  size="sm"
                  variant="outline-secondary"
                  onClick={handleSwitchToBrowseCards}
                  disabled={browseLoading}
                >
                  Kembali ke Browse
                </Button>
              </div>
            )}
            <div className="tmdb-candidate-quick-filter mb-2">
              {TMDB_CANDIDATE_FILTER_OPTIONS.map((item) => (
                <Form.Check
                  key={`tmdb-card-filter-${item.key}`}
                  type="switch"
                  id={`tmdb-card-filter-${item.key}`}
                  label={item.label}
                  checked={!!candidateFilters[item.key]}
                  onChange={() => toggleCandidateFilter(item.key)}
                />
              ))}
            </div>
            <div className="tmdb-candidate-filter-meta mb-2">
              <small className="text-muted">
                Tampil {cardDisplayItems.length}/{candidates.length} kandidat
                {probingCandidateMeta ? ' · mengecek trailer/provider...' : ''}
              </small>
            </div>

            {(browseLoading || searching) && (
              <div className="py-2 text-muted">
                <Spinner animation="border" size="sm" className="me-2" />
                {isSearchCardMode ? 'Mencari kartu TMDB...' : 'Memuat kartu TMDB...'}
              </div>
            )}
            {!browseLoading && !searching && !cardDisplayItems.length && !candidates.length && (
              <small className="text-muted">
                {isSearchCardMode
                  ? 'Belum ada hasil search. Jalankan Cari TMDB untuk menampilkan kartu.'
                  : 'Belum ada kartu kategori. Pilih salah satu kategori di atas.'}
              </small>
            )}
            {!browseLoading && !searching && !cardDisplayItems.length && !!candidates.length && (
              <small className="text-muted">Tidak ada kandidat yang sesuai filter aktif.</small>
            )}
            {!browseLoading && !searching && !!cardDisplayItems.length && (
              <div className="tmdb-browse-grid">
                {cardDisplayItems.map((item, idx) => {
                  const key = createCandidateKey(item) || `${item.mediaType || 'x'}-${item.tmdbId || idx}`
                  const active = selectedCandidateKey === key
                  const cap = candidateCapabilities[key] || createCandidateCapability(item)
                  const mediaTypeLabel = String(item.mediaType || '-').toUpperCase()
                  const ratingLabel = Number.isFinite(Number(item.rating))
                    ? `⭐ ${Number(item.rating).toFixed(1)}`
                    : 'NR'
                  const primaryGenre = resolvePrimaryGenre(item?.primaryGenre || cap?.primaryGenre)
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`tmdb-browse-card ${active ? 'is-active' : ''}`}
                      onClick={() => handleSelectCandidate(item)}
                      title={item.title || '-'}
                    >
                      <div className="tmdb-browse-poster">
                        {item.posterUrl ? (
                          <img src={item.posterUrl} alt={item.title || `browse-${idx + 1}`} />
                        ) : (
                          <span>No Poster</span>
                        )}
                        <span className="tmdb-browse-chip tmdb-browse-chip-type">{mediaTypeLabel}</span>
                        <span className="tmdb-browse-chip tmdb-browse-chip-rating">{ratingLabel}</span>
                        {active && (
                          <span className="tmdb-browse-chip tmdb-browse-chip-active">
                            <Icon icon="material-symbols:check-circle" width="14" height="14" />
                          </span>
                        )}
                        <div className="tmdb-browse-overlay">
                          <div className="tmdb-browse-title">{item.title || '-'}</div>
                          <div className="tmdb-browse-sub">
                            {item.year || '-'} · {primaryGenre || '-'}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {isSearchCardMode ? (
              <div className="tmdb-browse-pagination-wrap mt-2">
                <small className="text-muted">
                  Halaman {Math.max(1, Number(searchPager.page || 1))}/{Math.max(1, Number(searchPager.totalPages || 1))}
                  {' · '}Total hasil: {Math.max(0, Number(searchPager.totalResults || 0))}
                  {' · '}Max TMDB: {Math.max(1, Number(searchPager.maxPage || 500))}
                </small>
                {Math.max(1, Number(searchPager.totalPages || 1)) > 1 && (
                  <Pagination size="sm" className="tmdb-browse-pagination mb-0">
                    <Pagination.First
                      disabled={searching || Number(searchPager.page || 1) <= 1}
                      onClick={() => handleSearchPageChange(1)}
                    />
                    <Pagination.Prev
                      disabled={searching || Number(searchPager.page || 1) <= 1}
                      onClick={() => handleSearchPageChange(Number(searchPager.page || 1) - 1)}
                    />
                    {searchPageItems[0] > 1 && <Pagination.Ellipsis disabled />}
                    {searchPageItems.map((pageNumber) => (
                      <Pagination.Item
                        key={`search-page-${pageNumber}`}
                        active={Number(searchPager.page || 1) === pageNumber}
                        disabled={searching}
                        onClick={() => handleSearchPageChange(pageNumber)}
                      >
                        {pageNumber}
                      </Pagination.Item>
                    ))}
                    {!!searchTrailingPageItems.length && showSearchTrailingEllipsis && <Pagination.Ellipsis disabled />}
                    {searchTrailingPageItems.map((pageNumber) => (
                      <Pagination.Item
                        key={`search-page-tail-${pageNumber}`}
                        active={Number(searchPager.page || 1) === pageNumber}
                        disabled={searching}
                        onClick={() => handleSearchPageChange(pageNumber)}
                      >
                        {pageNumber}
                      </Pagination.Item>
                    ))}
                    <Pagination.Next
                      disabled={searching || Number(searchPager.page || 1) >= Number(searchPager.totalPages || 1)}
                      onClick={() => handleSearchPageChange(Number(searchPager.page || 1) + 1)}
                    />
                    <Pagination.Last
                      disabled={searching || Number(searchPager.page || 1) >= Number(searchPager.totalPages || 1)}
                      onClick={() => handleSearchPageChange(Number(searchPager.totalPages || 1))}
                    />
                  </Pagination>
                )}
              </div>
            ) : (
              <div className="tmdb-browse-pagination-wrap mt-2">
                <small className="text-muted">
                  Halaman {Math.max(1, Number(browsePager.page || 1))}/{Math.max(1, Number(browsePager.totalPages || 1))}
                  {' · '}Total hasil: {Math.max(0, Number(browsePager.totalResults || 0))}
                  {' · '}Max TMDB: {Math.max(1, Number(browsePager.maxPage || 500))}
                </small>
                {Math.max(1, Number(browsePager.totalPages || 1)) > 1 && (
                  <Pagination size="sm" className="tmdb-browse-pagination mb-0">
                    <Pagination.First
                      disabled={browseLoading || Number(browsePager.page || 1) <= 1}
                      onClick={() => handleBrowsePageChange(1)}
                    />
                    <Pagination.Prev
                      disabled={browseLoading || Number(browsePager.page || 1) <= 1}
                      onClick={() => handleBrowsePageChange(Number(browsePager.page || 1) - 1)}
                    />
                    {browsePageItems[0] > 1 && <Pagination.Ellipsis disabled />}
                    {browsePageItems.map((pageNumber) => (
                      <Pagination.Item
                        key={`browse-page-${pageNumber}`}
                        active={Number(browsePager.page || 1) === pageNumber}
                        disabled={browseLoading}
                        onClick={() => handleBrowsePageChange(pageNumber)}
                      >
                        {pageNumber}
                      </Pagination.Item>
                    ))}
                    {!!browseTrailingPageItems.length && showTrailingEllipsis && <Pagination.Ellipsis disabled />}
                    {browseTrailingPageItems.map((pageNumber) => (
                      <Pagination.Item
                        key={`browse-page-tail-${pageNumber}`}
                        active={Number(browsePager.page || 1) === pageNumber}
                        disabled={browseLoading}
                        onClick={() => handleBrowsePageChange(pageNumber)}
                      >
                        {pageNumber}
                      </Pagination.Item>
                    ))}
                    <Pagination.Next
                      disabled={browseLoading || Number(browsePager.page || 1) >= Number(browsePager.totalPages || 1)}
                      onClick={() => handleBrowsePageChange(Number(browsePager.page || 1) + 1)}
                    />
                    <Pagination.Last
                      disabled={browseLoading || Number(browsePager.page || 1) >= Number(browsePager.totalPages || 1)}
                      onClick={() => handleBrowsePageChange(Number(browsePager.totalPages || 1))}
                    />
                  </Pagination>
                )}
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      <Row className="g-3">
        <Col lg={12}>
          <Card className="h-100">
            <Card.Header className="py-2 d-flex justify-content-between align-items-center">
              <span>Detail TMDB</span>
              <div className="tmdb-detail-header-tools">
                <div className="tmdb-detail-header-badges">
                  <Badge bg="secondary">{String(detailData?.entityType || mediaType || 'multi').toUpperCase()}</Badge>
                  <Badge bg={detailCompleteness.variant}>
                    Kelengkapan {detailCompleteness.filled}/{detailCompleteness.total} ({detailCompleteness.percent}%)
                  </Badge>
                  {isTvDetail && (
                    <Badge bg="info">{tvScopeHeaderBadge}</Badge>
                  )}
                  <Badge bg="dark">Lock {factLockEnabledCount}/{factLockFields.length}</Badge>
                </div>
                <div className="tmdb-detail-header-actions">
                  <Button
                    type="button"
                    variant="outline-primary"
                    size="sm"
                    onClick={handleApplyWithoutBack}
                    disabled={!selectionPayload}
                  >
                    Apply & Hold
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleUseForGenerate}
                    disabled={!selectionPayload}
                  >
                    Use Data
                  </Button>
                  <Button type="button" variant="outline-danger" size="sm" onClick={handleClearSelection}>
                    Reset TMDB
                  </Button>
                </div>
              </div>
            </Card.Header>
            <Card.Body>
              {detailLoading && (
                <div className="py-4 text-center text-muted">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Memuat detail TMDB...
                </div>
              )}
              {!detailLoading && !detailData && (
                <small className="text-muted">Pilih salah satu kandidat untuk memuat detail.</small>
              )}
              {!detailLoading && detailData && (
                <>
                  <div className={`tmdb-tv-overview-group mb-3${isTvDetail ? ' is-tv' : ''}`}>
                    {isTvDetail && (
                      <div className="tmdb-tv-scope-card mb-0">
                        <div className="tmdb-tv-scope-groups">
                          <div className="tmdb-tv-scope-group tmdb-tv-scope-group-primary">
                            <Row className="g-2 align-items-end">
                              <Col md={6} className="tmdb-tv-scope-reference-col">
                                <div className="tmdb-scope-label-row mb-1">
                                  <Form.Label className="mb-0">Reference Scope</Form.Label>
                                  <div className="tmdb-scope-help-wrap">
                                    <Button
                                      type="button"
                                      variant="link"
                                      size="sm"
                                      className="tmdb-scope-help-btn p-0"
                                      onClick={showScopeHelpToast}
                                      title="Bantuan scope"
                                    >
                                      <Icon icon="material-symbols:help-outline" width="18" height="18" />
                                    </Button>
                                    {!!scopeHelpToastVisible && (
                                      <div className="tmdb-scope-help-toast-wrap">
                                        <Toast
                                          show={scopeHelpToastVisible}
                                          onClose={() => setScopeHelpToastVisible(false)}
                                          bg="dark"
                                          className="tmdb-help-toast tmdb-scope-help-toast"
                                        >
                                          <Toast.Header closeButton>
                                            <strong className="me-auto">Bantuan Reference Scope</strong>
                                          </Toast.Header>
                                          <Toast.Body className="text-white">
                                            {TMDB_SCOPE_HELP_TEXT.map((line) => (
                                              <div key={line} className="tmdb-help-line">{line}</div>
                                            ))}
                                          </Toast.Body>
                                        </Toast>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <Form.Select
                                  size="sm"
                                  value={normalizeReferenceScope(referenceScope)}
                                  onChange={(e) => handleTvScopeChange(e.target.value)}
                                >
                                  {TMDB_TV_REFERENCE_SCOPES.map((scopeKey) => (
                                    <option key={`scope-${scopeKey}`} value={scopeKey}>
                                      {TMDB_TV_REFERENCE_SCOPE_LABELS[scopeKey] || scopeKey}
                                    </option>
                                  ))}
                                </Form.Select>
                              </Col>
                              <Col md={6} className="tmdb-tv-scope-spoiler-col">
                                <Form.Label className="mb-1">Spoiler Level</Form.Label>
                                <Form.Select
                                  size="sm"
                                  value={normalizeSpoilerLevel(spoilerLevel)}
                                  onChange={(e) => applyTvScopeControl({ spoilerLevel: e.target.value })}
                                >
                                  {TMDB_SPOILER_LEVELS.map((spoilerKey) => (
                                    <option key={`spoiler-${spoilerKey}`} value={spoilerKey}>
                                      {TMDB_SPOILER_LABELS[spoilerKey] || spoilerKey}
                                    </option>
                                  ))}
                                </Form.Select>
                              </Col>
                            </Row>
                          </div>

                          <div className="tmdb-tv-scope-group tmdb-tv-scope-group-season">
                            <Row className="g-2 align-items-end">
                              <Col md={6} className="tmdb-tv-scope-season-col">
                                <Form.Label className="mb-1">Season</Form.Label>
                                <Form.Select
                                  size="sm"
                                  value={seasonSelectValue}
                                  disabled={!seasonControlEnabled}
                                  onChange={(e) => handleTvSeasonChange(e.target.value)}
                                >
                                  <option value="">
                                    {seasonControlEnabled ? 'Pilih Season' : 'All Season (Scope: Series)'}
                                  </option>
                                  {tvSeasonOptions.map((seasonItem) => (
                                    <option key={`season-opt-${seasonItem.number}`} value={seasonItem.number}>
                                      S{seasonItem.number}{seasonItem.name ? ` · ${seasonItem.name}` : ''}
                                    </option>
                                  ))}
                                </Form.Select>
                              </Col>
                              <Col md={6} className="tmdb-tv-scope-episode-col">
                                <Form.Label className="mb-1">Episode</Form.Label>
                                <Form.Select
                                  size="sm"
                                  value={episodeSelectValue}
                                  disabled={!episodeControlEnabled || !tvSeasonOptions.length}
                                  onChange={(e) => handleTvEpisodeChange(e.target.value)}
                                >
                                  <option value="">
                                    {episodeControlEnabled ? 'Pilih Episode' : 'All Episode (Scope: Season/Series)'}
                                  </option>
                                  {tvEpisodeOptions.map((episodeItem) => (
                                    <option key={`episode-opt-${episodeItem.number}`} value={episodeItem.number}>
                                      E{episodeItem.number}{episodeItem.name ? ` · ${episodeItem.name}` : ''}
                                    </option>
                                  ))}
                                </Form.Select>
                              </Col>
                            </Row>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="tmdb-detail-overview-grid mb-0">
                      <div className="tmdb-detail-overview-poster-wrap">
                        {detailOverviewPosterUrl ? (
                          <img
                            className="tmdb-detail-overview-poster"
                            src={detailOverviewPosterUrl}
                            alt={detailData?.movieOrTv?.title || detailSelectedCandidate?.title || 'tmdb-poster'}
                          />
                        ) : (
                          <div className="tmdb-detail-overview-poster tmdb-detail-overview-poster-empty">No Poster</div>
                        )}
                      </div>
                      <div className="tmdb-detail-overview-meta">
                        <div className="tmdb-detail-overview-title">
                          <strong>Title:</strong>{' '}
                          <span>{detailData?.movieOrTv?.title || '-'}</span>
                        </div>
                        <div className="tmdb-detail-overview-text">
                          <strong>Overview:</strong>{' '}
                          <span>{String(detailData?.movieOrTv?.overview || '').trim() || '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="tmdb-fact-grid mb-3">
                    <div><strong>Tagline:</strong> {detailData?.movieOrTv?.tagline || '-'}</div>
                    <div><strong>Release:</strong> {detailData?.movieOrTv?.release_date || '-'}</div>
                    <div><strong>Runtime:</strong> {detailData?.movieOrTv?.runtime || '-'} menit</div>
                    <div><strong>Certification:</strong> {detailData?.movieOrTv?.certification_id || '-'}</div>
                    <div><strong>Genres:</strong> {Array.isArray(detailData?.movieOrTv?.genres) ? detailData.movieOrTv.genres.join(', ') || '-' : '-'}</div>
                    <div><strong>{detailMakerLabel}:</strong> {detailMakerValue}</div>
                    <div><strong>Cast Top:</strong> {Array.isArray(detailData?.movieOrTv?.cast_top) ? detailData.movieOrTv.cast_top.join(', ') || '-' : '-'}</div>
                    <div><strong>Keywords:</strong> {Array.isArray(detailData?.movieOrTv?.keywords) ? detailData.movieOrTv.keywords.join(', ') || '-' : '-'}</div>
                    <div><strong>Production Companies:</strong> {Array.isArray(detailData?.movieOrTv?.production_companies) ? detailData.movieOrTv.production_companies.join(', ') || '-' : '-'}</div>
                    {isTvDetail && (
                      <div><strong>Networks:</strong> {Array.isArray(detailData?.movieOrTv?.networks) ? detailData.movieOrTv.networks.join(', ') || '-' : '-'}</div>
                    )}
                    <div><strong>Production Countries:</strong> {Array.isArray(detailData?.movieOrTv?.production_countries) ? detailData.movieOrTv.production_countries.join(', ') || '-' : '-'}</div>
                    <div><strong>Vote Average:</strong> {Number.isFinite(Number(detailData?.movieOrTv?.vote_average)) ? Number(detailData.movieOrTv.vote_average).toFixed(1) : '-'}</div>
                    {!isTvDetail && (
                      <div><strong>Budget:</strong> {formatMoney(detailData?.movieOrTv?.budget)}</div>
                    )}
                    {!isTvDetail && (
                      <div><strong>Revenue:</strong> {formatMoney(detailData?.movieOrTv?.revenue)}</div>
                    )}
                    <div><strong>Watch Providers:</strong> {Array.isArray(detailData?.movieOrTv?.watch_providers_id) ? detailData.movieOrTv.watch_providers_id.join(', ') || '-' : '-'}</div>
                    <div><strong>Status:</strong> {detailData?.movieOrTv?.status || '-'}</div>
                    <div><strong>Original Language:</strong> {detailData?.movieOrTv?.original_language || '-'}</div>
                    {isTvDetail && (
                      <>
                        <div><strong>Reference Scope:</strong> {tvScopeLabel}</div>
                        <div><strong>Spoiler Level:</strong> {tvSpoilerLabel}</div>
                        <div><strong>Season:</strong> {tvSelectionLabels.season || '-'}</div>
                        <div><strong>Season Count:</strong> {detailData?.movieOrTv?.season_count || tvContext?.seasonCount || '-'}</div>
                        {showSeasonScopedDetails && (
                          <div><strong>Episode Count:</strong> {detailData?.movieOrTv?.episode_count || tvContext?.episodeCount || '-'}</div>
                        )}
                        {showSeasonScopedDetails && (
                          <div><strong>Season Overview:</strong> {detailData?.movieOrTv?.season_overview || tvContext?.season?.overview || '-'}</div>
                        )}
                        {showEpisodeScopedDetails && (
                          <div><strong>Episode:</strong> {tvSelectionLabels.episode || '-'}</div>
                        )}
                        {showEpisodeScopedDetails && (
                          <div><strong>Episode Type:</strong> {detailData?.movieOrTv?.episode_type || tvContext?.episodeType || '-'}</div>
                        )}
                        {showEpisodeScopedDetails && (
                          <div><strong>Episode Overview:</strong> {detailData?.movieOrTv?.episode_overview || tvContext?.episode?.overview || '-'}</div>
                        )}
                      </>
                    )}
                  </div>

                  {detailData?.movieOrTv?.trailer && (
                    <div className="mb-2">
                      <strong>Trailer:</strong>{' '}
                      <a href={detailData.movieOrTv.trailer} target="_blank" rel="noreferrer">
                        {detailData.movieOrTv.trailer}
                      </a>
                    </div>
                  )}
                  {!detailData?.movieOrTv?.trailer && (
                    <div className="mb-2">
                      <strong>Trailer:</strong> -
                    </div>
                  )}

                  <div className="tmdb-fact-lock-card mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <strong>Fact Locks (Lock/Unlock per Field)</strong>
                      <small className="text-muted">{factLockEnabledCount}/{factLockFields.length} aktif</small>
                    </div>
                    <div className="tmdb-fact-lock-grid">
                      {factLockFields.map((field) => (
                        <Form.Check
                          key={field}
                          type="switch"
                          id={`tmdb-fact-lock-${field}`}
                          label={field === 'director' ? detailMakerLabel : (TMDB_FACT_LOCK_LABELS[field] || field)}
                          checked={factLocks[field] !== false}
                          onChange={() => toggleFactLock(field)}
                        />
                      ))}
                    </div>
                    <small className="text-muted d-block mt-1">
                      Field yang ON dipaksa mengikuti fakta TMDB saat generate.
                    </small>
                  </div>

                  <div className="mb-2 d-flex justify-content-between align-items-center">
                    <strong>Pilih Referensi Gambar (max {TMDB_MAX_SELECTED_IMAGES})</strong>
                    <small className="text-muted">
                      {selectedImages.length}/{TMDB_MAX_SELECTED_IMAGES} dipilih · Poster {detailPosterOptions.length} · Backdrop {detailBackdropOptions.length}
                    </small>
                  </div>
                  <div className="tmdb-image-tabs">
                    <Tab.Container
                      activeKey={activeImageTab}
                      onSelect={(key) => setActiveImageTab(key === 'backdrop' ? 'backdrop' : 'poster')}
                    >
                      <>
                        <Nav variant="tabs" className="tmdb-image-tabs-nav mb-2">
                          <Nav.Item>
                            <Nav.Link eventKey="poster">
                              Poster
                              <span className="tmdb-image-tab-count">{detailPosterOptions.length}</span>
                            </Nav.Link>
                          </Nav.Item>
                          <Nav.Item>
                            <Nav.Link eventKey="backdrop">
                              Backdrop
                              <span className="tmdb-image-tab-count">{detailBackdropOptions.length}</span>
                            </Nav.Link>
                          </Nav.Item>
                        </Nav>
                        <Tab.Content>
                          <Tab.Pane eventKey="poster">
                            {renderTmdbImageTab(detailPosterOptions, 'poster', 'Tidak ada poster.')}
                          </Tab.Pane>
                          <Tab.Pane eventKey="backdrop">
                            {renderTmdbImageTab(detailBackdropOptions, 'backdrop', 'Tidak ada backdrop.')}
                          </Tab.Pane>
                        </Tab.Content>
                      </>
                    </Tab.Container>
                  </div>

                  <div className="tmdb-payload-preview mt-3">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <strong>Payload Preview</strong>
                      <small className="text-muted">
                        {payloadPreviewMode === 'debug' ? 'Debug internal (selection + debug)' : 'Request strict (akan dikirim ke Generate)'}
                      </small>
                    </div>
                    <div className="tmdb-payload-mode-toggle mb-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={payloadPreviewMode === 'strict' ? 'primary' : 'outline-secondary'}
                        onClick={() => setPayloadPreviewMode('strict')}
                      >
                        Request (Strict)
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={payloadPreviewMode === 'debug' ? 'primary' : 'outline-secondary'}
                        onClick={() => setPayloadPreviewMode('debug')}
                      >
                        Debug (Full)
                      </Button>
                    </div>
                    <pre className="tmdb-payload-preview-json">
                      {payloadPreview ? JSON.stringify(payloadPreview, null, 2) : '{\n  "tmdb": null\n}'}
                    </pre>
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
