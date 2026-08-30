export function hasUnavailableGachaPresentation(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("results" in value))
    return false;
  const results = value.results;
  if (!Array.isArray(results)) return false;
  return results.some(
    (item) =>
      Boolean(item) &&
      typeof item === "object" &&
      (("image_thumbnail_url" in item && item.image_thumbnail_url === null) ||
        ("image_detail_url" in item && item.image_detail_url === null)),
  );
}

export function withGachaPresentationValidationUrls(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("results" in value))
    return value;
  const results = value.results;
  if (!Array.isArray(results)) return value;
  return {
    ...value,
    results: results.map((item) => {
      if (!item || typeof item !== "object" || !("template_id" in item))
        return item;
      const templateId = String(item.template_id).toLowerCase();
      const base =
        "https://placeholder.supabase.co/storage/v1/object/public/pet-runtime/catalog/v2";
      const hash = "0".repeat(64);
      return {
        ...item,
        ...(item.image_thumbnail_url === null
          ? {
              image_thumbnail_url: `${base}/thumb/${templateId}.${hash}.webp`,
            }
          : {}),
        ...(item.image_detail_url === null
          ? {
              image_detail_url: `${base}/detail/${templateId}.${hash}.webp`,
            }
          : {}),
      };
    }),
  };
}
