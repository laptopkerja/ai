import fs from 'fs'
import path from 'path'
import Ajv from 'ajv'

const schemaPath = path.resolve(process.cwd(), 'shared/templates/template.schema.json')
const dataPath = path.resolve(process.cwd(), 'data/presets.json')
const schema = JSON.parse(fs.readFileSync(schemaPath,'utf8'))
const data = JSON.parse(fs.readFileSync(dataPath,'utf8'))

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

const item = data[0]
const ok = validate(item)
console.log('Valid?', ok)
if (!ok) {
  console.log('Errors detail:')
  console.log(validate.errors)
}
