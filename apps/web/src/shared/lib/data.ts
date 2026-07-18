export type JsonRecord = Record<string, unknown>;

export function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

export function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

export function child(value: unknown, key: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const item = (value as JsonRecord)[key];
  return item && typeof item === "object" && !Array.isArray(item)
    ? (item as JsonRecord)
    : {};
}
