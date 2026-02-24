export default function normalizeManual(values) {
  // values is the form values from GenerateForm
  // Only pick minimal allowed manual fields and map to NormalizedConfig
  const normalized = {
    platform: values.platform || 'TikTok',
    // minimal strategy placeholder: empty unless user provides explicit goals (Manual shouldn't have strategy)
    strategy: null,
    contentStructure: {
      // heuristics: map length to a contentStructure suggestion
      length: values.length || 'short',
      format: values.formatOutput || 'text'
    },
    language: values.language || 'Indonesia',
    tone: values.tone || null,
    topic: values.topic || '',
    keywords: values.keywords ? (Array.isArray(values.keywords) ? values.keywords : (String(values.keywords).split(',').map(s=>s.trim()).filter(Boolean))) : [],
    cta: values.cta ? (Array.isArray(values.cta) ? values.cta : [{ type: 'primary', text: String(values.cta) }]) : [],
    constraints: values.constraints || { forbiddenWords: [] },
    meta: {
      createdBy: 'manual-ui',
      createdAt: new Date().toISOString()
    }
  }

  // Remove null/empty fields per requirements
  if (!normalized.strategy) delete normalized.strategy
  if (!normalized.tone) delete normalized.tone
  if (!normalized.keywords || normalized.keywords.length === 0) delete normalized.keywords
  if (!normalized.cta || normalized.cta.length === 0) delete normalized.cta

  return normalized
}
