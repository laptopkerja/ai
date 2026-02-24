import { isVisionCapableModel } from './aiProviders.js'

function safeString(value) {
  return String(value || '').trim()
}

function modelIdLower(id) {
  return safeString(id).toLowerCase()
}

function normalizeModelKey(id) {
  return modelIdLower(id).replace(/^mmeta-/, 'meta-')
}

const FEATURED_MODELS_BY_PROVIDER = {
  Gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  OpenAI: ['gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4o-mini-2024-07-18'],
  OpenRouter: [
    'meta-llama/llama-3-8b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'meta-llama/llama-3.1-8b-instruct'
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

const FEATURED_MODEL_SET_BY_PROVIDER = Object.fromEntries(
  Object.entries(FEATURED_MODELS_BY_PROVIDER).map(([provider, ids]) => [
    provider,
    new Set((ids || []).map((id) => normalizeModelKey(id)))
  ])
)

const FEATURED_MODEL_RANK_BY_PROVIDER = Object.fromEntries(
  Object.entries(FEATURED_MODELS_BY_PROVIDER).map(([provider, ids]) => {
    const rank = new Map()
    ;(ids || []).forEach((id, idx) => rank.set(normalizeModelKey(id), idx))
    return [provider, rank]
  })
)

function isFeaturedModel(provider, modelId) {
  const set = FEATURED_MODEL_SET_BY_PROVIDER[provider]
  if (!set) return false
  return set.has(normalizeModelKey(modelId))
}

function getFeaturedRank(provider, modelId) {
  const rankMap = FEATURED_MODEL_RANK_BY_PROVIDER[provider]
  if (!rankMap) return Number.MAX_SAFE_INTEGER
  const rank = rankMap.get(normalizeModelKey(modelId))
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER
}

function hasAny(text, patterns = []) {
  const input = safeString(text).toLowerCase()
  if (!input) return false
  return patterns.some((pattern) => input.includes(String(pattern).toLowerCase()))
}

function collectModalityTokens(raw) {
  const out = new Set()
  const pushTokenText = (value) => {
    const text = safeString(value).toLowerCase()
    if (!text) return
    text.split(/[^a-z0-9]+/g).forEach((token) => {
      if (token) out.add(token)
    })
  }
  const pushValue = (value) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      value.forEach(pushValue)
      return
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      pushTokenText(value)
      return
    }
    if (typeof value === 'object') {
      Object.values(value).forEach(pushValue)
    }
  }

  const candidates = [
    raw?.input_modalities,
    raw?.output_modalities,
    raw?.supported_input_modalities,
    raw?.supported_output_modalities,
    raw?.modalities,
    raw?.architecture?.input_modalities,
    raw?.architecture?.output_modalities,
    raw?.architecture?.modalities,
    raw?.architecture?.modality,
    raw?.architecture?.type
  ]
  candidates.forEach(pushValue)
  return out
}

export function inferVisionSupport(provider, modelId, raw = null) {
  const providerName = safeString(provider)
  const id = modelIdLower(modelId)
  if (!providerName || !id) return null

  if (providerName === 'OpenAI' || providerName === 'Gemini') {
    return isVisionCapableModel({ provider: providerName, model: modelId })
  }

  if (providerName === 'OpenRouter') {
    const modalityTokens = collectModalityTokens(raw)
    if (modalityTokens.has('image')) return true
    if (modalityTokens.size && !modalityTokens.has('image') && modalityTokens.has('text')) return false
    return isVisionCapableModel({ provider: providerName, model: modelId })
  }

  if (providerName === 'Groq') {
    if (hasAny(id, ['whisper', 'speech', 'audio', 'embed', 'embedding'])) return false
    if (hasAny(id, ['vision', 'llava', 'pixtral', 'qwen2-vl', 'llama-3.2-11b-vision', 'llama-3.2-90b-vision'])) return true
    return null
  }

  if (providerName === 'Cohere AI') {
    if (hasAny(id, ['embed', 'rerank', 'classif'])) return false
    if (hasAny(id, ['vision'])) return true
    return null
  }

  if (providerName === 'DeepSeek') {
    if (hasAny(id, ['deepseek-chat', 'deepseek-reasoner'])) return false
    if (hasAny(id, ['vision', 'vl'])) return true
    return null
  }

  if (providerName === 'Hugging Face') {
    const rawInputModalities = raw?.input_modalities
    if (Array.isArray(rawInputModalities)) {
      const lowerModalities = rawInputModalities.map((x) => safeString(x).toLowerCase())
      if (lowerModalities.includes('image')) return true
      if (lowerModalities.includes('text')) return false
    }
    if (hasAny(id, ['vision', 'vl', 'llava', 'pixtral', 'qwen2-vl', 'llama-3.2-11b-vision', 'llama-3.2-90b-vision'])) return true
    if (hasAny(id, ['embed', 'rerank', 'classif', 'whisper', 'audio'])) return false
    return null
  }

  return null
}

async function parseJsonResponse(response) {
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch (e) {
    data = null
  }
  return { text, data }
}

function toModelRow(provider, item) {
  const id = safeString(item.id)
  const explicitSupportsVision = typeof item.supportsVision === 'boolean' ? item.supportsVision : null
  const explicitFeatured = typeof item.isFeatured === 'boolean' ? item.isFeatured : null
  return {
    id,
    label: safeString(item.label || item.id),
    isFree: typeof item.isFree === 'boolean' ? item.isFree : null,
    contextWindow: Number.isFinite(Number(item.contextWindow)) ? Number(item.contextWindow) : null,
    isFeatured: explicitFeatured !== null ? explicitFeatured : isFeaturedModel(provider, id),
    supportsVision: explicitSupportsVision !== null
      ? explicitSupportsVision
      : inferVisionSupport(provider, id, item.raw || null)
  }
}

function dedupeModels(provider, models) {
  const out = []
  const seen = new Set()
  for (const raw of models || []) {
    const row = toModelRow(provider, raw)
    if (!row.id) continue
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

function shouldKeepByFree(models, freeOnly) {
  if (!freeOnly) return { models, freeFilterApplied: false }
  const hasFreeInfo = models.some((m) => typeof m.isFree === 'boolean')
  if (!hasFreeInfo) {
    return { models, freeFilterApplied: false }
  }
  const freeModels = models.filter((m) => m.isFree === true)
  if (!freeModels.length) {
    return { models, freeFilterApplied: true }
  }
  return { models: freeModels, freeFilterApplied: true }
}

function prioritizeFeaturedModels(provider, models = []) {
  return (models || [])
    .map((model, idx) => ({ ...model, __idx: idx }))
    .sort((a, b) => {
      if (!!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1
      if (a.isFeatured && b.isFeatured) {
        return getFeaturedRank(provider, a.id) - getFeaturedRank(provider, b.id)
      }
      return a.__idx - b.__idx
    })
    .map(({ __idx, ...model }) => model)
}

async function callOpenAiCompatibleModelList({ baseUrl, apiKey }) {
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  const { data, text } = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(data?.error?.message || text || `Provider model list error ${response.status}`)
  }
  const rows = Array.isArray(data?.data) ? data.data : []
  return rows.map((x) => ({ id: safeString(x?.id), label: safeString(x?.id), raw: x }))
}

async function callOpenRouterModelList({ apiKey }) {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  const { data, text } = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(data?.error?.message || text || `OpenRouter model list error ${response.status}`)
  }
  const rows = Array.isArray(data?.data) ? data.data : []
  return rows.map((x) => {
    const promptCost = Number(x?.pricing?.prompt)
    const completionCost = Number(x?.pricing?.completion)
    const isFree = Number.isFinite(promptCost) && Number.isFinite(completionCost)
      ? promptCost === 0 && completionCost === 0
      : null
    return {
      id: safeString(x?.id),
      label: safeString(x?.name || x?.id),
      isFree,
      contextWindow: Number(x?.context_length || x?.top_provider?.context_length || 0),
      raw: x
    }
  })
}

async function callGeminiModelList({ apiKey }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  const { data, text } = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(data?.error?.message || text || `Gemini model list error ${response.status}`)
  }
  const rows = Array.isArray(data?.models) ? data.models : []
  return rows
    .filter((x) => Array.isArray(x?.supportedGenerationMethods) && x.supportedGenerationMethods.includes('generateContent'))
    .map((x) => {
      const rawName = safeString(x?.name)
      const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName
      return {
        id,
        label: safeString(x?.displayName || id),
        contextWindow: Number(x?.inputTokenLimit || 0),
        raw: x
      }
    })
}

async function callCohereModelList({ apiKey }) {
  const response = await fetch('https://api.cohere.com/v1/models?endpoint=chat', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  const { data, text } = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(data?.message || text || `Cohere model list error ${response.status}`)
  }
  const rows = Array.isArray(data?.models) ? data.models : []
  return rows.map((x) => {
    const id = safeString(x?.name || x?.id)
    return {
      id,
      label: safeString(x?.name || x?.id),
      raw: x
    }
  })
}

async function callHfRouterModelList({ apiKey }) {
  const response = await fetch('https://router.huggingface.co/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  const { data, text } = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(data?.error?.message || text || `Hugging Face model list error ${response.status}`)
  }
  const rows = Array.isArray(data?.data) ? data.data : []
  return rows.map((x) => ({
    id: safeString(x?.id),
    label: safeString(x?.id),
    raw: x
  }))
}

export async function detectProviderModels({ provider, apiKey, freeOnly = false }) {
  const name = safeString(provider)
  const key = safeString(apiKey)
  if (!name) throw new Error('provider is required')
  if (!key) throw new Error('apiKey is required')

  let raw = []
  let source = 'unknown'
  if (name === 'OpenAI') {
    raw = await callOpenAiCompatibleModelList({ baseUrl: 'https://api.openai.com/v1', apiKey: key })
    source = 'openai-models'
  } else if (name === 'OpenRouter') {
    raw = await callOpenRouterModelList({ apiKey: key })
    source = 'openrouter-models'
  } else if (name === 'Groq') {
    raw = await callOpenAiCompatibleModelList({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: key })
    source = 'groq-models'
  } else if (name === 'DeepSeek') {
    raw = await callOpenAiCompatibleModelList({ baseUrl: 'https://api.deepseek.com', apiKey: key })
    source = 'deepseek-models'
  } else if (name === 'Gemini') {
    raw = await callGeminiModelList({ apiKey: key })
    source = 'gemini-models'
  } else if (name === 'Cohere AI') {
    raw = await callCohereModelList({ apiKey: key })
    source = 'cohere-models'
  } else if (name === 'Hugging Face') {
    raw = await callHfRouterModelList({ apiKey: key })
    source = 'huggingface-models'
  } else {
    throw new Error(`provider "${name}" is not supported`)
  }

  const deduped = dedupeModels(name, raw)
  const filtered = shouldKeepByFree(deduped, freeOnly)
  const prioritized = prioritizeFeaturedModels(name, filtered.models)
  return {
    provider: name,
    source,
    count: prioritized.length,
    freeFilterApplied: filtered.freeFilterApplied,
    models: prioritized
  }
}
