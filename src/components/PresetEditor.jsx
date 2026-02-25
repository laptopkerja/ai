import React, { useEffect, useMemo, useState } from 'react'
import { Form, Row, Col, Button, InputGroup, Badge, Alert } from 'react-bootstrap'
import validateTemplate from '../lib/validateTemplate'
import lintPresetAgainstPlatformContract from '../lib/presetPlatformLint'
import { CANONICAL_PLATFORMS, resolvePlatformAllowedLength } from '../../shared/lib/platformContracts.js'

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function safeString(value) {
  return String(value || '').trim()
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function splitSentences(text) {
  const source = safeString(text)
  if (!source) return []
  return source
    .split(/(?<=[.!?])\s+/)
    .map((x) => safeString(x))
    .filter(Boolean)
}

function trimToMaxChars(text, maxChars = 160) {
  const source = safeString(text)
  if (source.length <= maxChars) return source
  if (maxChars <= 4) return source.slice(0, maxChars)
  return `${source.slice(0, maxChars - 3).trim()}...`
}

function detectCtaSignal(text, language) {
  const source = safeString(text).toLowerCase()
  if (!source) return false
  const patterns = String(language || '').toLowerCase().startsWith('en')
    ? [/save/i, /comment/i, /share/i, /try/i, /learn more/i, /check/i, /reply/i, /react/i, /vote/i, /follow/i, /forward/i]
    : [/simpan/i, /komentar/i, /bagikan/i, /coba/i, /cek/i, /lihat/i, /balas/i, /reaksi/i, /vote/i, /ikuti/i, /forward/i]
  return patterns.some((re) => re.test(source))
}

const TARGET_AUDIO_SEC_BY_LENGTH = {
  short: 30,
  medium: 45,
  long: 60
}

const DEFAULT_CTA_TEXT_BY_STYLE = {
  comment_share_save: {
    id: 'Komentar, bagikan, lalu simpan kalau kamu mau lanjutan.',
    en: 'Comment, share, and save if you want the next part.'
  },
  comment_share: {
    id: 'Komentar pendapatmu dan bagikan jika bermanfaat.',
    en: 'Comment your take and share if this helps.'
  },
  comment_follow: {
    id: 'Komentar kebutuhanmu dan ikuti untuk update berikutnya.',
    en: 'Comment your need and follow for the next update.'
  },
  reply_debate: {
    id: 'Balas pendapatmu supaya diskusi makin tajam.',
    en: 'Reply with your perspective so we can compare ideas.'
  },
  watch_comment: {
    id: 'Tonton sampai selesai lalu tulis komentar versimu.',
    en: 'Watch through and leave your version in the comments.'
  },
  reply_contact: {
    id: 'Balas status ini kalau kamu mau versi lanjutannya.',
    en: 'Reply to this status if you want the follow-up version.'
  },
  react_forward: {
    id: 'Beri reaksi jika bermanfaat, lalu forward seperlunya.',
    en: 'React if useful, then forward it where relevant.'
  },
  reply_vote: {
    id: 'Balas pilihanmu dan vote topik berikutnya.',
    en: 'Reply your choice and vote for the next topic.'
  },
  reply_repost: {
    id: 'Balas pendapatmu lalu repost jika kamu setuju.',
    en: 'Reply with your take and repost if you agree.'
  },
  listen_follow: {
    id: 'Dengarkan track ini lalu follow untuk rilisan berikutnya.',
    en: 'Listen to this track and follow for the next release.'
  },
  read_comment: {
    id: 'Baca artikel lengkapnya lalu tulis komentarmu.',
    en: 'Read the full article and share your comment.'
  },
  checkout_comment: {
    id: 'Komentar kebutuhanmu dulu sebelum checkout.',
    en: 'Comment your use-case before checking out.'
  },
  save_pin: {
    id: 'Simpan pin ini supaya gampang dicari lagi.',
    en: 'Save this pin so you can revisit it later.'
  },
  soft: {
    id: 'Bagikan jika ini bermanfaat untuk kamu.',
    en: 'Share this if it helps you.'
  }
}

function defaultCtaText(style, language) {
  const entry = DEFAULT_CTA_TEXT_BY_STYLE[style] || DEFAULT_CTA_TEXT_BY_STYLE.soft
  const isEnglish = String(language || '').toLowerCase().startsWith('en')
  return isEnglish ? entry.en : entry.id
}

function diffRemoved(before = [], after = []) {
  const beforeList = Array.isArray(before) ? before : []
  const afterSet = new Set((Array.isArray(after) ? after : []).map((x) => safeString(x)))
  return beforeList.filter((item) => !afterSet.has(safeString(item)))
}

function buildPayloadFromState(state) {
  const payload = {
    id: String(state.id),
    version: String(state.version),
    title: String(state.title),
    label: String(state.label),
    description: String(state.description || ''),
    platform: String(state.platform || ''),
    category: String(state.category || ''),
    tags: Array.isArray(state.tags) ? state.tags.map(String) : [],
    engine: String(state.engine || ''),
    strategy: {
      goals: Array.isArray(state.strategy.goals) ? state.strategy.goals.map(String) : ['general'],
      emotionTriggers: Array.isArray(state.strategy.emotionTriggers) ? state.strategy.emotionTriggers.map(String) : [],
      targetAudience: String(state.strategy.targetAudience || '')
    },
    contentStructure: {
      length: state.contentStructure.length,
      format: String(state.contentStructure.format || ''),
      placeholders: Array.isArray(state.contentStructure.placeholders)
        ? state.contentStructure.placeholders.map((p) => ({ name: String(p.name), type: p.type ? String(p.type) : undefined, default: p.default }))
        : []
    },
    language: String(state.language || ''),
    keywords: Array.isArray(state.keywords) ? state.keywords.map(String) : [],
    hashtags: { strategy: String(state.hashtags.strategy || ''), count: Number(state.hashtags.count || 0) },
    cta: Array.isArray(state.cta) ? state.cta.map((c) => ({ type: String(c.type), text: String(c.text) })) : [],
    audio: {
      recommendation: String(state.audio.recommendation || ''),
      style: String(state.audio.style || ''),
      mood: String(state.audio.mood || ''),
      lengthSec: Number(state.audio.lengthSec || 0)
    },
    constraints: {
      forbiddenWords: Array.isArray(state.constraints.forbiddenWords) ? state.constraints.forbiddenWords.map(String) : [],
      variationCount: Number(state.constraints.variationCount || 1)
    },
    analytics: {
      trackingEnabled: !!state.analytics.trackingEnabled,
      expectedKPI: state.analytics.expectedKPI ? String(state.analytics.expectedKPI) : undefined
    },
    examples: Array.isArray(state.examples) ? state.examples.map((e) => ({ input: e.input || {}, output: e.output })) : [],
    meta: {
      createdAt: state.meta.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: state.meta.createdBy || 'unknown'
    }
  }

  if (payload.analytics.expectedKPI === undefined) delete payload.analytics.expectedKPI
  payload.contentStructure.placeholders = payload.contentStructure.placeholders.map((p) => {
    const out = { name: p.name }
    if (p.type !== undefined && p.type !== '') out.type = p.type
    if (p.default !== undefined) out.default = p.default
    return out
  })

  return payload
}

function getRequiredStatus(current) {
  const checks = [
    { key: 'Title', ok: !!current.title?.trim() },
    { key: 'Label', ok: !!current.label?.trim() },
    { key: 'Description', ok: !!current.description?.trim() },
    { key: 'Platform', ok: !!current.platform?.trim() },
    { key: 'Language', ok: !!current.language?.trim() },
    { key: 'Goals', ok: Array.isArray(current.strategy?.goals) && current.strategy.goals.length > 0 && current.strategy.goals.some((g) => String(g).trim()) },
    { key: 'Emotion Triggers', ok: Array.isArray(current.strategy?.emotionTriggers) && current.strategy.emotionTriggers.length > 0 },
    { key: 'Target Audience', ok: !!current.strategy?.targetAudience?.trim() },
    { key: 'Keywords', ok: Array.isArray(current.keywords) && current.keywords.length > 0 },
    { key: 'CTA', ok: Array.isArray(current.cta) && current.cta.length > 0 && current.cta.some((c) => String(c.text || '').trim()) }
  ]
  return {
    checks,
    done: checks.filter((c) => c.ok).length,
    total: checks.length,
    missing: checks.filter((c) => !c.ok).map((c) => c.key)
  }
}

function scoreQuality(state, requiredStatus, schemaErrors, presetLint) {
  const lintErrors = Array.isArray(presetLint?.errors) ? presetLint.errors : []
  const checks = [
    { key: 'Required Fields', ok: requiredStatus.missing.length === 0, weight: 30 },
    { key: 'Schema Valid', ok: schemaErrors.length === 0, weight: 20 },
    { key: 'Platform Contract Lint', ok: lintErrors.length === 0, weight: 15 },
    { key: 'Audio 4-field', ok: !!state.audio?.recommendation?.trim() && !!state.audio?.style?.trim() && !!state.audio?.mood?.trim() && Number(state.audio?.lengthSec || 0) > 0, weight: 15 },
    { key: 'Keywords >= 3', ok: Array.isArray(state.keywords) && state.keywords.length >= 3, weight: 10 },
    { key: 'CTA 1-4', ok: Array.isArray(state.cta) && state.cta.length >= 1 && state.cta.length <= 4, weight: 8 },
    { key: 'Forbidden Words >= 3', ok: Array.isArray(state.constraints?.forbiddenWords) && state.constraints.forbiddenWords.length >= 3, weight: 7 },
    { key: 'Audience Detail', ok: String(state.strategy?.targetAudience || '').trim().length >= 10, weight: 5 },
    { key: 'Description >= 20 char', ok: String(state.description || '').trim().length >= 20, weight: 5 }
  ]
  const totalWeight = checks.reduce((sum, it) => sum + it.weight, 0)
  const passedWeight = checks.filter((it) => it.ok).reduce((sum, it) => sum + it.weight, 0)
  const score = Math.round((passedWeight / totalWeight) * 100)
  return {
    checks,
    score,
    grade: score >= 85 ? 'Gold' : score >= 70 ? 'Good' : 'Needs Fix'
  }
}

// Controlled editor that builds payload matching Format 1 exactly.
export default function PresetEditor({ initialData = {}, onSave, onCancel }) {
  const [state, setState] = useState(() => ({
    id: initialData.id || `tpl-${Date.now()}`,
    version: initialData.version || '1.0.0',
    title: initialData.title || '',
    label: initialData.label || '',
    description: initialData.description || '',
    platform: initialData.platform || '',
    category: initialData.category || '',
    tags: Array.isArray(initialData.tags) ? [...initialData.tags] : [],
    engine: initialData.engine || '',
    strategy: {
      goals: initialData.strategy?.goals ? [...initialData.strategy.goals] : ['general'],
      emotionTriggers: initialData.strategy?.emotionTriggers ? [...initialData.strategy.emotionTriggers] : [],
      targetAudience: initialData.strategy?.targetAudience || ''
    },
    contentStructure: {
      length: initialData.contentStructure?.length || 'short',
      format: initialData.contentStructure?.format || 'text',
      placeholders: Array.isArray(initialData.contentStructure?.placeholders) ? [...initialData.contentStructure.placeholders] : []
    },
    language: initialData.language || 'Indonesia',
    keywords: Array.isArray(initialData.keywords) ? [...initialData.keywords] : [],
    hashtags: initialData.hashtags || { strategy: 'none', count: 0 },
    cta: Array.isArray(initialData.cta) && initialData.cta.length ? [...initialData.cta] : [{ type: 'primary', text: 'Call to action' }],
    audio: initialData.audio || { recommendation: '', style: '', mood: '', lengthSec: 0 },
    constraints: initialData.constraints || { forbiddenWords: [], variationCount: 1 },
    analytics: initialData.analytics || { trackingEnabled: false },
    examples: Array.isArray(initialData.examples) ? [...initialData.examples] : [],
    meta: initialData.meta || { createdAt: initialData.meta?.createdAt || new Date().toISOString(), createdBy: initialData.meta?.createdBy || 'unknown' }
  }))

  const [errors, setErrors] = useState([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [autoFixMessage, setAutoFixMessage] = useState('')
  const [autoFixReport, setAutoFixReport] = useState(null)

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      id: initialData.id || prev.id,
      version: initialData.version || prev.version
    }))
  }, [initialData.id, initialData.version])

  function set(path, value) {
    setState((prev) => {
      const next = deepClone(prev)
      const keys = path.split('.')
      let cur = next
      for (let i = 0; i < keys.length - 1; i += 1) {
        if (!cur[keys[i]]) cur[keys[i]] = {}
        cur = cur[keys[i]]
      }
      cur[keys[keys.length - 1]] = value
      return next
    })
  }

  function addArrayItem(path, item) {
    setState((prev) => {
      const next = deepClone(prev)
      const arr = path.split('.').reduce((obj, key) => obj[key], next)
      if (Array.isArray(arr)) arr.push(item)
      return next
    })
  }

  function removeArrayItem(path, idx) {
    setState((prev) => {
      const next = deepClone(prev)
      const arr = path.split('.').reduce((obj, key) => obj[key], next)
      if (Array.isArray(arr)) arr.splice(idx, 1)
      return next
    })
  }

  const requiredStatus = useMemo(() => getRequiredStatus(state), [state])
  const platformOptions = useMemo(() => {
    const current = safeString(state.platform)
    if (current && !CANONICAL_PLATFORMS.includes(current)) {
      return [current, ...CANONICAL_PLATFORMS]
    }
    return CANONICAL_PLATFORMS
  }, [state.platform])
  const previewPayload = useMemo(() => buildPayloadFromState(state), [state])
  const schemaErrors = useMemo(() => validateTemplate(previewPayload), [previewPayload])
  const presetLint = useMemo(() => lintPresetAgainstPlatformContract(previewPayload), [previewPayload])
  const quality = useMemo(() => scoreQuality(state, requiredStatus, schemaErrors, presetLint), [state, requiredStatus, schemaErrors, presetLint])
  const canSave = requiredStatus.missing.length === 0 && schemaErrors.length === 0 && presetLint.errors.length === 0
  const hasAutoFixIssues =
    requiredStatus.missing.length > 0 ||
    schemaErrors.length > 0 ||
    presetLint.errors.length > 0 ||
    presetLint.warnings.length > 0

  function validate() {
    const nextErrors = []
    if (!state.id || !state.id.trim()) nextErrors.push('id required')
    if (requiredStatus.missing.length) nextErrors.push(...requiredStatus.missing.map((item) => `${item} wajib diisi`))
    if (!Number.isInteger(state.hashtags?.count) || state.hashtags.count < 0 || state.hashtags.count > 30) nextErrors.push('hashtags.count must be 0-30')
    if (!Number.isInteger(state.constraints?.variationCount) || state.constraints.variationCount < 1) nextErrors.push('constraints.variationCount >=1')
    if (schemaErrors.length) nextErrors.push(...schemaErrors.slice(0, 8))
    if (presetLint.errors.length) nextErrors.push(...presetLint.errors.slice(0, 8))
    setErrors(nextErrors)
    return nextErrors.length === 0
  }

  function applyAutoFixByContract() {
    const next = deepClone(state)
    const changes = []
    const initialLint = lintPresetAgainstPlatformContract(buildPayloadFromState(next))
    const beforeErrors = Array.isArray(initialLint.errors) ? initialLint.errors : []
    const beforeWarnings = Array.isArray(initialLint.warnings) ? initialLint.warnings : []
    const isEnglish = String(next.language || '').toLowerCase().startsWith('en')

    if (!initialLint.contract?.supported) {
      next.platform = 'TikTok'
      changes.push('Platform diset ke TikTok (default kontrak).')
    }

    const contract = lintPresetAgainstPlatformContract(buildPayloadFromState(next)).contract

    const hashtagMin = clampNumber(contract?.hashtagMin, 0, 12, 3)
    const hashtagMax = clampNumber(contract?.hashtagMax, hashtagMin, 12, 8)
    if (!next.hashtags || typeof next.hashtags !== 'object') {
      next.hashtags = { strategy: 'none', count: hashtagMin }
      changes.push(`Hashtag count diset ${hashtagMin}.`)
    } else {
      const normalizedHashtagCount = Number.isFinite(Number(next.hashtags.count))
        ? Math.round(Number(next.hashtags.count))
        : hashtagMin
      const clampedHashtagCount = clampNumber(normalizedHashtagCount, hashtagMin, hashtagMax, hashtagMin)
      if (Number(next.hashtags.count) !== clampedHashtagCount) {
        next.hashtags.count = clampedHashtagCount
        changes.push(`Hashtag count disesuaikan ke ${clampedHashtagCount} (target ${hashtagMin}-${hashtagMax}).`)
      }
    }

    const allowedLength = resolvePlatformAllowedLength(next.platform)
    if (!next.contentStructure || typeof next.contentStructure !== 'object') {
      next.contentStructure = { length: allowedLength[0], format: 'text', placeholders: [] }
      changes.push(`Content length diset ${allowedLength[0]}.`)
    } else if (!allowedLength.includes(String(next.contentStructure.length || '').toLowerCase())) {
      next.contentStructure.length = allowedLength[0]
      changes.push(`Content length disesuaikan ke ${allowedLength[0]} untuk ${next.platform}.`)
    }

    const titleMin = clampNumber(contract?.hookMin, 10, 240, 18)
    const titleMax = clampNumber(contract?.hookMax, titleMin, 240, 180)
    let fixedTitle = safeString(next.title)
    if (!fixedTitle) {
      fixedTitle = isEnglish
        ? `${next.platform || 'Content'} insight for your audience`
        : `Insight ${next.platform || 'konten'} untuk audiens kamu`
      changes.push('Title dibuat otomatis karena kosong.')
    }
    if (fixedTitle.length > titleMax) {
      fixedTitle = trimToMaxChars(fixedTitle, titleMax)
      changes.push(`Title dipersingkat (maks ${titleMax} chars).`)
    }
    if (fixedTitle.length < titleMin) {
      fixedTitle = isEnglish
        ? `Quick reason why ${next.platform || 'this content'} matters now`
        : `Alasan cepat kenapa ${next.platform || 'konten ini'} penting sekarang`
      fixedTitle = trimToMaxChars(fixedTitle, titleMax)
      changes.push(`Title diperpanjang otomatis (min ${titleMin} chars).`)
    }
    next.title = fixedTitle
    if (!safeString(next.label)) {
      next.label = fixedTitle
      changes.push('Label diisi mengikuti title.')
    }

    const descMinSent = clampNumber(contract?.descriptionMinSentences, 1, 6, 1)
    const descMaxSent = clampNumber(contract?.descriptionMaxSentences, descMinSent, 8, 3)
    const descMaxChars = clampNumber(contract?.descriptionMaxChars, 80, 520, 260)
    let desc = safeString(next.description)
    if (!desc) {
      desc = isEnglish
        ? `Short description for ${next.platform || 'this'} audience.`
        : `Deskripsi singkat untuk audiens ${next.platform || 'ini'}.`
      changes.push('Description dibuat otomatis karena kosong.')
    }
    let descSentences = splitSentences(desc)
    if (!descSentences.length) descSentences = [desc]
    if (descSentences.length > descMaxSent) {
      descSentences = descSentences.slice(0, descMaxSent)
      changes.push(`Description dipadatkan ke maks ${descMaxSent} kalimat.`)
    }
    while (descSentences.length < descMinSent) {
      descSentences.push(isEnglish ? 'Keep it practical and clear.' : 'Pastikan tetap praktis dan jelas.')
      changes.push(`Description dilengkapi ke minimal ${descMinSent} kalimat.`)
    }
    desc = safeString(descSentences.join(' '))

    const style = safeString(contract?.ctaStyle || 'soft')
    const requiredCtaText = defaultCtaText(style, next.language)
    if (contract?.requireCtaInDescription && !detectCtaSignal(desc, next.language)) {
      desc = safeString(`${desc} ${requiredCtaText}`)
      changes.push('CTA ditambahkan ke description sesuai kontrak.')
    }
    if (desc.length > descMaxChars) {
      desc = trimToMaxChars(desc, descMaxChars)
      changes.push(`Description dipersingkat (maks ${descMaxChars} chars).`)
    }
    next.description = desc

    if (!Array.isArray(next.cta)) next.cta = []
    next.cta = next.cta
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({ type: safeString(x.type || 'primary') || 'primary', text: safeString(x.text) }))
      .filter((x) => x.text)
    if (contract?.requireCtaInDescription && next.cta.length === 0) {
      next.cta.push({ type: 'primary', text: requiredCtaText })
      changes.push('CTA utama ditambahkan.')
    }
    if (next.cta.length > 4) {
      next.cta = next.cta.slice(0, 4)
      changes.push('CTA dipangkas ke maksimum 4 item.')
    }
    if (next.cta.length > 0) {
      const allCtaText = next.cta.map((x) => x.text).join(' ')
      if (contract?.requireCtaInDescription && !detectCtaSignal(allCtaText, next.language)) {
        next.cta[0] = { ...next.cta[0], text: requiredCtaText }
        changes.push('CTA text diselaraskan dengan style kontrak.')
      }
    }

    if (!next.audio || typeof next.audio !== 'object') {
      next.audio = { recommendation: '', style: '', mood: '', lengthSec: 0 }
    }
    const targetAudioLength = TARGET_AUDIO_SEC_BY_LENGTH[String(next.contentStructure?.length || 'short').toLowerCase()] || 30
    const currentAudioLength = Number(next.audio.lengthSec || 0)
    if (!Number.isFinite(currentAudioLength) || currentAudioLength <= 0 || Math.abs(currentAudioLength - targetAudioLength) > 20) {
      next.audio.lengthSec = targetAudioLength
      changes.push(`Audio length diset ke ${targetAudioLength}s.`)
    }

    const finalLint = lintPresetAgainstPlatformContract(buildPayloadFromState(next))
    const afterErrors = Array.isArray(finalLint.errors) ? finalLint.errors : []
    const afterWarnings = Array.isArray(finalLint.warnings) ? finalLint.warnings : []
    const fixedErrors = diffRemoved(beforeErrors, afterErrors)
    const fixedWarnings = diffRemoved(beforeWarnings, afterWarnings)

    setState(next)
    setErrors([])
    setAutoFixReport({
      beforeErrors,
      beforeWarnings,
      afterErrors,
      afterWarnings,
      fixedErrors,
      fixedWarnings,
      changes
    })

    if (!changes.length) {
      setAutoFixMessage('Auto Fix by Contract: tidak ada perubahan, preset sudah sesuai kontrak.')
      return
    }
    setAutoFixMessage(`Auto Fix by Contract: ${changes.length} perubahan diterapkan. ${changes.join(' | ')}`)
  }

  async function handleSave() {
    if (!validate()) return
    setAutoFixMessage('')
    setAutoFixReport(null)
    if (onSave) await onSave(previewPayload)
  }

  return (
    <div>
      {errors.length > 0 && <Alert variant="danger">{errors.join('; ')}</Alert>}
      {schemaErrors.length > 0 && (
        <Alert variant="warning">
          <div><strong>Schema Check:</strong> {schemaErrors.length} issue</div>
          <div className="small mt-1">{schemaErrors.slice(0, 3).join(' | ')}</div>
        </Alert>
      )}

      <Alert variant={requiredStatus.missing.length ? 'warning' : 'success'}>
        <div><strong>Wajib Diisi:</strong> {requiredStatus.done}/{requiredStatus.total}</div>
        {requiredStatus.missing.length > 0 && <div className="mt-1">Kurang: {requiredStatus.missing.join(', ')}</div>}
      </Alert>

      <Alert variant={quality.score >= 85 ? 'success' : quality.score >= 70 ? 'warning' : 'danger'}>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <strong>Quality Score: {quality.score}/100</strong>
          <Badge bg={quality.score >= 85 ? 'success' : quality.score >= 70 ? 'warning' : 'danger'} text={quality.score >= 70 ? 'dark' : undefined}>{quality.grade}</Badge>
        </div>
        <div className="small mt-2 d-flex flex-wrap gap-1">
          {quality.checks.map((item) => (
            <Badge key={item.key} bg={item.ok ? 'success' : 'secondary'}>{item.key}</Badge>
          ))}
        </div>
      </Alert>
      <Alert variant={presetLint.errors.length ? 'danger' : (presetLint.warnings.length ? 'warning' : 'success')}>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <strong>Platform Contract Lint</strong>
          <Badge bg="dark">Stage {presetLint.contract?.stage || 2}</Badge>
          <Badge bg={presetLint.errors.length ? 'danger' : 'success'}>
            {presetLint.errors.length ? `${presetLint.errors.length} error` : 'pass'}
          </Badge>
          {presetLint.warnings.length > 0 && (
            <Badge bg="warning" text="dark">{presetLint.warnings.length} warning</Badge>
          )}
        </div>
        <div className="small mt-1">
          Hook {presetLint.contract?.hookMin ?? '-'}-{presetLint.contract?.hookMax ?? '-'} char ·
          Desc {presetLint.contract?.descriptionMinSentences ?? '-'}-{presetLint.contract?.descriptionMaxSentences ?? '-'} kalimat ·
          Hashtag {presetLint.contract?.hashtagMin ?? '-'}-{presetLint.contract?.hashtagMax ?? '-'}
          {typeof presetLint.contract?.requireCtaInDescription === 'boolean'
            ? ` · CTA ${presetLint.contract.requireCtaInDescription ? 'required' : 'optional'}`
            : ''}
        </div>
        {presetLint.errors.length > 0 && (
          <div className="small mt-1">Error: {presetLint.errors.join(' | ')}</div>
        )}
        {presetLint.warnings.length > 0 && (
          <div className="small mt-1">Warning: {presetLint.warnings.join(' | ')}</div>
        )}
        {hasAutoFixIssues && (
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline-primary" onClick={applyAutoFixByContract}>
              Auto Fix by Contract
            </Button>
          </div>
        )}
      </Alert>
      {autoFixMessage && (
        <Alert variant="info" className="py-2">
          {autoFixMessage}
        </Alert>
      )}
      {autoFixReport && (
        <Alert
          variant={autoFixReport.afterErrors.length ? 'danger' : (autoFixReport.afterWarnings.length ? 'warning' : 'success')}
          className="py-2"
        >
          <div><strong>Hasil Auto Fix</strong></div>
          <div className="small mt-1">
            Sebelum: {autoFixReport.beforeErrors.length} error, {autoFixReport.beforeWarnings.length} warning
            {' · '}
            Sesudah: {autoFixReport.afterErrors.length} error, {autoFixReport.afterWarnings.length} warning
          </div>
          {autoFixReport.fixedErrors.length > 0 && (
            <div className="small mt-1">
              Diperbaiki otomatis (error): {autoFixReport.fixedErrors.join(' | ')}
            </div>
          )}
          {autoFixReport.fixedWarnings.length > 0 && (
            <div className="small mt-1">
              Diperbaiki otomatis (warning): {autoFixReport.fixedWarnings.join(' | ')}
            </div>
          )}
          {autoFixReport.afterErrors.length > 0 && (
            <div className="small mt-1">
              Masih perlu perbaikan manual (error): {autoFixReport.afterErrors.join(' | ')}
            </div>
          )}
          {autoFixReport.afterWarnings.length > 0 && (
            <div className="small mt-1">
              Perlu ditinjau manual (warning): {autoFixReport.afterWarnings.join(' | ')}
            </div>
          )}
        </Alert>
      )}

      <Form>
        <h6>Wajib Diisi (untuk hasil tepat sasaran)</h6>
        <Form.Group className="mb-2">
          <Form.Label>Title <Badge bg="danger">Wajib</Badge></Form.Label>
          <Form.Control value={state.title} onChange={(e) => set('title', e.target.value)} />
        </Form.Group>

        <Form.Group className="mb-2">
          <Form.Label>Label <Badge bg="danger">Wajib</Badge></Form.Label>
          <Form.Control value={state.label} onChange={(e) => set('label', e.target.value)} />
        </Form.Group>

        <Form.Group className="mb-2">
          <Form.Label>Description <Badge bg="danger">Wajib</Badge></Form.Label>
          <Form.Control as="textarea" rows={2} value={state.description} onChange={(e) => set('description', e.target.value)} />
        </Form.Group>

        <Row>
          <Col md={6}>
            <Form.Group className="mb-2">
              <Form.Label>Platform <Badge bg="danger">Wajib</Badge></Form.Label>
              <Form.Select value={state.platform} onChange={(e) => set('platform', e.target.value)}>
                <option value="">Pilih platform</option>
                {platformOptions.map((platform) => (
                  <option key={platform} value={platform}>{platform}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-2">
              <Form.Label>Language <Badge bg="danger">Wajib</Badge></Form.Label>
              <Form.Select value={state.language} onChange={(e) => set('language', e.target.value)}>
                <option value="Indonesia">Indonesia</option>
                <option value="English">English</option>
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        <h6>Strategy</h6>
        <Form.Group className="mb-2">
          <Form.Label>Goals (enter then press Enter) <Badge bg="danger">Wajib</Badge></Form.Label>
          <InputGroup className="mb-2">
            <Form.Control
              placeholder="goal"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const value = e.target.value.trim()
                  if (value) {
                    setState((prev) => ({ ...prev, strategy: { ...prev.strategy, goals: [...prev.strategy.goals, value] } }))
                    e.target.value = ''
                  }
                }
              }}
            />
          </InputGroup>
          <div>{state.strategy.goals.map((goal, idx) => <Badge key={idx} bg="info" className="me-1" style={{ cursor: 'pointer' }} onClick={() => removeArrayItem('strategy.goals', idx)}>{goal} x</Badge>)}</div>
        </Form.Group>

        <Form.Group className="mb-2">
          <Form.Label>Emotion Triggers (comma separated) <Badge bg="danger">Wajib</Badge></Form.Label>
          <Form.Control value={state.strategy.emotionTriggers.join(', ')} onChange={(e) => set('strategy.emotionTriggers', e.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
        </Form.Group>

        <Form.Group className="mb-2">
          <Form.Label>Target Audience <Badge bg="danger">Wajib</Badge></Form.Label>
          <Form.Control value={state.strategy.targetAudience} onChange={(e) => set('strategy.targetAudience', e.target.value)} />
        </Form.Group>

        <Form.Group className="mb-2">
          <Form.Label>Keywords (comma separated) <Badge bg="danger">Wajib</Badge></Form.Label>
          <Form.Control value={state.keywords.join(', ')} onChange={(e) => set('keywords', e.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
        </Form.Group>

        <h6>CTA</h6>
        {state.cta.map((cta, idx) => (
          <div key={idx} className="d-flex gap-2 mb-2">
            <Form.Control value={cta.type} placeholder="type" onChange={(e) => set(`cta.${idx}.type`, e.target.value)} />
            <Form.Control value={cta.text} placeholder="text" onChange={(e) => set(`cta.${idx}.text`, e.target.value)} />
            <Button variant="outline-danger" onClick={() => removeArrayItem('cta', idx)}>Hapus</Button>
          </div>
        ))}
        <Button size="sm" onClick={() => addArrayItem('cta', { type: 'primary', text: '' })}>Tambah CTA</Button>

        <div className="mt-4">
          <Button type="button" variant="outline-secondary" size="sm" onClick={() => setShowAdvanced((visible) => !visible)}>
            {showAdvanced ? 'Sembunyikan Lanjutan' : 'Tampilkan Lanjutan (opsional)'}
          </Button>
        </div>

        {showAdvanced && (
          <>
            <h6 className="mt-3">Lanjutan (opsional)</h6>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>ID (teknis)</Form.Label>
                  <Form.Control value={state.id} onChange={(e) => set('id', e.target.value)} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Version (teknis)</Form.Label>
                  <Form.Control value={state.version} onChange={(e) => set('version', e.target.value)} />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Category</Form.Label>
                  <Form.Control value={state.category} onChange={(e) => set('category', e.target.value)} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Engine</Form.Label>
                  <Form.Control value={state.engine} onChange={(e) => set('engine', e.target.value)} />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-2">
              <Form.Label>Tags</Form.Label>
              <InputGroup className="mb-2">
                <Form.Control
                  placeholder="Tambahkan tag dan tekan Enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const value = e.target.value.trim()
                      if (value) {
                        setState((prev) => ({ ...prev, tags: [...prev.tags, value] }))
                        e.target.value = ''
                      }
                    }
                  }}
                />
              </InputGroup>
              <div>{state.tags.map((tag, idx) => <Badge bg="secondary" key={idx} className="me-1" onClick={() => removeArrayItem('tags', idx)} style={{ cursor: 'pointer' }}>{tag} x</Badge>)}</div>
            </Form.Group>

            <h6>Content Structure</h6>
            <Row>
              <Col md={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Length</Form.Label>
                  <Form.Select value={state.contentStructure.length} onChange={(e) => set('contentStructure.length', e.target.value)}>
                    <option value="short">short</option>
                    <option value="medium">medium</option>
                    <option value="long">long</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={8}>
                <Form.Group className="mb-2">
                  <Form.Label>Format</Form.Label>
                  <Form.Control value={state.contentStructure.format} onChange={(e) => set('contentStructure.format', e.target.value)} />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-2">
              <Form.Label>Placeholders</Form.Label>
              {state.contentStructure.placeholders.map((placeholder, idx) => (
                <div key={idx} className="mb-2 d-flex gap-2">
                  <Form.Control placeholder="name" value={placeholder.name} onChange={(e) => set(`contentStructure.placeholders.${idx}.name`, e.target.value)} />
                  <Form.Control placeholder="type" value={placeholder.type || ''} onChange={(e) => set(`contentStructure.placeholders.${idx}.type`, e.target.value)} />
                  <Form.Control placeholder="default" value={placeholder.default || ''} onChange={(e) => set(`contentStructure.placeholders.${idx}.default`, e.target.value)} />
                  <Button variant="outline-danger" onClick={() => removeArrayItem('contentStructure.placeholders', idx)}>Hapus</Button>
                </div>
              ))}
              <Button size="sm" onClick={() => addArrayItem('contentStructure.placeholders', { name: '', type: '', default: '' })}>Tambah Placeholder</Button>
            </Form.Group>

            <h6>Hashtags</h6>
            <Form.Group className="mb-2">
              <Form.Label>Hashtags Strategy</Form.Label>
              <Row>
                <Col>
                  <Form.Control value={state.hashtags.strategy} onChange={(e) => set('hashtags.strategy', e.target.value)} />
                </Col>
                <Col md={3}>
                  <Form.Control type="number" value={state.hashtags.count} onChange={(e) => set('hashtags.count', Number(e.target.value || 0))} />
                </Col>
              </Row>
            </Form.Group>

            <h6>Audio</h6>
            <Row>
              <Col>
                <Form.Group className="mb-2">
                  <Form.Label>Recommendation</Form.Label>
                  <Form.Control value={state.audio.recommendation} onChange={(e) => set('audio.recommendation', e.target.value)} />
                </Form.Group>
              </Col>
              <Col>
                <Form.Group className="mb-2">
                  <Form.Label>Style</Form.Label>
                  <Form.Control value={state.audio.style} onChange={(e) => set('audio.style', e.target.value)} />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col>
                <Form.Group className="mb-2">
                  <Form.Label>Mood</Form.Label>
                  <Form.Control value={state.audio.mood} onChange={(e) => set('audio.mood', e.target.value)} />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-2">
                  <Form.Label>Length (sec)</Form.Label>
                  <Form.Control type="number" value={state.audio.lengthSec} onChange={(e) => set('audio.lengthSec', Number(e.target.value || 0))} />
                </Form.Group>
              </Col>
            </Row>

            <h6>Constraints</h6>
            <Form.Group className="mb-2">
              <Form.Label>Forbidden Words (comma separated)</Form.Label>
              <Form.Control value={state.constraints.forbiddenWords.join(', ')} onChange={(e) => set('constraints.forbiddenWords', e.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Variation Count</Form.Label>
              <Form.Control type="number" value={state.constraints.variationCount} onChange={(e) => set('constraints.variationCount', Number(e.target.value || 1))} />
            </Form.Group>

            <h6>Analytics</h6>
            <Form.Check type="checkbox" label="Tracking Enabled" checked={!!state.analytics.trackingEnabled} onChange={(e) => set('analytics.trackingEnabled', e.target.checked)} />
            <Form.Group className="mb-2 mt-2">
              <Form.Label>Expected KPI (optional)</Form.Label>
              <Form.Control value={state.analytics.expectedKPI || ''} onChange={(e) => set('analytics.expectedKPI', e.target.value)} />
            </Form.Group>

            <h6>Examples</h6>
            {state.examples.map((example, idx) => (
              <div key={idx} className="mb-2">
                <Form.Group className="mb-1">
                  <Form.Label>Input (JSON)</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={JSON.stringify(example.input || {})}
                    onChange={(e) => {
                      try { set(`examples.${idx}.input`, JSON.parse(e.target.value)) } catch {}
                    }}
                  />
                </Form.Group>
                <Form.Group>
                  <Form.Label>Output (string or JSON)</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={typeof example.output === 'string' ? example.output : JSON.stringify(example.output || {})}
                    onChange={(e) => {
                      const value = e.target.value
                      try { set(`examples.${idx}.output`, JSON.parse(value)) } catch { set(`examples.${idx}.output`, value) }
                    }}
                  />
                </Form.Group>
                <Button variant="outline-danger" size="sm" onClick={() => removeArrayItem('examples', idx)}>Hapus Example</Button>
              </div>
            ))}
            <Button size="sm" onClick={() => addArrayItem('examples', { input: {}, output: '' })}>Tambah Example</Button>
          </>
        )}

        <div className="d-flex justify-content-end gap-2 mt-3">
          <Button variant="secondary" onClick={onCancel}>Batal</Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>Simpan</Button>
        </div>
      </Form>
    </div>
  )
}
