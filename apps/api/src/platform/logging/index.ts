export function writeLog(
  level: "info" | "error",
  value: Record<string, unknown>,
): void {
  const safe = redact(value);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...(safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {}),
  });
  if (level === "error") console.error(line);
  else console.info(line);
}

const sensitiveKey =
  /(?:authorization|cookie|init[_-]?data|start[_-]?param|private[_-]?seed|secret|token|api[_-]?key)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redact(item),
    ]),
  );
}
