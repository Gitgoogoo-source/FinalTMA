const PUBLIC_PET_PATH =
  /^\/storage\/v1\/object\/public\/pet-runtime\/catalog\/v[12]\/(thumb|detail)\/pet-[nat]-\d{3}-[123]\.[0-9a-f]{64}\.webp$/;

export type CatalogImageVariant = "thumbnail" | "detail";

export function validatePublicPetUrl(
  value: unknown,
  variant: CatalogImageVariant,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const match = PUBLIC_PET_PATH.exec(parsed.pathname);
    const expected = variant === "thumbnail" ? "thumb" : "detail";
    return parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      match?.[1] === expected
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
