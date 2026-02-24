#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const CURRENT_ENV_FILE = '.env'
const PROFILE_FILES = {
  primary: '.env.primary',
  backup: '.env.backup'
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseEnvValue(content, key) {
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.*)\\s*$`, 'mi')
  const match = String(content || '').match(pattern)
  return match ? String(match[1] || '').trim() : ''
}

function summarizeEnv(content) {
  const supabaseUrl = parseEnvValue(content, 'SUPABASE_URL') || parseEnvValue(content, 'VITE_SUPABASE_URL')
  const apiUrl = parseEnvValue(content, 'VITE_API_URL')
  return { supabaseUrl, apiUrl }
}

function absolutePath(fileName) {
  return path.join(ROOT_DIR, fileName)
}

async function fileExists(fileName) {
  try {
    await fs.access(absolutePath(fileName))
    return true
  } catch (e) {
    return false
  }
}

async function readText(fileName) {
  return fs.readFile(absolutePath(fileName), 'utf8')
}

async function writeText(fileName, content) {
  await fs.writeFile(absolutePath(fileName), String(content || ''), 'utf8')
}

function printUsage() {
  console.log('Usage:')
  console.log('  node scripts/switch-env.mjs status')
  console.log('  node scripts/switch-env.mjs primary')
  console.log('  node scripts/switch-env.mjs backup')
}

async function printStatus() {
  const hasCurrent = await fileExists(CURRENT_ENV_FILE)
  const hasPrimary = await fileExists(PROFILE_FILES.primary)
  const hasBackup = await fileExists(PROFILE_FILES.backup)

  if (!hasCurrent) {
    console.log('[env] .env belum ada.')
  } else {
    const currentContent = await readText(CURRENT_ENV_FILE)
    const currentSummary = summarizeEnv(currentContent)
    console.log(`[env] current file: ${CURRENT_ENV_FILE}`)
    console.log(`[env] current SUPABASE_URL: ${currentSummary.supabaseUrl || '-'}`)
    console.log(`[env] current VITE_API_URL: ${currentSummary.apiUrl || '-'}`)
    if (hasPrimary) {
      const primaryContent = await readText(PROFILE_FILES.primary)
      if (primaryContent === currentContent) {
        console.log('[env] active profile: primary')
      }
    }
    if (hasBackup) {
      const backupContent = await readText(PROFILE_FILES.backup)
      if (backupContent === currentContent) {
        console.log('[env] active profile: backup')
      }
    }
  }

  console.log(`[env] profile ${PROFILE_FILES.primary}: ${hasPrimary ? 'OK' : 'missing'}`)
  console.log(`[env] profile ${PROFILE_FILES.backup}: ${hasBackup ? 'OK' : 'missing'}`)
}

async function switchProfile(targetProfile) {
  const targetFile = PROFILE_FILES[targetProfile]
  if (!targetFile) {
    printUsage()
    process.exit(1)
  }

  const targetExists = await fileExists(targetFile)
  if (!targetExists) {
    console.error(`[env] file profile tidak ditemukan: ${targetFile}`)
    console.error('[env] buat dulu file profile tersebut, lalu coba lagi.')
    process.exit(1)
  }

  const content = await readText(targetFile)
  if (!String(content || '').trim()) {
    console.error(`[env] file profile kosong: ${targetFile}`)
    process.exit(1)
  }

  await writeText(CURRENT_ENV_FILE, content)
  const summary = summarizeEnv(content)
  console.log(`[env] switched -> ${targetProfile} (${targetFile})`)
  console.log(`[env] SUPABASE_URL: ${summary.supabaseUrl || '-'}`)
  console.log(`[env] VITE_API_URL: ${summary.apiUrl || '-'}`)
  console.log('[env] restart `npm run dev` agar perubahan env terbaca.')
}

async function run() {
  const command = String(process.argv[2] || 'status').trim().toLowerCase()
  if (command === 'status') {
    await printStatus()
    return
  }
  if (command === 'primary' || command === 'backup') {
    await switchProfile(command)
    return
  }
  printUsage()
  process.exit(1)
}

run().catch((err) => {
  console.error('[env] gagal menjalankan switch-env:', err?.message || err)
  process.exit(1)
})

