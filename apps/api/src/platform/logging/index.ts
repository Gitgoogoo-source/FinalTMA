export function writeLog(
  level: "info" | "error",
  value: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...value,
  });
  if (level === "error") console.error(line);
  else console.info(line);
}
