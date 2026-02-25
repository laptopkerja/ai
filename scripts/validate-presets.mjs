import fs from 'fs'
import path from 'path'
import validateTemplate from '../shared/lib/validateTemplate.js'
import lintPresetAgainstPlatformContract from '../src/lib/presetPlatformLint.js'

function loadJson(rel) {
  const p = path.resolve(process.cwd(), rel)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p,'utf8')) } catch (e) { return null }
}

const files = ['data/presets.json', 'public/sample-presets-format1.json', 'public/example-format-template-converted-by-script.json']
let hadError = false

for (const f of files) {
  const arr = loadJson(f)
  if (!arr) {
    console.log(`SKIP ${f} (not found or invalid JSON)`)
    continue
  }
  if (!Array.isArray(arr)) {
    console.log(`SKIP ${f} (not an array)`)
    continue
  }
  console.log(`\nValidating ${f} - ${arr.length} items`)
  arr.forEach((item, idx) => {
    try {
      const errs = validateTemplate(item)
      const lint = lintPresetAgainstPlatformContract(item)
      if (errs.length || lint.errors.length) {
        hadError = true
        console.log(`- Item ${idx} id=${item.id || '<no-id>'} -> INVALID:`)
        errs.forEach(e => console.log(`   • ${e}`))
        lint.errors.forEach((e) => console.log(`   • [platform-lint] ${e}`))
      } else {
        console.log(`- Item ${idx} id=${item.id || '<no-id>'} -> OK`)
        if (lint.warnings.length) {
          lint.warnings.forEach((w) => console.log(`   • [warning] ${w}`))
        }
      }
    } catch (e) {
      hadError = true
      console.log(`- Item ${idx} id=${item.id || '<no-id>'} -> EXCEPTION: ${e.message}`)
    }
  })
}

if (hadError) {
  console.error('\nValidation completed: ERRORS FOUND')
  process.exitCode = 2
} else {
  console.log('\nValidation completed: all OK')
  process.exitCode = 0
}
