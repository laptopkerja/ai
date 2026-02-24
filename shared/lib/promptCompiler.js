function getPath(obj, path) {
  if (!path) return undefined
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    // support array index like cta.0.text
    if (/^\d+$/.test(p)) {
      cur = cur[Number(p)]
    } else {
      cur = cur[p]
    }
  }
  return cur
}

function stringifyValue(val) {
  if (val == null) return ''
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

export function compilePrompt(template, config = {}) {
  if (!template || typeof template !== 'string') return ''
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
    const v = getPath(config, key.trim())
    return stringifyValue(v)
  })
}

export function defaultTemplateForConfig(config = {}) {
  // Baseline contract for Manual mode so output stays focused and safe.
  return [
    'Anda adalah content strategist untuk konten digital yang harus tepat sasaran.',
    'Konteks inti:',
    '- Platform: {{platform}}',
    '- Topik/ide: {{topic}}',
    '- Bahasa: {{language}}',
    '- Tone: {{tone}}',
    '- Panjang: {{contentStructure.length}}',
    '- Goal utama: {{goal}}',
    '- Target audience: {{targetAudience}}',
    '- Keyword penting: {{keywords}}',
    '- CTA prioritas: {{cta.0.text}}',
    'Target output:',
    '- Hook tajam, narasi jelas, deskripsi ringkas, hashtag relevan.',
    '- Narrator wajib format scene-by-length (short=3 scene, medium=5 scene, long=7 scene).',
    '- Audio recommendation wajib format 5 field: Style, Mood, Genre, Suggestion, Length.',
    '- Audio recommendation harus berupa referensi musik, bukan dialog/CTA.',
    'Larangan:',
    '- Hindari klaim absolut (100%, pasti untung, garansi hasil, auto viral).',
    '- Hindari kata spam/scam/clickbait dan hashtag berisiko.'
  ].join('\n')
}

export default compilePrompt
