function safeString(value) {
  return String(value || '').trim()
}

function compactSpaces(text) {
  return safeString(text)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim()
}

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueLower(values = []) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = safeString(value).toLowerCase()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function uniqueCaseInsensitive(values = []) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = safeString(value)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10
}

function splitSentences(text) {
  const source = compactSpaces(text)
  if (!source) return []
  return source
    .split(/(?<=[.!?])\s+/)
    .map((x) => compactSpaces(x))
    .filter(Boolean)
}

function truncateText(text, maxChars = 170) {
  const source = compactSpaces(text)
  if (source.length <= maxChars) return source
  return `${source.slice(0, Math.max(10, maxChars - 1)).trim()}...`
}

function languageCode(language) {
  return safeString(language).toLowerCase().startsWith('en') ? 'en' : 'id'
}

const GLOBAL_FORBIDDEN_TERMS = [
  'pasti untung',
  '100%',
  'garansi hasil',
  'cepat kaya',
  'untung instan',
  'jaminan profit',
  'klik link bio',
  'dm sekarang',
  'wa sekarang',
  'inbox sekarang',
  'rahasia terbongkar',
  'shocking',
  'you wont believe',
  'anti gagal total',
  'bocoran rahasia',
  'penawaran palsu',
  'no risiko',
  'risk free',
  'keuntungan pasti',
  'profit harian'
]

const PLATFORM_FORBIDDEN_TERMS = {
  TikTok: ['fyp guaranteed', 'auto viral', 'pasti viral', 'viral dijamin'],
  'Instagram Reels': ['auto masuk explore', 'pasti trending', 'explore guaranteed'],
  'Facebook Reels': ['auto cuan instan', 'viral auto'],
  Threads: ['thread auto viral', 'algoritma threads dijamin naik'],
  Shopee: ['harga termurah sejagat', 'garansi pasti laku', 'jualan pasti laku'],
  Tokopedia: ['diskon paling murah sejagat', 'jualan pasti laris'],
  Lazada: ['flash sale pasti untung', 'stok dijamin habis'],
  'YouTube Short': ['subscribe sekarang juga kalau tidak rugi', 'subscribe wajib'],
  'YouTube Long': ['klik link sekarang juga', 'watch sampai habis biar kaya'],
  Pinterest: ['auto jutaan view'],
  'WhatsApp Status': ['sebar ke semua kontak sekarang', 'broadcast wajib'],
  'WhatsApp Channel': ['broadcast wajib', 'spam ke semua kontak'],
  Telegram: ['join sekarang pasti kaya', 'forward ke semua grup'],
  LinkedIn: ['naik jabatan pasti', 'karier dijamin sukses'],
  'X (Twitter)': ['tweet ini pasti viral', 'auto trending topic'],
  SoundCloud: ['stream dijamin meledak', 'auto chart dalam sehari'],
  'Blog Blogger': ['ranking google dijamin', 'trafik pasti jutaan']
}

const FORBIDDEN_HASHTAG_TOKENS = [
  'scam',
  'penipuan',
  'slotgacor',
  'judionline',
  'cepatkaya',
  'garansihasil',
  'pastiviral',
  'untunginstan',
  'riskfree',
  'bocoranrahasia'
]

const SPAM_PATTERNS = [
  /(klik|click)\s*(link|tautan)\s*(bio|di bio)?/gi,
  /\b(dm|inbox|wa|whatsapp)\s*(sekarang|now)\b/gi,
  /\b100%\b/gi,
  /\bgaransi\b/gi,
  /\bpasti (viral|untung|cuan|laku)\b/gi,
  /\bcepat kaya\b/gi,
  /\bpromo gila\b/gi
]

const SCAM_PATTERNS = [
  /\b(transfer|bayar|deposit)\s+dulu\b/gi,
  /\b(slot|judi)\s*(online|gacor)?\b/gi,
  /\bkeuntungan pasti\b/gi,
  /\bprofit harian\b/gi,
  /\binvestasi bodong\b/gi
]

const SUSPENSE_PATTERNS = [
  /\b(kamu|anda)\s+(tidak|ga|nggak)\s+akan\s+percaya\b/gi,
  /\brahasia\s+(besar|gelap|terbongkar)\b/gi,
  /\bini bikin (deg[- ]?degan|shock)\b/gi,
  /\bjangan sampai kelewatan\b/gi
]

const AUDIO_DIALOG_PATTERNS = [
  /\bjangan lupa\b/i,
  /\bfollow\b/i,
  /\bsubscribe\b/i,
  /\bklik\b/i,
  /\blink bio\b/i,
  /\bcomment\b/i,
  /\bshare\b/i,
  /\buntuk review lengkap\b/i
]

const NARRATOR_INSTRUCTION_PATTERNS = [
  /^\s*(buka dengan hook|open with (a )?hook)\b/i,
  /^\s*(sebut|state)\s+(pain point|audience pain point|pain point audiens)\b/i,
  /^\s*(tutup dengan cta|close with (a )?cta)\b/i,
  /^\s*(jelaskan poin|explain (the )?key point)\b/i,
  /\b(scene-by-scene|scene by scene)\b/i,
  /\b(pain point audiens|audience pain point)\b/i,
  /\b(cta lembut|soft cta)\b/i,
  /\b(placeholder|isi di sini|to be filled)\b/i
]

const AUDIO_FIELD_KEYS = ['style', 'mood', 'genre', 'suggestion', 'length']
const AUDIO_FIELD_LABEL = {
  style: 'Style',
  mood: 'Mood',
  genre: 'Genre',
  suggestion: 'Suggestion',
  length: 'Length'
}

const CONTENT_LENGTH_PROFILE = {
  short: { sceneCount: 3, totalSec: 30 },
  medium: { sceneCount: 5, totalSec: 45 },
  long: { sceneCount: 7, totalSec: 60 }
}

const STAGE_1_PLATFORMS = new Set(['TikTok', 'Instagram Reels', 'YouTube Short', 'Threads'])
const STAGE_2_PLATFORMS = new Set([
  'YouTube Long',
  'Facebook Reels',
  'WhatsApp Status',
  'WhatsApp Channel',
  'Telegram',
  'Shopee',
  'Pinterest',
  'Tokopedia',
  'Lazada',
  'LinkedIn',
  'X (Twitter)',
  'SoundCloud',
  'Blog Blogger'
])

const DEFAULT_PLATFORM_OUTPUT_CONTRACT = {
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

const PLATFORM_OUTPUT_CONTRACTS = {
  TikTok: {
    hookMax: 130,
    hashtagMin: 4,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'comment_share_save'
  },
  'Instagram Reels': {
    hookMax: 140,
    hashtagMin: 4,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'comment_share'
  },
  'YouTube Short': {
    hookMax: 140,
    hashtagMin: 3,
    hashtagMax: 7,
    requireCtaInDescription: true,
    ctaStyle: 'comment_follow'
  },
  Threads: {
    hookMax: 170,
    descriptionMaxSentences: 4,
    descriptionMaxChars: 320,
    hashtagMin: 0,
    hashtagMax: 3,
    requireCtaInDescription: true,
    ctaStyle: 'reply_debate'
  },
  'YouTube Long': {
    hookMax: 180,
    descriptionMaxSentences: 4,
    descriptionMaxChars: 360,
    hashtagMin: 2,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'watch_comment'
  },
  'Facebook Reels': {
    hookMax: 150,
    hashtagMin: 3,
    hashtagMax: 7,
    requireCtaInDescription: true,
    ctaStyle: 'comment_share'
  },
  'WhatsApp Status': {
    hookMax: 120,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 180,
    hashtagMin: 0,
    hashtagMax: 2,
    requireCtaInDescription: false,
    ctaStyle: 'reply_contact'
  },
  'WhatsApp Channel': {
    hookMax: 120,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 170,
    hashtagMin: 0,
    hashtagMax: 1,
    requireCtaInDescription: true,
    ctaStyle: 'react_forward'
  },
  Telegram: {
    hookMax: 135,
    descriptionMaxSentences: 3,
    descriptionMaxChars: 240,
    hashtagMin: 0,
    hashtagMax: 3,
    requireCtaInDescription: true,
    ctaStyle: 'reply_vote'
  },
  Shopee: {
    hookMax: 130,
    hashtagMin: 3,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'checkout_comment'
  },
  Tokopedia: {
    hookMax: 130,
    hashtagMin: 3,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'checkout_comment'
  },
  Lazada: {
    hookMax: 130,
    hashtagMin: 3,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'checkout_comment'
  },
  Pinterest: {
    hookMax: 150,
    hashtagMin: 2,
    hashtagMax: 6,
    requireCtaInDescription: false,
    ctaStyle: 'save_pin'
  },
  LinkedIn: {
    hookMax: 170,
    descriptionMaxSentences: 4,
    descriptionMaxChars: 340,
    hashtagMin: 1,
    hashtagMax: 5,
    requireCtaInDescription: true,
    ctaStyle: 'comment_follow'
  },
  'X (Twitter)': {
    hookMax: 120,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 240,
    hashtagMin: 0,
    hashtagMax: 3,
    requireCtaInDescription: true,
    ctaStyle: 'reply_repost'
  },
  SoundCloud: {
    hookMax: 130,
    descriptionMaxSentences: 3,
    descriptionMaxChars: 260,
    hashtagMin: 2,
    hashtagMax: 6,
    requireCtaInDescription: true,
    ctaStyle: 'listen_follow'
  },
  'Blog Blogger': {
    hookMax: 180,
    descriptionMinSentences: 1,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 180,
    hashtagMin: 0,
    hashtagMax: 4,
    requireCtaInDescription: false,
    ctaStyle: 'read_comment'
  }
}

const BLOGGER_ARTICLE_CONTRACT = {
  minWords: 900,
  targetMinWords: 1300,
  targetMaxWords: 1700,
  maxWords: 2200,
  metaDescriptionMinChars: 140,
  metaDescriptionMaxChars: 160,
  minHeadings: 4,
  minFaqItems: 3,
  minInternalLinks: 2,
  maxInternalLinks: 5,
  minExternalReferences: 1,
  maxExternalReferences: 3,
  featuredSnippetMaxChars: 320
}

function isBloggerPlatform(platform) {
  return safeString(platform).toLowerCase() === 'blog blogger'
}

function countWords(text) {
  const source = safeString(text)
  if (!source) return 0
  return source.split(/\s+/).filter(Boolean).length
}

function slugifyBloggerText(raw) {
  return safeString(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96)
}

function normalizeBloggerSlug(rawSlug, fallbackText = '') {
  const slug = slugifyBloggerText(rawSlug) || slugifyBloggerText(fallbackText) || 'artikel-blogger'
  const parts = slug.split('-').filter(Boolean).slice(0, 12)
  if (!parts.length) return 'artikel-blogger'
  return parts.join('-')
}

function parseListInput(rawValue) {
  if (Array.isArray(rawValue)) return rawValue
  if (typeof rawValue === 'string') return rawValue.split(/[,\n]/g)
  return []
}

function normalizeBloggerInternalLinks(rawLinks, slug) {
  const source = parseListInput(rawLinks)
  const out = []
  const seen = new Set()
  const pushLink = (value) => {
    const text = safeString(value)
    if (!text.startsWith('/')) return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(text)
  }
  source.forEach(pushLink)

  const fallback = [
    `/p/${slug}.html`,
    `/p/${slug}-checklist.html`,
    `/p/${slug}-faq.html`
  ]
  fallback.forEach(pushLink)

  return out.slice(0, BLOGGER_ARTICLE_CONTRACT.maxInternalLinks)
}

function normalizeBloggerExternalReferences(rawRefs) {
  const source = parseListInput(rawRefs)
  const out = []
  const seen = new Set()
  const pushRef = (value) => {
    const text = safeString(value)
    if (!/^https?:\/\//i.test(text)) return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(text)
  }
  source.forEach(pushRef)

  const fallback = [
    'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
    'https://www.w3.org/WAI/'
  ]
  fallback.forEach(pushRef)

  return out.slice(0, BLOGGER_ARTICLE_CONTRACT.maxExternalReferences)
}

function normalizeBloggerFeaturedSnippet(rawSnippet, context = {}) {
  const lang = languageCode(context.language)
  const topic = safeString(context.topic) || (lang === 'en' ? 'this topic' : 'topik ini')
  const fallback = lang === 'en'
    ? `What is the key takeaway about ${topic}? Focus on practical steps, clear structure, and intent-first answers.`
    : `Apa inti ${topic}? Fokus pada langkah praktis, struktur jelas, dan jawaban yang sesuai intent pencarian.`
  let text = ensureRequiredText(rawSnippet, fallback)
  if (text.length > BLOGGER_ARTICLE_CONTRACT.featuredSnippetMaxChars) {
    text = truncateText(text, BLOGGER_ARTICLE_CONTRACT.featuredSnippetMaxChars)
  }
  if (text.length < 40) {
    text = fallback
  }
  return text
}

function normalizeBloggerPublishPack({ slug, internalLinks, externalReferences, featuredSnippet, title }, context = {}) {
  const fallbackText = safeString(context.topic) || safeString(title) || 'artikel blogger'
  const normalizedSlug = normalizeBloggerSlug(slug, fallbackText)
  let normalizedInternalLinks = normalizeBloggerInternalLinks(internalLinks, normalizedSlug)
  let normalizedExternalReferences = normalizeBloggerExternalReferences(externalReferences)
  let normalizedFeaturedSnippet = normalizeBloggerFeaturedSnippet(featuredSnippet, context)

  const reasons = []
  if (safeString(slug) !== normalizedSlug) reasons.push('slug_normalized')

  if (normalizedInternalLinks.length < BLOGGER_ARTICLE_CONTRACT.minInternalLinks) {
    normalizedInternalLinks = normalizeBloggerInternalLinks([], normalizedSlug)
    reasons.push('internal_links_fallback')
  }
  if (normalizedExternalReferences.length < BLOGGER_ARTICLE_CONTRACT.minExternalReferences) {
    normalizedExternalReferences = normalizeBloggerExternalReferences([])
    reasons.push('external_references_fallback')
  }
  if (safeString(featuredSnippet) !== normalizedFeaturedSnippet) {
    reasons.push('featured_snippet_adjusted')
  }

  return {
    slug: normalizedSlug,
    internalLinks: normalizedInternalLinks,
    externalReferences: normalizedExternalReferences,
    featuredSnippet: normalizedFeaturedSnippet,
    adjusted: reasons.length > 0,
    reasons
  }
}

function resolvePlatformContract(platform) {
  const normalized = safeString(platform) || 'TikTok'
  const specific = PLATFORM_OUTPUT_CONTRACTS[normalized] || {}
  const merged = {
    ...DEFAULT_PLATFORM_OUTPUT_CONTRACT,
    ...specific
  }
  const min = clampNumber(merged.hashtagMin, 0, 12, DEFAULT_PLATFORM_OUTPUT_CONTRACT.hashtagMin)
  const max = clampNumber(merged.hashtagMax, min, 12, DEFAULT_PLATFORM_OUTPUT_CONTRACT.hashtagMax)
  return {
    ...merged,
    platform: normalized,
    hashtagMin: min,
    hashtagMax: max,
    stage: STAGE_1_PLATFORMS.has(normalized) ? 1 : (STAGE_2_PLATFORMS.has(normalized) ? 2 : 2)
  }
}

function resolveContentLength(value) {
  const key = safeString(value).toLowerCase()
  if (key === 'medium') return 'medium'
  if (key === 'long') return 'long'
  return 'short'
}

function resolveLengthProfile(context = {}) {
  const contentLength = resolveContentLength(context.contentLength)
  const base = CONTENT_LENGTH_PROFILE[contentLength] || CONTENT_LENGTH_PROFILE.short
  const forcedSec = clampNumber(context.audioLengthSec, 15, 180, null)
  return {
    contentLength,
    sceneCount: base.sceneCount,
    totalSec: forcedSec || base.totalSec
  }
}

function buildForbiddenTerms({ platform, constraintsForbiddenWords = [] }) {
  const platformTerms = Array.isArray(PLATFORM_FORBIDDEN_TERMS?.[platform])
    ? PLATFORM_FORBIDDEN_TERMS[platform]
    : []
  return uniqueLower([
    ...GLOBAL_FORBIDDEN_TERMS,
    ...platformTerms,
    ...(Array.isArray(constraintsForbiddenWords) ? constraintsForbiddenWords : [])
  ])
}

function sanitizeForbiddenTerms(text, forbiddenTerms) {
  let out = safeString(text)
  let hits = 0
  for (const term of forbiddenTerms || []) {
    const pattern = new RegExp(escapeRegExp(term), 'gi')
    const matches = out.match(pattern)
    if (matches?.length) {
      hits += matches.length
      out = out.replace(pattern, '')
    }
  }
  return { text: compactSpaces(out), hits }
}

function sanitizeRiskyLanguage(text) {
  let out = safeString(text)
  let spamHits = 0
  let scamHits = 0
  let suspenseHits = 0

  for (const pattern of SPAM_PATTERNS) {
    const matches = out.match(pattern)
    if (matches?.length) {
      spamHits += matches.length
      out = out.replace(pattern, '')
    }
  }

  for (const pattern of SCAM_PATTERNS) {
    const matches = out.match(pattern)
    if (matches?.length) {
      scamHits += matches.length
      out = out.replace(pattern, '')
    }
  }

  for (const pattern of SUSPENSE_PATTERNS) {
    const matches = out.match(pattern)
    if (matches?.length) {
      suspenseHits += matches.length
      out = out.replace(pattern, '')
    }
  }

  out = out.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?')
  return {
    text: compactSpaces(out),
    spamHits,
    scamHits,
    suspenseHits,
    totalHits: spamHits + scamHits + suspenseHits
  }
}

function sanitizeSafeText(raw, forbiddenTerms) {
  const first = sanitizeForbiddenTerms(raw, forbiddenTerms)
  const second = sanitizeRiskyLanguage(first.text)
  return {
    text: compactSpaces(second.text),
    forbiddenHits: first.hits,
    spamHits: second.spamHits,
    scamHits: second.scamHits,
    suspenseHits: second.suspenseHits
  }
}

function sanitizeSafeMultilineText(raw, forbiddenTerms) {
  const source = String(raw || '')
  const lines = source.split(/\r?\n/)
  const cleanedLines = []
  let forbiddenHits = 0
  let spamHits = 0
  let scamHits = 0
  let suspenseHits = 0

  for (const line of lines) {
    const cleaned = sanitizeSafeText(line, forbiddenTerms)
    forbiddenHits += cleaned.forbiddenHits
    spamHits += cleaned.spamHits
    scamHits += cleaned.scamHits
    suspenseHits += cleaned.suspenseHits
    cleanedLines.push(cleaned.text)
  }

  const text = cleanedLines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

  return {
    text,
    forbiddenHits,
    spamHits,
    scamHits,
    suspenseHits
  }
}

function normalizeHashtagToken(raw) {
  const source = safeString(raw)
  if (!source) return null
  const withHash = source.startsWith('#') ? source : `#${source}`
  const compact = withHash.replace(/\s+/g, '')
  if (!/^#[\w.-]{2,40}$/i.test(compact)) return null
  return compact
}

function defaultSafeHashtagsByPlatform(platform) {
  if (platform === 'TikTok') return ['#tiktok', '#konten', '#edukasi', '#tips', '#review']
  if (platform === 'Instagram Reels') return ['#reels', '#konten', '#tips', '#creator', '#insight']
  if (platform === 'YouTube Short') return ['#shorts', '#konten', '#review', '#insight', '#tips']
  if (platform === 'Shopee') return ['#shopee', '#reviewproduk', '#belanjapintar', '#tipsbelanja', '#produk']
  if (platform === 'Tokopedia') return ['#tokopedia', '#reviewproduk', '#belanjapintar', '#tipsbelanja', '#produk']
  if (platform === 'Lazada') return ['#lazada', '#reviewproduk', '#promo', '#tipsbelanja', '#produk']
  if (platform === 'Threads') return ['#threads', '#insight', '#konten', '#tips', '#creator']
  if (platform === 'WhatsApp Channel') return ['#whatsappchannel', '#update', '#konten', '#tips', '#komunitas']
  if (platform === 'Telegram') return ['#telegram', '#channel', '#insight', '#tips', '#komunitas']
  if (platform === 'LinkedIn') return ['#linkedin', '#career', '#insight', '#professional', '#leadership']
  if (platform === 'X (Twitter)') return ['#twitter', '#x', '#thread', '#insight', '#update']
  if (platform === 'SoundCloud') return ['#soundcloud', '#music', '#newrelease', '#indie', '#artist']
  if (platform === 'Blog Blogger') return ['#blogger', '#blog', '#artikel', '#tips', '#insight']
  return ['#konten', '#tips', '#review', '#insight', '#creator']
}

function sanitizeHashtags(input, { platform, forbiddenTerms = [], platformContract = null }) {
  const terms = uniqueLower([...FORBIDDEN_HASHTAG_TOKENS, ...(forbiddenTerms || [])])
  const source = Array.isArray(input) ? input : []
  const contract = platformContract || resolvePlatformContract(platform)
  const minCount = clampNumber(contract.hashtagMin, 0, 12, 3)
  const maxCount = clampNumber(contract.hashtagMax, minCount, 12, 8)
  let removedCount = 0
  let addedCount = 0
  let contractAdjusted = false
  const out = []
  const seen = new Set()
  for (const raw of source) {
    const normalized = normalizeHashtagToken(raw)
    if (!normalized) {
      removedCount += 1
      continue
    }
    const lower = normalized.toLowerCase()
    if (terms.some((term) => lower.includes(term.replace(/\s+/g, '')))) {
      removedCount += 1
      continue
    }
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(normalized)
  }

  if (maxCount === 0) {
    if (out.length > 0) contractAdjusted = true
    removedCount += out.length
    return {
      hashtags: [],
      removedCount,
      addedCount,
      usedFallback: false,
      minCount,
      maxCount,
      inRange: true,
      contractAdjusted
    }
  }

  if (out.length > maxCount) {
    removedCount += (out.length - maxCount)
    out.length = maxCount
    contractAdjusted = true
  }

  if (out.length < minCount) {
    const fallback = defaultSafeHashtagsByPlatform(platform)
    for (const tag of fallback) {
      if (out.length >= minCount) break
      const normalized = normalizeHashtagToken(tag)
      if (!normalized) continue
      const lower = normalized.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      out.push(normalized)
      addedCount += 1
      contractAdjusted = true
    }
  }

  if (out.length) {
    return {
      hashtags: out.slice(0, maxCount),
      removedCount,
      addedCount,
      usedFallback: false,
      minCount,
      maxCount,
      inRange: out.length >= minCount && out.length <= maxCount,
      contractAdjusted
    }
  }

  if (minCount === 0) {
    return {
      hashtags: [],
      removedCount,
      addedCount,
      usedFallback: false,
      minCount,
      maxCount,
      inRange: true,
      contractAdjusted
    }
  }

  const fallback = defaultSafeHashtagsByPlatform(platform).slice(0, maxCount)
  return {
    hashtags: fallback,
    removedCount,
    addedCount,
    usedFallback: true,
    minCount,
    maxCount,
    inRange: fallback.length >= minCount && fallback.length <= maxCount,
    contractAdjusted: true
  }
}

function parseAudioLengthSeconds(raw) {
  const source = safeString(raw).toLowerCase()
  const match = source.match(/(\d{1,3})\s*(?:s|sec|secs|second|seconds)\b/)
  if (!match) return null
  return clampNumber(Number(match[1]), 5, 180, null)
}

function parseAudioFields(raw) {
  const source = safeString(raw)
  if (!source) return {}
  const lines = source
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[-*]\s*/, ''))

  const fields = {}
  for (const line of lines) {
    const m = line.match(/^(Style|Mood|Genre|Suggestion|Length)\s*:\s*(.+)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    fields[key] = compactSpaces(m[2])
  }
  return fields
}

function formatAudioFields(fields) {
  return AUDIO_FIELD_KEYS.map((key) => `${AUDIO_FIELD_LABEL[key]}: ${safeString(fields[key])}`).join('\n')
}

function isAudioFieldSetComplete(fields) {
  return AUDIO_FIELD_KEYS.every((key) => safeString(fields[key]).length > 0)
}

function validateAudioContract(text) {
  const source = safeString(text)
  if (!source) return { valid: false, reason: 'empty', fields: {} }

  const fields = parseAudioFields(source)
  if (!isAudioFieldSetComplete(fields)) {
    return { valid: false, reason: 'missing_fields', fields }
  }

  for (const key of AUDIO_FIELD_KEYS) {
    const value = safeString(fields[key])
    if (!value) return { valid: false, reason: `missing_${key}`, fields }
    if (value.includes('#')) return { valid: false, reason: 'contains_hashtag', fields }
    if (AUDIO_DIALOG_PATTERNS.some((re) => re.test(value))) {
      return { valid: false, reason: 'dialog_or_cta', fields }
    }
  }

  const lengthSec = parseAudioLengthSeconds(fields.length)
  if (!lengthSec) return { valid: false, reason: 'length_invalid', fields }
  if (fields.suggestion.split(/\s+/).filter(Boolean).length > 45) {
    return { valid: false, reason: 'suggestion_too_long', fields }
  }

  return { valid: true, reason: null, fields, lengthSec }
}

function defaultAudioFields(context, lengthProfile) {
  const lang = languageCode(context.language)
  const tone = safeString(context.tone) || (lang === 'en' ? 'balanced' : 'seimbang')
  const topic = safeString(context.topic) || (lang === 'en' ? 'this topic' : 'topik ini')
  const sec = lengthProfile.totalSec

  if (lang === 'en') {
    return {
      style: `Soft beat aesthetic, clean, calming, subtle build-up at second 3 (${tone})`,
      mood: 'Fresh, hopeful, confident, relaxed',
      genre: 'Chill pop, soft EDM, aesthetic creator sound',
      suggestion: `Pick a viral creator sound from the last 7-14 days, medium tempo, soft transition around second 3-5 to support ${topic} visuals.`,
      length: `${sec}s`
    }
  }

  return {
    style: `Soft beat aesthetic, clean, calming dengan build up halus di detik 3 (${tone})`,
    mood: 'Fresh, hopeful, confident, bikin rileks dan pede',
    genre: 'Chill pop, soft EDM, aesthetic creator sound',
    suggestion: `Pilih sound viral creator 7-14 hari terakhir, tempo sedang, transisi lembut di detik 3-5 agar visual ${topic} lebih kuat.`,
    length: `${sec}s`
  }
}

function normalizeAudioRecommendation(raw, context, lengthProfile) {
  if (isBloggerPlatform(context?.platform)) {
    const cleaned = sanitizeSafeText(raw, context.forbiddenTerms)
    const hadInput = safeString(raw).length > 0
    return {
      value: '',
      fields: {},
      lengthSec: lengthProfile.totalSec,
      usedFallback: false,
      contractValid: true,
      reason: hadInput ? 'blogger_audio_removed' : null,
      forbiddenHits: cleaned.forbiddenHits,
      spamHits: cleaned.spamHits,
      scamHits: cleaned.scamHits,
      suspenseHits: cleaned.suspenseHits
    }
  }

  const contract = validateAudioContract(raw)
  let usedFallback = false
  let reason = null
  let fields = contract.fields || {}

  if (!contract.valid) {
    usedFallback = true
    reason = contract.reason || 'audio_contract_invalid'
    fields = defaultAudioFields(context, lengthProfile)
  }

  let forbiddenHits = 0
  let spamHits = 0
  let scamHits = 0
  let suspenseHits = 0
  const cleanedFields = {}
  for (const key of AUDIO_FIELD_KEYS) {
    const cleaned = sanitizeSafeText(fields[key], context.forbiddenTerms)
    forbiddenHits += cleaned.forbiddenHits
    spamHits += cleaned.spamHits
    scamHits += cleaned.scamHits
    suspenseHits += cleaned.suspenseHits
    cleanedFields[key] = cleaned.text
  }

  const fallbackIfEmpty = !isAudioFieldSetComplete(cleanedFields)
  if (fallbackIfEmpty) {
    usedFallback = true
    reason = reason || 'audio_field_empty_after_sanitize'
    Object.assign(cleanedFields, defaultAudioFields(context, lengthProfile))
  }

  if (!parseAudioLengthSeconds(cleanedFields.length)) {
    cleanedFields.length = `${lengthProfile.totalSec}s`
    usedFallback = true
    reason = reason || 'audio_length_reset'
  }

  const value = formatAudioFields(cleanedFields)
  const finalContract = validateAudioContract(value)
  if (!finalContract.valid) {
    const fallbackFields = defaultAudioFields(context, lengthProfile)
    return {
      value: formatAudioFields(fallbackFields),
      fields: fallbackFields,
      lengthSec: lengthProfile.totalSec,
      usedFallback: true,
      contractValid: true,
      reason: reason || finalContract.reason || 'audio_contract_force_rewrite',
      forbiddenHits,
      spamHits,
      scamHits,
      suspenseHits
    }
  }

  return {
    value,
    fields: finalContract.fields,
    lengthSec: finalContract.lengthSec || lengthProfile.totalSec,
    usedFallback,
    contractValid: finalContract.valid,
    reason,
    forbiddenHits,
    spamHits,
    scamHits,
    suspenseHits
  }
}

function buildSceneRanges(totalSec, sceneCount) {
  const ranges = []
  const count = Math.max(1, sceneCount)
  const total = Math.max(count, totalSec)
  const base = Math.floor(total / count)
  let remainder = total % count
  let start = 0
  for (let i = 0; i < count; i += 1) {
    let duration = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder -= 1
    if (i === count - 1) duration = Math.max(1, total - start)
    const end = start + duration
    ranges.push({ start, end })
    start = end
  }
  return ranges
}

function parseNarratorScenes(raw) {
  const source = safeString(raw)
  if (!source) return []
  const lines = source
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
  const scenes = []
  for (const line of lines) {
    const m = line.match(/^Scene\s+(\d+)\s*\((\d+)-(\d+)s\)\s*:\s*(.+)$/i)
    if (!m) continue
    scenes.push({
      index: Number(m[1]),
      start: Number(m[2]),
      end: Number(m[3]),
      text: compactSpaces(m[4])
    })
  }
  return scenes
}

function isNarratorInstructionLike(text) {
  const source = safeString(text)
  if (!source) return true
  return NARRATOR_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(source))
}

function buildNarratorFallbackLine(context, sceneIndex, sceneCount, hook, description) {
  const lang = languageCode(context.language)
  const topic = safeString(context.topic) || (lang === 'en' ? 'this topic' : 'topik ini')
  const ctaFromContext = Array.isArray(context.ctaTexts) ? safeString(context.ctaTexts[0]) : ''
  const descSentences = splitSentences(description)

  if (sceneIndex === 0) {
    if (safeString(hook)) return safeString(hook)
    return lang === 'en'
      ? `Today we break down ${topic} so you can decide with more confidence.`
      : `Hari ini kita bahas ${topic} supaya kamu bisa ambil keputusan lebih yakin.`
  }

  if (sceneIndex === sceneCount - 1) {
    if (ctaFromContext) return ctaFromContext
    return lang === 'en'
      ? 'If this helps, save this and drop your take in the comments.'
      : 'Kalau ini membantu, simpan dulu lalu tulis pendapatmu di komentar.'
  }

  if (sceneIndex === 1) {
    return lang === 'en'
      ? `The common issue is people focus on hype, not on what they actually need from ${topic}.`
      : `Masalah yang sering terjadi, orang fokus ke hype, bukan kebutuhan nyata dari ${topic}.`
  }

  if (descSentences.length) {
    return descSentences[(sceneIndex - 2) % descSentences.length]
  }

  return lang === 'en'
    ? `Use this scene to show one concrete point that makes ${topic} easier to understand.`
    : `Di scene ini, tunjukkan satu poin konkret agar ${topic} lebih mudah dipahami.`
}

function normalizeNarratorSceneText(text, context, sceneIndex, sceneCount, hook, description) {
  const fallbackLine = buildNarratorFallbackLine(context, sceneIndex, sceneCount, hook, description)
  let value = compactSpaces(text)
  value = value.replace(/^scene\s*\d+\s*\(\d+-\d+s\)\s*:\s*/i, '')
  value = value.replace(/^(buka dengan hook|open with (a )?hook)\s*[:,-]?\s*/i, '')
  value = value.replace(/^(sebut|state)\s+(pain point|audience pain point|pain point audiens)\s*[:,-]?\s*/i, '')
  value = value.replace(/^(tutup dengan cta|close with (a )?cta)\s*[:,-]?\s*/i, '')
  value = value.replace(/^(jelaskan poin|explain (the )?key point)\s*[:,-]?\s*/i, '')
  value = compactSpaces(value)

  if (!value || isNarratorInstructionLike(value) || value.length < 12) {
    value = fallbackLine
  }
  return truncateText(value, 180)
}

function validateNarratorSemantics(scenes) {
  const instructionSceneIndexes = []
  const tooShortSceneIndexes = []
  for (const scene of scenes || []) {
    const text = safeString(scene?.text)
    if (isNarratorInstructionLike(text)) instructionSceneIndexes.push(scene.index)
    if (text.length < 12) tooShortSceneIndexes.push(scene.index)
  }
  if (instructionSceneIndexes.length) {
    return {
      valid: false,
      reason: 'scene_instructional_text',
      instructionSceneIndexes,
      tooShortSceneIndexes
    }
  }
  if (tooShortSceneIndexes.length) {
    return {
      valid: false,
      reason: 'scene_text_too_short',
      instructionSceneIndexes,
      tooShortSceneIndexes
    }
  }
  return {
    valid: true,
    reason: null,
    instructionSceneIndexes: [],
    tooShortSceneIndexes: []
  }
}

function validateNarratorContract(raw, lengthProfile) {
  const scenes = parseNarratorScenes(raw)
  if (!scenes.length) return { valid: false, reason: 'missing_scene_format', scenes: [] }
  if (scenes.length !== lengthProfile.sceneCount) {
    return { valid: false, reason: 'scene_count_mismatch', scenes }
  }
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i]
    if (scene.index !== i + 1) return { valid: false, reason: 'scene_index_invalid', scenes }
    if (!safeString(scene.text)) return { valid: false, reason: 'scene_text_empty', scenes }
    if (scene.end <= scene.start) return { valid: false, reason: 'scene_range_invalid', scenes }
  }
  return { valid: true, reason: null, scenes }
}

function countBloggerHeadings(text) {
  const source = String(text || '')
  const matches = source.match(/(?:^|\n)\s*(?:##+\s+|H2:\s+|H3:\s+)/gim)
  return Array.isArray(matches) ? matches.length : 0
}

function countBloggerFaqItems(text) {
  const source = String(text || '')
  const matches = source.match(/(?:^|\n)\s*Q\d+\s*[:.-]/gim)
  return Array.isArray(matches) ? matches.length : 0
}

function trimToWordLimit(text, maxWords) {
  const source = safeString(text)
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return source
  return words.slice(0, maxWords).join(' ')
}

function validateBloggerArticleContract(raw) {
  const source = safeString(raw)
  const wordCount = countWords(source)
  const headingCount = countBloggerHeadings(raw)
  const faqCount = countBloggerFaqItems(raw)
  const valid =
    wordCount >= BLOGGER_ARTICLE_CONTRACT.minWords &&
    wordCount <= BLOGGER_ARTICLE_CONTRACT.maxWords &&
    headingCount >= BLOGGER_ARTICLE_CONTRACT.minHeadings &&
    faqCount >= BLOGGER_ARTICLE_CONTRACT.minFaqItems

  let reason = null
  if (!source) reason = 'empty'
  else if (wordCount < BLOGGER_ARTICLE_CONTRACT.minWords) reason = 'article_too_short'
  else if (wordCount > BLOGGER_ARTICLE_CONTRACT.maxWords) reason = 'article_too_long'
  else if (headingCount < BLOGGER_ARTICLE_CONTRACT.minHeadings) reason = 'heading_missing'
  else if (faqCount < BLOGGER_ARTICLE_CONTRACT.minFaqItems) reason = 'faq_missing'

  return {
    valid,
    reason,
    wordCount,
    headingCount,
    faqCount
  }
}

function buildBloggerSectionParagraph(topic, angle, lang) {
  if (lang === 'en') {
    return compactSpaces(
      `${topic} becomes easier to evaluate when readers start from clear intent, compare realistic options, and focus on practical execution. ` +
      `In this section, we break down ${angle} using concrete examples, simple decision criteria, and low-risk actions that can be applied immediately. ` +
      'The goal is to help readers move from confusion to confident action without exaggerated claims, while still keeping the guidance relevant for search intent.'
    )
  }

  return compactSpaces(
    `${topic} akan lebih mudah dipahami ketika pembaca mulai dari tujuan yang jelas, membandingkan opsi secara realistis, dan fokus pada langkah eksekusi yang praktis. ` +
    `Di bagian ini, kita membedah ${angle} dengan contoh konkret, kriteria keputusan sederhana, dan tindakan rendah risiko yang bisa langsung diterapkan. ` +
    'Tujuannya agar pembaca bergerak dari bingung menjadi yakin mengambil keputusan tanpa janji berlebihan, namun tetap relevan dengan intent pencarian.'
  )
}

function buildBloggerArticle(context, sourceNarrator, hook, description) {
  const lang = languageCode(context.language)
  const topic = safeString(context.topic) || (lang === 'en' ? 'the main topic' : 'topik utama')
  const introHook = safeString(hook)
  const metaDesc = safeString(description)
  const cta = getPlatformCtaSentence(context.platformContract || resolvePlatformContract('Blog Blogger'), context)

  const sectionTitles = lang === 'en'
    ? [
        `## Why ${topic} Matters Right Now`,
        `## Common Problems Readers Usually Face`,
        '## Step-by-Step Practical Framework',
        '## Realistic Case Example and Lessons Learned',
        '## Mistakes to Avoid for Better Results',
        '## Quick Checklist Before You Execute'
      ]
    : [
        `## Kenapa ${topic} Penting Saat Ini`,
        '## Masalah Umum yang Sering Dialami Pembaca',
        '## Framework Praktis Langkah demi Langkah',
        '## Contoh Kasus Realistis dan Pelajaran Utama',
        '## Kesalahan yang Perlu Dihindari',
        '## Checklist Cepat Sebelum Eksekusi'
      ]

  const sectionAngles = lang === 'en'
    ? [
        'search intent and context relevance',
        'root causes and audience pain points',
        'priority order and execution sequence',
        'measurable indicators and outcome review',
        'risk management and quality control',
        'final validation before publishing'
      ]
    : [
        'intent pencarian dan konteks kebutuhan',
        'akar masalah serta pain point audiens',
        'urutan prioritas dan tahapan eksekusi',
        'indikator terukur serta evaluasi hasil',
        'manajemen risiko dan kontrol kualitas',
        'validasi akhir sebelum dipublikasikan'
      ]

  const lines = []
  const introLine = introHook ||
    (lang === 'en'
      ? `In this guide, we discuss ${topic} in a practical and SEO-friendly way.`
      : `Pada panduan ini, kita membahas ${topic} secara praktis dan SEO-friendly.`)
  lines.push(introLine)
  if (metaDesc) lines.push(metaDesc)

  for (let i = 0; i < sectionTitles.length; i += 1) {
    lines.push(sectionTitles[i])
    lines.push(buildBloggerSectionParagraph(topic, sectionAngles[i], lang))
    lines.push(buildBloggerSectionParagraph(topic, sectionAngles[i], lang))
  }

  lines.push(lang === 'en' ? '## FAQ' : '## FAQ')
  if (lang === 'en') {
    lines.push(`Q1: Is ${topic} suitable for beginners?`)
    lines.push(`A1: Yes, as long as the steps are applied consistently and measured with clear indicators.`)
    lines.push(`Q2: How long does it usually take to see improvement?`)
    lines.push('A2: Most teams can see early improvements in one to four weeks when execution is disciplined.')
    lines.push('Q3: What is the most common mistake?')
    lines.push('A3: Skipping intent analysis and jumping directly to publishing without quality checks.')
  } else {
    lines.push(`Q1: Apakah ${topic} cocok untuk pemula?`)
    lines.push('A1: Cocok, selama langkah diterapkan konsisten dan dievaluasi dengan indikator yang jelas.')
    lines.push('Q2: Berapa lama biasanya terlihat hasil perbaikan?')
    lines.push('A2: Umumnya tim mulai melihat perbaikan awal dalam satu sampai empat minggu dengan eksekusi disiplin.')
    lines.push('Q3: Kesalahan paling umum apa?')
    lines.push('A3: Melewati analisis intent lalu langsung publish tanpa quality check.')
  }

  lines.push(lang === 'en' ? '## Closing' : '## Penutup')
  lines.push(cta)

  let article = lines.filter(Boolean).join('\n\n')
  let safetyCounter = 0
  while (countWords(article) < BLOGGER_ARTICLE_CONTRACT.minWords && safetyCounter < 20) {
    article = `${article}\n\n${buildBloggerSectionParagraph(topic, lang === 'en' ? 'advanced execution notes' : 'catatan eksekusi lanjutan', lang)}`
    safetyCounter += 1
  }
  article = trimToWordLimit(article, BLOGGER_ARTICLE_CONTRACT.maxWords)
  return article
}

function buildSceneNarrator(context, lengthProfile, sourceNarrator, hook, description) {
  const bodySentences = splitSentences(sourceNarrator || description)
  const ranges = buildSceneRanges(lengthProfile.totalSec, lengthProfile.sceneCount)

  const getBodySentence = (idx) => {
    if (bodySentences.length) return bodySentences[idx % bodySentences.length]
    return buildNarratorFallbackLine(context, Math.max(2, idx + 2), lengthProfile.sceneCount, hook, description)
  }

  const lines = []
  for (let i = 0; i < lengthProfile.sceneCount; i += 1) {
    const baseText = i >= 2 && i < lengthProfile.sceneCount - 1
      ? getBodySentence(i - 2)
      : ''
    const clipped = normalizeNarratorSceneText(
      baseText || buildNarratorFallbackLine(context, i, lengthProfile.sceneCount, hook, description),
      context,
      i,
      lengthProfile.sceneCount,
      hook,
      description
    )
    const range = ranges[i]
    lines.push(`Scene ${i + 1} (${range.start}-${range.end}s): ${clipped}`)
  }
  return lines.join('\n')
}

function normalizeNarrator(raw, context, lengthProfile, hook, description) {
  if (isBloggerPlatform(context?.platform)) {
    const contract = validateBloggerArticleContract(raw)
    if (contract.valid) {
      const normalized = trimToWordLimit(raw, BLOGGER_ARTICLE_CONTRACT.maxWords)
      return {
        value: normalized,
        usedFallback: false,
        reason: null,
        sceneCount: 0,
        wordCount: countWords(normalized),
        headingCount: countBloggerHeadings(normalized),
        faqCount: countBloggerFaqItems(normalized)
      }
    }

    const rebuilt = buildBloggerArticle(context, raw, hook, description)
    return {
      value: rebuilt,
      usedFallback: true,
      reason: contract.reason || 'blogger_article_contract_invalid',
      sceneCount: 0,
      wordCount: countWords(rebuilt),
      headingCount: countBloggerHeadings(rebuilt),
      faqCount: countBloggerFaqItems(rebuilt)
    }
  }

  const contract = validateNarratorContract(raw, lengthProfile)
  if (contract.valid) {
    const normalizedScenes = contract.scenes.map((scene, idx) => {
      const nextText = normalizeNarratorSceneText(
        scene.text,
        context,
        idx,
        lengthProfile.sceneCount,
        hook,
        description
      )
      return {
        ...scene,
        text: nextText,
        rewritten: compactSpaces(nextText) !== compactSpaces(scene.text)
      }
    })
    const semantic = validateNarratorSemantics(normalizedScenes)
    if (!semantic.valid) {
      const rebuiltFromSemantic = buildSceneNarrator(context, lengthProfile, raw, hook, description)
      return {
        value: rebuiltFromSemantic,
        usedFallback: true,
        reason: semantic.reason || 'scene_semantic_invalid',
        sceneCount: lengthProfile.sceneCount,
        wordCount: countWords(rebuiltFromSemantic),
        headingCount: 0,
        faqCount: 0
      }
    }

    const normalized = normalizedScenes
      .map((scene) => `Scene ${scene.index} (${scene.start}-${scene.end}s): ${compactSpaces(scene.text)}`)
      .join('\n')
    const semanticRewrite = normalizedScenes.some((scene) => scene.rewritten)
    return {
      value: normalized,
      usedFallback: semanticRewrite,
      reason: semanticRewrite ? 'scene_semantic_rewrite' : null,
      sceneCount: normalizedScenes.length,
      wordCount: countWords(normalized),
      headingCount: 0,
      faqCount: 0
    }
  }

  const rebuilt = buildSceneNarrator(context, lengthProfile, raw, hook, description)
  return {
    value: rebuilt,
    usedFallback: true,
    reason: contract.reason || 'scene_contract_invalid',
    sceneCount: lengthProfile.sceneCount,
    wordCount: countWords(rebuilt),
    headingCount: 0,
    faqCount: 0
  }
}

function detectCtaSignal(text, language) {
  const source = safeString(text).toLowerCase()
  if (!source) return false
  const patterns = language === 'en'
    ? [/save/i, /comment/i, /share/i, /try/i, /learn more/i, /check/i, /reply/i, /react/i, /vote/i, /follow/i, /forward/i]
    : [/simpan/i, /komentar/i, /bagikan/i, /coba/i, /cek/i, /lihat/i, /balas/i, /reaksi/i, /vote/i, /ikuti/i, /forward/i]
  return patterns.some((re) => re.test(source))
}

function getPlatformCtaSentence(platformContract, context) {
  const lang = languageCode(context.language)
  const platform = safeString(platformContract.platform)
  const style = safeString(platformContract.ctaStyle)
  const fromContext = Array.isArray(context.ctaTexts) ? safeString(context.ctaTexts[0]) : ''
  if (fromContext) return fromContext

  if (lang === 'en') {
    if (style === 'reply_debate') return 'Reply with your take so we can compare perspectives.'
    if (style === 'react_forward') return 'React if useful and forward this update to someone who needs it.'
    if (style === 'reply_vote') return 'Reply your choice and vote for the next topic.'
    if (style === 'reply_repost') return 'Reply with your opinion and repost if this resonates.'
    if (style === 'listen_follow') return 'Listen to this track and follow for the next release.'
    if (style === 'read_comment') return 'Read the full post and share your perspective in comments.'
    if (style === 'checkout_comment') return 'Comment your use-case before deciding to checkout.'
    if (style === 'save_pin') return 'Save this pin so you can revisit it later.'
    if (platform === 'WhatsApp Status') return 'Reply if you want the follow-up version.'
    return 'Comment or share if you want the next part.'
  }

  if (style === 'reply_debate') return 'Balas pendapat kamu di komentar agar diskusi lebih tajam.'
  if (style === 'react_forward') return 'Beri reaksi jika bermanfaat, lalu forward seperlunya.'
  if (style === 'reply_vote') return 'Balas pilihan kamu dan vote topik berikutnya.'
  if (style === 'reply_repost') return 'Balas pendapatmu dan repost jika kamu setuju.'
  if (style === 'listen_follow') return 'Dengarkan track ini dan follow untuk rilisan berikutnya.'
  if (style === 'read_comment') return 'Baca versi lengkapnya lalu tulis pendapatmu di komentar.'
  if (style === 'checkout_comment') return 'Komentar kebutuhanmu dulu sebelum checkout.'
  if (style === 'save_pin') return 'Simpan pin ini supaya gampang dicari lagi.'
  if (platform === 'WhatsApp Status') return 'Balas status ini kalau kamu mau versi lanjutan.'
  return 'Komentar atau bagikan jika kamu mau part berikutnya.'
}

function enforceHookByContract(hook, platformContract, context) {
  const fallback = languageCode(context.language) === 'en'
    ? 'Quick insight worth watching.'
    : 'Insight singkat yang layak ditonton.'
  let value = ensureRequiredText(hook, fallback)
  const reasons = []

  const maxChars = clampNumber(platformContract.hookMax, 24, 240, 180)
  const minChars = clampNumber(platformContract.hookMin, 10, maxChars, 18)

  if (value.length > maxChars) {
    value = truncateText(value, maxChars)
    reasons.push('hook_truncated')
  }
  if (value.length < minChars) {
    const topic = safeString(context.topic) || (languageCode(context.language) === 'en' ? 'this topic' : 'topik ini')
    value = languageCode(context.language) === 'en'
      ? `Quick reason why ${topic} matters now.`
      : `Alasan cepat kenapa ${topic} penting sekarang.`
    value = truncateText(value, maxChars)
    reasons.push('hook_rebuilt_min_length')
  }

  return {
    value,
    adjusted: reasons.length > 0,
    reasons
  }
}

function enforceDescriptionByContract(description, platformContract, context) {
  const lang = languageCode(context.language)
  const fallback = lang === 'en'
    ? `Short description for ${platformContract.platform} audience.`
    : `Deskripsi singkat untuk audiens ${platformContract.platform}.`

  if (isBloggerPlatform(platformContract.platform)) {
    const minChars = BLOGGER_ARTICLE_CONTRACT.metaDescriptionMinChars
    const maxChars = BLOGGER_ARTICLE_CONTRACT.metaDescriptionMaxChars
    const topic = safeString(context.topic) || (lang === 'en' ? 'this topic' : 'topik ini')
    const filler = lang === 'en'
      ? ` Practical insights about ${topic} with actionable steps and FAQ.`
      : ` Insight praktis tentang ${topic} lengkap dengan langkah aksi dan FAQ.`

    let value = ensureRequiredText(description, fallback)
    const reasons = []

    if (value.length > maxChars) {
      value = truncateText(value, maxChars)
      reasons.push('meta_description_truncated')
    }
    while (value.length < minChars) {
      value = compactSpaces(`${value}${filler}`)
      reasons.push('meta_description_extended')
      if (value.length > maxChars) {
        value = truncateText(value, maxChars)
        reasons.push('meta_description_truncated')
        if (value.length > maxChars) value = value.slice(0, maxChars).trim()
        break
      }
    }

    if (value.length > maxChars) value = value.slice(0, maxChars).trim()

    return {
      value,
      adjusted: reasons.length > 0,
      reasons
    }
  }

  const maxChars = clampNumber(platformContract.descriptionMaxChars, 80, 480, 260)
  const minSentences = clampNumber(platformContract.descriptionMinSentences, 1, 5, 1)
  const maxSentences = clampNumber(platformContract.descriptionMaxSentences, minSentences, 6, 3)

  let value = ensureRequiredText(description, fallback)
  const reasons = []

  let sentences = splitSentences(value)
  if (!sentences.length) sentences = [fallback]

  if (sentences.length > maxSentences) {
    sentences = sentences.slice(0, maxSentences)
    reasons.push('description_sentence_clamped')
  }
  while (sentences.length < minSentences) {
    sentences.push(lang === 'en' ? 'Keep the message practical and clear.' : 'Pastikan pesannya praktis dan jelas.')
    reasons.push('description_sentence_extended')
  }

  value = compactSpaces(sentences.join(' '))
  if (platformContract.requireCtaInDescription && !detectCtaSignal(value, lang)) {
    value = compactSpaces(`${value} ${getPlatformCtaSentence(platformContract, context)}`)
    reasons.push('description_cta_appended')
  }
  if (value.length > maxChars) {
    value = truncateText(value, maxChars)
    reasons.push('description_truncated')
  }

  return {
    value,
    adjusted: reasons.length > 0,
    reasons
  }
}

function scoreHookPotential(hook) {
  const text = safeString(hook)
  const len = text.length
  const hasTrigger = /(cara|review|tips|cek|kenapa|before|after|vs|worth|how|why|what)/i.test(text)
  const hasQuestion = /[?]/.test(text)
  let awarded = 16
  let status = 'retry'
  if (len >= 30 && len <= 150) {
    awarded = hasTrigger ? 28 : 25
    status = 'pass'
  } else if (len >= 18 && len <= 180) {
    awarded = hasTrigger ? 24 : 22
    status = 'fallback'
  }
  if (hasQuestion && awarded < 30) awarded += 2
  return {
    id: 'hook_strength',
    label: 'Hook strength',
    weight: 30,
    awarded: Math.min(30, awarded),
    status,
    note: status === 'pass' ? 'Hook cukup kuat untuk menarik perhatian awal' : 'Hook perlu dipertajam agar lebih kuat'
  }
}

function scoreBloggerArticleDepth(narratorRes) {
  const words = Number(narratorRes?.wordCount || 0)
  let awarded = 12
  let status = 'retry'
  if (words >= BLOGGER_ARTICLE_CONTRACT.targetMinWords && words <= BLOGGER_ARTICLE_CONTRACT.targetMaxWords) {
    awarded = 25
    status = 'pass'
  } else if (words >= BLOGGER_ARTICLE_CONTRACT.minWords && words <= BLOGGER_ARTICLE_CONTRACT.maxWords) {
    awarded = 21
    status = 'fallback'
  } else if (words >= Math.max(500, BLOGGER_ARTICLE_CONTRACT.minWords - 200)) {
    awarded = 17
    status = 'fallback'
  }
  return {
    id: 'article_depth',
    label: 'Article depth readiness',
    weight: 25,
    awarded,
    status,
    note: `Word count ${words} (target ${BLOGGER_ARTICLE_CONTRACT.targetMinWords}-${BLOGGER_ARTICLE_CONTRACT.targetMaxWords})`
  }
}

function scoreBloggerReadability(narratorRes) {
  const headingCount = Number(narratorRes?.headingCount || 0)
  const faqCount = Number(narratorRes?.faqCount || 0)
  let awarded = 8
  let status = 'retry'
  if (headingCount >= BLOGGER_ARTICLE_CONTRACT.minHeadings && faqCount >= BLOGGER_ARTICLE_CONTRACT.minFaqItems) {
    awarded = 15
    status = 'pass'
  } else if (headingCount >= 3 && faqCount >= 2) {
    awarded = 12
    status = 'fallback'
  }
  return {
    id: 'readability_structure',
    label: 'Readability structure',
    weight: 15,
    awarded,
    status,
    note: `Heading ${headingCount}, FAQ ${faqCount}`
  }
}

function scoreScriptRetention(narratorRes, lengthProfile) {
  let awarded = 14
  let status = 'retry'
  if (narratorRes.sceneCount === lengthProfile.sceneCount && !narratorRes.usedFallback) {
    awarded = 25
    status = 'pass'
  } else if (narratorRes.sceneCount === lengthProfile.sceneCount) {
    awarded = 21
    status = 'fallback'
  } else if (narratorRes.sceneCount >= Math.max(2, lengthProfile.sceneCount - 1)) {
    awarded = 18
    status = 'fallback'
  }
  return {
    id: 'script_retention',
    label: 'Script retention readiness',
    weight: 25,
    awarded,
    status,
    note: narratorRes.usedFallback
      ? 'Scene script ditata ulang agar sesuai pacing'
      : 'Pacing scene sudah selaras dengan durasi konten'
  }
}

function scoreTrendFit(hashtags, keywordsCount, platformContract) {
  const minTag = clampNumber(platformContract?.hashtagMin, 0, 12, 3)
  const maxTag = clampNumber(platformContract?.hashtagMax, minTag, 12, 8)
  const tagCount = Array.isArray(hashtags) ? hashtags.length : 0
  const inRange = tagCount >= minTag && tagCount <= maxTag
  let awarded = 10
  let status = 'retry'
  if (inRange && keywordsCount >= 2) {
    awarded = 20
    status = 'pass'
  } else if (inRange) {
    awarded = 17
    status = 'fallback'
  } else if (tagCount > maxTag) {
    awarded = 15
    status = 'fallback'
  } else if (tagCount >= Math.max(1, minTag - 1)) {
    awarded = 16
    status = 'fallback'
  }
  return {
    id: 'trend_fit',
    label: 'Trend-fit signal',
    weight: 20,
    awarded,
    status,
    note: `Hashtag ${tagCount} item (target ${minTag}-${maxTag}), keyword ${keywordsCount} item`
  }
}

function scoreAudioVisualFit(audioRes, lengthProfile) {
  const diff = Math.abs(Number(audioRes.lengthSec || 0) - Number(lengthProfile.totalSec || 0))
  let awarded = 9
  let status = 'retry'
  if (!audioRes.usedFallback && diff <= 5) {
    awarded = 15
    status = 'pass'
  } else if (diff <= 10) {
    awarded = 12
    status = 'fallback'
  }
  return {
    id: 'audio_visual_fit',
    label: 'Audio-visual fit',
    weight: 15,
    awarded,
    status,
    note: `Selisih durasi audio terhadap target ${diff}s`
  }
}

function scoreCtaClarity(context, description, narrator) {
  const lang = languageCode(context.language)
  const explicitCta = Array.isArray(context.ctaTexts) ? safeString(context.ctaTexts[0]) : ''
  const fromScript = detectCtaSignal(`${description}\n${narrator}`, lang)
  let awarded = 5
  let status = 'retry'
  if (explicitCta.length >= 8 && explicitCta.length <= 100) {
    awarded = 10
    status = 'pass'
  } else if (fromScript) {
    awarded = 7
    status = 'fallback'
  }
  return {
    id: 'cta_clarity',
    label: 'CTA clarity',
    weight: 10,
    awarded,
    status,
    note: explicitCta ? 'CTA dari template/payload tersedia' : 'CTA diambil dari narasi/deskripsi'
  }
}

function buildComplianceChecks({ structurePass, audioRes, narratorRes, forbiddenHits, riskyHits, scamHits, hashtagsRes, lengthProfile, platformContract, description, bloggerPublishPack = null }) {
  if (isBloggerPlatform(platformContract?.platform)) {
    const checks = []
    const articleWords = Number(narratorRes?.wordCount || 0)
    const headingCount = Number(narratorRes?.headingCount || 0)
    const faqCount = Number(narratorRes?.faqCount || 0)
    const articlePass =
      articleWords >= BLOGGER_ARTICLE_CONTRACT.minWords &&
      articleWords <= BLOGGER_ARTICLE_CONTRACT.maxWords

    checks.push({
      id: 'article',
      label: 'Article compliance',
      weight: 40,
      awarded: articlePass ? (narratorRes.usedFallback ? 32 : 40) : 22,
      status: articlePass ? (narratorRes.usedFallback ? 'fallback' : 'pass') : 'retry',
      note: `Word ${articleWords}, heading ${headingCount}, faq ${faqCount}`
    })

    const metaLen = safeString(description).length
    const metaPass =
      metaLen >= BLOGGER_ARTICLE_CONTRACT.metaDescriptionMinChars &&
      metaLen <= BLOGGER_ARTICLE_CONTRACT.metaDescriptionMaxChars

    const internalCount = Array.isArray(bloggerPublishPack?.internalLinks) ? bloggerPublishPack.internalLinks.length : 0
    const externalCount = Array.isArray(bloggerPublishPack?.externalReferences) ? bloggerPublishPack.externalReferences.length : 0

    checks.push({
      id: 'meta',
      label: 'Meta description compliance',
      weight: 20,
      awarded: metaPass ? 20 : 12,
      status: metaPass ? 'pass' : 'fallback',
      note: `Meta ${metaLen} chars · Internal links ${internalCount} · External refs ${externalCount}`
    })

    let safetyAwarded = 12
    let safetyStatus = 'retry'
    if (forbiddenHits === 0 && riskyHits === 0) {
      safetyAwarded = 25
      safetyStatus = 'pass'
    } else if (scamHits > 0) {
      safetyAwarded = 8
      safetyStatus = 'block'
    } else if (forbiddenHits + riskyHits <= 2) {
      safetyAwarded = 18
      safetyStatus = 'fallback'
    }
    checks.push({
      id: 'safety',
      label: 'Safety compliance',
      weight: 25,
      awarded: safetyAwarded,
      status: safetyStatus,
      note: `Forbidden ${forbiddenHits}, risky ${riskyHits}, scam ${scamHits}`
    })

    const tagCount = Array.isArray(hashtagsRes.hashtags) ? hashtagsRes.hashtags.length : 0
    const minTag = clampNumber(platformContract?.hashtagMin, 0, 12, hashtagsRes.minCount || 0)
    const maxTag = clampNumber(platformContract?.hashtagMax, minTag, 12, hashtagsRes.maxCount || 12)
    const inRange = hashtagsRes.inRange !== false
    let labelAwarded = 9
    let labelStatus = 'retry'
    if (inRange && !hashtagsRes.usedFallback && hashtagsRes.removedCount === 0 && hashtagsRes.addedCount === 0) {
      labelAwarded = 15
      labelStatus = 'pass'
    } else if (inRange) {
      labelAwarded = 12
      labelStatus = 'fallback'
    }
    checks.push({
      id: 'labels',
      label: 'Label/hashtag compliance',
      weight: 15,
      awarded: labelAwarded,
      status: labelStatus,
      note: `${tagCount} label (target ${minTag}-${maxTag}), removed ${hashtagsRes.removedCount || 0}, added ${hashtagsRes.addedCount || 0}`
    })

    return checks
  }

  const checks = []

  checks.push({
    id: 'audio',
    label: 'Audio compliance',
    weight: 25,
    awarded: audioRes.usedFallback ? 16 : 25,
    status: audioRes.usedFallback ? 'fallback' : 'pass',
    note: audioRes.usedFallback
      ? `Audio di-rewrite ke kontrak 5 field (${audioRes.reason || 'normalisasi'})`
      : 'Audio sudah memenuhi kontrak 5 field'
  })

  let scriptAwarded = 12
  let scriptStatus = 'retry'
  if (structurePass && narratorRes.sceneCount === lengthProfile.sceneCount && !narratorRes.usedFallback) {
    scriptAwarded = 30
    scriptStatus = 'pass'
  } else if (structurePass && narratorRes.sceneCount === lengthProfile.sceneCount) {
    scriptAwarded = 24
    scriptStatus = 'fallback'
  } else if (structurePass) {
    scriptAwarded = 20
    scriptStatus = 'fallback'
  }

  checks.push({
    id: 'script',
    label: 'Script compliance',
    weight: 30,
    awarded: scriptAwarded,
    status: scriptStatus,
    note: narratorRes.usedFallback
      ? 'Narrator di-rewrite ke format Scene-by-length'
      : `Scene lengkap (${narratorRes.sceneCount}/${lengthProfile.sceneCount})`
  })

  let safetyAwarded = 12
  let safetyStatus = 'retry'
  if (forbiddenHits === 0 && riskyHits === 0) {
    safetyAwarded = 25
    safetyStatus = 'pass'
  } else if (scamHits > 0) {
    safetyAwarded = 8
    safetyStatus = 'block'
  } else if (forbiddenHits + riskyHits <= 2) {
    safetyAwarded = 18
    safetyStatus = 'fallback'
  }

  checks.push({
    id: 'safety',
    label: 'Safety compliance',
    weight: 25,
    awarded: safetyAwarded,
    status: safetyStatus,
    note: `Forbidden ${forbiddenHits}, risky ${riskyHits}, scam ${scamHits}`
  })

  const tagCount = Array.isArray(hashtagsRes.hashtags) ? hashtagsRes.hashtags.length : 0
  const minTag = clampNumber(platformContract?.hashtagMin, 0, 12, hashtagsRes.minCount || 0)
  const maxTag = clampNumber(platformContract?.hashtagMax, minTag, 12, hashtagsRes.maxCount || 12)
  const inRange = hashtagsRes.inRange !== false

  let hashtagAwarded = 12
  let hashtagStatus = 'retry'
  if (inRange && !hashtagsRes.usedFallback && hashtagsRes.removedCount === 0 && hashtagsRes.addedCount === 0) {
    hashtagAwarded = 20
    hashtagStatus = 'pass'
  } else if (inRange && !hashtagsRes.usedFallback) {
    hashtagAwarded = 17
    hashtagStatus = 'fallback'
  } else if (inRange) {
    hashtagAwarded = 15
    hashtagStatus = 'fallback'
  }

  checks.push({
    id: 'hashtag',
    label: 'Hashtag compliance',
    weight: 20,
    awarded: hashtagAwarded,
    status: hashtagStatus,
    note: `${tagCount} hashtag (target ${minTag}-${maxTag}), removed ${hashtagsRes.removedCount || 0}, added ${hashtagsRes.addedCount || 0}`
  })

  return checks
}

function buildPerformanceChecks({ hook, narratorRes, lengthProfile, hashtags, keywordsCount, audioRes, context, description, narrator, platformContract }) {
  if (isBloggerPlatform(platformContract?.platform)) {
    return [
      scoreHookPotential(hook),
      scoreBloggerArticleDepth(narratorRes),
      scoreTrendFit(hashtags, keywordsCount, platformContract),
      scoreBloggerReadability(narratorRes),
      scoreCtaClarity(context, description, narrator)
    ]
  }
  return [
    scoreHookPotential(hook),
    scoreScriptRetention(narratorRes, lengthProfile),
    scoreTrendFit(hashtags, keywordsCount, platformContract),
    scoreAudioVisualFit(audioRes, lengthProfile),
    scoreCtaClarity(context, description, narrator)
  ]
}

function decideAiStatus({ complianceScore, potentialScore, forbiddenHits, scamHits, riskyHits }) {
  const reasons = []
  const criticalSafety = scamHits > 0 || forbiddenHits >= 3 || riskyHits >= 6

  if (criticalSafety) {
    reasons.push('Safety risk terdeteksi, wajib perbaikan sebelum publish.')
    return { status: 'BLOCK', reasons }
  }

  if (complianceScore < 85) {
    reasons.push(`Compliance ${complianceScore} masih di bawah ambang 85.`)
  }
  if (potentialScore < 60) {
    reasons.push(`Performance potential ${potentialScore} masih di bawah ambang 60.`)
  }
  if (reasons.length) return { status: 'REVISE', reasons }

  reasons.push('Konten lolos compliance dan punya potensi performa yang baik.')
  return { status: 'GO', reasons }
}

function computeFinalScore({ complianceScore, potentialScore, aiDecision }) {
  const base = (Number(complianceScore || 0) * 0.6) + (Number(potentialScore || 0) * 0.4)
  if (aiDecision === 'BLOCK') return round1(Math.min(base, 49))
  if (aiDecision === 'REVISE') return round1(Math.min(base, 79))
  return round1(base)
}

function resolvePerformanceConfidence(complianceScore, potentialScore, decision) {
  if (decision === 'BLOCK') return 'low'
  if (potentialScore >= 80 && complianceScore >= 85) return 'high'
  if (potentialScore >= 60) return 'medium'
  return 'low'
}

function mapLegacyQualityGate({ decision, hasFallback, hasRetrySignal }) {
  if (decision === 'BLOCK') return 'block'
  if (hasFallback) return 'fallback'
  if (hasRetrySignal) return 'retry'
  return 'pass'
}

function ensureRequiredText(value, fallback) {
  const text = compactSpaces(value)
  if (text) return text
  return compactSpaces(fallback)
}

export function applyGenerationQualityGuardrails(result, context = {}) {
  const base = result && typeof result === 'object' ? result : {}
  const platform = safeString(context.platform || base.platform || base.meta?.platform || 'TikTok')
  const language = safeString(context.language || base.language || base.meta?.language || 'Indonesia')
  const tone = safeString(context.tone || base.meta?.tone || base.tone || '')
  const topic = safeString(context.topic || base.topic || base.meta?.topic || '')
  const constraintsForbiddenWords = Array.isArray(context.constraintsForbiddenWords) ? context.constraintsForbiddenWords : []
  const forbiddenTerms = buildForbiddenTerms({ platform, constraintsForbiddenWords })
  const lengthProfile = resolveLengthProfile(context)
  const platformContract = resolvePlatformContract(platform)

  const runtimeContext = {
    ...context,
    platform,
    language,
    tone,
    topic,
    forbiddenTerms,
    platformContract
  }

  const sanitized = { ...base }

  const titleClean = sanitizeSafeText(sanitized.title, forbiddenTerms)
  const hookClean = sanitizeSafeText(sanitized.hook, forbiddenTerms)
  const narratorClean = sanitizeSafeMultilineText(sanitized.narrator, forbiddenTerms)
  const descriptionClean = sanitizeSafeText(sanitized.description, forbiddenTerms)

  sanitized.title = ensureRequiredText(titleClean.text, `${platform} Content`)
  sanitized.hook = ensureRequiredText(
    hookClean.text,
    languageCode(language) === 'en' ? 'Quick insight worth watching.' : 'Insight singkat yang layak ditonton.'
  )
  sanitized.description = ensureRequiredText(
    descriptionClean.text,
    languageCode(language) === 'en'
      ? `Short description for ${platform} audience.`
      : `Deskripsi singkat untuk audiens ${platform}.`
  )

  const hookContractRes = enforceHookByContract(sanitized.hook, platformContract, runtimeContext)
  sanitized.hook = hookContractRes.value

  const descriptionContractRes = enforceDescriptionByContract(sanitized.description, platformContract, runtimeContext)
  sanitized.description = descriptionContractRes.value

  const narratorSeed = ensureRequiredText(
    narratorClean.text,
    isBloggerPlatform(platform)
      ? (languageCode(language) === 'en'
          ? 'Write a complete SEO-friendly blog article with headings and FAQ.'
          : 'Tulis artikel blog SEO-friendly yang lengkap dengan heading dan FAQ.')
      : (languageCode(language) === 'en'
          ? 'Explain the key point in a concise scene-by-scene flow.'
          : 'Jelaskan poin utama dalam alur scene yang ringkas.')
  )

  const narratorRes = normalizeNarrator(
    narratorSeed,
    runtimeContext,
    lengthProfile,
    sanitized.hook,
    sanitized.description
  )
  sanitized.narrator = narratorRes.value

  const hashtagsRes = sanitizeHashtags(sanitized.hashtags, { platform, forbiddenTerms, platformContract })
  sanitized.hashtags = hashtagsRes.hashtags

  const audioRes = normalizeAudioRecommendation(sanitized.audioRecommendation, runtimeContext, lengthProfile)
  sanitized.audioRecommendation = audioRes.value

  let bloggerPublishPack = null
  if (isBloggerPlatform(platform)) {
    bloggerPublishPack = normalizeBloggerPublishPack({
      slug: sanitized.slug,
      internalLinks: sanitized.internalLinks,
      externalReferences: sanitized.externalReferences,
      featuredSnippet: sanitized.featuredSnippet,
      title: sanitized.title
    }, runtimeContext)
    sanitized.slug = bloggerPublishPack.slug
    sanitized.internalLinks = bloggerPublishPack.internalLinks
    sanitized.externalReferences = bloggerPublishPack.externalReferences
    const snippetClean = sanitizeSafeText(bloggerPublishPack.featuredSnippet, forbiddenTerms)
    sanitized.featuredSnippet = normalizeBloggerFeaturedSnippet(snippetClean.text, runtimeContext)
  }

  const forbiddenHits =
    titleClean.forbiddenHits +
    hookClean.forbiddenHits +
    narratorClean.forbiddenHits +
    descriptionClean.forbiddenHits +
    audioRes.forbiddenHits

  const spamHits =
    titleClean.spamHits +
    hookClean.spamHits +
    narratorClean.spamHits +
    descriptionClean.spamHits +
    audioRes.spamHits

  const scamHits =
    titleClean.scamHits +
    hookClean.scamHits +
    narratorClean.scamHits +
    descriptionClean.scamHits +
    audioRes.scamHits

  const suspenseHits =
    titleClean.suspenseHits +
    hookClean.suspenseHits +
    narratorClean.suspenseHits +
    descriptionClean.suspenseHits +
    audioRes.suspenseHits

  const riskyHits = spamHits + scamHits + suspenseHits
  const structurePass =
    safeString(sanitized.title).length > 0 &&
    safeString(sanitized.hook).length > 0 &&
    safeString(sanitized.narrator).length > 0 &&
    safeString(sanitized.description).length > 0

  const complianceChecks = buildComplianceChecks({
    structurePass,
    audioRes,
    narratorRes,
    forbiddenHits,
    riskyHits,
    scamHits,
    hashtagsRes,
    lengthProfile,
    platformContract,
    description: sanitized.description,
    bloggerPublishPack
  })
  const complianceScore = complianceChecks.reduce((acc, check) => acc + Number(check.awarded || 0), 0)

  const keywordsCount = Array.isArray(context.keywords) ? context.keywords.filter((x) => safeString(x)).length : 0
  const performanceChecks = buildPerformanceChecks({
    hook: sanitized.hook,
    narratorRes,
    lengthProfile,
    hashtags: sanitized.hashtags,
    keywordsCount,
    audioRes,
    context,
    description: sanitized.description,
    narrator: sanitized.narrator,
    platformContract
  })
  const performancePotentialScore = performanceChecks.reduce((acc, check) => acc + Number(check.awarded || 0), 0)

  const aiDecision = decideAiStatus({
    complianceScore,
    potentialScore: performancePotentialScore,
    forbiddenHits,
    scamHits,
    riskyHits
  })
  const finalScore = computeFinalScore({
    complianceScore,
    potentialScore: performancePotentialScore,
    aiDecision: aiDecision.status
  })

  const hasFallbackSignal =
    audioRes.usedFallback ||
    narratorRes.usedFallback ||
    hashtagsRes.usedFallback ||
    hookContractRes.adjusted ||
    descriptionContractRes.adjusted ||
    hashtagsRes.contractAdjusted ||
    !!bloggerPublishPack?.adjusted
  const hasRetrySignal = forbiddenHits > 0 || riskyHits > 0 || hashtagsRes.removedCount > 0 || hashtagsRes.inRange === false
  const qualityGate = mapLegacyQualityGate({
    decision: aiDecision.status,
    hasFallback: hasFallbackSignal,
    hasRetrySignal
  })

  const performanceConfidence = resolvePerformanceConfidence(
    complianceScore,
    performancePotentialScore,
    aiDecision.status
  )

  const existingWarnings = Array.isArray(base.meta?.warnings) ? base.meta.warnings : []
  const extraWarnings = []
  if (audioRes.usedFallback && !isBloggerPlatform(platform)) {
    extraWarnings.push('Audio dinormalisasi ke format 5 field agar konsisten.')
  }
  if (narratorRes.usedFallback) {
    extraWarnings.push(
      isBloggerPlatform(platform)
        ? 'Artikel dinormalisasi ke kontrak SEO Blogger (word count + heading + FAQ).'
        : 'Narrator dinormalisasi ke format Scene-by-length.'
    )
  }
  if (hookContractRes.adjusted) extraWarnings.push('Hook disesuaikan dengan kontrak platform.')
  if (descriptionContractRes.adjusted) extraWarnings.push('Deskripsi disesuaikan dengan kontrak platform.')
  if (forbiddenHits > 0) extraWarnings.push('Kata terlarang dibersihkan otomatis.')
  if (riskyHits > 0) extraWarnings.push('Pola spam/scam/suspense dibersihkan otomatis.')
  if (hashtagsRes.removedCount > 0 || hashtagsRes.usedFallback || hashtagsRes.contractAdjusted) {
    extraWarnings.push('Hashtag berisiko dibersihkan sesuai policy platform.')
  }
  if (audioRes.reason === 'blogger_audio_removed') {
    extraWarnings.push('Audio dihapus karena mode Blog Blogger bersifat text-first.')
  }
  if (bloggerPublishPack?.adjusted) {
    extraWarnings.push('Publish pack Blogger (slug/link/snippet) dinormalisasi agar siap publish.')
  }
  if (aiDecision.status === 'REVISE') extraWarnings.push('AI decision: REVISE sebelum publish.')
  if (aiDecision.status === 'BLOCK') extraWarnings.push('AI decision: BLOCK karena risiko tinggi.')
  const warnings = uniqueCaseInsensitive([...existingWarnings, ...extraWarnings])

  sanitized.meta = {
    ...(base.meta || {}),
    platform,
    language,
    tone,
    qualityScore: complianceScore,
    qualityChecks: complianceChecks,
    qualityGate,
    qualityVersion: 'v3-platform-contract',
    complianceScore,
    complianceChecks,
    performancePotentialScore,
    performanceChecks,
    performanceConfidence,
    aiDecision,
    finalScore,
    scoreModel: 'gate-v1',
    scoreVersion: 'v3-gate-platform',
    platformContract: {
      stage: platformContract.stage,
      hookRange: [platformContract.hookMin, platformContract.hookMax],
      descriptionSentences: [platformContract.descriptionMinSentences, platformContract.descriptionMaxSentences],
      hashtagRange: [platformContract.hashtagMin, platformContract.hashtagMax],
      requireCtaInDescription: !!platformContract.requireCtaInDescription,
      ctaStyle: platformContract.ctaStyle,
      articleWordRange: isBloggerPlatform(platform)
        ? [BLOGGER_ARTICLE_CONTRACT.minWords, BLOGGER_ARTICLE_CONTRACT.maxWords]
        : null,
      articleTargetWords: isBloggerPlatform(platform)
        ? [BLOGGER_ARTICLE_CONTRACT.targetMinWords, BLOGGER_ARTICLE_CONTRACT.targetMaxWords]
        : null,
      metaDescriptionChars: isBloggerPlatform(platform)
        ? [BLOGGER_ARTICLE_CONTRACT.metaDescriptionMinChars, BLOGGER_ARTICLE_CONTRACT.metaDescriptionMaxChars]
        : null,
      publishPackRequired: isBloggerPlatform(platform) ? true : null
    },
    platformContractAdjustments: {
      hookAdjusted: hookContractRes.adjusted,
      descriptionAdjusted: descriptionContractRes.adjusted,
      hashtagAdjusted: !!hashtagsRes.contractAdjusted,
      hashtagRemoved: Number(hashtagsRes.removedCount || 0),
      hashtagAdded: Number(hashtagsRes.addedCount || 0),
      slugAdjusted: !!(bloggerPublishPack?.reasons || []).find((reason) => reason === 'slug_normalized'),
      internalLinksAdjusted: !!(bloggerPublishPack?.reasons || []).find((reason) => reason === 'internal_links_fallback'),
      externalReferencesAdjusted: !!(bloggerPublishPack?.reasons || []).find((reason) => reason === 'external_references_fallback'),
      featuredSnippetAdjusted: !!(bloggerPublishPack?.reasons || []).find((reason) => reason === 'featured_snippet_adjusted')
    },
    qualitySummary: {
      forbiddenHitsRemoved: forbiddenHits,
      spamHitsRemoved: spamHits,
      scamHitsRemoved: scamHits,
      suspenseHitsRemoved: suspenseHits,
      removedHashtags: hashtagsRes.removedCount,
      addedHashtags: hashtagsRes.addedCount || 0,
      audioFallbackApplied: audioRes.usedFallback,
      narratorFallbackApplied: narratorRes.usedFallback,
      narratorWordCount: Number(narratorRes.wordCount || 0),
      narratorHeadingCount: Number(narratorRes.headingCount || 0),
      narratorFaqCount: Number(narratorRes.faqCount || 0),
      bloggerSlug: sanitized.slug || null,
      bloggerInternalLinks: Array.isArray(sanitized.internalLinks) ? sanitized.internalLinks.length : 0,
      bloggerExternalReferences: Array.isArray(sanitized.externalReferences) ? sanitized.externalReferences.length : 0,
      hookContractAdjusted: hookContractRes.adjusted,
      descriptionContractAdjusted: descriptionContractRes.adjusted
    },
    bloggerPublishPack: isBloggerPlatform(platform)
      ? {
          slug: sanitized.slug || null,
          internalLinks: Array.isArray(sanitized.internalLinks) ? sanitized.internalLinks : [],
          externalReferences: Array.isArray(sanitized.externalReferences) ? sanitized.externalReferences : [],
          featuredSnippet: safeString(sanitized.featuredSnippet)
        }
      : null,
    warnings
  }

  return sanitized
}

export default applyGenerationQualityGuardrails
