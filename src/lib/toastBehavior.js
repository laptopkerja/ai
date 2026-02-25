function toLower(value) {
  return String(value || '').trim().toLowerCase()
}

function toSafeDelay(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.round(parsed))
}

export function resolveToastBehavior(options = {}) {
  const mode = toLower(options.mode || 'message')
  const bg = toLower(options.bg || 'secondary')
  const hasExplicitAutohide = typeof options.autohide === 'boolean'
  const hasExplicitDelay = Number.isFinite(Number(options.delay))

  let autohide
  if (hasExplicitAutohide) autohide = options.autohide
  else if (mode === 'confirm' || mode === 'confirm-delete') autohide = false
  else if (bg === 'warning' || bg === 'danger') autohide = false
  else autohide = true

  let delay
  if (hasExplicitDelay) delay = toSafeDelay(options.delay, 0)
  else if (!autohide) delay = 0
  else if (bg === 'success') delay = 3000
  else delay = 2800

  return { autohide, delay }
}

export function mapAlertVariantToToastBg(variant) {
  const key = toLower(variant || 'secondary')
  if (key === 'error') return 'danger'
  if (key === 'warn') return 'warning'
  if (key === 'ok') return 'success'
  if (key === 'primary' || key === 'secondary' || key === 'success' || key === 'danger' || key === 'warning' || key === 'info') {
    return key
  }
  return 'secondary'
}
