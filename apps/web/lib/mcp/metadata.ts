import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from '@drasil/mcp-runtime/handler';
import { getMcpConfig } from './config';
/** Both public aliases and auth challenges use this fixed resource owner. */
export async function resourceMetadata(request: Request): Promise<Response> {
  const config = getMcpConfig();
  if (!config) return new Response(null, { status: 404 });
  return protectedResourceHandler({
    authServerUrls: [config.issuer],
    resourceUrl: config.resource,
  })(request);
}
export const resourceMetadataOptions = metadataCorsOptionsRequestHandler();

/** Covers both CIMD documents and discovery-owned JWKS, retaining the maintained transport. */
export function boundMetadataTransport(
  acquire: (origin: string) => Promise<() => Promise<void>>,
  transport: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const release = await acquire(url.origin);
    let response: Response;
    try {
      response = await transport(input, init);
    } catch (error) {
      await release();
      throw error;
    }
    if (!response.body) {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method === 'HEAD' || [204, 205, 304].includes(response.status)) await release();
      // An unexpected null body is not the maintained transport's EOF contract.
      return response;
    }
    // Both maintained consumers reject these headers before reading and only clear their timer.
    // Cancel that rejected message without changing provider validation or response headers.
    if (
      response.redirected ||
      ![200, 304].includes(response.status) ||
      (response.status === 200 &&
        !/^application\/(?:[-\w.]+\+)?json\s*(?:;|$)/i.test(
          response.headers.get('content-type') ?? ''
        ))
    ) {
      await response.body.cancel();
      await release();
      return response;
    }
    const reader = response.body.getReader();
    let terminal = false;
    let cancelling = false;
    async function finish(): Promise<void> {
      if (terminal) return;
      terminal = true;
      await release();
    }
    void reader.closed
      .then(
        () => {
          if (!cancelling) return finish();
        },
        () => {
          if (!cancelling) return finish();
        }
      )
      .catch(() => undefined);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            if (!cancelling) await finish();
            controller.close();
          } else controller.enqueue(chunk.value);
        } catch (error) {
          if (!cancelling) await finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelling = true;
        await reader.cancel(reason);
        await finish();
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
