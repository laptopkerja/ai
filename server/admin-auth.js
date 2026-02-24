import express from 'express'
import { createClient } from '@supabase/supabase-js'

const router = express.Router()

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_INTERNAL_TOKEN = process.env.ADMIN_INTERNAL_TOKEN || process.env.ADMIN_TOKEN
const ENFORCE_AUTH_EMAIL_ALLOWLIST = String(process.env.ENFORCE_AUTH_EMAIL_ALLOWLIST || 'true').toLowerCase() !== 'false'
const AUTH_ALLOWED_EMAILS = parseEmailAllowlist(
  process.env.AUTH_ALLOWED_EMAILS
  || process.env.ALLOWED_LOGIN_EMAILS
  || process.env.LOGIN_EMAIL_ALLOWLIST
  || ''
)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY env for admin router')
}

const admin = (SUPABASE_URL && SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

function sanitizeSupabaseError(err) {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  return err.message || 'Supabase operation failed'
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function parseEmailAllowlist(raw) {
  const out = new Set()
  String(raw || '')
    .split(/[\s,;]+/)
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
    .forEach((item) => {
      if (isValidEmail(item)) out.add(item)
    })
  return out
}

function isStrongEnoughPassword(password) {
  return typeof password === 'string' && password.length >= 8
}

function requireAdmin(req, res, next) {
  if (!admin) return res.status(503).json({ error: 'Admin service is not configured' })
  const token = req.headers['x-admin-token'] || req.headers['x-internal-token']
  if (!ADMIN_INTERNAL_TOKEN) return res.status(500).json({ error: 'ADMIN_INTERNAL_TOKEN not configured on server' })
  if (!token || token !== ADMIN_INTERNAL_TOKEN) return res.status(403).json({ error: 'Forbidden' })
  next()
}

router.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - started
    console.log(`[admin] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`)
  })
  next()
})

// Create user (admin)
router.post('/create-user', requireAdmin, async (req, res) => {
  try {
    const { email, password, confirm = false } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) return res.status(400).json({ error: 'Invalid email format' })
    if (!isStrongEnoughPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    if (ENFORCE_AUTH_EMAIL_ALLOWLIST && !AUTH_ALLOWED_EMAILS.size) {
      return res.status(503).json({ error: 'AUTH_ALLOWED_EMAILS is empty while allowlist enforcement is enabled' })
    }
    if (ENFORCE_AUTH_EMAIL_ALLOWLIST && !AUTH_ALLOWED_EMAILS.has(normalizedEmail)) {
      return res.status(403).json({ error: 'EMAIL_NOT_ALLOWED' })
    }

    // Use Supabase Admin API to create user
    const { data, error } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: confirm
    })

    if (error) return res.status(400).json({ error: sanitizeSupabaseError(error) })
    return res.json({ ok: true, data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || String(err) })
  }
})

// Confirm user by id (admin)
router.post('/confirm-user', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body
    if (!user_id || !/^[0-9a-fA-F-]{36}$/.test(String(user_id))) return res.status(400).json({ error: 'valid user_id required' })

    // Update user to mark email confirmed. API shape may vary by supabase-js version.
    const { data, error } = await admin.auth.admin.updateUserById(user_id, {
      email_confirm: true
    })

    if (error) return res.status(400).json({ error: sanitizeSupabaseError(error) })
    return res.json({ ok: true, data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || String(err) })
  }
})

// Admin helper: create storage bucket (protected)
router.post('/create-bucket', requireAdmin, async (req, res) => {
  try {
    const { name, public: isPublic = false } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name required' })
    if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(String(name))) return res.status(400).json({ error: 'Invalid bucket name format' })

    // create bucket using service role client
    const { data, error } = await admin.storage.createBucket(name, { public: !!isPublic })
    if (error) return res.status(400).json({ error: sanitizeSupabaseError(error) })
    return res.json({ ok: true, data })
  } catch (err) {
    console.error('create-bucket failed', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
})

export default router
