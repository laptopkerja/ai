function isIndex(str) {
  return /^\d+$/.test(str)
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// Apply overrides safely: only replace existing paths, never create new structure.
// overrides: { 'language.tone': 'Formal', 'cta.0.text': 'Buy now' }
export default function applyOverrides(config = {}, overrides = {}) {
  const out = deepClone(config)
  if (!overrides || typeof overrides !== 'object') return out

  for (const [path, value] of Object.entries(overrides)) {
    if (!path) continue
    const parts = path.split('.')
    let cur = out
    let i = 0
    let ok = true
    for (; i < parts.length - 1; i++) {
      const p = parts[i]
      if (isIndex(p)) {
        const idx = Number(p)
        if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) { ok = false; break }
        cur = cur[idx]
      } else {
        if (cur == null || typeof cur !== 'object' || !(p in cur)) { ok = false; break }
        cur = cur[p]
      }
    }
    if (!ok) continue
    const last = parts[parts.length - 1]
    if (isIndex(last)) {
      const idx = Number(last)
      if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) continue
      cur[idx] = value
    } else {
      if (cur == null || typeof cur !== 'object' || !(last in cur)) continue
      cur[last] = value
    }
  }

  return out
}

export { deepClone }
