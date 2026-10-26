import { wrapMcpBody } from './body';
import { createDelegationStore } from '@drasil/application/postgres';
import { createMcpHandler, createMcpToolCatalog } from './server';
import { createWebMcpReadTools } from './tools/reads';
import { createWebMcpActionService } from './actionService';
import { createWebDelegationDatabase } from './adapters/database';
import { verifyMcpBearer } from './auth/principal';
import { getMcpConfig } from './config';
let handler: ((request: Request) => Promise<Response>) | undefined;
export async function handleMcpRequest(request: Request): Promise<Response> {
  const config = getMcpConfig();
  if (!config) return new Response(null, { status: 404 });
  if (!handler) {
    const service = createWebMcpActionService();
    const store = createDelegationStore(createWebDelegationDatabase());
    handler = createMcpHandler({
      config,
      wrapBody: wrapMcpBody,
      service,
      tools: createMcpToolCatalog({ service, reads: createWebMcpReadTools(config.cursorSecret) }),
      loadIntent: store.loadIntent,
      verifyBearer: verifyMcpBearer,
    });
  }
  return handler(request);
}
