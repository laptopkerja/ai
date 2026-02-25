function safeString(value) {
  return String(value || '').trim()
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const CANONICAL_PLATFORMS = [
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

export const DEFAULT_PLATFORM_OUTPUT_CONTRACT = {
  hookMin: 18,
  hookMax: 180,
  descriptionMinSentences: 1,
  descriptionMaxSentences: 3,
  descriptionMaxChars: 260,
  hashtagMin: 3,
  hashtagMax: 8,
  requireCtaInDescription: false,
  ctaStyle: 'soft',
  stage: 2
}

export const PLATFORM_OUTPUT_CONTRACTS = {
  TikTok: {
    hookMax: 130,
    hashtagMin: 4,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'comment_share_save',
    stage: 1
  },
  'Instagram Reels': {
    hookMax: 140,
    hashtagMin: 4,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'comment_share',
    stage: 1
  },
  'YouTube Short': {
    hookMax: 140,
    hashtagMin: 3,
    hashtagMax: 7,
    requireCtaInDescription: true,
    ctaStyle: 'comment_follow',
    stage: 1
  },
  Threads: {
    hookMax: 170,
    descriptionMaxSentences: 4,
    descriptionMaxChars: 320,
    hashtagMin: 0,
    hashtagMax: 3,
    requireCtaInDescription: true,
    ctaStyle: 'reply_debate',
    stage: 1
  },
  'YouTube Long': {
    hookMax: 180,
    descriptionMaxSentences: 4,
    descriptionMaxChars: 360,
    hashtagMin: 2,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'watch_comment',
    stage: 2
  },
  'Facebook Reels': {
    hookMax: 150,
    hashtagMin: 3,
    hashtagMax: 7,
    requireCtaInDescription: true,
    ctaStyle: 'comment_share',
    stage: 2
  },
  'WhatsApp Status': {
    hookMax: 120,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 180,
    hashtagMin: 0,
    hashtagMax: 2,
    requireCtaInDescription: false,
    ctaStyle: 'reply_contact',
    stage: 2
  },
  'WhatsApp Channel': {
    hookMax: 120,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 170,
    hashtagMin: 0,
    hashtagMax: 1,
    requireCtaInDescription: true,
    ctaStyle: 'react_forward',
    stage: 2
  },
  Telegram: {
    hookMax: 135,
    descriptionMaxSentences: 3,
    descriptionMaxChars: 240,
    hashtagMin: 0,
    hashtagMax: 3,
    requireCtaInDescription: true,
    ctaStyle: 'reply_vote',
    stage: 2
  },
  Shopee: {
    hookMax: 130,
    hashtagMin: 3,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'checkout_comment',
    stage: 2
  },
  Tokopedia: {
    hookMax: 130,
    hashtagMin: 3,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'checkout_comment',
    stage: 2
  },
  Lazada: {
    hookMax: 130,
    hashtagMin: 3,
    hashtagMax: 8,
    requireCtaInDescription: true,
    ctaStyle: 'checkout_comment',
    stage: 2
  },
  Pinterest: {
    hookMax: 150,
    hashtagMin: 2,
    hashtagMax: 6,
    requireCtaInDescription: false,
    ctaStyle: 'save_pin',
    stage: 2
  },
  LinkedIn: {
    hookMax: 170,
    descriptionMaxSentences: 4,
    descriptionMaxChars: 340,
    hashtagMin: 1,
    hashtagMax: 5,
    requireCtaInDescription: true,
    ctaStyle: 'comment_follow',
    stage: 2
  },
  'X (Twitter)': {
    hookMax: 120,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 240,
    hashtagMin: 0,
    hashtagMax: 3,
    requireCtaInDescription: true,
    ctaStyle: 'reply_repost',
    stage: 2
  },
  SoundCloud: {
    hookMax: 130,
    descriptionMaxSentences: 3,
    descriptionMaxChars: 260,
    hashtagMin: 2,
    hashtagMax: 6,
    requireCtaInDescription: true,
    ctaStyle: 'listen_follow',
    stage: 2
  },
  'Blog Blogger': {
    hookMax: 180,
    descriptionMinSentences: 1,
    descriptionMaxSentences: 2,
    descriptionMaxChars: 180,
    hashtagMin: 0,
    hashtagMax: 4,
    requireCtaInDescription: false,
    ctaStyle: 'read_comment',
    stage: 2
  }
}

export const PLATFORM_ALLOWED_LENGTH = {
  TikTok: ['short', 'medium'],
  'Instagram Reels': ['short', 'medium'],
  'YouTube Short': ['short', 'medium'],
  Threads: ['short', 'medium'],
  'YouTube Long': ['medium', 'long'],
  'Facebook Reels': ['short', 'medium'],
  'WhatsApp Status': ['short'],
  'WhatsApp Channel': ['short', 'medium'],
  Telegram: ['short', 'medium', 'long'],
  Shopee: ['short', 'medium'],
  Tokopedia: ['short', 'medium'],
  Lazada: ['short', 'medium'],
  LinkedIn: ['short', 'medium', 'long'],
  'X (Twitter)': ['short', 'medium'],
  SoundCloud: ['short', 'medium'],
  'Blog Blogger': ['medium', 'long'],
  Pinterest: ['short', 'medium']
}

export const BLOGGER_SEO_CONTRACT = {
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

export function resolvePlatformOutputContract(platform) {
  const normalizedPlatform = safeString(platform)
  const specific = PLATFORM_OUTPUT_CONTRACTS[normalizedPlatform] || null
  const merged = {
    ...DEFAULT_PLATFORM_OUTPUT_CONTRACT,
    ...(specific || {})
  }
  const hashtagMin = clampNumber(merged.hashtagMin, 0, 12, DEFAULT_PLATFORM_OUTPUT_CONTRACT.hashtagMin)
  const hashtagMax = clampNumber(merged.hashtagMax, hashtagMin, 12, DEFAULT_PLATFORM_OUTPUT_CONTRACT.hashtagMax)
  const stage = clampNumber(merged.stage, 1, 2, DEFAULT_PLATFORM_OUTPUT_CONTRACT.stage)
  return {
    ...merged,
    platform: normalizedPlatform || '',
    supported: !!specific,
    hashtagMin,
    hashtagMax,
    stage
  }
}

export function resolvePlatformAllowedLength(platform) {
  const normalizedPlatform = safeString(platform)
  const lengths = PLATFORM_ALLOWED_LENGTH[normalizedPlatform]
  return Array.isArray(lengths) && lengths.length ? lengths : ['short', 'medium', 'long']
}

export function normalizeCtaStyleForPrompt(ctaStyle) {
  const style = safeString(ctaStyle || 'soft')
  return style.replace(/_/g, '/')
}
