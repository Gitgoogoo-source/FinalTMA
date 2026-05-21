export function normalizeCurrencyAmount(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^-?\d+$/.test(trimmed)) {
      return trimmed;
    }
  }

  return "0";
}

export function formatCurrencyAmount(value: unknown): string {
  const normalized = normalizeCurrencyAmount(value);
  const sign = normalized.startsWith("-") ? "-" : "";
  const digits = sign ? normalized.slice(1) : normalized;

  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
