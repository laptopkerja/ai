import {
  resolvePlatformOutputContract as resolveSharedPlatformOutputContract,
  resolvePlatformAllowedLength
} from '../../shared/lib/platformContracts.js'

function safeString(value) {
  return String(value || '').trim()
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
  return resolveSharedPlatformOutputContract(platform)
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
  const allowedLength = resolvePlatformAllowedLength(platform)
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
