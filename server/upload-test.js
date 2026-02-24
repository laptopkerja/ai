import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function run() {
  try {
    // prepare a tiny PNG (1x1 transparent) from base64
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII='
    const buffer = Buffer.from(base64, 'base64')
    const tmpPath = path.join(__dirname, 'tmp-avatar.png')
    fs.writeFileSync(tmpPath, buffer)

    const userId = process.env.TEST_USER_ID || `test-${Date.now()}`
    const filePath = `avatars/${userId}-${Date.now()}.png`

    console.log('Ensuring bucket exists: avatars')
    try {
      await supabase.storage.createBucket('avatars', { public: true })
      console.log('Bucket created (or already existed)')
    } catch (e) {
      // createBucket throws if already exists; ignore
      console.warn('createBucket notice:', e.message || e)
    }

    console.log('Uploading to', filePath)
    const fileStream = fs.createReadStream(tmpPath)
    const { data, error } = await supabase.storage.from('avatars').upload(filePath, fileStream, { upsert: true })
    if (error) {
      console.error('Upload error:', error)
      process.exit(1)
    }
    console.log('Upload succeeded:', data)

    const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(filePath)
    console.log('Public URL:', publicData.publicUrl)

    // cleanup
    fs.unlinkSync(tmpPath)
    process.exit(0)
  } catch (err) {
    console.error('Test failed', err)
    process.exit(1)
  }
}

run()
