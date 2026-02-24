import fs from 'fs'
import path from 'path'
import normalizePreset from '../shared/lib/normalizePreset.js'
import validateTemplate from '../shared/lib/validateTemplate.js'
import axios from 'axios'

function loadJson(rel) {
  const p = path.resolve(process.cwd(), rel)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p,'utf8')) } catch (e) { return null }
}

async function tryPost(preset) {
  const url = 'http://localhost:3000/api/presets'
  try {
    const resp = await axios.post(url, preset, { timeout: 3000 })
    return { status: resp.status, ok: resp.status >= 200 && resp.status < 300, body: resp.data }
  } catch (e) {
    if (e.response) return { status: e.response.status, ok: false, body: e.response.data }
    return { error: e.message }
  }
}

async function tryPatch(preset) {
  const url = `http://localhost:3000/api/presets/${encodeURIComponent(preset.id)}`
  try {
    const resp = await axios.patch(url, preset, { timeout: 3000 })
    return { status: resp.status, ok: resp.status >= 200 && resp.status < 300, body: resp.data }
  } catch (e) {
    if (e.response) return { status: e.response.status, ok: false, body: e.response.data }
    return { error: e.message }
  }
}

async function main() {
  const files = ['public/example-format-template-converted-by-script.json', 'public/sample-presets-format1.json', 'data/presets.json']
  for (const f of files) {
    const arr = loadJson(f)
    if (!arr) { console.log(`SKIP ${f}`); continue }
    console.log(`\nProcessing ${f} (${arr.length} items)`)
    for (let i=0;i<arr.length;i++) {
      const item = arr[i]
      const normalized = normalizePreset(item)
      const errs = validateTemplate(normalized)
      if (errs.length) {
        console.log(`- Item ${i} id=${item.id||'<no-id>'} -> INVALID:`)
        errs.forEach(e=>console.log(`   • ${e}`))
        continue
      }
      console.log(`- Item ${i} id=${normalized.id} -> VALID`)
      const res = await tryPost(normalized)
      if (res.error) {
        console.log(`  • POST failed: ${res.error} (server may be down). Skipping network test.`)
        continue
      }
      if (res.status === 201) {
        console.log(`  • POST succeeded: created`) 
        continue
      }
      if (res.status === 409) {
        console.log(`  • POST conflict (exists). Trying PATCH`)
        const r2 = await tryPatch(normalized)
        if (r2.error) console.log(`    - PATCH failed: ${r2.error}`)
        else if (r2.ok) console.log(`    - PATCH succeeded`) 
        else console.log(`    - PATCH response status ${r2.status}`, r2.body)
        continue
      }
      console.log(`  • POST response ${res.status}`, res.body)
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1) })
