import { createContainmentIntentResolver } from '@drasil/application';
import { createContainmentResources } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './database';
export function createWebContainmentResolution() {
  const resources = createContainmentResources(createWebDelegationDatabase());
  return {
    resolver: createContainmentIntentResolver(resources),
    resolvePreviewReference: resources.resolvePreviewReference,
  };
}
