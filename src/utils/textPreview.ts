export function truncatePreview(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const overflow = value.length - maxLength;
  return `${value.slice(0, maxLength)}\n... (truncated ${overflow} characters)`;
}
