import { readRequestBody, DEFAULT_MAX_REQUEST_BODY_SIZE } from '@drasil/mcp-runtime/server';
import { observeContinuationBody } from './continuationDiagnostics';
/** Run before mcp-handler's clone().json(); the SDK cannot bound its parsedBody path. */
export function wrapMcpBody(
  next: (request: Request) => Promise<Response>,
  diagnosticSink?: (line: string) => void
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return next(request);
    const body = await readRequestBody(request, DEFAULT_MAX_REQUEST_BODY_SIZE);
    if (body.tooLarge) {
      await request.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 413 });
    }
    observeContinuationBody(body.text, diagnosticSink);
    // The maintained reader consumed the original. Preserve signal, headers, URL and method.
    return next(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        body: body.text,
      })
    );
  };
}
