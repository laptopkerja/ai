function safeString(value) {
  return String(value || '').trim()
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function countSentences(text) {
  const source = safeString(text)
  if (!source) return 0
  return source
    .split(/(?<=[.!?])\s+/)
    .map((x) => safeString(x))
    .filter(Boolean)
    .length
}

const DEFAULT_PLATFORM_OUTPUT_CONTRACT = {
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

const PLATFORM_OUTPUT_CONTRACTS = {
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
  }
}

const PLATFORM_ALLOWED_LENGTH = {
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

const CTA_STYLE_HINTS = {
  comment_share_save: ['comment', 'komentar', 'share', 'bagikan', 'save', 'simpan'],
  comment_share: ['comment', 'komentar', 'share', 'bagikan'],
  comment_follow: ['comment', 'komentar', 'follow', 'ikuti'],
  reply_debate: ['reply', 'balas', 'pendapat', 'diskusi'],
  watch_comment: ['watch', 'tonton', 'comment', 'komentar'],
  reply_contact: ['reply', 'balas', 'kontak'],
  react_forward: ['react', 'reaksi', 'forward', 'bagikan'],
  reply_vote: ['reply', 'balas', 'vote', 'poll'],
  reply_repost: ['reply', 'balas', 'repost', 'retweet'],
  listen_follow: ['listen', 'dengar', 'follow', 'stream'],
  read_comment: ['read', 'baca', 'comment', 'komentar'],
  checkout_comment: ['checkout', 'check out', 'komentar', 'comment'],
  save_pin: ['save', 'simpan', 'pin']
}

const TARGET_AUDIO_SEC_BY_LENGTH = {
  short: 30,
  medium: 45,
  long: 60
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
  return {
    ...merged,
    platform: normalizedPlatform || '',
    supported: !!specific,
    hashtagMin,
    hashtagMax,
    stage: Number(specific?.stage || merged.stage || 2)
  }
}

export default function lintPresetAgainstPlatformContract(preset) {
  const payload = preset && typeof preset === 'object' ? preset : {}
  const platform = safeString(payload.platform)
  const contract = resolvePlatformOutputContract(platform)
  const errors = []
  const warnings = []
  const checks = []

  checks.push({ key: 'Platform supported', ok: contract.supported })
  if (!platform) {
    errors.push('Platform wajib diisi.')
  } else if (!contract.supported) {
    errors.push(`Platform "${platform}" belum didukung kontrak output.`)
  }

  const hashtagCount = Number(payload?.hashtags?.count)
  const hashtagCountValid = Number.isInteger(hashtagCount) && hashtagCount >= contract.hashtagMin && hashtagCount <= contract.hashtagMax
  checks.push({ key: `Hashtag count ${contract.hashtagMin}-${contract.hashtagMax}`, ok: hashtagCountValid })
  if (!Number.isInteger(hashtagCount)) {
    errors.push('hashtags.count wajib berupa angka bulat.')
  } else if (!hashtagCountValid) {
    errors.push(`hashtags.count (${hashtagCount}) harus di rentang ${contract.hashtagMin}-${contract.hashtagMax} untuk platform ${platform || '-'}.`)
  }

  const ctaItems = Array.isArray(payload.cta) ? payload.cta : []
  const ctaTexts = ctaItems.map((x) => safeString(x?.text)).filter(Boolean)
  const hasCtaText = ctaTexts.length > 0
  checks.push({ key: 'CTA presence', ok: !contract.requireCtaInDescription || hasCtaText })
  if (contract.requireCtaInDescription && !hasCtaText) {
    errors.push('CTA minimal 1 wajib diisi untuk platform ini.')
  }

  const joinedCta = ctaTexts.join(' ').toLowerCase()
  const styleHints = Array.isArray(CTA_STYLE_HINTS[contract.ctaStyle]) ? CTA_STYLE_HINTS[contract.ctaStyle] : []
  if (styleHints.length && hasCtaText && !styleHints.some((token) => joinedCta.includes(token))) {
    warnings.push(`CTA belum merefleksikan style "${contract.ctaStyle}".`)
  }

  const length = safeString(payload?.contentStructure?.length).toLowerCase()
  const allowedLength = PLATFORM_ALLOWED_LENGTH[platform]
  if (allowedLength && length && !allowedLength.includes(length)) {
    warnings.push(`Length "${length}" kurang ideal untuk ${platform}. Rekomendasi: ${allowedLength.join('/')} .`)
  }

  const description = safeString(payload.description)
  const descriptionSentences = countSentences(description)
  if (description) {
    if (descriptionSentences > contract.descriptionMaxSentences) {
      warnings.push(`Description terlalu panjang (${descriptionSentences} kalimat). Maks ${contract.descriptionMaxSentences} kalimat.`)
    }
    if (descriptionSentences > 0 && descriptionSentences < contract.descriptionMinSentences) {
      warnings.push(`Description terlalu pendek (${descriptionSentences} kalimat). Minimal ${contract.descriptionMinSentences} kalimat.`)
    }
    if (description.length > contract.descriptionMaxChars) {
      warnings.push(`Description terlalu panjang (${description.length} chars). Maks ${contract.descriptionMaxChars} chars.`)
    }
  }

  const hook = safeString(payload.hook || payload.title)
  if (hook) {
    if (hook.length > contract.hookMax) {
      warnings.push(`Hook/title panjang (${hook.length} chars). Target maks ${contract.hookMax} chars.`)
    }
    if (hook.length < contract.hookMin) {
      warnings.push(`Hook/title pendek (${hook.length} chars). Target min ${contract.hookMin} chars.`)
    }
  }

  const audioLengthSec = Number(payload?.audio?.lengthSec || 0)
  const targetAudio = TARGET_AUDIO_SEC_BY_LENGTH[length] || 30
  if (Number.isFinite(audioLengthSec) && audioLengthSec > 0) {
    const diff = Math.abs(audioLengthSec - targetAudio)
    if (diff > 20) {
      warnings.push(`Audio length (${audioLengthSec}s) jauh dari target ${targetAudio}s untuk length "${length || '-'}".`)
    }
  }

  return {
    contract,
    checks,
    errors,
    warnings
  }
}
