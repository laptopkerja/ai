#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function ensureArray(v) {
  if (!v && v !== 0) return []
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.split(/[,;]+/).map(x => x.trim()).filter(Boolean)
  return [v]
}

function convertOne(key, raw) {
  const now = new Date().toISOString()
  const id = raw.id || slugify(key) || `tpl-${Date.now()}`
  const title = raw.title || key
  const description = raw.description || raw.exampleOutput || ''

  const generation = {
    platform: raw.platform || raw.platforms || (key.match(/tiktok/i) ? 'TikTok' : (key.match(/youtube/i) ? 'YouTube Short' : 'Generic')),
    topicExample: raw.topic || raw.topicExample || '',
    placeholders: raw.placeholders || [],
    tone: raw.tone || '',
    language: raw.language || raw.languageRules || 'Indonesia',
    length: raw.length || 'short',
    maxWords: typeof raw.maxWords === 'number' ? raw.maxWords : (raw.max_words || null),
    formatOutput: raw.formatOutput || raw.structure || ''
  }

  const audio = {
    recommendation: raw.audioRecommendation || raw.musicSuggestion || raw.audioStyle || raw.musicMood || '',
    style: raw.audioStyle || raw.musicGenre || '',
    mood: raw.musicMood || '',
    genre: raw.audioGenre || '',
    lengthSec: raw.audioLength ? Number(raw.audioLength) : (raw.audioLengthSec ? Number(raw.audioLengthSec) : undefined)
  }

  const hashtags = { strategy: raw.hashtagStrategy || '', count: raw.hashtagCount || raw.hashtagsCount || null }

  const ctas = []
  if (raw.ctaMain) ctas.push({ type: 'main', text: raw.ctaMain })
  if (raw.ctaAffiliate) ctas.push({ type: 'affiliate', text: raw.ctaAffiliate })
  if (raw.cta) ctas.push({ type: 'generic', text: raw.cta })
  if (Array.isArray(raw.ctaEngagement)) raw.ctaEngagement.forEach(t => ctas.push({ type: 'engagement', text: t }))

  const keywords = {
    main: raw.keywordMain || '',
    extras: ensureArray(raw.keywordExtra || raw.keyword_extras || []),
    priority: ensureArray(raw.keywordPriorityOrder || [])
  }

  let forbiddenWords = raw.forbiddenWords
  if (typeof forbiddenWords === 'string') forbiddenWords = ensureArray(forbiddenWords)
  if (!forbiddenWords) forbiddenWords = []

  const constraints = {
    forbiddenWords: forbiddenWords,
    variationCount: typeof raw.variationCount === 'number' ? raw.variationCount : (raw.variation_count || null)
  }

  const examples = raw.exampleOutput ? (Array.isArray(raw.exampleOutput) ? raw.exampleOutput : [raw.exampleOutput]) : (raw.examples || [])

  const prompt = raw.prompt || raw.instruction || raw.formatOutput || `Buat konten untuk topik '{{topic}}' dengan tone '{{tone}}'`;

  const out = {
    id,
    title,
    description,
    version: raw.version || 1,
    metadata: { createdAt: raw.createdAt || now, visibility: raw.visibility || 'private' },
    generation,
    audio,
    hashtags,
    ctas,
    keywords,
    constraints,
    examples,
    prompt
  }

  return out
}

function convert(inputPath, outputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const results = []

  if (data && data.storage && data.storage.userPresets && typeof data.storage.userPresets === 'object') {
    const userPresets = data.storage.userPresets
    for (const key of Object.keys(userPresets)) {
      try {
        results.push(convertOne(key, userPresets[key]))
      } catch (err) {
        console.error('Failed to convert', key, err)
      }
    }
  } else if (Array.isArray(data)) {
    data.forEach((item, idx) => {
      results.push(convertOne(item.id || `item-${idx}`, item))
    })
  } else if (typeof data === 'object') {
    if (data.id || data.title) {
      results.push(convertOne(data.id || data.title, data))
    } else {
      for (const key of Object.keys(data)) {
        results.push(convertOne(key, data[key]))
      }
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`Converted ${results.length} templates -> ${outputPath}`)
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  if (argv.length < 2) {
    console.error('Usage: node convertTemplates.cjs <input.json> <output.json>')
    process.exit(2)
  }
  const input = path.resolve(process.cwd(), argv[0])
  const output = path.resolve(process.cwd(), argv[1])
  convert(input, output)
}

module.exports = { convert, convertOne }
