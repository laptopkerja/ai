import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_PLATFORMS,
  resolvePlatformOutputContract,
  BLOGGER_SEO_CONTRACT
} from '../../shared/lib/platformContracts.js'

const EXPECTED_PLATFORM_CONTRACT_SNAPSHOT = {
  TikTok: { hookMin: 18, hookMax: 130, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 4, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'comment_share_save', stage: 1 },
  'YouTube Short': { hookMin: 18, hookMax: 140, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 3, hashtagMax: 7, requireCtaInDescription: true, ctaStyle: 'comment_follow', stage: 1 },
  'YouTube Long': { hookMin: 18, hookMax: 180, descriptionMinSentences: 1, descriptionMaxSentences: 4, descriptionMaxChars: 360, hashtagMin: 2, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'watch_comment', stage: 2 },
  Shopee: { hookMin: 18, hookMax: 130, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 3, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'checkout_comment', stage: 2 },
  Tokopedia: { hookMin: 18, hookMax: 130, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 3, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'checkout_comment', stage: 2 },
  Lazada: { hookMin: 18, hookMax: 130, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 3, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'checkout_comment', stage: 2 },
  'Instagram Reels': { hookMin: 18, hookMax: 140, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 4, hashtagMax: 8, requireCtaInDescription: true, ctaStyle: 'comment_share', stage: 1 },
  'Facebook Reels': { hookMin: 18, hookMax: 150, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 3, hashtagMax: 7, requireCtaInDescription: true, ctaStyle: 'comment_share', stage: 2 },
  Pinterest: { hookMin: 18, hookMax: 150, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 2, hashtagMax: 6, requireCtaInDescription: false, ctaStyle: 'save_pin', stage: 2 },
  'WhatsApp Status': { hookMin: 18, hookMax: 120, descriptionMinSentences: 1, descriptionMaxSentences: 2, descriptionMaxChars: 180, hashtagMin: 0, hashtagMax: 2, requireCtaInDescription: false, ctaStyle: 'reply_contact', stage: 2 },
  Threads: { hookMin: 18, hookMax: 170, descriptionMinSentences: 1, descriptionMaxSentences: 4, descriptionMaxChars: 320, hashtagMin: 0, hashtagMax: 3, requireCtaInDescription: true, ctaStyle: 'reply_debate', stage: 1 },
  'WhatsApp Channel': { hookMin: 18, hookMax: 120, descriptionMinSentences: 1, descriptionMaxSentences: 2, descriptionMaxChars: 170, hashtagMin: 0, hashtagMax: 1, requireCtaInDescription: true, ctaStyle: 'react_forward', stage: 2 },
  Telegram: { hookMin: 18, hookMax: 135, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 240, hashtagMin: 0, hashtagMax: 3, requireCtaInDescription: true, ctaStyle: 'reply_vote', stage: 2 },
  LinkedIn: { hookMin: 18, hookMax: 170, descriptionMinSentences: 1, descriptionMaxSentences: 4, descriptionMaxChars: 340, hashtagMin: 1, hashtagMax: 5, requireCtaInDescription: true, ctaStyle: 'comment_follow', stage: 2 },
  'X (Twitter)': { hookMin: 18, hookMax: 120, descriptionMinSentences: 1, descriptionMaxSentences: 2, descriptionMaxChars: 240, hashtagMin: 0, hashtagMax: 3, requireCtaInDescription: true, ctaStyle: 'reply_repost', stage: 2 },
  SoundCloud: { hookMin: 18, hookMax: 130, descriptionMinSentences: 1, descriptionMaxSentences: 3, descriptionMaxChars: 260, hashtagMin: 2, hashtagMax: 6, requireCtaInDescription: true, ctaStyle: 'listen_follow', stage: 2 },
  'Blog Blogger': { hookMin: 18, hookMax: 180, descriptionMinSentences: 1, descriptionMaxSentences: 2, descriptionMaxChars: 180, hashtagMin: 0, hashtagMax: 4, requireCtaInDescription: false, ctaStyle: 'read_comment', stage: 2 }
}

const EXPECTED_BLOGGER_SEO_CONTRACT = {
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

test('platform contract snapshot remains stable per platform', () => {
  const snapshot = Object.fromEntries(
    CANONICAL_PLATFORMS.map((platform) => {
      const contract = resolvePlatformOutputContract(platform)
      return [
        platform,
        {
          hookMin: contract.hookMin,
          hookMax: contract.hookMax,
          descriptionMinSentences: contract.descriptionMinSentences,
          descriptionMaxSentences: contract.descriptionMaxSentences,
          descriptionMaxChars: contract.descriptionMaxChars,
          hashtagMin: contract.hashtagMin,
          hashtagMax: contract.hashtagMax,
          requireCtaInDescription: contract.requireCtaInDescription,
          ctaStyle: contract.ctaStyle,
          stage: contract.stage
        }
      ]
    })
  )

  assert.deepEqual(snapshot, EXPECTED_PLATFORM_CONTRACT_SNAPSHOT)
})

test('blogger seo contract snapshot remains stable', () => {
  assert.deepEqual(BLOGGER_SEO_CONTRACT, EXPECTED_BLOGGER_SEO_CONTRACT)
})
