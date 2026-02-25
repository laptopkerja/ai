import React, { useEffect, useState } from 'react'
import { Card, Badge, Button } from 'react-bootstrap'

function qualityGateVariant(gate) {
  if (gate === 'pass') return 'success'
  if (gate === 'retry') return 'warning'
  if (gate === 'fallback') return 'secondary'
  if (gate === 'block') return 'danger'
  return 'dark'
}

function decisionVariant(status) {
  if (status === 'GO') return 'success'
  if (status === 'REVISE') return 'warning'
  if (status === 'BLOCK') return 'danger'
  return 'secondary'
}

function safeClipboardField(value) {
  const text = String(value || '').trim()
  return text || '-'
}

function joinHashtags(value) {
  if (Array.isArray(value)) {
    const tags = value.map((item) => String(item || '').trim()).filter(Boolean)
    return tags.length ? tags.join(', ') : '-'
  }
  return safeClipboardField(value)
}

function joinLines(value, fallback = '-') {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || '').trim()).filter(Boolean)
    if (!items.length) return fallback
    return items.join('\n')
  }
  const text = String(value || '').trim()
  return text || fallback
}

function buildClipboardOutput(item, { isBlogger = false } = {}) {
  const title = safeClipboardField(item?.title)
  const hook = safeClipboardField(item?.hook)
  const description = safeClipboardField(item?.description)
  const hashtags = joinHashtags(item?.hashtags)
  const narrator = safeClipboardField(item?.narrator)
  const audio = safeClipboardField(item?.audioRecommendation || item?.meta?.audio)
  const bloggerPack = item?.meta?.bloggerPublishPack || {}
  const slug = safeClipboardField(item?.slug || bloggerPack?.slug)
  const internalLinks = joinLines(item?.internalLinks || bloggerPack?.internalLinks)
  const externalReferences = joinLines(item?.externalReferences || bloggerPack?.externalReferences)
  const featuredSnippet = safeClipboardField(item?.featuredSnippet || bloggerPack?.featuredSnippet)

  const lines = [
    `Title: ${title}`,
    `Hook: ${hook}`,
    `Deskripsi: ${description}`,
    `Hashtag: ${hashtags}`,
    'Skrip Narator/Voice:',
    narrator
  ]

  if (isBlogger) {
    lines.push(`Slug: ${slug}`)
    lines.push('Internal Links:')
    lines.push(internalLinks)
    lines.push('External References:')
    lines.push(externalReferences)
    lines.push(`Featured Snippet: ${featuredSnippet}`)
  } else {
    lines.push('Audio:')
    lines.push(audio)
  }

  return lines.join('\n')
}

export default function GenerateResult({ item, onCopy, onRegenerate, onSave }) {
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    setActiveIdx(0)
  }, [item])

  if (!item) return null

  const variations = Array.isArray(item.variations) && item.variations.length ? item.variations : [item]

  const activeItem = variations[activeIdx] || item
  const KNOWN_PLATFORMS = [
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

  // Work on a copy of title so we can strip embedded platform/tone
  let title = activeItem.title || ''
  let platform = activeItem.platform || activeItem.meta?.platform
  const provider = activeItem.meta?.provider
  const model = activeItem.meta?.model
  const keySource = activeItem.meta?.keySource
  const providerCall = activeItem.meta?.providerCall
  const warnings = Array.isArray(activeItem.meta?.warnings) ? activeItem.meta.warnings : []
  const visionMode = String(activeItem.meta?.vision?.mode || '')
  let tone = activeItem.meta?.tone || activeItem.tone
  const lang = activeItem.language || activeItem.meta?.language
  const imageReferencesCount = Number(activeItem.meta?.imageReferencesCount || 0)
  const complianceScoreRaw = Number(activeItem.meta?.complianceScore ?? activeItem.meta?.qualityScore)
  const hasComplianceScore = Number.isFinite(complianceScoreRaw)
  const complianceScore = hasComplianceScore ? Math.max(0, Math.min(100, Math.round(complianceScoreRaw))) : null
  const performanceScoreRaw = Number(activeItem.meta?.performancePotentialScore)
  const hasPerformanceScore = Number.isFinite(performanceScoreRaw)
  const performanceScore = hasPerformanceScore ? Math.max(0, Math.min(100, Math.round(performanceScoreRaw))) : null
  const finalScoreRaw = Number(activeItem.meta?.finalScore)
  const hasFinalScore = Number.isFinite(finalScoreRaw)
  const finalScore = hasFinalScore ? Math.max(0, Math.min(100, Number(finalScoreRaw.toFixed(1)))) : null
  const aiDecision = String(activeItem.meta?.aiDecision?.status || '').toUpperCase()
  const aiDecisionReasons = Array.isArray(activeItem.meta?.aiDecision?.reasons)
    ? activeItem.meta.aiDecision.reasons
    : []
  const performanceConfidence = String(activeItem.meta?.performanceConfidence || '').toLowerCase()
  const qualityGate = String(activeItem.meta?.qualityGate || '').toLowerCase()
  const complianceChecks = Array.isArray(activeItem.meta?.complianceChecks)
    ? activeItem.meta.complianceChecks
    : (Array.isArray(activeItem.meta?.qualityChecks) ? activeItem.meta.qualityChecks : [])
  const performanceChecks = Array.isArray(activeItem.meta?.performanceChecks) ? activeItem.meta.performanceChecks : []
  const platformContract = activeItem.meta?.platformContract && typeof activeItem.meta?.platformContract === 'object'
    ? activeItem.meta.platformContract
    : null
  const platformContractAdjustments = activeItem.meta?.platformContractAdjustments && typeof activeItem.meta?.platformContractAdjustments === 'object'
    ? activeItem.meta.platformContractAdjustments
    : null
  const contractStage = Number(platformContract?.stage)
  const contractHasStage = Number.isFinite(contractStage) && contractStage > 0
  const contractHookRange = Array.isArray(platformContract?.hookRange) && platformContract.hookRange.length === 2
    ? platformContract.hookRange
    : null
  const contractDescriptionRange = Array.isArray(platformContract?.descriptionSentences) && platformContract.descriptionSentences.length === 2
    ? platformContract.descriptionSentences
    : null
  const contractHashtagRange = Array.isArray(platformContract?.hashtagRange) && platformContract.hashtagRange.length === 2
    ? platformContract.hashtagRange
    : null
  const contractRequireCta = typeof platformContract?.requireCtaInDescription === 'boolean'
    ? platformContract.requireCtaInDescription
    : null
  const contractCtaStyle = String(platformContract?.ctaStyle || '').trim()
  const contractHookAdjusted = !!platformContractAdjustments?.hookAdjusted
  const contractDescriptionAdjusted = !!platformContractAdjustments?.descriptionAdjusted
  const contractHashtagAdjusted = !!platformContractAdjustments?.hashtagAdjusted
  const contractHashtagRemoved = Number.isFinite(Number(platformContractAdjustments?.hashtagRemoved))
    ? Number(platformContractAdjustments?.hashtagRemoved || 0)
    : null
  const contractHashtagAdded = Number.isFinite(Number(platformContractAdjustments?.hashtagAdded))
    ? Number(platformContractAdjustments?.hashtagAdded || 0)
    : null
  const contractSlugAdjusted = !!platformContractAdjustments?.slugAdjusted
  const contractInternalLinksAdjusted = !!platformContractAdjustments?.internalLinksAdjusted
  const contractExternalReferencesAdjusted = !!platformContractAdjustments?.externalReferencesAdjusted
  const contractFeaturedSnippetAdjusted = !!platformContractAdjustments?.featuredSnippetAdjusted
  const contractArticleWordRange = Array.isArray(platformContract?.articleWordRange) && platformContract.articleWordRange.length === 2
    ? platformContract.articleWordRange
    : null
  const contractArticleTargetWords = Array.isArray(platformContract?.articleTargetWords) && platformContract.articleTargetWords.length === 2
    ? platformContract.articleTargetWords
    : null
  const contractMetaDescriptionChars = Array.isArray(platformContract?.metaDescriptionChars) && platformContract.metaDescriptionChars.length === 2
    ? platformContract.metaDescriptionChars
    : null
  const contractHasAdjustment =
    contractHookAdjusted ||
    contractDescriptionAdjusted ||
    contractHashtagAdjusted ||
    contractSlugAdjusted ||
    contractInternalLinksAdjusted ||
    contractExternalReferencesAdjusted ||
    contractFeaturedSnippetAdjusted
  const contractAdjustmentParts = [
    contractHookAdjusted ? 'Hook adjusted' : null,
    contractDescriptionAdjusted ? 'Description adjusted' : null,
    contractHashtagAdjusted
      ? `Hashtag adjusted${contractHashtagRemoved !== null || contractHashtagAdded !== null
        ? ` (removed ${contractHashtagRemoved ?? 0}, added ${contractHashtagAdded ?? 0})`
        : ''}`
      : null,
    contractSlugAdjusted ? 'Slug adjusted' : null,
    contractInternalLinksAdjusted ? 'Internal links adjusted' : null,
    contractExternalReferencesAdjusted ? 'External refs adjusted' : null,
    contractFeaturedSnippetAdjusted ? 'Featured snippet adjusted' : null
  ].filter(Boolean)
  const hasPlatformContractInfo =
    !!platformContract ||
    !!platformContractAdjustments ||
    contractHasStage ||
    !!contractHookRange ||
    !!contractDescriptionRange ||
    !!contractHashtagRange ||
    contractRequireCta !== null ||
    !!contractCtaStyle
  const LANG_MAP = { 'Indonesia': 'ID', 'Indonesian': 'ID', 'English': 'EN' }
  const langShort = lang ? (LANG_MAP[lang] || String(lang).slice(0, 2).toUpperCase()) : null

  // If title starts with a known platform followed by ' - ', extract it
  if (!platform && title) {
    const parts = title.split(' - ')
    if (parts.length > 1) {
      const cand = parts[0].trim()
      if (KNOWN_PLATFORMS.includes(cand)) {
        platform = cand
        title = parts.slice(1).join(' - ').trim()
      }
    }
  }

  // If title ends with ' (Tone)', extract tone
  if (!tone && title) {
    const m = title.match(/\s*\(([^)]+)\)\s*$/)
    if (m) {
      tone = m[1]
      title = title.replace(/\s*\([^)]+\)\s*$/, '').trim()
    }
  }

  const isBlogger = String(platform || activeItem.meta?.platform || '').toLowerCase() === 'blog blogger'
  const bloggerPack = activeItem.meta?.bloggerPublishPack && typeof activeItem.meta?.bloggerPublishPack === 'object'
    ? activeItem.meta.bloggerPublishPack
    : null
  const bloggerSlug = String(activeItem.slug || bloggerPack?.slug || '').trim()
  const bloggerInternalLinks = Array.isArray(activeItem.internalLinks)
    ? activeItem.internalLinks
    : (Array.isArray(bloggerPack?.internalLinks) ? bloggerPack.internalLinks : [])
  const bloggerExternalReferences = Array.isArray(activeItem.externalReferences)
    ? activeItem.externalReferences
    : (Array.isArray(bloggerPack?.externalReferences) ? bloggerPack.externalReferences : [])
  const bloggerFeaturedSnippet = String(activeItem.featuredSnippet || bloggerPack?.featuredSnippet || '').trim()
  const narratorWordCount = Number(activeItem.meta?.qualitySummary?.narratorWordCount || 0)
  const hookLabel = isBlogger ? 'Lead / Opening:' : 'Hook:'
  const descriptionLabel = isBlogger ? 'Meta Description:' : 'Deskripsi:'
  const hashtagLabel = isBlogger ? 'Labels:' : 'Hashtag:'
  const narratorLabel = isBlogger ? 'Artikel SEO:' : 'Skrip Narator:'
  const audioLabel = 'Audio:'

  return (
    <Card className="mt-3">
      <Card.Body>
        {variations.length > 1 && (
          <div className="mb-2">
            <small className="text-muted d-block mb-1">
              Variations: {variations.length}
              {item?.variation_meta?.requested ? ` (requested ${item.variation_meta.requested})` : ''}
            </small>
            <div className="d-flex gap-1 flex-wrap">
              {variations.map((v, idx) => (
                <Button
                  key={v.id || idx}
                  size="sm"
                  variant={idx === activeIdx ? 'primary' : 'outline-secondary'}
                  onClick={() => setActiveIdx(idx)}
                >
                  V{idx + 1}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="badges-result mb-2">
              {platform && <Badge bg="danger gradient" text="dark" className="me-1">{platform}</Badge>}
              {provider && <Badge bg="info" className="me-1">{provider}</Badge>}
              {model && <Badge bg="primary" className="me-1">{model}</Badge>}
              {keySource && <Badge bg={keySource === 'user' ? 'success' : 'secondary'} className="me-1">{keySource === 'user' ? 'User Key' : 'Server Key'}</Badge>}
              {providerCall && <Badge bg={providerCall === 'real' ? 'success' : 'dark'} className="me-1">{providerCall === 'real' ? 'Real AI' : 'Mock AI'}</Badge>}
              {visionMode === 'multimodal' && <Badge bg="success" className="me-1">Vision ON</Badge>}
              {visionMode === 'text_fallback' && <Badge bg="warning" text="dark" className="me-1">Vision Fallback</Badge>}
              {langShort && <Badge bg="warning" text="dark" className="me-1">{langShort}</Badge>}
              {tone && <Badge bg="secondary" className="me-1">{tone}</Badge>}
              {imageReferencesCount > 0 && <Badge bg="dark" className="me-1">Image Ref: {imageReferencesCount}</Badge>}
              {hasFinalScore && <Badge bg="primary" className="me-1">Final: {finalScore}%</Badge>}
              {hasComplianceScore && <Badge bg="success" className="me-1">Compliance: {complianceScore}</Badge>}
              {hasPerformanceScore && <Badge bg="info" className="me-1">Potential: {performanceScore}</Badge>}
              {aiDecision && <Badge bg={decisionVariant(aiDecision)} className="me-1">Decision: {aiDecision}</Badge>}
              {contractHasStage && <Badge bg="dark" className="me-1">Contract S{contractStage}</Badge>}
              {contractHasAdjustment && <Badge bg="warning" text="dark" className="me-1">Adjusted</Badge>}
              {qualityGate && (
                <Badge bg={qualityGateVariant(qualityGate)} text={qualityGate === 'retry' ? 'dark' : undefined} className="me-1">
                  Gate: {qualityGate}
                </Badge>
              )}
              {activeItem.id && (
                <small className="text-muted ms-2 gen-result-id" title={activeItem.id}>ID: {String(activeItem.id).slice(0, 8)}</small>
              )}
            </div>
        {hasPlatformContractInfo && (
          <div className="mb-2">
            <small className="d-block text-muted">
              Platform Contract{contractHasStage ? ` (Stage ${contractStage})` : ''}:&nbsp;
              Hook {contractHookRange ? `${contractHookRange[0]}-${contractHookRange[1]} char` : '-'} ·
              {isBlogger
                ? `Meta ${contractMetaDescriptionChars ? `${contractMetaDescriptionChars[0]}-${contractMetaDescriptionChars[1]} char` : '-'} · Article ${contractArticleWordRange ? `${contractArticleWordRange[0]}-${contractArticleWordRange[1]} kata` : '-'}`
                : `Desc ${contractDescriptionRange ? `${contractDescriptionRange[0]}-${contractDescriptionRange[1]} kalimat` : '-'} · Hashtag ${contractHashtagRange ? `${contractHashtagRange[0]}-${contractHashtagRange[1]}` : '-'}`}
            </small>
            {isBlogger && (
              <small className="d-block text-muted">
                Target Article Words: {contractArticleTargetWords ? `${contractArticleTargetWords[0]}-${contractArticleTargetWords[1]}` : '-'}
              </small>
            )}
            <small className="d-block text-muted">
              CTA in Description: {contractRequireCta === null ? '-' : (contractRequireCta ? 'required' : 'optional')}
              {contractCtaStyle ? ` · Style: ${contractCtaStyle}` : ''}
            </small>
            <small className={`d-block ${contractHasAdjustment ? 'text-warning' : 'text-muted'}`}>
              Adjustment: {contractHasAdjustment ? contractAdjustmentParts.join(' · ') : 'No adjustment'}
            </small>
          </div>
        )}
        <h5 className="mb-3 text-capitalize">{title}</h5>
        <label className="lb-result">{hookLabel}</label>
        <p> {activeItem.hook}</p>
        <label className="lb-result">{descriptionLabel}</label>
        <p> {activeItem.description}</p>
        <label className="lb-result">{hashtagLabel}</label>
        <div className="mb-2">
          {(activeItem.hashtags || []).map(h => <Badge bg="secondary" className="me-1" key={h}>{h}</Badge>)}
        </div>
        {isBlogger && (
          <>
            <label className="lb-result">Slug:</label>
            <pre style={{ whiteSpace: 'pre-wrap', marginBottom: '.75rem' }}>{bloggerSlug || '—'}</pre>
            <label className="lb-result">Internal Links:</label>
            <pre style={{ whiteSpace: 'pre-wrap', marginBottom: '.75rem' }}>
              {bloggerInternalLinks.length ? bloggerInternalLinks.join('\n') : '—'}
            </pre>
            <label className="lb-result">External References:</label>
            <pre style={{ whiteSpace: 'pre-wrap', marginBottom: '.75rem' }}>
              {bloggerExternalReferences.length ? bloggerExternalReferences.join('\n') : '—'}
            </pre>
            <label className="lb-result">Featured Snippet:</label>
            <pre style={{ whiteSpace: 'pre-wrap', marginBottom: '.75rem' }}>{bloggerFeaturedSnippet || '—'}</pre>
          </>
        )}
        <label className="lb-result">{narratorLabel}</label>
        {isBlogger && narratorWordCount > 0 && (
          <small className="d-block text-muted mb-1">Word count: {narratorWordCount}</small>
        )}
        <pre style={{ whiteSpace: 'pre-wrap', marginBottom: '.75rem' }}>{activeItem.narrator || '—'}</pre>
        {!isBlogger && (
          <>
            <label className="lb-result">{audioLabel}</label>
            <pre className="pre-end">{activeItem.audioRecommendation || activeItem.meta?.audio || '—'}</pre>
          </>
        )}
         
        <div className="d-flex gap-2 btns-result">
          <Button
            size="sm"
            variant="outline-success" className="btn-salin btn-success" 
            onClick={() => {
              const text = buildClipboardOutput(activeItem, { isBlogger })
              navigator.clipboard.writeText(text)
              onCopy && onCopy()
            }}
          >
            Salin
          </Button>
         
          <Button size="sm" variant="primary" className="btn-simpan" onClick={() => onSave && onSave(activeItem)}>Simpan</Button>

           <Button size="sm" variant="outline-warning" className="btn-ulang" onClick={() => onRegenerate && onRegenerate(activeItem)}>Buat Ulang  
          </Button>
        </div>
        {(warnings.length > 0 || hasComplianceScore || hasPerformanceScore || hasFinalScore || aiDecision || complianceChecks.length > 0 || performanceChecks.length > 0) && (
          <div className="report-quality mt-2">
            {warnings.length > 0 && (
              <div className="report-quality-warnings mb-2 text-warning">
                {warnings.map((w, idx) => (
                  <small className="d-block info-output" key={`${idx}-${w}`}>{w}</small>
                ))}
              </div>
            )}
            {(hasComplianceScore || hasPerformanceScore || hasFinalScore || aiDecision) && (
              <div className="report-quality-summary mb-2">
                <small className="d-block text-muted">Quality Compliance Score: {hasComplianceScore ? `${complianceScore}/100` : '—'}</small>
                <small className="d-block text-muted">
                  Performance Potential Score: {hasPerformanceScore ? `${performanceScore}/100` : '—'}
                  {performanceConfidence ? ` (${performanceConfidence})` : ''}
                </small>
                <small className="d-block text-muted">AI Decision: {aiDecision || '—'}</small>
                <small className="d-block text-muted">Final Score (Gate): {hasFinalScore ? `${finalScore}%` : '—'}</small>
                {aiDecisionReasons.map((reason, idx) => (
                  <small className="d-block text-muted" key={`${idx}-${reason}`}>Reason: {reason}</small>
                ))}
              </div>
            )}
            {complianceChecks.length > 0 && (
              <div className="report-quality-compliance mb-2">
                {complianceChecks.map((check) => {
                  const label = String(check?.label || check?.id || 'Check')
                  const awarded = Number(check?.awarded || 0)
                  const weight = Number(check?.weight || 0)
                  const note = String(check?.note || '').trim()
                  return (
                    <small className="d-block text-muted" key={String(check?.id || label)}>
                      Compliance - {label}: {awarded}/{weight}{note ? ` - ${note}` : ''}
                    </small>
                  )
                })}
              </div>
            )}
            {performanceChecks.length > 0 && (
              <div className="report-quality-potential mb-2">
                {performanceChecks.map((check) => {
                  const label = String(check?.label || check?.id || 'Check')
                  const awarded = Number(check?.awarded || 0)
                  const weight = Number(check?.weight || 0)
                  const note = String(check?.note || '').trim()
                  return (
                    <small className="d-block text-muted" key={`perf-${String(check?.id || label)}`}>
                      Potential - {label}: {awarded}/{weight}{note ? ` - ${note}` : ''}
                    </small>
                  )
                })}
              </div>
            )}
          </div>
        )}
       
      </Card.Body>
    </Card>
  )
}
