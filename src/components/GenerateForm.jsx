import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Form, Button, Row, Col, Spinner, Alert, Dropdown, Accordion } from 'react-bootstrap'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { apiAxios, humanizeApiError } from '../lib/apiRuntime'
import { supabase } from '../supabase/client'
import normalizeManual from '../lib/normalizeManual'
import { compilePrompt, defaultTemplateForConfig } from '../lib/promptCompiler'
import { syncLocalFallbackToSupabase } from '../lib/generationStorage'
import { sortPresetsForUi } from '../lib/presetOrdering'
import {
  buildTmdbGenerateRequestFromSelection,
  clearTmdbGenerateSelection,
  readTmdbFinderPrefs,
  readTmdbGenerateSelection,
  writeTmdbFinderPrefs,
  writeTmdbGenerateSelection
} from '../lib/tmdbSelection'

const PLATFORMS = [
  'TikTok',
  'YouTube Short',
  'YouTube Long',
  'Shopee',
  'Tokopedia',
  'Lazada',
  'Instagram Reels',
  'Facebook Reels',
  'Pinterest',
  'WhatsApp Status',
  'Threads',
  'WhatsApp Channel',
  'Telegram',
  'LinkedIn',
  'X (Twitter)',
  'SoundCloud',
  'Blog Blogger'
]
const PROVIDERS = ['Gemini', 'OpenAI', 'OpenRouter', 'Groq', 'Cohere AI', 'DeepSeek', 'Hugging Face']
const PROVIDER_MODELS = {
  Gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'],
  OpenAI: ['gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4o-mini-2024-07-18', 'gpt-4o', 'gpt-4.1-mini'],
  'OpenRouter': [
    'meta-llama/llama-3-8b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'google/gemini-2.0-flash-001'
  ],
  Groq: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  'Cohere AI': ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r7b-12-2024', 'command-r', 'command-r-plus'],
  'DeepSeek': ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-r1-distil-llama-70b'],
  'Hugging Face': [
    'meta-llama/Llama-3-70b-chat-hf',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
    'Qwen/Qwen2.5-72B-Instruct',
    'meta-llama/Llama-3.1-8B-Instruct',
    'mistralai/Mistral-7B-Instruct-v0.3'
  ]
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

const FEATURED_MODEL_RANK_BY_PROVIDER = Object.fromEntries(
  Object.entries(FEATURED_MODELS_BY_PROVIDER).map(([provider, models]) => {
    const rank = new Map()
    ;(models || []).forEach((id, idx) => rank.set(normalizeModelKey(id), idx))
    return [provider, rank]
  })
)

function isFeaturedModel(providerName, modelId) {
  const set = FEATURED_MODEL_SET_BY_PROVIDER[String(providerName || '').trim()]
  if (!set) return false
  return set.has(normalizeModelKey(modelId))
}

function getFeaturedRank(providerName, modelId) {
  const rankMap = FEATURED_MODEL_RANK_BY_PROVIDER[String(providerName || '').trim()]
  if (!rankMap) return Number.MAX_SAFE_INTEGER
  const rank = rankMap.get(normalizeModelKey(modelId))
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER
}

function prioritizeModels(providerName, models = []) {
  return (models || [])
    .map((model, idx) => ({
      ...model,
      isFeatured: model?.isFeatured === true || isFeaturedModel(providerName, model?.id),
      __idx: idx
    }))
    .sort((a, b) => {
      if (!!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1
      if (a.isFeatured && b.isFeatured) {
        return getFeaturedRank(providerName, a.id) - getFeaturedRank(providerName, b.id)
      }
      return a.__idx - b.__idx
    })
    .map(({ __idx, ...model }) => model)
}

function inferVisionSupport(providerName, modelId) {
  const provider = String(providerName || '').trim()
  const id = String(modelId || '').trim().toLowerCase()
  if (!provider || !id) return null

  if (provider === 'OpenAI') {
    if (/gpt-3\.5|embedding|whisper|tts|audio|dall-e|moderation|realtime/.test(id)) return false
    if (/gpt-4o|gpt-4\.1|vision|omni/.test(id)) return true
    return null
  }

  if (provider === 'Gemini') {
    if (/embedding|aqa|imagen|tts|speech|transcribe/.test(id)) return false
    if (/gemini/.test(id)) return true
    return null
  }

  if (provider === 'OpenRouter') {
    if (/embedding|rerank|moderation|whisper|tts|audio/.test(id)) return false
    if (/vision|gpt-4o|gpt-4\.1|gemini|claude-3|claude-sonnet|pixtral|llava|qwen2-vl|llama-3\.2-11b-vision|llama-3\.2-90b-vision/.test(id)) return true
    return null
  }

  if (provider === 'Groq') {
    if (/whisper|audio|embed|embedding/.test(id)) return false
    if (/vision|llava|pixtral|qwen2-vl|llama-3\.2-11b-vision|llama-3\.2-90b-vision/.test(id)) return true
    return null
  }

  if (provider === 'Cohere AI') {
    if (/embed|rerank|classif/.test(id)) return false
    if (/vision/.test(id)) return true
    return null
  }

  if (provider === 'DeepSeek') {
    if (/deepseek-chat|deepseek-reasoner/.test(id)) return false
    if (/vision|vl/.test(id)) return true
    return null
  }

  if (provider === 'Hugging Face') {
    if (/embed|rerank|classif|whisper|audio/.test(id)) return false
    if (/vision|vl|llava|pixtral|qwen2-vl|llama-3\.2-11b-vision|llama-3\.2-90b-vision/.test(id)) return true
    return null
  }

  return null
}

function normalizeModelOption(input, providerName = '') {
  if (typeof input === 'string') {
    const id = String(input || '').trim()
    return id
      ? {
        id,
        label: id,
        supportsVision: inferVisionSupport(providerName, id),
        isFeatured: isFeaturedModel(providerName, id)
      }
      : null
  }
  if (!input || typeof input !== 'object') return null
  const id = String(input.id || '').trim()
  if (!id) return null
  const label = String(input.label || id).trim() || id
  const supportsVision = typeof input.supportsVision === 'boolean'
    ? input.supportsVision
    : inferVisionSupport(providerName, id)
  const isFeatured = typeof input.isFeatured === 'boolean'
    ? input.isFeatured
    : isFeaturedModel(providerName, id)
  return { id, label, supportsVision, isFeatured }
}

function fallbackModelOptions(provider) {
  const list = Array.isArray(PROVIDER_MODELS[provider]) ? PROVIDER_MODELS[provider] : []
  return prioritizeModels(provider, list.map((id) => ({
    id,
    label: id,
    supportsVision: inferVisionSupport(provider, id),
    isFeatured: isFeaturedModel(provider, id)
  })))
}
const RECOMMENDED_TONES = [
  'Urgency',
  'Persuasive / Meyakinkan',
  'Casual / Santai',
  'Sassy / Ngegas',
  'Bold / Berani',
  'Relatable / Bisa Direlate',
  'Friendly / Ramah',
  'Witty / Cerdas Lucu',
  'Profesional',
  'Fun'
]

const MORE_TONES = [
  'Adventurous / Petualang',
  'Classy / Elegan',
  'Conversational / Ngobrol',
  'Curious / Bikin Penasaran',
  'Humor / Lucu',
  'Motivational / Motivasi',
  'Raw / Unfiltered / Mentah Autentik',
  'Inspirational / Menginspirasi',
  'Storytelling / Naratif',
  'Empathetic / Empati'
]
const LANGS = [
  { value: 'Indonesia', label: 'ID' },
  { value: 'English', label: 'EN' }
]

const PRESETS = [
  { key: 'builtin:short-hook', label: 'Short Hook (Instant)', tone: 'Fun', length: 'short' },
  { key: 'builtin:long-script', label: 'Long Script (Instant)', tone: 'Profesional', length: 'long' },
  { key: 'builtin:hashtag-pack', label: 'Hashtag Pack (Instant)', tone: 'Urgency', length: 'short' }
]

const MAX_IMAGE_REFERENCES = 5
const MAX_UPLOAD_IMAGE_MB = 2
const PLATFORM_WIDTH_CH = {
  'TikTok': 10,
  'YouTube Short': 18,
  'YouTube Long': 18,
  'Shopee': 12,
  'Tokopedia': 14,
  'Lazada': 10,
  'Instagram Reels': 18,
  'Facebook Reels': 18,
  'WhatsApp Status': 20,
  'Threads': 11,
  'WhatsApp Channel': 20,
  'Telegram': 11,
  'LinkedIn': 12,
  'X (Twitter)': 14,
  'SoundCloud': 14,
  'Blog Blogger': 16
}
const PROVIDER_WIDTH_CH = {
  'Gemini': 11,
  'OpenAI': 11,
  'OpenRouter': 15,
  'Groq': 10,
  'Cohere AI': 13,
  'DeepSeek': 13,
  'Hugging Face': 16
}
const FREE_ONLY_PREFS_STORAGE_KEY = 'provider_free_only_by_provider_v1'
const TMDB_DETAIL_ACCORDION_STORAGE_KEY = 'tmdb_detail_accordion_open_v1'

function readFreeOnlyPrefsByProvider() {
  try {
    const raw = JSON.parse(localStorage.getItem(FREE_ONLY_PREFS_STORAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    return {}
  }
}

function getProviderFreeOnlyPreference(provider) {
  const prefs = readFreeOnlyPrefsByProvider()
  const value = prefs?.[provider]
  if (typeof value === 'boolean') return value
  return provider === 'OpenRouter' ? false : true
}

function getProviderModelFetchLimit(providerName) {
  const provider = String(providerName || '').trim()
  if (provider === 'OpenRouter') return 400
  return 100
}

function readTmdbDetailAccordionOpen() {
  try {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(TMDB_DETAIL_ACCORDION_STORAGE_KEY) === '1'
  } catch (e) {
    return false
  }
}

export default function GenerateForm({ onResult, regenerateToken = 0 }) {
  const location = useLocation()
  const navigate = useNavigate()
  const tmdbPrefs = readTmdbFinderPrefs()
  const { register, handleSubmit, reset, watch, setValue, getValues } = useForm({
    defaultValues: {
      platform: 'TikTok',
      provider: 'OpenAI',
      tone: 'Fun',
      language: 'Indonesia',
      length: 'short',
      model: 'gpt-4o-mini',
      mode: 'Standard',
      preset: '',
      useTmdb: tmdbPrefs.enabled !== false
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [modelLoadAlert, setModelLoadAlert] = useState(null)
  const provider = watch('provider')
  const mode = watch('mode')
  const preset = watch('preset')
  const tone = watch('tone')
  const platform = watch('platform')
  const model = watch('model')
  const language = watch('language')
  const topicValue = watch('topic')
  const useTmdb = watch('useTmdb')
  const [templatePresets, setTemplatePresets] = useState([])
  const orderedTemplatePresets = useMemo(() => sortPresetsForUi(templatePresets), [templatePresets])
  const isTemplatePreset = mode === 'Instant' && String(preset || '').startsWith('template:')
  const isBuiltinPreset = mode === 'Instant' && String(preset || '').startsWith('builtin:')
  const selectedTemplate = isTemplatePreset
    ? templatePresets.find((x) => x.id === String(preset).replace('template:', ''))
    : null
  const templateVariationCount = Number.isInteger(Number(selectedTemplate?.constraints?.variationCount))
    ? Math.max(1, Number(selectedTemplate?.constraints?.variationCount))
    : 1
  const selectedBuiltin = isBuiltinPreset ? PRESETS.find((x) => x.key === preset) : null
  const [models, setModels] = useState(fallbackModelOptions('OpenAI'))
  const [loadingModels, setLoadingModels] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [toneOpen, setToneOpen] = useState(false)
  const [promptPreview, setPromptPreview] = useState('')
  // preset dropdown state
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetSearch, setPresetSearch] = useState('')
  const [presetFilterPlatform, setPresetFilterPlatform] = useState('')
  const [presetFilterType, setPresetFilterType] = useState('all')
  const [imageReferences, setImageReferences] = useState([])
  const [tmdbSelection, setTmdbSelection] = useState(() => readTmdbGenerateSelection())
  const [tmdbDetailAccordionOpen, setTmdbDetailAccordionOpen] = useState(() => readTmdbDetailAccordionOpen())
  const imageFileInputRef = useRef(null)
  const lastRegenerateTokenRef = useRef(0)
  const detectedModelsCacheRef = useRef({})
  const lastVisionAutoKeyRef = useRef('')
  const lastAppliedHistoryKeyRef = useRef('')
  const tmdbSelectedImageRefs = useMemo(() => {
    if (!useTmdb) return []
    const rows = Array.isArray(tmdbSelection?.selectedImages) ? tmdbSelection.selectedImages : []
    return rows
      .map((item, idx) => {
        const url = String(item?.url || '').trim()
        if (!url || !isValidHttpUrl(url)) return null
        return {
          id: `tmdb:${idx}:${url}`,
          type: 'url',
          url,
          __source: 'tmdb'
        }
      })
      .filter(Boolean)
  }, [tmdbSelection?.selectedImages, useTmdb])
  const combinedImagePreviewRefs = useMemo(
    () => [
      ...(imageReferences || []).map((ref) => ({ ...ref, __source: 'local' })),
      ...tmdbSelectedImageRefs
    ],
    [imageReferences, tmdbSelectedImageRefs]
  )
  const tmdbSelectedImageCount = tmdbSelectedImageRefs.length
  const localAndTmdbImageCount = imageReferences.length + tmdbSelectedImageCount
  const topicImageUrlCount = extractUrlsFromText(topicValue).filter((url) => isValidHttpUrl(url)).length
  const hasImageRefsForCurrentInput = localAndTmdbImageCount > 0 || topicImageUrlCount > 0
  const imageRefCountForInput = localAndTmdbImageCount + topicImageUrlCount
  const providerFreeOnlyPreference = getProviderFreeOnlyPreference(provider)
  const effectiveFreeOnlyForModelFetch = hasImageRefsForCurrentInput ? false : providerFreeOnlyPreference
  const modelPoolLabel = effectiveFreeOnlyForModelFetch
    ? 'Free only'
    : (hasImageRefsForCurrentInput && providerFreeOnlyPreference ? 'All models (auto for image refs)' : 'All models')

  useEffect(() => {
    let mounted = true
    const fallbackList = fallbackModelOptions(provider)
    const cacheKey = `${provider}::${effectiveFreeOnlyForModelFetch ? 'free' : 'all'}`

    function applyModels(nextModels) {
      if (!mounted) return
      const normalized = Array.isArray(nextModels)
        ? nextModels.map((x) => normalizeModelOption(x, provider)).filter(Boolean)
        : []
      const list = prioritizeModels(provider, normalized)
      setModels(list)
      if (!list.length) return
      const currentModel = String(getValues('model') || '')
      if (!currentModel || !list.some((x) => x.id === currentModel)) {
        setValue('model', list[0].id)
      }
    }

    async function loadProviderModels() {
      const cached = detectedModelsCacheRef.current[cacheKey]
      if (Array.isArray(cached) && cached.length) {
        setModelLoadAlert(null)
        applyModels(cached)
        return
      }

      setLoadingModels(true)
      setModelLoadAlert(null)
      try {
        const headers = await buildAuthHeaders()
        const requestConfig = Object.keys(headers).length ? { headers } : {}
        const resp = await apiAxios({
          method: 'post',
          url: `/api/settings/provider-keys/${encodeURIComponent(provider)}/test`,
          data: { freeOnly: effectiveFreeOnlyForModelFetch, limit: getProviderModelFetchLimit(provider) },
          ...requestConfig
        })
        const detected = Array.isArray(resp?.data?.data?.models)
          ? resp.data.data.models.map((x) => normalizeModelOption(x, provider)).filter(Boolean)
          : []
        if (detected.length) {
          detectedModelsCacheRef.current[cacheKey] = detected
          setModelLoadAlert(null)
          applyModels(detected)
          return
        }
      } catch (e) {
        if (mounted) {
          setModelLoadAlert(
            humanizeApiError(e, {
              fallback: `Gagal memuat model ${provider}. Menampilkan daftar model bawaan.`
            })
          )
        }
      }
      applyModels(fallbackList)
      setLoadingModels(false)
    }

    loadProviderModels().finally(() => {
      if (mounted) setLoadingModels(false)
    })
    return () => { mounted = false }
  }, [provider, setValue, getValues, effectiveFreeOnlyForModelFetch])

  useEffect(() => {
    let mounted = true
    async function loadPresets() {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        const requestConfig = token ? { headers: { Authorization: `Bearer ${token}` } } : {}
        const resp = await apiAxios({
          method: 'get',
          url: '/api/presets',
          ...requestConfig
        })
        if (!mounted) return
        if (resp.data?.ok && Array.isArray(resp.data.data)) {
          setTemplatePresets(resp.data.data)
          localStorage.setItem('templates', JSON.stringify(resp.data.data))
          return
        }
      } catch (e) {}

      try {
        const local = JSON.parse(localStorage.getItem('templates') || '[]')
        if (mounted && Array.isArray(local)) setTemplatePresets(local)
      } catch (e) {
        if (mounted) setTemplatePresets([])
      }
    }
    loadPresets()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    async function syncFallbackHistory() {
      try {
        const { data: userData } = await supabase.auth.getUser()
        const user = userData?.user
        if (!user) return
        await syncLocalFallbackToSupabase({ supabase, userId: user.id })
      } catch (e) {}
    }
    syncFallbackHistory()
  }, [])

  useEffect(() => {
    if (mode === 'Instant' && preset) {
      // preset may be builtin:key or template:id
      if (preset.startsWith('builtin:')) {
        const p = PRESETS.find(x => x.key === preset)
        if (p) {
          setValue('tone', p.tone)
          setValue('length', p.length)
        }
      } else if (preset.startsWith('template:')) {
        const id = preset.replace('template:', '')
        const t = (templatePresets || []).find(x => x.id === id)
        if (t) {
            // prefill topic, platform and other metadata from template
            setValue('platform', t.platform || '')
            setValue('topic', t.topic || '')
            // Provider and Model are chosen on the Generate page; template remains source of truth.
            if (t.language) setValue('language', t.language)
            if (t.contentStructure?.length) setValue('length', t.contentStructure.length)
          }
      }
    }
  }, [mode, preset, setValue, templatePresets])

  useEffect(() => {
    writeTmdbFinderPrefs({ enabled: !!useTmdb })
  }, [useTmdb])

  useEffect(() => {
    setTmdbSelection(readTmdbGenerateSelection())
  }, [location?.key])

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(TMDB_DETAIL_ACCORDION_STORAGE_KEY, tmdbDetailAccordionOpen ? '1' : '0')
    } catch (e) {}
  }, [tmdbDetailAccordionOpen])

  // If navigated with a template preset in location.state, prefill the preset
  useEffect(() => {
    const historyItem = location?.state?.historyItem
    if (historyItem && typeof historyItem === 'object') {
      const historyKey = String(historyItem.id || historyItem.created_at || '').trim()
      if (historyKey && historyKey === lastAppliedHistoryKeyRef.current) return
      lastAppliedHistoryKeyRef.current = historyKey

      const historyResult = historyItem.result || {}
      const nextTopic = String(
        historyItem.topic ||
        historyResult.topic ||
        historyResult.title ||
        ''
      ).trim()
      const nextPlatform = String(
        historyItem.platform ||
        historyResult.platform ||
        historyResult.meta?.platform ||
        'TikTok'
      ).trim()
      const nextProvider = String(
        historyItem.provider ||
        historyResult.meta?.provider ||
        'OpenAI'
      ).trim()
      const nextModel = String(historyResult.meta?.model || '').trim()
      const nextLanguage = String(
        historyResult.language ||
        historyResult.meta?.language ||
        'Indonesia'
      ).trim()
      const nextTone = String(historyResult.meta?.tone || historyResult.tone || 'Fun').trim()
      const nextLength = String(historyResult.meta?.length || 'short').trim()

      setValue('mode', 'Standard')
      setValue('preset', '')
      setValue('topic', nextTopic)
      setValue('platform', nextPlatform)
      setValue('provider', nextProvider)
      if (nextModel) setValue('model', nextModel)
      if (nextLanguage) setValue('language', nextLanguage)
      if (nextTone) setValue('tone', nextTone)
      if (nextLength && ['short', 'medium', 'long'].includes(nextLength)) {
        setValue('length', nextLength)
      }
      setImageReferences([])
      setPromptPreview('')
      setError(null)
      return
    }

    const statePreset = location?.state?.preset
    if (statePreset) {
      setValue('preset', statePreset)
      // also switch mode to Instant so preset applies immediately
      setValue('mode', 'Instant')
    }
  }, [location, setValue])

  function getPresetLabel(value) {
    if (!value) return ''
    if (value.startsWith('builtin:')) {
      const p = PRESETS.find(x => x.key === value)
      return p ? p.label : value
    }
    if (value.startsWith('template:')) {
      const id = value.replace('template:', '')
      const t = orderedTemplatePresets.find(x => x.id === id) || templatePresets.find(x => x.id === id)
      return t ? t.title : value
    }
    return value
  }

  function selectWidthCh(value, opts = { min: 8, max: 18, extra: 3, fixed: null }) {
    if (opts.fixed && Object.prototype.hasOwnProperty.call(opts.fixed, value)) {
      return `${opts.fixed[value]}ch`
    }
    const len = String(value || '').length + Number(opts.extra || 0)
    const bounded = Math.max(Number(opts.min || 8), Math.min(Number(opts.max || 18), len))
    return `${bounded}ch`
  }

  function filterPresetItems() {
    const items = []
    const search = String(presetSearch || '').toLowerCase()
    // built-in
    if (presetFilterType === 'all' || presetFilterType === 'builtin') {
      PRESETS.forEach(p => {
        if (search && !p.label.toLowerCase().includes(search)) return
        if (presetFilterPlatform && p.platform && p.platform !== presetFilterPlatform) return
        items.push({ value: p.key, label: p.label })
      })
    }
    // templates
    if (presetFilterType === 'all' || presetFilterType === 'template') {
      orderedTemplatePresets.forEach(t => {
        if (search && !((t.title || '').toLowerCase().includes(search) || (t.topic || '').toLowerCase().includes(search))) return
        if (presetFilterPlatform && t.platform && t.platform !== presetFilterPlatform) return
        items.push({ value: `template:${t.id}`, label: t.title || t.id })
      })
    }
    return items
  }

  function validateBeforeGenerate(values) {
    const { cleanedTopic, combinedImageRefs } = resolveTopicAndImageRefs(values.topic)
    if (!(values.mode === 'Instant' && values.preset && values.preset.startsWith('template:'))) {
      if (!cleanedTopic && !combinedImageRefs.length) {
        return 'Isi Topik / Ide Konten atau tambahkan minimal 1 referensi gambar'
      }
    }
    return null
  }

  function createImageRefId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function isValidHttpUrl(raw) {
    try {
      const u = new URL(String(raw || '').trim())
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch (e) {
      return false
    }
  }

  function toPayloadImageReferences(sourceRefs = imageReferences) {
    return (sourceRefs || []).map((ref) => {
      if (ref.type === 'url') return { type: 'url', url: ref.url }
      return {
        type: 'data_url',
        dataUrl: ref.dataUrl,
        name: ref.name || null,
        sizeBytes: ref.sizeBytes || null
      }
    })
  }

  function extractUrlsFromText(raw) {
    const matches = String(raw || '').match(/https?:\/\/[^\s<>"']+/g) || []
    const cleaned = matches
      .map((u) => u.replace(/[),.;!?]+$/, '').trim())
      .filter(Boolean)
    return Array.from(new Set(cleaned))
  }

  function stripUrlsFromText(raw) {
    return String(raw || '')
      .replace(/https?:\/\/[^\s<>"']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function mergeUniqueImageReferences(baseRefs, incomingRefs) {
    const out = []
    const seen = new Set()
    const all = [...(baseRefs || []), ...(incomingRefs || [])]
    for (const ref of all) {
      if (!ref) continue
      if (ref.type === 'url') {
        const key = `url:${ref.url}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(ref)
        continue
      }
      if (ref.type === 'data_url') {
        const key = `data:${ref.dataUrl}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(ref)
      }
    }
    return out
  }

  function resolveTopicAndImageRefs(rawTopic) {
    const topicText = String(rawTopic || '')
    const cleanedTopic = stripUrlsFromText(topicText)
    const topicUrlRefs = extractUrlsFromText(topicText)
      .filter((url) => isValidHttpUrl(url))
      .map((url) => ({ type: 'url', url }))
    const stateRefs = toPayloadImageReferences()
    const tmdbRefs = (tmdbSelectedImageRefs || []).map((ref) => ({ type: 'url', url: ref.url }))
    const merged = mergeUniqueImageReferences(
      mergeUniqueImageReferences(stateRefs, topicUrlRefs),
      tmdbRefs
    ).slice(0, MAX_IMAGE_REFERENCES)
    return { cleanedTopic, combinedImageRefs: merged }
  }

  useEffect(() => {
    if (!hasImageRefsForCurrentInput) {
      lastVisionAutoKeyRef.current = ''
      return
    }
    if (!Array.isArray(models) || !models.length) return
    const visionModels = models.filter((x) => x?.supportsVision === true)
    if (!visionModels.length) return
    const current = models.find((x) => x.id === model)
    if (current?.supportsVision === true) return

    const autoKey = `${provider}:${visionModels[0].id}:${imageRefCountForInput}`
    if (lastVisionAutoKeyRef.current === autoKey) return
    lastVisionAutoKeyRef.current = autoKey
    setValue('model', visionModels[0].id, { shouldDirty: true })
  }, [hasImageRefsForCurrentInput, imageRefCountForInput, models, model, provider, setValue])

  function addImageUrlReferencesFromText(rawText) {
    const urls = extractUrlsFromText(rawText)
    if (!urls.length) {
      return 0
    }

    const remain = Math.max(MAX_IMAGE_REFERENCES - localAndTmdbImageCount, 0)
    if (!remain) {
      setError(`Maksimal ${MAX_IMAGE_REFERENCES} referensi gambar`)
      return 0
    }

    const existing = new Set([
      ...(imageReferences || []).filter((x) => x.type === 'url').map((x) => x.url),
      ...(tmdbSelectedImageRefs || []).map((x) => x.url)
    ])
    const toAdd = []
    let invalidCount = 0
    let duplicateCount = 0
    let overflowCount = 0
    for (const url of urls) {
      if (!isValidHttpUrl(url)) {
        invalidCount += 1
        continue
      }
      if (existing.has(url) || toAdd.some((x) => x.url === url)) {
        duplicateCount += 1
        continue
      }
      if (toAdd.length >= remain) {
        overflowCount += 1
        continue
      }
      toAdd.push({ id: createImageRefId(), type: 'url', url })
    }

    if (toAdd.length) {
      setImageReferences((prev) => [...prev, ...toAdd])
      setError(null)
    } else if (duplicateCount && !invalidCount) {
      setError('URL gambar sudah ada di daftar referensi')
    }

    if (!toAdd.length && invalidCount) {
      setError('URL referensi gambar tidak valid. Gunakan http:// atau https://')
    } else if (overflowCount) {
      setError(`Sebagian URL tidak ditambahkan karena batas maksimal ${MAX_IMAGE_REFERENCES} referensi`)
    }

    return toAdd.length
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function addImageFiles(files) {
    if (!files.length) return

    const remain = Math.max(MAX_IMAGE_REFERENCES - localAndTmdbImageCount, 0)
    if (!remain) {
      setError(`Maksimal ${MAX_IMAGE_REFERENCES} referensi gambar`)
      return
    }

    const selected = files.slice(0, remain)
    const next = []
    for (const file of selected) {
      if (!String(file.type || '').startsWith('image/')) {
        setError(`File "${file.name}" bukan image`)
        continue
      }
      if (file.size > MAX_UPLOAD_IMAGE_MB * 1024 * 1024) {
        setError(`File "${file.name}" melebihi ${MAX_UPLOAD_IMAGE_MB}MB`)
        continue
      }
      try {
        const dataUrl = await fileToDataUrl(file)
        next.push({
          id: createImageRefId(),
          type: 'data_url',
          dataUrl: String(dataUrl || ''),
          name: file.name,
          sizeBytes: file.size
        })
      } catch (e) {
        setError(`Gagal membaca file "${file.name}"`)
      }
    }

    if (next.length) {
      setImageReferences((prev) => [...prev, ...next])
      setError(null)
    }
    if (selected.length > next.length) {
      setError('Sebagian file tidak bisa ditambahkan. Pastikan file gambar dan ukuran sesuai.')
    }
  }

  async function handleImageUploadChange(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = null
    await addImageFiles(files)
  }

  async function handleTopicPaste(event) {
    const clipboardItems = Array.from(event.clipboardData?.items || [])
    const pastedFiles = clipboardItems
      .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean)

    if (pastedFiles.length) {
      event.preventDefault()
      await addImageFiles(pastedFiles)
      return
    }

    const pastedText = event.clipboardData?.getData('text') || ''
    const urls = extractUrlsFromText(pastedText)
    if (urls.length) {
      event.preventDefault()
      addImageUrlReferencesFromText(pastedText)
      const cleaned = stripUrlsFromText(pastedText)
      if (cleaned) {
        const current = String(watch('topic') || '')
        const next = current ? `${current}\n${cleaned}` : cleaned
        setValue('topic', next, { shouldDirty: true, shouldTouch: true })
      }
    }
  }

  async function handleTopicDrop(event) {
    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length) {
      event.preventDefault()
      await addImageFiles(files)
      return
    }

    const droppedText = event.dataTransfer?.getData('text') || ''
    if (extractUrlsFromText(droppedText).length) {
      event.preventDefault()
      addImageUrlReferencesFromText(droppedText)
      const cleaned = stripUrlsFromText(droppedText)
      if (cleaned) {
        const current = String(watch('topic') || '')
        const next = current ? `${current}\n${cleaned}` : cleaned
        setValue('topic', next, { shouldDirty: true, shouldTouch: true })
      }
    }
  }

  function triggerImageFilePicker() {
    if (localAndTmdbImageCount >= MAX_IMAGE_REFERENCES) return
    imageFileInputRef.current?.click()
  }

  function openTmdbFinder() {
    if (!useTmdb) return
    const { cleanedTopic } = resolveTopicAndImageRefs(getValues('topic'))
    const seedQuery = String(cleanedTopic || tmdbSelection?.query || '').trim()
    writeTmdbFinderPrefs({ enabled: true, query: seedQuery || '' })
    navigate('/tmdb-finder', { state: { seedQuery } })
  }

  function clearTmdbSelectionOnly() {
    clearTmdbGenerateSelection()
    setTmdbSelection(null)
  }

  function handleTmdbDetailAccordionSelect(eventKey) {
    setTmdbDetailAccordionOpen(eventKey === '0')
  }

  function removeImageReference(refItem) {
    const source = String(refItem?.__source || 'local').toLowerCase()
    if (source === 'tmdb') {
      const removeUrl = String(refItem?.url || '').trim()
      if (!removeUrl) return
      setTmdbSelection((prev) => {
        if (!prev || typeof prev !== 'object') return prev
        const selectedImages = (Array.isArray(prev.selectedImages) ? prev.selectedImages : [])
          .filter((item) => String(item?.url || '').trim() !== removeUrl)
        const next = { ...prev, selectedImages }
        writeTmdbGenerateSelection(next)
        return next
      })
      return
    }
    const removeId = String(refItem?.id || '').trim()
    if (!removeId) return
    setImageReferences((prev) => prev.filter((x) => String(x.id || '').trim() !== removeId))
  }

  function resetForm() {
    reset()
    setImageReferences([])
    setTmdbSelection(readTmdbGenerateSelection())
    setError(null)
  }

  function appendImageReferencesToPrompt(basePrompt, refs = toPayloadImageReferences()) {
    if (!refs.length) return basePrompt
    const lines = refs.map((ref, idx) => {
      if (ref.type === 'url') return `${idx + 1}. URL: ${ref.url}`
      const sizeKb = ref.sizeBytes ? Math.max(1, Math.round(ref.sizeBytes / 1024)) : null
      const sizeLabel = sizeKb ? `${sizeKb}KB` : 'unknown size'
      return `${idx + 1}. Upload: ${ref.name || `image-${idx + 1}`} (${sizeLabel})`
    })
    return `${basePrompt}\n\nReferensi visual:\n${lines.map((l) => `- ${l}`).join('\n')}`
  }

  function buildTmdbField(values, cleanedTopic = '') {
    const enabled = values?.useTmdb !== false
    if (!enabled) return { tmdb: { enabled: false } }

    const selected = tmdbSelection && Number.isInteger(Number(tmdbSelection?.tmdbId))
      ? tmdbSelection
      : null
    if (selected?.tmdbId) {
      const strictRequest = buildTmdbGenerateRequestFromSelection(selected)
      if (strictRequest?.tmdb?.tmdbId) return strictRequest
    }

    const fallbackQuery = String(cleanedTopic || '').trim()
    return {
      tmdb: {
        enabled: true,
        ...(fallbackQuery ? { query: fallbackQuery } : {})
      }
    }
  }

  function buildPayload(values) {
    const { cleanedTopic, combinedImageRefs } = resolveTopicAndImageRefs(values.topic)
    const manualTopic = cleanedTopic || (combinedImageRefs.length ? 'Konten berbasis referensi gambar' : '')
    const imageRefs = combinedImageRefs
    const imageRefField = imageRefs.length ? { imageReferences: imageRefs } : {}
    const tmdbField = buildTmdbField(values, cleanedTopic)

    if (values.mode === 'Instant' && values.preset && values.preset.startsWith('template:')) {
      const id = values.preset.replace('template:', '')
      const t = templatePresets.find((x) => x.id === id)
      if (!t) return { error: 'Preset template not found' }
      return {
        payload: {
          mode: 'preset',
          presetId: id,
          provider: values.provider,
          model: values.model,
          ...(cleanedTopic ? { extraInstruction: cleanedTopic } : {}),
          ...imageRefField,
          ...tmdbField
        },
        templatePreset: t
      }
    }

    if (values.mode === 'Instant' && values.preset && values.preset.startsWith('builtin:')) {
      const key = values.preset
      const p = PRESETS.find((x) => x.key === key)
      const manualConfig = normalizeManual({
        platform: values.platform,
        topic: manualTopic,
        tone: p?.tone || values.tone,
        length: p?.length || values.length,
        language: values.language
      })
      return {
        payload: { mode: 'manual', manualConfig, provider: values.provider, model: values.model, ...imageRefField, ...tmdbField },
        templatePreset: null
      }
    }

    const manualConfig = normalizeManual({ ...values, topic: manualTopic })
    return {
      payload: { mode: 'manual', manualConfig, provider: values.provider, model: values.model, ...imageRefField, ...tmdbField },
      templatePreset: null
    }
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

  function mapRequestError(err) {
    return humanizeApiError(err, {
      fallback: 'Generate gagal. Coba lagi atau ganti model/provider.'
    })
  }

  async function runGenerate(values, options = { variations: false }) {
    setLoading(true)
    setError(null)
    const preError = validateBeforeGenerate(values)
    if (preError) {
      setError(preError)
      setLoading(false)
      return
    }

    const { payload, templatePreset, error: buildError } = buildPayload(values)
    if (buildError) {
      setError(buildError)
      setLoading(false)
      return
    }

    const useVariations = !!options.variations && payload.mode === 'preset'
    const requestedVariations = useVariations
      ? Math.max(1, Math.min(Number(templatePreset?.constraints?.variationCount || 1), 10))
      : 1
    const requestOptions = { timeoutMs: 30000, retryAttempts: 1, retryDelayMs: 450 }

    try {
      const headers = await buildAuthHeaders()
      const requestConfig = Object.keys(headers).length ? { headers } : {}
      if (requestedVariations === 1) {
        const resp = await apiAxios({
          method: 'post',
          url: '/api/generate',
          data: payload,
          ...requestConfig
        }, requestOptions)
        if (!resp.data?.ok) {
          const apiError = resp.data?.error
          setError(apiError?.message || apiError || 'No data')
          return
        }
        const result = resp.data.data
        onResult(result)
        return
      }

      // Preflight one call first; avoid flooding same 4xx/5xx error for all variation requests.
      const first = await apiAxios({
        method: 'post',
        url: '/api/generate',
        data: payload,
        ...requestConfig
      }, requestOptions)
      if (!first.data?.ok) {
        const apiError = first.data?.error
        setError(apiError?.message || apiError || 'No data')
        return
      }

      const remainCount = requestedVariations - 1
      const remainCalls = remainCount > 0
        ? Array.from({ length: remainCount }, () => apiAxios({
          method: 'post',
          url: '/api/generate',
          data: payload,
          ...requestConfig
        }, requestOptions))
        : []
      const settledRemain = remainCalls.length ? await Promise.allSettled(remainCalls) : []

      const settled = [
        { status: 'fulfilled', value: first },
        ...settledRemain
      ]
      const results = settled
        .filter((r) => r.status === 'fulfilled' && r.value?.data?.ok)
        .map((r) => r.value.data.data)

      if (!results.length) {
        const firstRejected = settled.find((x) => x.status === 'rejected')
        if (firstRejected && firstRejected.status === 'rejected') {
          setError(mapRequestError(firstRejected.reason))
        } else {
          setError('Semua variation gagal di-generate')
        }
        return
      }

      const merged = {
        ...results[0],
        variations: results,
        variation_meta: {
          requested: requestedVariations,
          generated: results.length
        }
      }
      onResult(merged)

      if (results.length < requestedVariations) {
        setError(`Sebagian variation gagal. Berhasil: ${results.length}/${requestedVariations}`)
      }
    } catch (err) {
      setError(mapRequestError(err))
    } finally {
      setLoading(false)
    }
  }

  async function onSubmit(values) {
    return runGenerate(values, { variations: false })
  }

  async function onSubmitVariations(values) {
    return runGenerate(values, { variations: true })
  }

  useEffect(() => {
    if (!regenerateToken) return
    if (regenerateToken === lastRegenerateTokenRef.current) return
    if (loading) return
    lastRegenerateTokenRef.current = regenerateToken
    handleSubmit(onSubmit)()
  }, [regenerateToken, loading, handleSubmit])

  function handlePreview() {
    const { cleanedTopic, combinedImageRefs } = resolveTopicAndImageRefs(watch('topic'))
    const values = {
      platform: watch('platform'),
      topic: cleanedTopic || (combinedImageRefs.length ? 'Konten berbasis referensi gambar' : ''),
      length: watch('length'),
      language: watch('language'),
      tone: watch('tone'),
      keywords: watch('keywords') || [],
      cta: watch('cta') ? [{ type: 'primary', text: watch('cta') }] : []
    }
    const normalized = normalizeManual(values)
    const tpl = defaultTemplateForConfig(normalized)
    const rendered = compilePrompt(tpl, normalized)
    setPromptPreview(appendImageReferencesToPrompt(rendered, combinedImageRefs))
  }

  const selectedModelOption = (models || []).find((x) => x.id === model) || null
  const visionOn = hasImageRefsForCurrentInput && selectedModelOption?.supportsVision === true
  const tmdbTitle = String(tmdbSelection?.title || tmdbSelection?.query || '').trim()
  const tmdbTypeLabel = String(tmdbSelection?.entityType || tmdbSelection?.mediaType || '').trim().toUpperCase()
  const tmdbSelectedImagesCount = tmdbSelectedImageCount
  const tmdbSummaryText = tmdbSelection?.tmdbId
    ? `${tmdbTypeLabel || 'TMDB'} · ${tmdbTitle || '-'}${tmdbSelection?.year ? ` (${tmdbSelection.year})` : ''}`
    : 'Belum ada data TMDB yang dipilih'
  const tmdbCandidate = tmdbSelection?.candidate || null
  const tmdbSearchMeta = tmdbSelection?.searchMeta || null
  const tmdbMovieData = tmdbSelection?.movieOrTv || null
  const tmdbIsTv = String(tmdbSelection?.entityType || tmdbSelection?.mediaType || '').trim().toLowerCase() === 'tv'
  const tmdbScopeLabels = tmdbIsTv && tmdbSelection?.scopeLabels && typeof tmdbSelection.scopeLabels === 'object'
    ? tmdbSelection.scopeLabels
    : null
  const tmdbMakerLabel = tmdbIsTv ? 'Creator' : 'Director'
  const tmdbMakerValue = tmdbIsTv
    ? (
        tmdbMovieData?.creator
        || (Array.isArray(tmdbMovieData?.creator_list) ? tmdbMovieData.creator_list[0] : '')
        || tmdbMovieData?.director
        || '-'
      )
    : (
        tmdbMovieData?.director
        || (Array.isArray(tmdbMovieData?.director_list) ? tmdbMovieData.director_list[0] : '')
        || '-'
      )
  const tmdbScope = String(tmdbMovieData?.reference_scope || tmdbSelection?.referenceScope || '').trim().toLowerCase()
  const tmdbSeasonSelectionLabel = (() => {
    if (!tmdbIsTv) return ''
    const fromScopeLabels = String(tmdbScopeLabels?.season || '').trim()
    if (fromScopeLabels) return fromScopeLabels
    if (tmdbScope === 'series') return 'All Season'
    const seasonObj = tmdbSelection?.season || null
    const seasonNum = Number(seasonObj?.number || 0)
    if (Number.isInteger(seasonNum) && seasonNum > 0) {
      const seasonName = String(seasonObj?.name || '').trim()
      return seasonName ? `S${seasonNum} · ${seasonName}` : `S${seasonNum}`
    }
    return '-'
  })()
  const tmdbEpisodeSelectionLabel = (() => {
    if (!tmdbIsTv) return ''
    const fromScopeLabels = String(tmdbScopeLabels?.episode || '').trim()
    if (fromScopeLabels) return fromScopeLabels
    const seasonBase = tmdbSeasonSelectionLabel || '-'
    if (tmdbScope === 'season') return seasonBase !== '-' ? `${seasonBase} · All Episode` : 'All Episode'
    if (tmdbScope !== 'episode') return '-'
    const episodeObj = tmdbSelection?.episode || null
    const episodeNum = Number(episodeObj?.number || 0)
    if (Number.isInteger(episodeNum) && episodeNum > 0) {
      const episodeName = String(episodeObj?.name || '').trim()
      const episodeBase = episodeName ? `E${episodeNum} · ${episodeName}` : `E${episodeNum}`
      return seasonBase !== '-' ? `${seasonBase} · ${episodeBase}` : episodeBase
    }
    return '-'
  })()
  const tmdbCardPosterUrl = String(
    tmdbCandidate?.posterUrl
    || tmdbSelectedImageRefs?.[0]?.url
    || ''
  ).trim()
  const tmdbCandidateCount = Number.isFinite(Number(tmdbSearchMeta?.count))
    ? Number(tmdbSearchMeta.count)
    : (tmdbSelection?.tmdbId ? 1 : 0)
  const tmdbAccordionHeaderText = [
    `${(tmdbCandidate?.mediaType || tmdbSelection?.entityType || '-').toString().toUpperCase()} Detail Kandidat: ${tmdbCandidateCount}`,
    tmdbSearchMeta?.query ? ` ${tmdbSearchMeta.query} ${tmdbSelection?.year ? ` · ${tmdbSelection.year}` : ''}` : '',
    tmdbSearchMeta?.languageCode ? ` ${tmdbSearchMeta.languageCode}` : '',
    tmdbSearchMeta?.region ? `reg-${tmdbSearchMeta.region}` : ''
  ].filter(Boolean).join(' · ')

  return (
    
    <Form onSubmit={handleSubmit(onSubmit)} className="generate-form">
      {modelLoadAlert && <Alert variant="warning">{modelLoadAlert}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
       <Row className="mb-3">
        <Col md={4}>
          <Form.Label>Mode</Form.Label>
          <Form.Select {...register('mode')}>
            <option value="Standard">Standard</option>
            <option value="Instant">Instant</option>
          </Form.Select>
        </Col>
        {mode === 'Instant' && (
          <Col md={8}>
            <Form.Label>Preset (Instant)</Form.Label>

            <Dropdown show={presetOpen} onToggle={(isOpen) => setPresetOpen(isOpen)} className="w-100">
              <Dropdown.Toggle as={Button} variant="outline-secondary" className="w-100 text-start preset-toggle">
                {getPresetLabel(preset) || '-- choose preset --'}
              </Dropdown.Toggle>

              <Dropdown.Menu style={{ maxHeight: 320, width: '100%', padding: '.5rem' }}>
                <div className="mb-2">
                  <Form.Control size="sm" placeholder="🔍 Cari preset..." value={presetSearch} onChange={(e) => setPresetSearch(e.target.value)} />
                </div>
                <div className="d-flex gap-2 mb-2">
                  <Form.Select size="sm" value={presetFilterPlatform} onChange={(e) => setPresetFilterPlatform(e.target.value)}>
                    <option value="">(Semua)</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Form.Select>
                  <Form.Select size="sm" value={presetFilterType} onChange={(e) => setPresetFilterType(e.target.value)}>
                    <option value="all">(Semua)</option>
                    <option value="builtin">Built-in</option>
                    <option value="template">Template</option>
                  </Form.Select>
                  <Button size="sm" variant="outline-secondary" onClick={() => { setPresetSearch(''); setPresetFilterPlatform(''); setPresetFilterType('all'); }}>Reset</Button>
                </div>

                <div style={{ maxHeight: 220, overflow: 'auto' }}>
                  {/* Built-in items */}
                  {filterPresetItems().map(item => (
                    <Dropdown.Item key={item.value} onClick={() => { setValue('preset', item.value); setPresetOpen(false); }}>
                      {item.label}
                    </Dropdown.Item>
                  ))}
                </div>
              </Dropdown.Menu>
            </Dropdown>

            <Form.Control type="hidden" {...register('preset')} />
          </Col>
        )}
      </Row>
      <Form.Group className="mb-3">
        <Form.Label>{isTemplatePreset ? 'Instruksi Tambahan + Referensi Gambar (Opsional)' : 'Topik / Ide Konten + Referensi Gambar'}</Form.Label>
        <div
          className="ref-unified-input border rounded p-2"
          onDrop={handleTopicDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {combinedImagePreviewRefs.length > 0 && (
            <div className="image-ref-list mb-2">
              {combinedImagePreviewRefs.map((ref, idx) => (
                <div className="image-ref-item" key={ref.id}>
                  <img
                    src={ref.type === 'url' ? ref.url : ref.dataUrl}
                    alt={`reference-${idx + 1}`}
                    className="image-ref-thumb"
                  />
                  {ref.__source === 'tmdb' && (
                    <span className="image-ref-badge">TMDB</span>
                  )}
                  <button
                    type="button"
                    className="image-ref-remove"
                    onClick={() => removeImageReference(ref)}
                    aria-label={`Hapus referensi gambar ${idx + 1}`}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}

          <Form.Control
            as="textarea"
            rows={isTemplatePreset ? 2 : 3}
            className="border-0 shadow-none p-0"
            placeholder={isTemplatePreset
              ? `Tulis instruksi tambahan, paste URL gambar, paste image (Ctrl+V), atau drag & drop... Maks ${MAX_IMAGE_REFERENCES} gambar, ${MAX_UPLOAD_IMAGE_MB}MB/file.`
              : `Masukan topik / ide konten. Bisa langsung paste URL gambar, paste image (Ctrl+V), atau drag & drop... Maks ${MAX_IMAGE_REFERENCES} gambar, ${MAX_UPLOAD_IMAGE_MB}MB/file.`}
            {...register('topic')}
            onPaste={handleTopicPaste}
          />

          <div className="composer-action-row mt-2">
            <div className="composer-left-group">
              <Button
                type="button"
                size="sm"
                variant="light"
                className="upload-icon-btn"
                onClick={triggerImageFilePicker}
                disabled={localAndTmdbImageCount >= MAX_IMAGE_REFERENCES}
                title="Upload gambar"
                aria-label="Upload gambar"
              >
                <Icon icon="gridicons:add-outline" width="26" height="26" />
              </Button>
              <div className="composer-controls d-flex align-items-center gap-2">
                {!isTemplatePreset && (
                  <Form.Select
                    size="sm"
                    className="composer-select"
                    style={{ width: selectWidthCh(platform, { fixed: PLATFORM_WIDTH_CH, min: 7, max: 20, extra: 3 }) }}
                    {...register('platform')}
                  >
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Form.Select>
                )}
                <Form.Select
                  size="sm"
                  className="composer-select"
                  style={{ width: selectWidthCh(provider, { fixed: PROVIDER_WIDTH_CH, min: 7, max: 16, extra: 3 }) }}
                  {...register('provider')}
                >
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </Form.Select>
                <Form.Select
                  size="sm"
                  className="composer-select"
                  style={{ width: selectWidthCh(model, { min: 7, max: 20, extra: 3 }) }}
                  disabled={loadingModels && !models.length}
                  {...register('model')}
                >
                  {(models || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.isFeatured ? `* ${m.label}` : m.label}{m.supportsVision === true ? ' (Vision)' : ''}
                    </option>
                  ))}
                </Form.Select>
              </div>
            </div>
            <div className="composer-status-group">
              <span
                className={`composer-status-icon ${visionOn ? 'is-on' : 'is-off'}`}
                title={`Vision ${visionOn ? 'ON' : 'OFF'}`}
                aria-label={`Vision ${visionOn ? 'ON' : 'OFF'}`}
              >
                <Icon icon="picon:fox" width="18" height="18" />
              </span>
              <span
                className={`composer-status-icon ${effectiveFreeOnlyForModelFetch ? 'is-free' : 'is-paid'}`}
                title={`Pool: ${modelPoolLabel}`}
                aria-label={`Pool: ${modelPoolLabel}`}
              >
                <Icon
                  icon={effectiveFreeOnlyForModelFetch
                    ? 'streamline-sharp:tag-free-circle-remix'
                    : 'streamline-sharp:tag-free-circle-remix'}
                  width="18"
                  height="18"
                />
              </span>
            </div>
          </div>

          {!isTemplatePreset && (
            <Row className="mb-2 mt-2 triple-row">
              <Col md={2}>
                <Form.Label>Bahasa</Form.Label>
                <Form.Select
                  className="language-select-compact"
                  style={{ width: '9ch' }}
                  {...register('language')}
                >
                  {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Long Output</Form.Label>
                <Form.Select {...register('length')}>
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </Form.Select>
              </Col>
              {mode === 'Standard' && (
                <Col md={4}>
                  <Form.Label>Tone (Manual)</Form.Label>
                  <div>
                    <Dropdown show={toneOpen} onToggle={(isOpen) => setToneOpen(isOpen)} autoClose={false}>
                      <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm" className="w-100 text-start">
                        {tone || '-- pilih tone --'}
                      </Dropdown.Toggle>

                      <Dropdown.Menu style={{ maxHeight: 300, overflow: 'auto' }}>
                        {RECOMMENDED_TONES.map(t => (
                          <Dropdown.Item key={t} onClick={() => { setValue('tone', t); setToneOpen(false); }}>{t}</Dropdown.Item>
                        ))}

                        {!showMore && (
                          <Dropdown.Item onClick={() => setShowMore(true)}>More...</Dropdown.Item>
                        )}

                        {showMore && (
                          <>
                            <Dropdown.Divider />
                            {MORE_TONES.map(t => (
                              <Dropdown.Item key={t} onClick={() => { setValue('tone', t); setToneOpen(false); }}>{t}</Dropdown.Item>
                            ))}
                            <Dropdown.Divider />
                            <Dropdown.Item onClick={() => setShowMore(false)}>Less</Dropdown.Item>
                          </>
                        )}
                      </Dropdown.Menu>
                    </Dropdown>

                    <Form.Control type="hidden" {...register('tone')} />
                  </div>
                </Col>
              )}
              {isBuiltinPreset && (
                <Col md={4}>
                  <Form.Label>Tone Built-in (Preset)</Form.Label>
                  <Form.Control value={selectedBuiltin?.tone || 'Default'} readOnly />
                </Col>
              )}
            </Row>
          )}

          <div className="tmdb-bridge-row mt-2">
            <Form.Check
              type="switch"
              id="use-tmdb-generate"
              label="Use TMDB"
              className="tmdb-switch"
              {...register('useTmdb')}
            />
            <Button
              type="button"
              size="sm"
              variant="outline-primary"
              className="tmdb-finder-btn"
              disabled={!useTmdb}
              onClick={openTmdbFinder}
            >
              Buka TMDB Finder
            </Button>
            {useTmdb && tmdbSelection?.tmdbId && (
              <>
                <span className="tmdb-bridge-summary" title={tmdbSummaryText}>
                  {tmdbSummaryText}
                </span>
                <span className="tmdb-bridge-badge">{tmdbSelectedImagesCount} gambar</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline-danger"
                  className="tmdb-clear-btn"
                  onClick={clearTmdbSelectionOnly}
                >
                  Lepas
                </Button>
              </>
            )}
          </div>
          {useTmdb && !tmdbSelection?.tmdbId && (
            <small className="text-muted d-block mt-1 tmdb-bridge-empty">
              TMDB belum dipilih. Klik <strong>Buka TMDB Finder</strong> untuk cari Movie/TV + pilih detail dan gambar.
            </small>
          )}
          {useTmdb && tmdbSelection?.tmdbId && (
            <div className="tmdb-selected-ref-wrap mt-2">
              <div className="tmdb-selected-card">
                <div className="tmdb-candidate-thumb-wrap">
                  {tmdbCardPosterUrl
                    ? <img src={tmdbCardPosterUrl} alt={tmdbTitle || 'tmdb-selected'} className="tmdb-candidate-thumb" />
                    : <div className="tmdb-candidate-thumb tmdb-candidate-thumb-empty">No Poster</div>}
                </div>
                <div className="tmdb-candidate-meta">
                  <div className="tmdb-candidate-title">{tmdbTitle || '-'}</div>
                  <div className="tmdb-candidate-sub">
                    {(tmdbCandidate?.mediaType || tmdbSelection?.entityType || '-').toString().toUpperCase()}
                    {tmdbSelection?.year ? ` · ${tmdbSelection.year}` : ''}
                  </div>
                  <div className="tmdb-candidate-rating">
                    {Number.isFinite(Number(tmdbCandidate?.rating))
                      ? `⭐ ${Number(tmdbCandidate.rating).toFixed(1)}`
                      : '-'}
                  </div>
                </div>
                <div className="tmdb-candidate-overview">
                  {String(tmdbMovieData?.overview || '').trim() || '-'}
                </div>
              </div>

              {!!tmdbMovieData && (
                <Accordion
                  className="mt-2 tmdb-detail-accordion"
                  activeKey={tmdbDetailAccordionOpen ? '0' : null}
                  onSelect={handleTmdbDetailAccordionSelect}
                >
                  <Accordion.Item eventKey="0">
                    <Accordion.Header>{tmdbAccordionHeaderText || 'Kandidat TMDB'}</Accordion.Header>
                    <Accordion.Body>
                      <div className="tmdb-selected-detail-grid">
                        <small><strong className='st-dt'>Tagline:</strong> {tmdbMovieData?.tagline || '-'}</small>
                        <small><strong className='st-dt'>Release:</strong> {tmdbMovieData?.release_date || '-'}</small>
                        <small><strong className='st-dt'>Genres:</strong> {Array.isArray(tmdbMovieData?.genres) ? (tmdbMovieData.genres.join(', ') || '-') : '-'}</small>
                        <small><strong className='st-dt'>{tmdbMakerLabel}:</strong> {tmdbMakerValue}</small>
                        <small><strong className='st-dt'>Runtime:</strong> {tmdbMovieData?.runtime || '-'} menit</small>
                        <small><strong className='st-dt'>Status:</strong> {tmdbMovieData?.status || '-'}</small>
                        <small><strong className='st-dt'>Certification:</strong> {tmdbMovieData?.certification_id || '-'}</small>
                        <small><strong className='st-dt'>Vote Average:</strong> {Number.isFinite(Number(tmdbMovieData?.vote_average)) ? Number(tmdbMovieData.vote_average).toFixed(1) : '-'}</small>
                        {!tmdbIsTv && (
                          <small><strong className='st-dt'>Budget:</strong> {Number.isFinite(Number(tmdbMovieData?.budget)) && Number(tmdbMovieData?.budget) > 0 ? `$${new Intl.NumberFormat('en-US').format(Math.round(Number(tmdbMovieData.budget)))}` : '-'}</small>
                        )}
                        {!tmdbIsTv && (
                          <small><strong className='st-dt'>Revenue:</strong> {Number.isFinite(Number(tmdbMovieData?.revenue)) && Number(tmdbMovieData?.revenue) > 0 ? `$${new Intl.NumberFormat('en-US').format(Math.round(Number(tmdbMovieData.revenue)))}` : '-'}</small>
                        )}
                        <small><strong className='st-dt'>Original Language:</strong> {tmdbMovieData?.original_language || '-'}</small>
                        <small><strong className='st-dt'>Production Countries:</strong> {Array.isArray(tmdbMovieData?.production_countries) ? (tmdbMovieData.production_countries.slice(0, 4).join(', ') || '-') : '-'}</small>
                        <small><strong className='st-dt'>Production Companies:</strong> {Array.isArray(tmdbMovieData?.production_companies) ? (tmdbMovieData.production_companies.slice(0, 4).join(', ') || '-') : '-'}</small>
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Networks:</strong> {Array.isArray(tmdbMovieData?.networks) ? (tmdbMovieData.networks.slice(0, 4).join(', ') || '-') : '-'}</small>
                        )}
                        <small><strong className='st-dt'>Cast:</strong> {Array.isArray(tmdbMovieData?.cast_top) ? (tmdbMovieData.cast_top.slice(0, 4).join(', ') || '-') : '-'}</small>
                        <small><strong className='st-dt'>Keywords:</strong> {Array.isArray(tmdbMovieData?.keywords) ? (tmdbMovieData.keywords.slice(0, 8).join(', ') || '-') : '-'}</small>
                        <small><strong className='st-dt'>Watch:</strong> {Array.isArray(tmdbMovieData?.watch_providers_id) ? (tmdbMovieData.watch_providers_id.slice(0, 4).join(', ') || '-') : '-'}</small>
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Reference Scope:</strong> {tmdbMovieData?.reference_scope || tmdbSelection?.referenceScope || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Season:</strong> {tmdbSeasonSelectionLabel || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Episode:</strong> {tmdbEpisodeSelectionLabel || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Season Count:</strong> {tmdbMovieData?.season_count || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Episode Count:</strong> {tmdbMovieData?.episode_count || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Episode Type:</strong> {tmdbMovieData?.episode_type || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Season Overview:</strong> {tmdbMovieData?.season_overview || tmdbSelection?.season?.overview || '-'}</small>
                        )}
                        {tmdbIsTv && (
                          <small><strong className='st-dt'>Episode Overview:</strong> {tmdbMovieData?.episode_overview || tmdbSelection?.episode?.overview || '-'}</small>
                        )}
                        <small><strong className='st-dt'>Trailer:</strong> {tmdbMovieData?.trailer ? <a href={tmdbMovieData.trailer} target="_blank" rel="noreferrer">link</a> : '-'}</small>
                      </div>
                    </Accordion.Body>
                  </Accordion.Item>
                </Accordion>
              )}
            </div>
          )}

          <Form.Control
            ref={imageFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
            multiple
            onChange={handleImageUploadChange}
            style={{ display: 'none' }}
          />
        </div>
      </Form.Group>
      <div className="d-grid d-md-flex gap-2">
        <Button type="submit" disabled={loading} variant="primary" className="w-md-auto">{loading ? <Spinner animation="border" size="sm"/> : 'Generate'}</Button>
        {isTemplatePreset && templateVariationCount > 1 && (
          <Button
            type="button"
            disabled={loading}
            variant="outline-primary"
            className="w-md-auto"
            onClick={handleSubmit(onSubmitVariations)}
          >
            {loading ? <Spinner animation="border" size="sm"/> : `Generate Variations (${templateVariationCount})`}
          </Button>
        )}
        <Button type="button" variant="outline-secondary" onClick={resetForm} className="w-md-auto"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="none"/><path fill="none" stroke="currentColor" strokeWidth="2" d="M20 8c-1.403-2.96-4.463-5-8-5a9 9 0 1 0 0 18a9 9 0 0 0 9-9m0-9v6h-6"/></svg></Button>
        <Button type="button" variant="outline-primary" onClick={handlePreview} className="w-md-auto">Preview Prompt</Button>
      </div>
      {promptPreview && (
        <div className="mt-3">
          <h6>Preview Prompt</h6>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{promptPreview}</pre>
        </div>
      )}
    </Form>
  )
}
