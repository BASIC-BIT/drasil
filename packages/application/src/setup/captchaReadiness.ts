/** Server-only key validation. Do not include secret values in diagnostics. */
export function decodeCaptchaImageSecret(secret: string | undefined): Buffer | null {
  if (!secret || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(secret))
    return null;
  const decoded = Buffer.from(secret, 'base64');
  return decoded.length >= 32 && decoded.toString('base64') === secret ? decoded : null;
}
export function captchaImageSecretConfigured(secret: string | undefined): boolean {
  return decodeCaptchaImageSecret(secret) !== null;
}
