import app from '../server/index.js'

function ensureLeadingSlash(value) {
  const raw = String(value || '').trim()
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

function restoreApiPrefix(req) {
  const currentUrl = ensureLeadingSlash(req?.url || '/')
  if (currentUrl === '/api' || currentUrl.startsWith('/api/')) return
  req.url = currentUrl === '/' ? '/api' : `/api${currentUrl}`
}

export default function vercelExpressAdapter(req, res) {
  restoreApiPrefix(req)
  return app(req, res)
}
