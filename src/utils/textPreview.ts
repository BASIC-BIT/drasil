export function truncatePreview(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const suffix = '\n... (truncated to fit)';
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`.slice(0, maxLength);
}
