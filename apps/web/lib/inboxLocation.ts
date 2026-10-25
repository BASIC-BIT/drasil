import { moderationInboxItemKindSchema } from '@drasil/contracts';
import {
  isModerationInboxSavedViewActive,
  moderationInboxSavedViews,
  type ModerationInboxViewControls,
} from './moderationInboxViewModel';

export interface InboxLocation {
  readonly controls: ModerationInboxViewControls;
  readonly selectedItemId: string | null;
  readonly trackedRequestId: string | null;
}

export function parseInboxLocation(params: URLSearchParams): InboxLocation {
  const preset =
    moderationInboxSavedViews.find((view) => view.id === params.get('view')) ??
    moderationInboxSavedViews[0];
  const kind = params.get('kind');
  const parsedKind = moderationInboxItemKindSchema.safeParse(kind);
  const freshness = params.get('freshness');
  const sort = params.get('sort');
  const selectedItemId = params.get('selected') || null;
  return {
    controls: {
      kind: kind === 'all' ? kind : parsedKind.success ? parsedKind.data : preset.controls.kind,
      freshness:
        freshness === 'all' ||
        freshness === 'stale' ||
        freshness === 'fresh' ||
        freshness === 'attention'
          ? freshness
          : preset.controls.freshness,
      sortMode:
        sort === 'priority' || sort === 'newest' || sort === 'oldest' || sort === 'stale'
          ? sort
          : preset.controls.sortMode,
      searchQuery: params.get('q') ?? preset.controls.searchQuery,
    },
    selectedItemId,
    trackedRequestId: selectedItemId ? params.get('request') || null : null,
  };
}

export function serializeInboxLocation(location: InboxLocation): URLSearchParams {
  const params = new URLSearchParams();
  const preset = moderationInboxSavedViews.find((view) =>
    isModerationInboxSavedViewActive(location.controls, view)
  );
  if (preset) params.set('view', preset.id);
  params.set('kind', location.controls.kind);
  params.set('freshness', location.controls.freshness);
  params.set('sort', location.controls.sortMode);
  if (location.controls.searchQuery) params.set('q', location.controls.searchQuery);
  if (location.selectedItemId) {
    params.set('selected', location.selectedItemId);
    if (location.trackedRequestId) params.set('request', location.trackedRequestId);
  }
  return params;
}
