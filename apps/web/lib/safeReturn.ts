export function resolveSafeReturnPath(
  value: string | null | undefined,
  fallback = '/admin'
): string {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = new URL(value, 'https://drasil.local');
    if (parsed.origin !== 'https://drasil.local') {
      return fallback;
    }
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
  } catch {
    return fallback;
  }
}
