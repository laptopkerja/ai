import 'dotenv/config'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'

const API_BASE = String(process.env.API_BASE || 'http://localhost:3000').trim()
const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const TARGET_PRESET_IDS = [
  'tokopedia-marketplace-conversion-advanced-001',
  'lazada-marketplace-conversion-advanced-001',
  'linkedin-thought-leadership-advanced-001',
  'x-twitter-engagement-advanced-001',
  'soundcloud-track-promo-advanced-001',
  'blog-blogger-seo-story-advanced-001'
]

function requiredEnv(name, value) {
  if (!value) throw new Error(`Missing required env: ${name}`)
}

function nowIso() {
  return new Date().toISOString()
}

function shortId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function assertApiReachable() {
  try {
    const res = await axios.get(`${API_BASE}/api/health`, { timeout: 5000 })
    if (res.status !== 200) throw new Error(`Unexpected /api/health status ${res.status}`)
  } catch (err) {
    const detail = err?.response?.status
      ? `${err.response.status} ${JSON.stringify(err.response.data || {})}`
      : String(err?.message || err)
    throw new Error(`Cannot reach API ${API_BASE}: ${detail}`)
  }
}

async function createSmokeUser(adminClient) {
  const email = `smoke+${shortId()}@example.com`
  const password = `Sm0ke!${shortId()}Aa`
  const displayName = `Smoke Bot ${new Date().toISOString().slice(0, 19)}`
  const created = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })
  if (created.error || !created.data?.user?.id) {
    throw new Error(`Failed to create smoke user: ${created.error?.message || 'unknown error'}`)
  }
  const userId = created.data.user.id

  // Ensure profile exists so downstream display-name enrichment has deterministic data.
  const profileRow = {
    id: userId,
    email,
    display_name: displayName
  }
  const profileWrite = await adminClient.from('profiles').upsert([profileRow]).select('id').maybeSingle()
  if (profileWrite.error) {
    throw new Error(`Failed to upsert smoke profile: ${profileWrite.error.message || 'unknown error'}`)
  }

  return { userId, email, password, displayName }
}

async function signInSmokeUser(anonClient, email, password) {
  const signed = await anonClient.auth.signInWithPassword({ email, password })
  if (signed.error || !signed.data?.session?.access_token) {
    throw new Error(`Failed to sign in smoke user: ${signed.error?.message || 'missing session token'}`)
  }
  return signed.data.session.access_token
}

async function runPresetFlow(presetId, bearerToken) {
  const headers = { Authorization: `Bearer ${bearerToken}` }
  const outcome = {
    presetId,
    generated: false,
    saved: false,
    generateStatus: null,
    saveStatus: null,
    title: '',
    platform: '',
    error: ''
  }

  try {
    const generateRes = await axios.post(
      `${API_BASE}/api/generate`,
      {
        mode: 'preset',
        presetId
      },
      { headers, timeout: 30000 }
    )
    outcome.generateStatus = generateRes.status
    const body = generateRes.data || {}
    if (!body.ok || !body.data) {
      outcome.error = `Generate response invalid: ${JSON.stringify(body)}`
      return outcome
    }
    const generated = body.data
    outcome.generated = true
    outcome.title = String(generated.title || '').trim()
    outcome.platform = String(generated.platform || '').trim()

    const savePayload = {
      entry: {
        topic: outcome.title || presetId,
        platform: outcome.platform || 'unknown',
        provider: String(generated?.meta?.provider || 'mock').trim() || 'mock',
        result: generated,
        created_at: nowIso()
      }
    }

    const saveRes = await axios.post(`${API_BASE}/api/generations/save`, savePayload, {
      headers,
      timeout: 30000
    })
    outcome.saveStatus = saveRes.status
    const saveBody = saveRes.data || {}
    if (!saveBody.ok) {
      outcome.error = `Save response invalid: ${JSON.stringify(saveBody)}`
      return outcome
    }
    outcome.saved = true
    return outcome
  } catch (err) {
    const detail = err?.response?.status
      ? `${err.response.status} ${JSON.stringify(err.response.data || {})}`
      : String(err?.message || err)
    outcome.error = detail
    return outcome
  }
}

async function deleteSmokeUser(adminClient, userId) {
  if (!userId) return
  await adminClient.auth.admin.deleteUser(userId)
}

function printSummary(rows) {
  const okCount = rows.filter((row) => row.generated && row.saved).length
  const failCount = rows.length - okCount
  console.log('\nSmoke summary:')
  rows.forEach((row) => {
    const mark = row.generated && row.saved ? 'PASS' : 'FAIL'
    const statusPart = `generate=${row.generateStatus || '-'}, save=${row.saveStatus || '-'}`
    const titlePart = row.title ? `, title="${row.title}"` : ''
    const errPart = row.error ? `, error=${row.error}` : ''
    console.log(`- [${mark}] ${row.presetId} (${statusPart}${titlePart}${errPart})`)
  })
  console.log(`\nResult: ${okCount}/${rows.length} PASS, ${failCount} FAIL`)
  return failCount === 0
}

async function main() {
  requiredEnv('VITE_SUPABASE_URL or SUPABASE_URL', SUPABASE_URL)
  requiredEnv('VITE_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY)
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)

  await assertApiReachable()

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  let smokeUser = null
  try {
    smokeUser = await createSmokeUser(adminClient)
    const token = await signInSmokeUser(anonClient, smokeUser.email, smokeUser.password)

    const results = []
    for (const presetId of TARGET_PRESET_IDS) { // eslint-disable-line no-restricted-syntax
      const row = await runPresetFlow(presetId, token) // eslint-disable-line no-await-in-loop
      results.push(row)
    }

    const ok = printSummary(results)
    if (!ok) process.exitCode = 2
  } finally {
    if (smokeUser?.userId) {
      await deleteSmokeUser(adminClient, smokeUser.userId)
    }
  }
}

main().catch((err) => {
  console.error(`Smoke test failed: ${err.message || err}`)
  process.exitCode = 1
})
