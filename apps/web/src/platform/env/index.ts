export type WebPublicConfig = {
  apiBaseUrl: string;
  tonConnectManifestUrl: string;
};

let cached: WebPublicConfig | undefined;

export function getWebPublicConfig(): WebPublicConfig {
  if (cached) return cached;
  const origin = new URL(window.location.origin);
  if (import.meta.env.PROD && origin.protocol !== "https:")
    throw new Error("Production Mini App must use HTTPS");
  cached = {
    apiBaseUrl: origin.toString(),
    tonConnectManifestUrl: new URL(
      "/tonconnect-manifest.json",
      origin,
    ).toString(),
  };
  return cached;
}
