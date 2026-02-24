import crypto from 'crypto'

function decodeKeyFromEnv() {
  const raw = String(process.env.PROVIDER_KEYS_ENC_KEY_B64 || '').trim()
  if (!raw) return null
  try {
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) return null
    return key
  } catch (e) {
    return null
  }
}

export function hasProviderKeyEncryptionKey() {
  return !!decodeKeyFromEnv()
}

export function encryptProviderApiKey(apiKeyPlaintext) {
  const key = decodeKeyFromEnv()
  if (!key) {
    throw new Error('PROVIDER_KEYS_ENC_KEY_B64 is not configured or invalid (must decode to 32 bytes)')
  }
  const plaintext = String(apiKeyPlaintext || '')
  if (!plaintext) {
    throw new Error('apiKey plaintext is empty')
  }

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    key_ciphertext: encrypted.toString('base64'),
    key_iv: iv.toString('base64'),
    key_tag: tag.toString('base64')
  }
}

export function decryptProviderApiKey(row) {
  const key = decodeKeyFromEnv()
  if (!key) {
    throw new Error('PROVIDER_KEYS_ENC_KEY_B64 is not configured or invalid (must decode to 32 bytes)')
  }
  if (!row || !row.key_ciphertext || !row.key_iv || !row.key_tag) {
    throw new Error('Encrypted provider key payload is incomplete')
  }

  const ciphertext = Buffer.from(String(row.key_ciphertext), 'base64')
  const iv = Buffer.from(String(row.key_iv), 'base64')
  const tag = Buffer.from(String(row.key_tag), 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

