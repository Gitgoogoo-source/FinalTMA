import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getSession,
  registerSensitiveStateResetter,
  useSession,
} from "../../platform/session/store.ts";
import { NewMarkerContext, type NewMarkerValue } from "./context.ts";

type NewMarkerState = {
  sessionGeneration: string | null;
  templateIds: ReadonlySet<string>;
};

const emptyTemplateIds: ReadonlySet<string> = new Set();

export function NewMarkerProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const sessionGeneration = useSession()?.generation ?? null;
  const [state, setState] = useState<NewMarkerState>({
    sessionGeneration,
    templateIds: emptyTemplateIds,
  });
  const reset = useCallback(
    () =>
      setState({
        sessionGeneration: null,
        templateIds: emptyTemplateIds,
      }),
    [],
  );

  useEffect(() => registerSensitiveStateResetter(reset), [reset]);

  const markNew = useCallback((templateIds: readonly string[]) => {
    const session = getSession();
    if (!session || session.accountStatus !== "normal") return;
    const ids = templateIds.filter(Boolean);
    if (ids.length === 0) return;
    setState((current) => {
      const next = new Set(
        current.sessionGeneration === session.generation
          ? current.templateIds
          : emptyTemplateIds,
      );
      ids.forEach((templateId) => next.add(templateId));
      if (
        current.sessionGeneration === session.generation &&
        next.size === current.templateIds.size
      )
        return current;
      return { sessionGeneration: session.generation, templateIds: next };
    });
  }, []);

  const clearNew = useCallback((templateId: string) => {
    const sessionGeneration = getSession()?.generation ?? null;
    setState((current) => {
      if (
        current.sessionGeneration !== sessionGeneration ||
        !current.templateIds.has(templateId)
      )
        return current;
      const next = new Set(current.templateIds);
      next.delete(templateId);
      return { ...current, templateIds: next };
    });
  }, []);

  const visibleTemplateIds =
    state.sessionGeneration === sessionGeneration
      ? state.templateIds
      : emptyTemplateIds;
  const value = useMemo<NewMarkerValue>(
    () => ({ templateIds: visibleTemplateIds, markNew, clearNew }),
    [clearNew, markNew, visibleTemplateIds],
  );
  return (
    <NewMarkerContext.Provider value={value}>
      {children}
    </NewMarkerContext.Provider>
  );
}
