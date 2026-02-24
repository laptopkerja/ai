import Ajv from 'ajv'
import schema from '../templates/template.schema.json' with { type: 'json' }

const ajv = new Ajv({ allErrors: true, strict: true })
const validate = ajv.compile(schema)

export default function validateTemplate(obj) {
  const valid = validate(obj)
  if (valid) return []
  return (validate.errors || []).map((e) => {
    const path = e.instancePath || e.schemaPath || '/'
    return `${path} ${e.message}`
  })
}
