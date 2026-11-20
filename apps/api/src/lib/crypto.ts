const enc = new TextEncoder()

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

export function randomToken(bytes = 32) {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function hex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return [...view].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)))
}

async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Share links are re-displayable on the dashboard, so the token is stored encrypted, never in clear. */
export async function encryptText(secret: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(value))
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export async function decryptText(secret: string, value: string) {
  const [iv, ciphertext] = value.split('.')
  if (!iv || !ciphertext) throw new Error('Invalid encrypted value')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    await aesKey(secret),
    fromBase64(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}
