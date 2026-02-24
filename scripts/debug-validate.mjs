import fs from 'fs'
import path from 'path'
import validateTemplate from '../shared/lib/validateTemplate.js'

const p = path.resolve(process.cwd(), 'data/presets.json')
const arr = JSON.parse(fs.readFileSync(p,'utf8'))
const item = arr[0]
console.log('Validating id=', item.id)
const errs = validateTemplate(item)
if (errs.length) {
  console.log('Errors:')
  errs.forEach(e => console.log(' -', e))
} else {
  console.log('No errors')
}
