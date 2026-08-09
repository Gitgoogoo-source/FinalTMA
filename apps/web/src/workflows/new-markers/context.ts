import { useSyncExternalStore } from "react";

import {
  getSession,
  registerSensitiveStateResetter,
  useSession,
} from "../../platform/session/store.ts";

export type NewMarkerValue = {
  templateIds: ReadonlySet<string>;
  markNew(templateIds: readonly string[]): void;
  clearNew(templateId: string): void;
};

type NewMarkerSnapshot = {
  generation: string | null;
  templateIds: ReadonlySet<string>;
};

const emptyTemplateIds: ReadonlySet<string> = new Set();
let snapshot: NewMarkerSnapshot = {
  generation: null,
  templateIds: emptyTemplateIds,
};
const listeners = new Set<() => void>();

function publish(next: NewMarkerSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function markNew(templateIds: readonly string[]): void {
  const session = getSession();
  if (!session || session.accountStatus !== "normal") return;
  const next = new Set(
    snapshot.generation === session.generation
      ? snapshot.templateIds
      : emptyTemplateIds,
  );
  templateIds.filter(Boolean).forEach((templateId) => next.add(templateId));
  if (
    snapshot.generation !== session.generation ||
    next.size !== snapshot.templateIds.size
  )
    publish({ generation: session.generation, templateIds: next });
}

function clearNew(templateId: string): void {
  const generation = getSession()?.generation ?? null;
  if (
    snapshot.generation !== generation ||
    !snapshot.templateIds.has(templateId)
  )
    return;
  const next = new Set(snapshot.templateIds);
  next.delete(templateId);
  publish({ generation, templateIds: next });
}

registerSensitiveStateResetter(() =>
  publish({ generation: null, templateIds: emptyTemplateIds }),
);

export function useNewMarkers(): NewMarkerValue {
  const generation = useSession()?.generation ?? null;
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
  return {
    templateIds:
      current.generation === generation
        ? current.templateIds
        : emptyTemplateIds,
    markNew,
    clearNew,
  };
}
