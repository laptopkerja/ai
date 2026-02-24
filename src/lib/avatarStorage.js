export const AVATAR_BUCKET = 'avatars'

function normalizePath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace(/^\/+/, '')
}

export function extractAvatarPathFromStorageUrl(url, bucket = AVATAR_BUCKET) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`
  ]
  try {
    const parsed = new URL(raw)
    const pathname = String(parsed.pathname || '')
    for (const marker of markers) {
      const idx = pathname.indexOf(marker)
      if (idx < 0) continue
      const pathPart = pathname.slice(idx + marker.length)
      const normalized = normalizePath(decodeURIComponent(pathPart))
      if (normalized) return normalized
    }
  } catch (e) {}
  return ''
}

export function resolveAvatarPathFromMetadata(metadata = {}, bucket = AVATAR_BUCKET) {
  const directPath = normalizePath(metadata?.avatar_path)
  if (directPath) return directPath
  const fromUrl = extractAvatarPathFromStorageUrl(metadata?.avatar_url, bucket)
  return normalizePath(fromUrl)
}

export async function resolveAvatarDisplayUrl({
  supabase,
  metadata = {},
  bucket = AVATAR_BUCKET,
  expiresIn = 3600
} = {}) {
  const directUrl = String(metadata?.avatar_url || '').trim()
  const path = resolveAvatarPathFromMetadata(metadata, bucket)
  if (path && supabase?.storage?.from) {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
      if (!error && data?.signedUrl) {
        return { url: data.signedUrl, path, source: 'signed' }
      }
    } catch (e) {}
  }
  return {
    url: directUrl || '',
    path: path || '',
    source: directUrl ? 'direct' : 'none'
  }
}
