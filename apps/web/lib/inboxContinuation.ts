import type { ModerationInboxItem } from '@drasil/contracts';

export function chooseInboxContinuation({
  previousIds,
  selectedId,
  currentItems,
}: {
  readonly previousIds: readonly string[];
  readonly selectedId: string | null;
  readonly currentItems: readonly Pick<ModerationInboxItem, 'id'>[];
}): string | null {
  const currentIds = new Set(currentItems.map((item) => item.id));
  if (selectedId && currentIds.has(selectedId)) return selectedId;
  const oldIndex = selectedId ? previousIds.indexOf(selectedId) : -1;
  if (oldIndex >= 0) {
    for (const id of previousIds.slice(oldIndex + 1)) if (currentIds.has(id)) return id;
    for (const id of previousIds.slice(0, oldIndex).reverse()) if (currentIds.has(id)) return id;
  }
  return currentItems[0]?.id ?? null;
}
