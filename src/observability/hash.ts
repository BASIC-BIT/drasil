import { createHmac, randomBytes } from 'crypto';

let cachedKey: Buffer | null = null;

function getHashKey(): Buffer {
  const configured = process.env.OBSERVABILITY_HASH_KEY;
  if (configured && configured.trim().length > 0) {
    return Buffer.from(configured, 'utf8');
  }

  // Ephemeral per-process key so we never emit reversible/raw identifiers by default.
  // Set OBSERVABILITY_HASH_KEY in production to make hashes stable across restarts.
  if (!cachedKey) {
    cachedKey = randomBytes(32);
  }

  return cachedKey;
}

export function hashIdentifier(value: string): string {
  return createHmac('sha256', getHashKey()).update(value).digest('hex').slice(0, 24);
}
