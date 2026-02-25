import test from 'node:test'
import assert from 'node:assert/strict'
import { applyGenerationQualityGuardrails } from '../../server/lib/generationQuality.js'

test('audio is normalized to 5-field format and narrator to scene-by-length', () => {
  const input = {
    title: 'Review HP budget',
    hook: 'Cek ini sekarang',
    narrator: 'Ulasan cepat handphone budget terbaru.',
    description: 'Ringkasan fitur utama untuk audiens TikTok.',
    hashtags: ['#reviewhp', '#budgetphone'],
    audioRecommendation: 'Jangan lupa follow untuk review lengkap berikutnya.',
    meta: { warnings: [] }
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'TikTok',
    language: 'Indonesia',
    tone: 'Fun',
    contentLength: 'short'
  })

  assert.match(String(out.audioRecommendation), /^Style:/m)
  assert.match(String(out.audioRecommendation), /^Mood:/m)
  assert.match(String(out.audioRecommendation), /^Genre:/m)
  assert.match(String(out.audioRecommendation), /^Suggestion:/m)
  assert.match(String(out.audioRecommendation), /^Length:\s*30s$/m)

  const sceneLines = String(out.narrator).split('\n').filter((line) => /^Scene\s+\d+\s+\(\d+-\d+s\):/i.test(line))
  assert.equal(sceneLines.length, 3)
  assert.equal(typeof out.meta.complianceScore, 'number')
  assert.equal(typeof out.meta.performancePotentialScore, 'number')
  assert.equal(typeof out.meta.finalScore, 'number')
  assert.ok(['GO', 'REVISE', 'BLOCK'].includes(String(out.meta.aiDecision?.status || '')))
})

test('critical safety hits force AI decision BLOCK and cap final score', () => {
  const input = {
    title: '100% pasti untung sekarang',
    hook: 'Kamu tidak akan percaya hasilnya',
    narrator: 'Klik link bio agar cepat kaya.',
    description: 'Transfer dulu untuk profit harian dan garansi hasil.',
    hashtags: ['#reviewproduk', '#tipsaman'],
    audioRecommendation: [
      'Style: Soft beat aesthetic',
      'Mood: Fresh confident',
      'Genre: Chill pop',
      'Suggestion: Creator sound medium tempo',
      'Length: 30s'
    ].join('\n')
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'TikTok',
    language: 'Indonesia',
    contentLength: 'short'
  })

  assert.equal(out.meta.aiDecision.status, 'BLOCK')
  assert.ok(Number(out.meta.finalScore) <= 49)
  assert.ok(out.meta.qualitySummary.scamHitsRemoved > 0)
  assert.equal(String(out.title).toLowerCase().includes('100%'), false)
  assert.equal(String(out.narrator).toLowerCase().includes('klik link bio'), false)
})

test('strong compliant output can pass GO decision with gate model scoring', () => {
  const input = {
    title: 'Review iPhone 13 Pro untuk creator 2026',
    hook: 'Masih worth it dipakai konten harian di 2026?',
    narrator: [
      'Scene 1 (0-10s): Buka dengan pertanyaan apakah iPhone 13 Pro masih relevan.',
      'Scene 2 (10-20s): Tunjukkan hasil kamera low light dan stabilisasi video.',
      'Scene 3 (20-30s): Tutup dengan CTA untuk simpan dan komentar kebutuhan review berikutnya.'
    ].join('\n'),
    description: 'Ringkas performa, kamera, dan baterai untuk creator TikTok.',
    hashtags: ['#tiktok', '#reviewhp', '#iphone13pro', '#creator', '#techtips'],
    audioRecommendation: [
      'Style: Soft beat aesthetic, clean, calming dengan build up halus di detik 3',
      'Mood: Fresh, hopeful, confident, bikin rileks dan pede',
      'Genre: Chill pop, soft EDM, aesthetic creator sound',
      'Suggestion: Pilih sound viral creator 7-14 hari terakhir dengan transisi lembut detik 3-5.',
      'Length: 30s'
    ].join('\n')
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'TikTok',
    language: 'Indonesia',
    contentLength: 'short',
    keywords: ['iphone 13 pro', 'review kamera', 'creator'],
    ctaTexts: ['Simpan video ini lalu komentar tipe review berikutnya.']
  })

  assert.equal(out.meta.aiDecision.status, 'GO')
  assert.ok(Number(out.meta.complianceScore) >= 85)
  assert.ok(Number(out.meta.performancePotentialScore) >= 60)
  assert.ok(Number(out.meta.finalScore) > 0)
  assert.ok(Array.isArray(out.meta.complianceChecks))
  assert.ok(Array.isArray(out.meta.performanceChecks))
})

test('instruction-like narrator scenes are rewritten to ready-to-speak lines', () => {
  const input = {
    title: 'Review serial terbaru minggu ini',
    hook: 'Serial ini lagi ramai, tapi apa memang se-worth it itu?',
    narrator: [
      'Scene 1 (0-10s): Buka dengan hook: serial ini lagi ramai.',
      'Scene 2 (10-20s): Sebut pain point audiens dan kenapa serial ini relevan.',
      'Scene 3 (20-30s): Tutup dengan CTA lembut untuk simpan atau komentar.'
    ].join('\n'),
    description: 'Ringkas poin kuat, kelemahan, dan siapa audiens yang cocok menonton.',
    hashtags: ['#review', '#serial', '#tiktok'],
    audioRecommendation: [
      'Style: Soft beat aesthetic',
      'Mood: Fresh confident',
      'Genre: Chill pop',
      'Suggestion: Creator sound medium tempo',
      'Length: 30s'
    ].join('\n')
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'TikTok',
    language: 'Indonesia',
    contentLength: 'short',
    topic: 'review serial terbaru'
  })

  assert.equal(String(out.narrator).toLowerCase().includes('buka dengan hook'), false)
  assert.equal(String(out.narrator).toLowerCase().includes('sebut pain point'), false)
  assert.equal(String(out.narrator).toLowerCase().includes('tutup dengan cta'), false)
  assert.equal(String(out.narrator).toLowerCase().includes('fokus ke hype, bukan kebutuhan nyata'), false)
  assert.match(String(out.narrator), /Scene 1 \(0-10s\):/i)
  assert.match(String(out.narrator), /Scene 2 \(10-20s\):/i)
  assert.match(String(out.narrator), /Scene 3 \(20-30s\):/i)
})

test('short narrator scene 2 uses contextual narrative instead of static generic line', () => {
  const input = {
    title: 'Movie Shelter',
    hook: 'Jason Statham kembali dengan aksi menegangkan di Shelter.',
    narrator: 'Cerita berfokus pada konflik masa lalu, tekanan moral, dan keputusan berisiko dalam situasi darurat.',
    description: 'Ulas kekuatan cerita, tensi aksi, dan alasan film ini relevan buat penonton action-thriller.',
    hashtags: ['#movieshelter', '#reviewfilm'],
    audioRecommendation: [
      'Style: Soft beat aesthetic',
      'Mood: Fresh confident',
      'Genre: Chill pop',
      'Suggestion: Creator sound medium tempo',
      'Length: 30s'
    ].join('\n')
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'TikTok',
    language: 'Indonesia',
    contentLength: 'short',
    topic: 'movie Shelter'
  })

  const scene2Line = String(out.narrator)
    .split('\n')
    .find((line) => /^Scene\s+2\s+\(\d+-\d+s\):/i.test(line))

  assert.ok(scene2Line, 'Scene 2 line should exist')
  assert.equal(String(scene2Line).toLowerCase().includes('fokus ke hype, bukan kebutuhan nyata'), false)
  assert.match(String(scene2Line), /(konflik|tekanan moral|keputusan berisiko|tensi aksi|kekuatan cerita)/i)
})

test('medium narrator rewrites clipped directive fragments into contextual scene lines', () => {
  const input = {
    title: 'Movie Shelter Breakdown',
    hook: 'Sebelum nonton, pahami konflik utama Shelter dalam 45 detik.',
    narrator: [
      'Scene 1 (0-9s): Buka dengan hook yang tajam tentang film ini.',
      'Scene 2 (9-18s): Jelaskan poin utama dengan ringkas.',
      'Scene 3 (18-27s): Jelaskan poin utama lanjutan.',
      'Scene 4 (27-36s): Jelaskan poin utama lanjutan.',
      'Scene 5 (36-45s): Tutup dengan CTA lembut untuk komentar.'
    ].join('\n'),
    description: 'Ulas konflik karakter, motivasi tokoh, dan payoff emosi agar penonton bisa menilai apakah film ini cocok dengan selera mereka.',
    hashtags: ['#movieshelter', '#reviewfilm'],
    audioRecommendation: [
      'Style: Soft beat aesthetic',
      'Mood: Fresh confident',
      'Genre: Chill pop',
      'Suggestion: Creator sound medium tempo',
      'Length: 45s'
    ].join('\n')
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'YouTube Short',
    language: 'Indonesia',
    contentLength: 'medium',
    topic: 'Movie Shelter'
  })

  const lines = String(out.narrator).split('\n').filter(Boolean)
  const scene2 = lines.find((line) => /^Scene\s+2\s+\(\d+-\d+s\):/i.test(line)) || ''
  assert.equal(scene2.toLowerCase().includes('utama dengan ringkas'), false)
  assert.equal(scene2.toLowerCase().includes('poin utama lanjutan'), false)
})

test('scene CTA follows preset language and ignores mismatched cta text', () => {
  const input = {
    title: 'Shelter quick review',
    hook: 'Is Shelter worth watching this week?',
    narrator: [
      'Scene 1 (0-10s): Open with hook about Shelter.',
      'Scene 2 (10-20s): State audience pain point and relevance.',
      'Scene 3 (20-30s): Close with soft CTA.'
    ].join('\n'),
    description: 'Break down the conflict setup, pacing, and payoff so viewers can decide faster.',
    hashtags: ['#shelter', '#moviereview'],
    audioRecommendation: [
      'Style: Soft beat aesthetic',
      'Mood: Fresh confident',
      'Genre: Chill pop',
      'Suggestion: Creator sound medium tempo',
      'Length: 30s'
    ].join('\n')
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'TikTok',
    language: 'English',
    contentLength: 'short',
    topic: 'Movie Shelter',
    ctaTexts: ['Follow untuk part 2 dan rekomendasi film lain sesuai genre favorit kamu.']
  })

  const scene3 = String(out.narrator)
    .split('\n')
    .find((line) => /^Scene\s+3\s+\(\d+-\d+s\):/i.test(line)) || ''

  assert.equal(scene3.toLowerCase().includes('untuk part 2'), false)
  assert.match(scene3, /(save|comment|share|follow)/i)
})

test('blogger platform enforces SEO article contract with word range and FAQ structure', () => {
  const input = {
    title: 'Panduan memilih router rumah untuk keluarga',
    hook: 'Cara cepat memilih router yang stabil untuk rumah.',
    narrator: 'Artikel singkat tentang router.',
    description: 'Panduan router rumah.',
    hashtags: ['#blogger', '#router'],
    audioRecommendation: ''
  }

  const out = applyGenerationQualityGuardrails(input, {
    platform: 'Blog Blogger',
    language: 'Indonesia',
    contentLength: 'long',
    topic: 'memilih router rumah untuk keluarga',
    keywords: ['router rumah', 'wifi stabil', 'tips jaringan rumah']
  })

  const words = Number(out.meta?.qualitySummary?.narratorWordCount || 0)
  const metaDescLen = String(out.description || '').length

  assert.ok(words >= 900, `expected narrator words >= 900, got ${words}`)
  assert.ok(words <= 2200, `expected narrator words <= 2200, got ${words}`)
  assert.match(String(out.narrator), /##\s*FAQ/i)
  assert.match(String(out.narrator), /Q1\s*:/i)
  assert.ok(metaDescLen >= 140 && metaDescLen <= 160, `expected meta description 140-160 chars, got ${metaDescLen}`)
  assert.ok(String(out.slug || '').length >= 3)
  assert.ok(Array.isArray(out.internalLinks) && out.internalLinks.length >= 2)
  assert.ok(Array.isArray(out.externalReferences) && out.externalReferences.length >= 1)
  assert.ok(String(out.featuredSnippet || '').length >= 40)
  assert.equal(String(out.audioRecommendation || ''), '')
  assert.ok(!/^Style:/im.test(String(out.audioRecommendation)))
  assert.ok(Array.isArray(out.meta.complianceChecks))
  assert.ok(Array.isArray(out.meta.performanceChecks))
})
