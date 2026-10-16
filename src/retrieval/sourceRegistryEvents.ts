export const SOURCE_REGISTRY_CHANGE_EVENT = 'regulatory-source-registry-changed';

/** Notifies mounted answer views to recheck citations after a source lifecycle change. */
export function notifySourceRegistryChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOURCE_REGISTRY_CHANGE_EVENT));
}
