import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENCRYPTION_KEY_SALT = 'drasil-web-cookie-encryption';
const ENCRYPTION_KEY_INFO = 'drasil-web:aes-256-gcm';

const encodeBase64Url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url');
const decodeBase64Url = (value: string): Buffer => Buffer.from(value, 'base64url');

function deriveEncryptionKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error('Encryption secret is not configured.');
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(trimmed, 'utf8'),
      Buffer.from(ENCRYPTION_KEY_SALT, 'utf8'),
      Buffer.from(ENCRYPTION_KEY_INFO, 'utf8'),
      32
    )
  );
}

export function signPayload(payload: string, secret: string): string {
  return encodeBase64Url(createHmac('sha256', secret.trim()).update(payload).digest());
}

export function encodeSignedJson(value: unknown, secret: string): string {
  const payload = encodeBase64Url(JSON.stringify(value));
  return `${payload}.${signPayload(payload, secret)}`;
}

export function decodeSignedJson(token: string, secret: string): unknown | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expected = decodeBase64Url(signPayload(payload, secret));
  const actual = decodeBase64Url(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(payload).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export function encryptJson(value: unknown, secret: string): string {
  const key = deriveEncryptionKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [encodeBase64Url(iv), encodeBase64Url(tag), encodeBase64Url(encrypted)].join('.');
}

export function decryptJson(token: string, secret: string): unknown | null {
  const [ivRaw, tagRaw, encryptedRaw] = token.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveEncryptionKey(secret),
      decodeBase64Url(ivRaw)
    );
    decipher.setAuthTag(decodeBase64Url(tagRaw));
    const decrypted = Buffer.concat([
      decipher.update(decodeBase64Url(encryptedRaw)),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}
