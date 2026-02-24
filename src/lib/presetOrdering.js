const PLATFORM_ORDER = [
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

const PLATFORM_RANK = new Map(PLATFORM_ORDER.map((platform, index) => [platform, index]))

function presetVariantRank(preset) {
  const source = `${preset?.id || ''} ${preset?.title || ''} ${preset?.label || ''}`.toLowerCase()
  if (source.includes('hard-sell') || source.includes('hard sell')) return 0
  if (source.includes('soft-education') || source.includes('soft education')) return 1
  return 2
}

function platformRank(platform) {
  if (PLATFORM_RANK.has(platform)) return PLATFORM_RANK.get(platform)
  return Number.MAX_SAFE_INTEGER
}

function normalizedTitle(preset) {
  return String(preset?.title || preset?.label || preset?.id || '').trim().toLowerCase()
}

export function comparePresetsForUi(a, b) {
  const aPlatform = String(a?.platform || '').trim()
  const bPlatform = String(b?.platform || '').trim()

  const byPlatform = platformRank(aPlatform) - platformRank(bPlatform)
  if (byPlatform !== 0) return byPlatform

  if (aPlatform !== bPlatform) return aPlatform.localeCompare(bPlatform)

  const byVariant = presetVariantRank(a) - presetVariantRank(b)
  if (byVariant !== 0) return byVariant

  const aTitle = normalizedTitle(a)
  const bTitle = normalizedTitle(b)
  const byTitle = aTitle.localeCompare(bTitle)
  if (byTitle !== 0) return byTitle

  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

export function sortPresetsForUi(presets = []) {
  return Array.isArray(presets) ? [...presets].sort(comparePresetsForUi) : []
}

