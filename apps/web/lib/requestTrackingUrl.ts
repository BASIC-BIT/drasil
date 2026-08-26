export function buildTrackedRequestUrl(
  currentUrl: string,
  queryParameter: string,
  requestId: string
): string {
  const url = new URL(currentUrl);
  url.searchParams.set(queryParameter, requestId);
  return url.toString();
}
