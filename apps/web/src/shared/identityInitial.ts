export function getIdentityInitial(displayName: string): string {
  return Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? "P";
}
