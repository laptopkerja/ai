import axios from 'axios'

async function test() {
  const ports = [3000,3001,3002,3003]
  let url = process.env.API_URL || null
  if (!url) {
    for (const p of ports) {
      try {
        // quick ping
        await axios.get(`http://localhost:${p}/api/presets`, { timeout: 800 })
        url = `http://localhost:${p}`
        break
      } catch (e) {
        // try next
      }
    }
  }
  if (!url) {
    console.error('No server found on ports', ports)
    return
  }
  const presetId = 'promo-shopee-001'
  console.log('Using API:', url)
  try {
    const r = await axios.post(`${url}/api/generate`, { mode: 'preset', presetId })
    console.log('Preset generate OK status', r.status)
    console.log('Title:', r.data.data.title)
  } catch (e) {
    if (e.response) console.error('Preset generate ERROR', e.response.status, JSON.stringify(e.response.data))
    else console.error('Preset generate EX', e.stack || e.message)
  }

  try {
    const r2 = await axios.post(`${url}/api/generate`, { mode: 'preset', presetId, override: { newIllegalField: 'x' } })
    console.error('Override-inject should have failed but got:', r2.status, r2.data)
    process.exitCode = 2
  } catch (e) {
    if (e.response) console.error('Override-inject expected failure:', e.response.status, JSON.stringify(e.response.data))
    else console.error('Override-inject EX', e.stack || e.message)
  }

  // Manual mode test with current contract (manualConfig)
  try {
    const manualPayload = {
      mode: 'manual',
      provider: 'OpenAI',
      model: 'gpt-4',
      manualConfig: {
        topic: 'Tes manual generate',
        platform: 'TikTok',
        language: 'Indonesia',
        contentStructure: { length: 'short', format: 'text' }
      }
    }
    const r3 = await axios.post(`${url}/api/generate`, manualPayload)
    console.log('Manual generate OK', r3.status)
  } catch (e) {
    if (e.response) console.error('Manual generate ERROR', e.response.status, JSON.stringify(e.response.data))
    else console.error('Manual generate EX', e.stack || e.message)
    process.exitCode = 2
  }
}

test()
