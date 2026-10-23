import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export interface ImageAnswerBinding {
  serverId: string;
  userId: string;
  caseId: string;
  challengeId: string;
  generation: number;
}
export function generateImageAnswer(): string {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
export function normalizeImageAnswer(input: string): string | null {
  const trimmed = input.trim();
  // Check before uppercasing: Unicode case expansion must never create a valid answer.
  if (!/^[A-Za-z0-9]{6}$/.test(trimmed)) return null;
  const answer = trimmed.toUpperCase();
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(answer) ? answer : null;
}
export function digestImageAnswer(
  binding: ImageAnswerBinding,
  answer: string,
  key: Buffer
): Buffer {
  return createHmac('sha256', key)
    .update(
      JSON.stringify([
        'drasil-image-answer-v1',
        binding.serverId,
        binding.userId,
        binding.caseId,
        binding.challengeId,
        binding.generation,
        answer,
      ])
    )
    .digest();
}
export function verifyImageAnswer(
  binding: ImageAnswerBinding,
  input: string,
  key: Buffer,
  expected: Uint8Array
): boolean {
  const normalized = normalizeImageAnswer(input);
  if (!normalized || expected.byteLength !== 32) return false;
  return timingSafeEqual(digestImageAnswer(binding, normalized, key), expected);
}
export function imageAnswerKeyVersion(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex');
}
