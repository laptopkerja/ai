import app from '../server/index.js'

function ensureLeadingSlash(value) {
  const raw = String(value || '').trim()
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

function normalizePathFromQuery(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace(/^\/+/, '').replace(/\/+/g, '/')
}

function restorePathFromRewriteQuery(req) {
  const rawUrl = ensureLeadingSlash(req?.url || '/')
  let parsed
  try {
    parsed = new URL(rawUrl, 'http://localhost')
  } catch (e) {
    return
  }

  const rewrittenPath = normalizePathFromQuery(
    parsed.searchParams.get('__path') || parsed.searchParams.get('path')
  )
  if (!rewrittenPath) return

  parsed.searchParams.delete('__path')
  parsed.searchParams.delete('path')
  const query = parsed.searchParams.toString()
  const nextPath = `/api/${rewrittenPath}`
  req.url = query ? `${nextPath}?${query}` : nextPath
}

function restoreApiPrefix(req) {
  restorePathFromRewriteQuery(req)
  const currentUrl = ensureLeadingSlash(req?.url || '/')
  if (currentUrl === '/api' || currentUrl.startsWith('/api/')) return
  req.url = currentUrl === '/' ? '/api' : `/api${currentUrl}`
}

export default function vercelExpressAdapter(req, res) {
  restoreApiPrefix(req)
  return app(req, res)
}
