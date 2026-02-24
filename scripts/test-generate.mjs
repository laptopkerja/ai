import axios from 'axios'
const API_BASE = process.env.API_BASE || 'http://localhost:3000'

async function run() {
  try {
    // Test preset (template) instant mode without topic
    const payload = { mode: 'preset', presetId: 'preset-konten-iphone-17-pro-max-viral-tiktok', provider: 'OpenAI', model: 'gpt-4' }
    const r = await axios.post(`${API_BASE}/api/generate`, payload, { timeout: 5000 })
    console.log('Status', r.status)
    console.log('Data:', r.data)
  } catch (e) {
    if (e.response) console.error('Error response', e.response.status, e.response.data)
    else console.error('Request error', e.message)
    process.exit(1)
  }
}

run()
