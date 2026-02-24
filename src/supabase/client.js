import { createClient } from '@supabase/supabase-js'

const RUNTIME_SUPABASE_URL_KEY = 'supabase_runtime_url_v1'
const RUNTIME_SUPABASE_ANON_KEY = 'supabase_runtime_anon_key_v1'

function hasWindow() {
  return typeof window !== 'undefined'
}

function readStorage(key) {
  if (!hasWindow()) return ''
  try {
    return String(window.localStorage.getItem(key) || '').trim()
  } catch (e) {
    return ''
  }
}

function writeStorage(key, value) {
  if (!hasWindow()) return
  try {
    const next = String(value || '').trim()
    if (!next) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, next)
  } catch (e) {}
}

function normalizeSupabaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    return `${parsed.protocol}//${parsed.host}`
  } catch (e) {
    return ''
  }
}

function resolveConfig() {
  const envUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || '')
  const envAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
  const runtimeUrl = normalizeSupabaseUrl(readStorage(RUNTIME_SUPABASE_URL_KEY))
  const runtimeAnonKey = String(readStorage(RUNTIME_SUPABASE_ANON_KEY) || '').trim()

  if (runtimeUrl && runtimeAnonKey) {
    return {
      url: runtimeUrl,
      anonKey: runtimeAnonKey,
      source: 'runtime'
    }
  }

  return {
    url: envUrl,
    anonKey: envAnonKey,
    source: 'env'
  }
}

let activeConfig = resolveConfig()

function buildClient(config) {
  const url = normalizeSupabaseUrl(config?.url || '')
  const anonKey = String(config?.anonKey || '').trim()
  if (!url || !anonKey) {
    // Keep failure explicit so misconfiguration is visible during initialization.
    throw new Error('Supabase client is not configured. Missing URL or anon key.')
  }
  return createClient(url, anonKey)
}

export let supabase = buildClient(activeConfig)

export function getSupabaseClientConfig() {
  return {
    url: activeConfig.url,
    source: activeConfig.source
  }
}

export function setSupabaseRuntimeConfig({ url, anonKey }) {
  const nextUrl = normalizeSupabaseUrl(url)
  const nextAnonKey = String(anonKey || '').trim()
  if (!nextUrl || !nextAnonKey) {
    throw new Error('Supabase runtime config tidak valid')
  }
  writeStorage(RUNTIME_SUPABASE_URL_KEY, nextUrl)
  writeStorage(RUNTIME_SUPABASE_ANON_KEY, nextAnonKey)
  activeConfig = {
    url: nextUrl,
    anonKey: nextAnonKey,
    source: 'runtime'
  }
  supabase = buildClient(activeConfig)
  return getSupabaseClientConfig()
}

export function clearSupabaseRuntimeConfig() {
  writeStorage(RUNTIME_SUPABASE_URL_KEY, '')
  writeStorage(RUNTIME_SUPABASE_ANON_KEY, '')
  activeConfig = resolveConfig()
  supabase = buildClient(activeConfig)
  return getSupabaseClientConfig()
}

