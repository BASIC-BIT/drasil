import { readRequestBody, DEFAULT_MAX_REQUEST_BODY_SIZE } from '@drasil/mcp-runtime/server';
/** Run before mcp-handler's clone().json(); the SDK cannot bound its parsedBody path. */
export function wrapMcpBody(
  next: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return next(request);
    const body = await readRequestBody(request, DEFAULT_MAX_REQUEST_BODY_SIZE);
    if (body.tooLarge) {
      await request.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 413 });
    }
    // The maintained reader consumed the original. Preserve signal, headers, URL and method.
    return next(new Request(request, { body: body.text }));
  };
}
