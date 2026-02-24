const DEFAULT_MODEL_BY_PROVIDER = {
  Gemini: 'gemini-1.5-flash',
  OpenAI: 'gpt-4o-mini',
  OpenRouter: 'openai/gpt-4o-mini',
  Groq: 'llama-3.1-8b-instant',
  'Cohere AI': 'command-r',
  DeepSeek: 'deepseek-chat',
  'Hugging Face': 'meta-llama/Llama-3.1-8B-Instruct'
}

const RESPONSE_TEMPERATURE = 0.35
const PROVIDER_REQUEST_TIMEOUT_MS = Math.max(8000, Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 28000))
const PROVIDER_REQUEST_RETRY_COUNT = Math.max(0, Math.min(3, Number(process.env.PROVIDER_REQUEST_RETRY_COUNT || 1)))
const PROVIDER_REQUEST_RETRY_BACKOFF_MS = Math.max(120, Number(process.env.PROVIDER_REQUEST_RETRY_BACKOFF_MS || 650))
const PROVIDER_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

function readEnvNumberWithBounds(raw, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function providerEnvSlug(provider) {
  return String(provider || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveProviderRequestConfig(provider) {
  const slug = providerEnvSlug(provider)
  const prefix = slug ? `PROVIDER_${slug}_` : ''
  const timeout = readEnvNumberWithBounds(
    process.env[`${prefix}TIMEOUT_MS`],
    PROVIDER_REQUEST_TIMEOUT_MS,
    { min: 8000, max: 120000 }
  )
  const retryCount = readEnvNumberWithBounds(
    process.env[`${prefix}RETRY_COUNT`],
    PROVIDER_REQUEST_RETRY_COUNT,
    { min: 0, max: 3 }
  )
  const retryBackoffMs = readEnvNumberWithBounds(
    process.env[`${prefix}RETRY_BACKOFF_MS`],
    PROVIDER_REQUEST_RETRY_BACKOFF_MS,
    { min: 120, max: 5000 }
  )

  return {
    timeoutMs: timeout,
    retryCount,
    retryBackoffMs
  }
}

const DEFAULT_PLATFORM_OUTPUT_HINT = {
  hookMin: 18,
  hookMax: 180,
  descriptionMinSentences: 1,
  descriptionMaxSentences: 3,
  descriptionMaxChars: 260,
  hashtagMin: 3,
  hashtagMax: 8,
  requireCtaInDescription: false,
  ctaStyle: 'soft'
}

const PLATFORM_OUTPUT_HINTS = {
  TikTok: { hookMax: 130, hashtagMin: 4, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'comment/share/save' },
  'Instagram Reels': { hookMax: 140, hashtagMin: 4, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'comment/share' },
  'YouTube Short': { hookMax: 140, hashtagMin: 3, hashtagMax: 7, requireCtaInDescription: true, ctaStyle: 'comment/follow' },
  Threads: { hookMax: 170, descriptionMaxSentences: 4, descriptionMaxChars: 320, hashtagMin: 0, hashtagMax: 3, requireCtaInDescription: true, ctaStyle: 'reply/debate' },
  'YouTube Long': { hookMax: 180, descriptionMaxSentences: 4, descriptionMaxChars: 360, hashtagMin: 2, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'watch/comment' },
  'Facebook Reels': { hookMax: 150, hashtagMin: 3, hashtagMax: 7, requireCtaInDescription: true, ctaStyle: 'comment/share' },
  'WhatsApp Status': { hookMax: 120, descriptionMaxSentences: 2, descriptionMaxChars: 180, hashtagMin: 0, hashtagMax: 2, requireCtaInDescription: false, ctaStyle: 'reply' },
  'WhatsApp Channel': { hookMax: 120, descriptionMaxSentences: 2, descriptionMaxChars: 170, hashtagMin: 0, hashtagMax: 1, requireCtaInDescription: true, ctaStyle: 'react/forward' },
  Telegram: { hookMax: 135, descriptionMaxSentences: 3, descriptionMaxChars: 240, hashtagMin: 0, hashtagMax: 3, requireCtaInDescription: true, ctaStyle: 'reply/vote' },
  LinkedIn: { hookMax: 170, descriptionMaxSentences: 4, descriptionMaxChars: 340, hashtagMin: 1, hashtagMax: 5, requireCtaInDescription: true, ctaStyle: 'comment/follow' },
  'X (Twitter)': { hookMax: 120, descriptionMaxSentences: 2, descriptionMaxChars: 240, hashtagMin: 0, hashtagMax: 3, requireCtaInDescription: true, ctaStyle: 'reply/repost' },
  SoundCloud: { hookMax: 130, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 2, hashtagMax: 6, requireCtaInDescription: true, ctaStyle: 'listen/follow' },
  'Blog Blogger': { hookMax: 180, descriptionMaxSentences: 4, descriptionMaxChars: 420, hashtagMin: 0, hashtagMax: 4, requireCtaInDescription: true, ctaStyle: 'read/comment' },
  Shopee: { hookMax: 130, hashtagMin: 3, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'checkout/comment' },
  Tokopedia: { hookMax: 130, hashtagMin: 3, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'checkout/comment' },
  Lazada: { hookMax: 130, hashtagMin: 3, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'checkout/comment' },
  Pinterest: { hookMax: 150, hashtagMin: 2, hashtagMax: 6, requireCtaInDescription: false, ctaStyle: 'save pin' }
}

const BLOGGER_SEO_WORD_CONTRACT = {
  minWords: 900,
  targetMinWords: 1300,
  targetMaxWords: 1700,
  maxWords: 2200,
  metaDescriptionMinChars: 140,
  metaDescriptionMaxChars: 160,
  faqMinItems: 3
}

function safeString(value) {
  return String(value || '').trim()
}

function isBloggerPlatform(platform) {
  return safeString(platform).toLowerCase() === 'blog blogger'
}

function slugifyText(raw) {
  const source = safeString(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return source.slice(0, 96)
}

function normalizeBloggerSlug(value, fallbackText = '') {
  const slug = slugifyText(value) || slugifyText(fallbackText) || 'artikel-blogger'
  const parts = slug.split('-').filter(Boolean).slice(0, 12)
  if (!parts.length) return 'artikel-blogger'
  return parts.join('-')
}

function normalizeBloggerLinks(input, fallback = [], options = {}) {
  const external = !!options.external
  const minCount = Number.isFinite(Number(options.minCount)) ? Number(options.minCount) : 0
  const maxCount = Number.isFinite(Number(options.maxCount)) ? Number(options.maxCount) : 5

  let raw = []
  if (Array.isArray(input)) raw = input
  else if (typeof input === 'string') raw = input.split(/[,\n]/g)

  const normalized = []
  const seen = new Set()
  const pushLink = (value) => {
    const text = safeString(value)
    if (!text) return
    if (external) {
      if (!/^https?:\/\//i.test(text)) return
    } else if (!text.startsWith('/')) {
      return
    }
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    normalized.push(text)
  }

  raw.forEach(pushLink)
  if (Array.isArray(fallback)) fallback.forEach(pushLink)

  const out = normalized.slice(0, Math.max(minCount, maxCount))
  return out
}

function normalizeHashtags(input, fallback = []) {
  let raw = []
  if (Array.isArray(input)) {
    raw = input
  } else if (typeof input === 'string') {
    raw = input.split(/[,\n]/g)
  }

  const normalized = raw
    .map((x) => safeString(x))
    .filter(Boolean)
    .map((x) => (x.startsWith('#') ? x : `#${x}`))
    .map((x) => x.replace(/\s+/g, ''))
    .filter((x) => /^#[\w.-]{2,40}$/.test(x))
    .filter((x, idx, arr) => arr.indexOf(x) === idx)
    .slice(0, 18)

  if (normalized.length) return normalized
  return fallback
}

function uniqueStrings(values = []) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = String(value || '')
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function delay(ms) {
  const wait = Math.max(0, Number(ms || 0))
  if (!wait) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, wait))
}

function createProviderError(code, message, details = {}) {
  const err = new Error(safeString(message) || 'Provider request failed')
  err.code = safeString(code) || 'PROVIDER_API_ERROR'
  err.classification = safeString(details.classification) || null
  err.retryable = details.retryable === true
  err.details = details
  return err
}

function isRetryableProviderError(err) {
  if (!err) return false
  if (err.retryable === true) return true
  const code = safeString(err.code)
  return [
    'PROVIDER_TIMEOUT',
    'PROVIDER_NETWORK_ERROR',
    'PROVIDER_RATE_LIMIT',
    'PROVIDER_UPSTREAM_ERROR'
  ].includes(code)
}

function stripJsonCodeFences(text) {
  const raw = String(text || '')
  const matches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  if (!matches.length) return []
  return matches
    .map((match) => safeString(match?.[1]))
    .filter(Boolean)
}

function removeJsonComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function stripTrailingCommas(text) {
  return String(text || '').replace(/,\s*([}\]])/g, '$1')
}

function quoteUnquotedJsonKeys(text) {
  return String(text || '').replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
}

function normalizeSmartQuotes(text) {
  return String(text || '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}

function normalizeSingleQuotedJson(text) {
  return String(text || '')
    .replace(/([{,]\s*)'([^'\\]+?)'\s*:/g, '$1"$2":')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value) => {
      const escaped = String(value || '').replace(/"/g, '\\"')
      return `"${escaped}"`
    })
}

function extractBalancedJsonObjects(text) {
  const raw = String(text || '')
  const objects = []
  let depth = 0
  let start = -1
  let inString = false
  let quoteChar = ''
  let escaped = false

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quoteChar) {
        inString = false
        quoteChar = ''
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      quoteChar = ch
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }

    if (ch === '}') {
      if (depth <= 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, i + 1))
        start = -1
      }
    }
  }

  return uniqueStrings(objects.map((x) => safeString(x)).filter(Boolean))
}

function extractLabeledSectionsAsObject(text) {
  const lines = String(text || '').split(/\r?\n/)
  const alias = {
    title: 'title',
    hook: 'hook',
    narrator: 'narrator',
    description: 'description',
    deskripsi: 'description',
    hashtags: 'hashtags',
    hashtag: 'hashtags',
    labels: 'hashtags',
    'audio recommendation': 'audioRecommendation',
    audiorecommendation: 'audioRecommendation',
    audio: 'audioRecommendation',
    'audio rekomendasi': 'audioRecommendation',
    slug: 'slug',
    'internal links': 'internalLinks',
    internallinks: 'internalLinks',
    'external references': 'externalReferences',
    externalreferences: 'externalReferences',
    'featured snippet': 'featuredSnippet',
    featuredsnippet: 'featuredSnippet'
  }

  const sections = {}
  let currentKey = null

  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9\s/_()-]{1,45})\s*:\s*(.*)$/)
    if (keyMatch) {
      const rawKey = safeString(keyMatch[1]).toLowerCase()
      const resolved = alias[rawKey] || null
      if (resolved) {
        currentKey = resolved
        sections[currentKey] = sections[currentKey] || []
        if (safeString(keyMatch[2])) sections[currentKey].push(safeString(keyMatch[2]))
        continue
      }
    }

    if (currentKey) {
      const currentValue = safeString(line)
      if (currentValue) sections[currentKey].push(currentValue)
    }
  }

  if (!Object.keys(sections).length) return null
  const output = {}
  for (const [key, values] of Object.entries(sections)) {
    const joined = values.join('\n').trim()
    if (!joined) continue
    if (key === 'hashtags') {
      output.hashtags = joined
        .split(/[\s,]+/g)
        .map((token) => safeString(token))
        .filter((token) => token.startsWith('#'))
      continue
    }
    if (key === 'internalLinks' || key === 'externalReferences') {
      output[key] = joined
        .split(/[\n,]/g)
        .map((token) => safeString(token))
        .filter(Boolean)
      continue
    }
    output[key] = joined
  }

  if (!output.title && !output.hook && !output.narrator && !output.description) return null
  return output
}

function tryParseJsonCandidate(candidate) {
  const raw = safeString(candidate)
  if (!raw) return null
  const variants = uniqueStrings([
    raw,
    removeJsonComments(raw),
    stripTrailingCommas(removeJsonComments(raw)),
    quoteUnquotedJsonKeys(stripTrailingCommas(removeJsonComments(raw))),
    normalizeSingleQuotedJson(quoteUnquotedJsonKeys(stripTrailingCommas(removeJsonComments(raw)))),
    stripTrailingCommas(normalizeSingleQuotedJson(quoteUnquotedJsonKeys(removeJsonComments(raw)))),
    stripTrailingCommas(normalizeSmartQuotes(normalizeSingleQuotedJson(quoteUnquotedJsonKeys(removeJsonComments(raw)))))
  ])

  for (const value of variants) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch (e) {}
  }
  return null
}

export function parseProviderOutputJson(text) {
  const raw = safeString(text)
  if (!raw) return null

  const topLevelSlice = (() => {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) return raw.slice(start, end + 1)
    return ''
  })()

  const candidates = uniqueStrings([
    raw,
    ...stripJsonCodeFences(raw),
    ...extractBalancedJsonObjects(raw),
    topLevelSlice
  ].filter(Boolean).map((x) => normalizeSmartQuotes(x)))

  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate)
    if (parsed) return parsed
  }

  return extractLabeledSectionsAsObject(raw)
}

function extractFirstJsonObject(text) {
  return parseProviderOutputJson(text)
}

function normalizeProviderTransportError(err, context = {}) {
  if (err?.code && String(err.code).startsWith('PROVIDER_')) return err
  const message = safeString(err?.message) || 'Provider request failed'
  const timeoutLike = err?.name === 'AbortError' || /timeout|timed out|ecconnaborted|etimedout/i.test(message)
  if (timeoutLike) {
    return createProviderError(
      'PROVIDER_TIMEOUT',
      `Provider timeout after ${context.timeoutMs || PROVIDER_REQUEST_TIMEOUT_MS}ms`,
      {
        classification: 'timeout',
        retryable: true,
        provider: context.provider || null,
        model: context.model || null,
        stage: context.stage || 'generate',
        timeoutMs: context.timeoutMs || PROVIDER_REQUEST_TIMEOUT_MS
      }
    )
  }

  if (/enotfound|econnreset|econnrefused|ehostunreach|network|fetch failed|socket hang up/i.test(message)) {
    return createProviderError('PROVIDER_NETWORK_ERROR', message, {
      classification: 'network',
      retryable: true,
      provider: context.provider || null,
      model: context.model || null,
      stage: context.stage || 'generate'
    })
  }

  return createProviderError('PROVIDER_API_ERROR', message, {
    classification: 'provider',
    retryable: false,
    provider: context.provider || null,
    model: context.model || null,
    stage: context.stage || 'generate'
  })
}

function extractProviderErrorMessage(data, text, fallbackStatus = 0) {
  const options = [
    data?.error?.message,
    data?.message,
    data?.error_description,
    data?.detail,
    text
  ]
  for (const option of options) {
    const msg = safeString(option)
    if (msg) return msg.slice(0, 420)
  }
  return fallbackStatus ? `Provider HTTP ${fallbackStatus}` : 'Provider request failed'
}

function classifyProviderHttpError({ provider, model, stage, status, data, text }) {
  const statusCode = Number(status || 0)
  const message = extractProviderErrorMessage(data, text, statusCode)
  const details = {
    provider: provider || null,
    model: model || null,
    stage: stage || 'generate',
    status: statusCode
  }

  if (statusCode === 401 || statusCode === 403) {
    return createProviderError('PROVIDER_AUTH_ERROR', message, {
      ...details,
      classification: 'auth',
      retryable: false
    })
  }

  if (statusCode === 404) {
    return createProviderError('PROVIDER_MODEL_NOT_FOUND', message, {
      ...details,
      classification: 'model',
      retryable: false
    })
  }

  if (statusCode === 429) {
    return createProviderError('PROVIDER_RATE_LIMIT', message, {
      ...details,
      classification: 'rate_limit',
      retryable: true
    })
  }

  if (PROVIDER_RETRYABLE_STATUS.has(statusCode) || statusCode >= 500) {
    return createProviderError('PROVIDER_UPSTREAM_ERROR', message, {
      ...details,
      classification: statusCode === 408 || statusCode === 504 ? 'timeout' : 'upstream',
      retryable: true
    })
  }

  return createProviderError('PROVIDER_BAD_REQUEST', message, {
    ...details,
    classification: 'bad_request',
    retryable: false
  })
}

async function fetchWithTimeout(url, init = {}, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || PROVIDER_REQUEST_TIMEOUT_MS)))
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function requestProviderJson({
  provider,
  model,
  stage = 'generate',
  url,
  init,
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
  retryCount = PROVIDER_REQUEST_RETRY_COUNT,
  retryBackoffMs = PROVIDER_REQUEST_RETRY_BACKOFF_MS
}) {
  const maxAttempts = Math.max(1, Number(retryCount || 0) + 1)
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs)
      const { data, text } = await parseJsonResponse(response)
      if (response.ok) return { response, data, text, attempt }

      const httpError = classifyProviderHttpError({
        provider,
        model,
        stage,
        status: response.status,
        data,
        text
      })
      lastError = httpError
      if (!isRetryableProviderError(httpError) || attempt >= maxAttempts) throw httpError
    } catch (rawError) {
      const providerError = normalizeProviderTransportError(rawError, {
        provider,
        model,
        stage,
        timeoutMs
      })
      lastError = providerError
      if (!isRetryableProviderError(providerError) || attempt >= maxAttempts) throw providerError
    }

    const sleepMs = Number(retryBackoffMs || PROVIDER_REQUEST_RETRY_BACKOFF_MS) * attempt
    await delay(sleepMs)
  }

  throw lastError || createProviderError('PROVIDER_API_ERROR', 'Provider request failed', {
    provider,
    model,
    stage,
    classification: 'provider',
    retryable: false
  })
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

function normalizeProviderOutput(parsed, fallback, platform) {
  const out = parsed && typeof parsed === 'object' ? parsed : {}
  const isBlogger = isBloggerPlatform(platform)
  const narratorValue = safeString(out.narrator) || safeString(out.articleBody) || safeString(out.body) || safeString(out.content)
  const descriptionValue = safeString(out.description) || safeString(out.metaDescription) || safeString(out.summary)
  const hashtagValue = Array.isArray(out.hashtags) || typeof out.hashtags === 'string' ? out.hashtags : out.labels
  const audioValue = safeString(out.audioRecommendation) || safeString(out.audio) || safeString(out.audioNotes)
  const slugValue = normalizeBloggerSlug(
    out.slug || out.seoSlug || out.permalink,
    out.title || fallback.title || fallback.topic
  )
  const internalLinksValue = normalizeBloggerLinks(
    out.internalLinks || out.internal_links || out.internalLinkSuggestions,
    fallback.internalLinks || [],
    { external: false, minCount: 2, maxCount: 5 }
  )
  const externalReferencesValue = normalizeBloggerLinks(
    out.externalReferences || out.external_references || out.references || out.sources,
    fallback.externalReferences || [],
    { external: true, minCount: 1, maxCount: 3 }
  )
  const featuredSnippetValue = safeString(
    out.featuredSnippet || out.featured_snippet || out.snippetTarget || out.snippet
  )
  return {
    title: safeString(out.title) || fallback.title,
    hook: safeString(out.hook) || safeString(out.openingHook) || fallback.hook,
    narrator: narratorValue || fallback.narrator,
    description: descriptionValue || fallback.description,
    hashtags: normalizeHashtags(hashtagValue, fallback.hashtags),
    audioRecommendation: isBlogger ? '' : (audioValue || fallback.audioRecommendation),
    ...(isBlogger
      ? {
          slug: slugValue,
          internalLinks: internalLinksValue,
          externalReferences: externalReferencesValue,
          featuredSnippet: featuredSnippetValue || safeString(out.hook) || safeString(fallback.hook)
        }
      : {})
  }
}

function resolvePlatformOutputHint(platform) {
  const normalized = safeString(platform)
  const merged = {
    ...DEFAULT_PLATFORM_OUTPUT_HINT,
    ...(PLATFORM_OUTPUT_HINTS[normalized] || {})
  }
  const min = Math.max(0, Math.min(12, Number(merged.hashtagMin)))
  const max = Math.max(min, Math.min(12, Number(merged.hashtagMax)))
  return {
    ...merged,
    platform: normalized || 'Unknown',
    hashtagMin: min,
    hashtagMax: max
  }
}

function buildBloggerSystemPrompt(language, platform) {
  const lang = safeString(language) || 'Indonesia'
  const seo = BLOGGER_SEO_WORD_CONTRACT
  return [
    `You are an expert SEO content strategist writing in ${lang}.`,
    'Platform output contract: Blog Blogger (article-first).',
    'Return ONLY valid JSON (no markdown fences) with this exact shape:',
    '{"title":"...","hook":"...","narrator":"...","description":"...","hashtags":["#label1","#label2"],"audioRecommendation":"","slug":"...","internalLinks":["/p/slug-1.html"],"externalReferences":["https://example.com/ref"],"featuredSnippet":"..."}',
    'Field meaning for Blogger:',
    '- title: SEO article title, clear and specific (50-70 chars recommended).',
    '- hook: opening hook/lead (18-180 chars).',
    '- narrator: FULL article body in plain text/markdown style with headings.',
    '- description: meta description, concise and SEO-friendly.',
    '- hashtags: 0-4 label tags for Blogger categories (no spam/scam).',
    '- audioRecommendation: MUST be empty string ("").',
    '- slug: URL-friendly kebab-case (3-12 words).',
    '- internalLinks: 2-5 relative links that start with "/", relevant to this topic.',
    '- externalReferences: 1-3 trusted HTTPS references (docs, standards, official guides).',
    '- featuredSnippet: one concise Q/A-style answer target (max 320 chars).',
    'Mandatory Blogger SEO rules:',
    `- narrator word count MUST be between ${seo.minWords}-${seo.maxWords}; target ${seo.targetMinWords}-${seo.targetMaxWords}.`,
    '- narrator must include clear structure: intro, 4-6 subheadings (H2/H3 style allowed), practical steps, and closing CTA.',
    `- narrator must include FAQ section with at least ${seo.faqMinItems} Q&A items.`,
    '- narrator must naturally include the primary topic keyword in intro and at least one subheading.',
    `- description length MUST be ${seo.metaDescriptionMinChars}-${seo.metaDescriptionMaxChars} chars and include the main keyword naturally.`,
    '- avoid forbidden wording: 100%, pasti untung, garansi hasil, cepat kaya, auto viral, bocoran rahasia.'
  ].join('\n')
}

function buildSystemPrompt(language, platform) {
  if (isBloggerPlatform(platform)) {
    return buildBloggerSystemPrompt(language, platform)
  }
  const lang = safeString(language) || 'Indonesia'
  const hint = resolvePlatformOutputHint(platform)
  const hashtagRule = hint.hashtagMax === 0
    ? '- hashtags MUST be [] for this platform'
    : `- hashtags ${hint.hashtagMin}-${hint.hashtagMax} unique items, each starts with #, no banned/scam terms`

  return [
    `You are an expert short-form content strategist writing in ${lang}.`,
    `Platform output contract: ${hint.platform}`,
    'Return ONLY valid JSON (no markdown, no code fences) with this exact shape:',
    '{"title":"...","hook":"...","narrator":"...","description":"...","hashtags":["#tag1","#tag2"],"audioRecommendation":"..."}',
    'Mandatory rules:',
    '- title max 120 chars, specific, no clickbait promises',
    `- hook ${hint.hookMin}-${hint.hookMax} chars, clear and direct`,
    '- narrator MUST use scene format, one scene per line:',
    '  Scene 1 (0-3s): ...',
    '  Scene 2 (3-8s): ...',
    '  Scene N ...',
    '- scene count must follow content length: short=3, medium=5, long=7',
    '- narrator must be final ready-to-speak voice-over text, NOT instructions or placeholders.',
    '- forbidden narrator meta phrases: "Buka dengan hook", "Open with hook", "Sebut pain point", "State pain point", "Tutup dengan CTA".',
    '- narrator must avoid scam/spam wording and absolute guarantees',
    `- description ${hint.descriptionMinSentences}-${hint.descriptionMaxSentences} sentences, max ${hint.descriptionMaxChars} chars`,
    hashtagRule,
    hint.requireCtaInDescription
      ? `- description MUST include one soft CTA sentence (${hint.ctaStyle})`
      : '- description CTA is optional and should stay natural',
    '- audioRecommendation MUST use EXACT 5-field format, each on new line:',
    '  Style: ...',
    '  Mood: ...',
    '  Genre: ...',
    '  Suggestion: ...',
    '  Length: 30s',
    '- audioRecommendation MUST NOT be dialogue and MUST NOT include CTA words (follow/subscribe/click/share/comment/link bio)',
    '- avoid forbidden wording: 100%, pasti untung, garansi hasil, cepat kaya, auto viral, bocoran rahasia'
  ].join('\n')
}

function buildBloggerUserPrompt({ prompt, platform, topic }) {
  const platformText = safeString(platform) || 'Blog Blogger'
  const topicText = safeString(topic) || 'General article topic'
  const seo = BLOGGER_SEO_WORD_CONTRACT
  return [
    `Platform: ${platformText}`,
    `Topic: ${topicText}`,
    `SEO word target: min ${seo.minWords}, ideal ${seo.targetMinWords}-${seo.targetMaxWords}, max ${seo.maxWords}.`,
    `Meta description target: ${seo.metaDescriptionMinChars}-${seo.metaDescriptionMaxChars} chars.`,
    'Publishing pack target: slug + 2-5 internal links + 1-3 external references + featured snippet.',
    'Article requirements: answer search intent quickly, then deepen with practical sections and FAQ.',
    'Compiled prompt/context:',
    prompt || ''
  ].join('\n\n')
}

function buildUserPrompt({ prompt, platform, topic }) {
  if (isBloggerPlatform(platform)) {
    return buildBloggerUserPrompt({ prompt, platform, topic })
  }
  const platformText = safeString(platform) || 'Unknown'
  const topicText = safeString(topic) || 'General content'
  const hint = resolvePlatformOutputHint(platform)
  const hashtagRangeText = hint.hashtagMax === 0 ? '0 (none)' : `${hint.hashtagMin}-${hint.hashtagMax}`
  return [
    `Platform: ${platformText}`,
    `Topic: ${topicText}`,
    `Contract summary: hook ${hint.hookMin}-${hint.hookMax} chars, description ${hint.descriptionMinSentences}-${hint.descriptionMaxSentences} sentences (max ${hint.descriptionMaxChars} chars), hashtag ${hashtagRangeText}, CTA style ${hint.ctaStyle}`,
    'Narrator reminder: output final spoken scene lines, not meta-instructions.',
    'Compiled prompt/context:',
    prompt || ''
  ].join('\n\n')
}

function getModel(provider, model) {
  const fromInput = safeString(model)
  if (fromInput) return fromInput
  return DEFAULT_MODEL_BY_PROVIDER[provider] || 'gpt-4o-mini'
}

const VISION_PROVIDERS = new Set(['OpenAI', 'Gemini', 'OpenRouter'])

function hasImageReferences(imageReferences) {
  return Array.isArray(imageReferences) && imageReferences.length > 0
}

function normalizeImageReferences(imageReferences) {
  if (!Array.isArray(imageReferences)) return []
  const out = []
  for (const ref of imageReferences) {
    if (!ref || typeof ref !== 'object') continue
    if (String(ref.type || '').toLowerCase() === 'url') {
      const url = safeString(ref.url)
      if (url) out.push({ type: 'url', url })
      continue
    }
    if (String(ref.type || '').toLowerCase() === 'data_url') {
      const dataUrl = safeString(ref.dataUrl)
      if (!dataUrl) continue
      out.push({
        type: 'data_url',
        dataUrl,
        mimeType: safeString(ref.mimeType) || null
      })
    }
  }
  return out
}

function openAiImageParts(imageReferences) {
  return normalizeImageReferences(imageReferences).map((ref) => {
    const imageUrl = ref.type === 'url' ? ref.url : ref.dataUrl
    return { type: 'image_url', image_url: { url: imageUrl } }
  })
}

function toOpenAiUserContent(userPrompt, imageReferences = []) {
  const text = safeString(userPrompt)
  const imageParts = openAiImageParts(imageReferences)
  if (!imageParts.length) return text
  return [
    { type: 'text', text: text || 'Analyze the visual references and follow all instructions.' },
    ...imageParts
  ]
}

function toOpenAiMessages(systemPrompt, userPrompt, imageReferences = []) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: toOpenAiUserContent(userPrompt, imageReferences) }
  ]
}

function parseDataUrl(dataUrl) {
  const match = safeString(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/)
  if (!match) return null
  return { mimeType: match[1], base64Data: match[2] }
}

function toGeminiParts(systemPrompt, userPrompt, imageReferences = []) {
  const textBlock = `${systemPrompt}\n\n${userPrompt}`
  const parts = [{ text: textBlock }]
  const refs = normalizeImageReferences(imageReferences)

  for (const ref of refs) {
    if (ref.type === 'data_url') {
      const parsed = parseDataUrl(ref.dataUrl)
      if (!parsed) continue
      parts.push({
        inlineData: {
          mimeType: ref.mimeType || parsed.mimeType || 'image/png',
          data: parsed.base64Data
        }
      })
      continue
    }
    if (ref.type === 'url') {
      parts.push({
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: ref.url
        }
      })
    }
  }
  return parts
}

export function isVisionProviderImplemented(provider) {
  return VISION_PROVIDERS.has(safeString(provider))
}

function isOpenAiVisionModel(model) {
  const id = safeString(model).toLowerCase()
  if (!id) return false
  if (/gpt-3\.5|embedding|whisper|tts|audio|dall-e|moderation|realtime/.test(id)) return false
  if (/gpt-4o|gpt-4\.1|vision|omni/.test(id)) return true
  return false
}

function isGeminiVisionModel(model) {
  const id = safeString(model).toLowerCase()
  if (!id) return false
  if (/embedding|aqa|imagen|tts|speech|transcribe/.test(id)) return false
  if (/gemini/.test(id)) return true
  return false
}

function isOpenRouterVisionModel(model) {
  const id = safeString(model).toLowerCase()
  if (!id) return false
  if (/embedding|rerank|moderation|whisper|tts|audio/.test(id)) return false
  if (/vision|gpt-4o|gpt-4\.1|gemini|claude-3|claude-sonnet|pixtral|llava|qwen2-vl|llama-3\.2-11b-vision|llama-3\.2-90b-vision/.test(id)) return true
  return false
}

export function isVisionCapableModel({ provider, model }) {
  const providerName = safeString(provider)
  const resolvedModel = getModel(providerName, model)
  if (!isVisionProviderImplemented(providerName)) return false
  if (providerName === 'OpenAI') return isOpenAiVisionModel(resolvedModel)
  if (providerName === 'Gemini') return isGeminiVisionModel(resolvedModel)
  if (providerName === 'OpenRouter') return isOpenRouterVisionModel(resolvedModel)
  return false
}

function extractOpenAiLikeContent(data) {
  const msg = data?.choices?.[0]?.message?.content
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) {
    return msg.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim()
  }
  return ''
}

function extractGeminiContent(data) {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map((p) => safeString(p?.text)).filter(Boolean).join('\n').trim()
}

function extractCohereContent(data) {
  const content = data?.message?.content
  if (Array.isArray(content)) {
    return content.map((part) => safeString(part?.text)).filter(Boolean).join('\n').trim()
  }
  const text = safeString(data?.text)
  return text
}

async function callOpenAiCompatible({
  providerName = 'OpenAI',
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  imageReferences = [],
  extraHeaders = {},
  requestConfig = {}
}) {
  const requestBody = {
    model,
    temperature: RESPONSE_TEMPERATURE,
    messages: toOpenAiMessages(systemPrompt, userPrompt, imageReferences),
    response_format: { type: 'json_object' }
  }

  const makeRequest = async (withStructured = true) => {
    const finalBody = withStructured
      ? requestBody
      : { ...requestBody, response_format: undefined }
    const payload = { ...finalBody }
    if (!withStructured) delete payload.response_format
    const { data, attempt } = await requestProviderJson({
      provider: providerName,
      model,
      stage: 'generate',
      url: `${baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...extraHeaders
        },
        body: JSON.stringify(payload)
      },
      timeoutMs: requestConfig.timeoutMs,
      retryCount: requestConfig.retryCount,
      retryBackoffMs: requestConfig.retryBackoffMs
    })
    return { data, attempt }
  }

  let data
  let attemptsUsed = 1
  let structuredMode = true
  try {
    const first = await makeRequest(true)
    data = first.data
    attemptsUsed = first.attempt
    structuredMode = true
  } catch (err) {
    const unsupportedStructuredMode =
      safeString(err?.code) === 'PROVIDER_BAD_REQUEST' &&
      /response_format|json_object|unsupported|not supported|invalid parameter/i.test(safeString(err?.message))
    if (!unsupportedStructuredMode) throw err
    const second = await makeRequest(false)
    data = second.data
    attemptsUsed = Math.max(attemptsUsed, second.attempt)
    structuredMode = false
  }

  const content = extractOpenAiLikeContent(data)
  if (!content) {
    throw createProviderError('PROVIDER_EMPTY_RESPONSE', 'Provider returned empty response content', {
      provider: providerName,
      model,
      stage: 'generate',
      classification: 'empty',
      retryable: true
    })
  }
  return {
    text: content,
    attemptsUsed,
    structuredMode
  }
}

async function callGemini({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  imageReferences = [],
  requestConfig = {}
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const basePayload = {
    contents: [{ role: 'user', parts: toGeminiParts(systemPrompt, userPrompt, imageReferences) }],
    generationConfig: {
      temperature: RESPONSE_TEMPERATURE,
      responseMimeType: 'application/json'
    }
  }

  const makeRequest = async (withStructured = true) => {
    const payload = withStructured
      ? basePayload
      : {
          ...basePayload,
          generationConfig: {
            temperature: RESPONSE_TEMPERATURE
          }
        }

    const { data, attempt } = await requestProviderJson({
      provider: 'Gemini',
      model,
      stage: 'generate',
      url: endpoint,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      },
      timeoutMs: requestConfig.timeoutMs,
      retryCount: requestConfig.retryCount,
      retryBackoffMs: requestConfig.retryBackoffMs
    })
    return { data, attempt }
  }

  let data
  let attemptsUsed = 1
  let structuredMode = true
  try {
    const first = await makeRequest(true)
    data = first.data
    attemptsUsed = first.attempt
    structuredMode = true
  } catch (err) {
    const unsupportedStructuredMode =
      safeString(err?.code) === 'PROVIDER_BAD_REQUEST' &&
      /responsemimetype|response mime type|unsupported|not supported|invalid argument/i.test(safeString(err?.message))
    if (!unsupportedStructuredMode) throw err
    const second = await makeRequest(false)
    data = second.data
    attemptsUsed = Math.max(attemptsUsed, second.attempt)
    structuredMode = false
  }

  const content = extractGeminiContent(data)
  if (!content) {
    throw createProviderError('PROVIDER_EMPTY_RESPONSE', 'Gemini returned empty response content', {
      provider: 'Gemini',
      model,
      stage: 'generate',
      classification: 'empty',
      retryable: true
    })
  }
  return {
    text: content,
    attemptsUsed,
    structuredMode
  }
}

async function callCohere({ apiKey, model, systemPrompt, userPrompt, requestConfig = {} }) {
  const { data, attempt } = await requestProviderJson({
    provider: 'Cohere AI',
    model,
    stage: 'generate',
    url: 'https://api.cohere.com/v2/chat',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: RESPONSE_TEMPERATURE,
        messages: toOpenAiMessages(systemPrompt, userPrompt)
      })
    },
    timeoutMs: requestConfig.timeoutMs,
    retryCount: requestConfig.retryCount,
    retryBackoffMs: requestConfig.retryBackoffMs
  })

  const content = extractCohereContent(data)
  if (!content) {
    throw createProviderError('PROVIDER_EMPTY_RESPONSE', 'Cohere returned empty response content', {
      provider: 'Cohere AI',
      model,
      stage: 'generate',
      classification: 'empty',
      retryable: true
    })
  }
  return {
    text: content,
    attemptsUsed: attempt,
    structuredMode: null
  }
}

export async function generateStructuredWithProvider({
  provider,
  model,
  apiKey,
  prompt,
  platform,
  topic,
  language,
  imageReferences = [],
  fallback
}) {
  const providerName = safeString(provider)
  const resolvedModel = getModel(providerName, model)
  const key = safeString(apiKey)
  if (!key) throw new Error('Provider API key is missing')

  const systemPrompt = buildSystemPrompt(language, platform)
  const userPrompt = buildUserPrompt({ prompt, platform, topic })
  const refs = normalizeImageReferences(imageReferences)
  const requestConfig = resolveProviderRequestConfig(providerName)
  const startedAt = Date.now()
  let attemptsUsed = 1
  let structuredMode = null

  let rawText = ''
  try {
    if (providerName === 'OpenAI') {
      const response = await callOpenAiCompatible({
        providerName,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        imageReferences: refs,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else if (providerName === 'OpenRouter') {
      const response = await callOpenAiCompatible({
        providerName,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        imageReferences: refs,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else if (providerName === 'Groq') {
      const response = await callOpenAiCompatible({
        providerName,
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else if (providerName === 'DeepSeek') {
      const response = await callOpenAiCompatible({
        providerName,
        baseUrl: 'https://api.deepseek.com',
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else if (providerName === 'Hugging Face') {
      const response = await callOpenAiCompatible({
        providerName,
        baseUrl: 'https://router.huggingface.co/v1',
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else if (providerName === 'Gemini') {
      const response = await callGemini({
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        imageReferences: refs,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else if (providerName === 'Cohere AI') {
      const response = await callCohere({
        apiKey: key,
        model: resolvedModel,
        systemPrompt,
        userPrompt,
        requestConfig
      })
      rawText = response.text
      attemptsUsed = response.attemptsUsed
      structuredMode = response.structuredMode
    } else {
      throw createProviderError('PROVIDER_NOT_IMPLEMENTED', `Provider "${providerName}" is not implemented`, {
        provider: providerName,
        model: resolvedModel,
        stage: 'generate',
        classification: 'provider',
        retryable: false
      })
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    if (error?.details && typeof error.details === 'object') {
      error.details.elapsedMs = elapsedMs
      error.details.timeoutMs = requestConfig.timeoutMs
      error.details.retryCount = requestConfig.retryCount
      error.details.retryBackoffMs = requestConfig.retryBackoffMs
      error.details.attemptsUsed = Number(error.details.attemptsUsed || attemptsUsed || 1)
    }
    throw normalizeProviderTransportError(error, {
      provider: providerName,
      model: resolvedModel,
      stage: 'generate',
      timeoutMs: requestConfig.timeoutMs || PROVIDER_REQUEST_TIMEOUT_MS
    })
  }

  const parsed = extractFirstJsonObject(rawText)
  if (!parsed) {
    throw createProviderError('PROVIDER_INVALID_JSON', 'Provider response is not valid JSON format', {
      provider: providerName,
      model: resolvedModel,
      stage: 'json_parse',
      classification: 'json_invalid',
      retryable: true
    })
  }

  return {
    ...normalizeProviderOutput(parsed, fallback, platform),
    rawText,
    _providerRuntime: {
      elapsedMs: Date.now() - startedAt,
      attemptsUsed: Math.max(1, Number(attemptsUsed || 1)),
      structuredMode,
      timeoutMs: requestConfig.timeoutMs,
      retryCount: requestConfig.retryCount,
      retryBackoffMs: requestConfig.retryBackoffMs,
      provider: providerName,
      model: resolvedModel
    }
  }
}
