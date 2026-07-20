import { createContext, useContext } from "react";

export type NewMarkerValue = {
  templateIds: ReadonlySet<string>;
  markNew(templateIds: readonly string[]): void;
  clearNew(templateId: string): void;
};

export const NewMarkerContext = createContext<NewMarkerValue | null>(null);

export function useNewMarkers(): NewMarkerValue {
  const value = useContext(NewMarkerContext);
  if (!value) throw new Error("NewMarkerProvider is missing");
  return value;
}
