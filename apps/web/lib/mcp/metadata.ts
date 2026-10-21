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
