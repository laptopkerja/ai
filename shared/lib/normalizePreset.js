// normalizePreset: produce canonical preset object matching Format 1 schema

function ensureArray(v){
  if (!v) return []
  if (Array.isArray(v)) return v
  return String(v).split(',').map(s=>s.trim()).filter(Boolean)
}

export default function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object') return null

  // Start from common mapping of likely legacy fields
  const out = {
    id: raw.id || raw._id || `tpl-${Date.now()}`,
    version: raw.version || raw.ver || '1.0.0',
    title: raw.title || raw.name || 'Untitled Preset',
    label: raw.label || raw.title || raw.name || 'Preset',
    description: raw.description || raw.desc || '',
    platform: raw.platform || (raw.generation && raw.generation.platform) || 'TikTok',
    category: raw.category || (raw.metadata && raw.metadata.category) || '',
    tags: ensureArray(raw.tags || raw.labels || (raw.metadata && raw.metadata.tags)),
    engine: raw.engine || raw.provider || 'generic',
    strategy: raw.strategy || raw.strategy || (raw.generation && raw.generation.strategy) || {},
    contentStructure: raw.contentStructure || (raw.generation ? { length: raw.generation.length || 'short', format: raw.generation.formatOutput || 'text', placeholders: raw.generation.placeholders || [] } : { length: 'short', format: 'text' }),
    language: raw.language || (raw.generation && raw.generation.language) || 'Indonesia',
    keywords: ensureArray(raw.keywords || (raw.metadata && raw.metadata.keywords) || raw.generation?.keywords),
    hashtags: raw.hashtags || raw.generation?.hashtags || {},
    cta: Array.isArray(raw.cta) ? raw.cta : (raw.ctas || raw.cta ? ensureArray(raw.ctas || raw.cta).map(t => ({ type: 'primary', text: t })) : (raw.ctas || [])),
    audio: raw.audio || (raw.generation ? { recommendation: raw.generation.audioRecommendation || raw.generation.audioStyle || '' } : {}),
    constraints: raw.constraints || raw.generation?.constraints || {},
    analytics: raw.analytics || {},
    examples: raw.examples || raw.examples || [],
    meta: raw.meta || raw.metadata || { importedFromLegacy: !!raw.generation }
  }

  // Cleanup: remove empty arrays/objects
  // Ensure required fields for Format 1 are present with safe defaults
  if (!out.tags || out.tags.length === 0) out.tags = []
  if (!out.keywords || out.keywords.length === 0) out.keywords = []
  if (!out.cta || out.cta.length === 0) out.cta = [{ type: 'primary', text: out.description || 'Call to action' }]
  if (!out.examples || out.examples.length === 0) out.examples = []
  if (!out.analytics || Object.keys(out.analytics).length === 0) out.analytics = { trackingEnabled: false }
  if (!out.strategy || Object.keys(out.strategy).length === 0) out.strategy = { goals: ['general'] }

  // Ensure contentStructure has required props
  out.contentStructure = out.contentStructure || {}
  out.contentStructure.length = out.contentStructure.length || 'short'
  out.contentStructure.format = out.contentStructure.format || 'text'
  out.contentStructure.placeholders = out.contentStructure.placeholders || []

  // Ensure hashtags structure
  out.hashtags = out.hashtags || { strategy: 'none', count: 0 }

  // Ensure audio structure matches required fields
  out.audio = out.audio || { recommendation: '', style: '', mood: '', lengthSec: 0 }
  out.audio.recommendation = out.audio.recommendation || (raw.audio && raw.audio.recommendation) || out.audio.recommendation || ''
  out.audio.style = out.audio.style || (raw.audio && raw.audio.style) || ''
  out.audio.mood = out.audio.mood || (raw.audio && raw.audio.mood) || ''
  out.audio.lengthSec = typeof out.audio.lengthSec === 'number' ? out.audio.lengthSec : (raw.audio && raw.audio.lengthSec) || 0

  // Ensure constraints
  out.constraints = out.constraints || { forbiddenWords: [], variationCount: 1 }
  out.constraints.forbiddenWords = out.constraints.forbiddenWords || []
  out.constraints.variationCount = out.constraints.variationCount || 1

  // Ensure meta with createdAt
  out.meta = out.meta || {}
  out.meta.createdAt = out.meta.createdAt || new Date().toISOString()

  // Sanitize output to only include fields allowed by Format 1 (additionalProperties: false)
  const sanitized = {
    id: String(out.id),
    version: String(out.version),
    title: String(out.title),
    label: String(out.label),
    description: String(out.description || ''),
    platform: String(out.platform || ''),
    category: String(out.category || ''),
    tags: Array.isArray(out.tags) ? out.tags.map(String) : [],
    engine: String(out.engine || ''),
    strategy: {
      goals: Array.isArray(out.strategy?.goals) ? out.strategy.goals.map(String) : ['general'],
      emotionTriggers: Array.isArray(out.strategy?.emotionTriggers) ? out.strategy.emotionTriggers.map(String) : [],
      targetAudience: out.strategy?.targetAudience ? String(out.strategy.targetAudience) : ''
    },
    contentStructure: {
      length: out.contentStructure?.length || 'short',
      format: out.contentStructure?.format || 'text',
      placeholders: Array.isArray(out.contentStructure?.placeholders) ? out.contentStructure.placeholders.map(p => ({ name: String(p.name), ...(p.type ? { type: String(p.type) } : {}), ...(p.default !== undefined ? { default: p.default } : {}) })) : []
    },
    language: String(out.language || ''),
    keywords: Array.isArray(out.keywords) ? out.keywords.map(String) : [],
    hashtags: { strategy: String(out.hashtags?.strategy || ''), count: Number(out.hashtags?.count || 0) },
    cta: Array.isArray(out.cta) ? out.cta.map(c => ({ type: String(c.type), text: String(c.text) })) : [],
    audio: {
      recommendation: String(out.audio?.recommendation || ''),
      style: String(out.audio?.style || ''),
      mood: String(out.audio?.mood || ''),
      lengthSec: Number(out.audio?.lengthSec || 0)
    },
    constraints: {
      forbiddenWords: Array.isArray(out.constraints?.forbiddenWords) ? out.constraints.forbiddenWords.map(String) : [],
      variationCount: Number(out.constraints?.variationCount || 1)
    },
    analytics: {
      trackingEnabled: !!out.analytics?.trackingEnabled
    },
    examples: Array.isArray(out.examples) ? out.examples.map(e => ({ input: e.input || {}, output: e.output })) : [],
    meta: {
      createdAt: out.meta?.createdAt || new Date().toISOString(),
      updatedAt: out.meta?.updatedAt || new Date().toISOString(),
      createdBy: out.meta?.createdBy || 'unknown'
    }
  }

  if (out.analytics && typeof out.analytics.expectedKPI === 'string' && out.analytics.expectedKPI.length) sanitized.analytics.expectedKPI = out.analytics.expectedKPI

  return sanitized
}
