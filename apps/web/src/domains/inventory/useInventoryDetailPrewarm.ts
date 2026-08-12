import { useEffect, useState } from "react";

import { validatePublicPetUrl } from "../../shared/ui/catalogImageUrl.ts";

const decodedDetailUrls = new Set<string>();
const failedDetailUrls = new Set<string>();
const pendingDetailUrls = new Map<string, Promise<void>>();
let detailPreparationTail = Promise.resolve();

export function useInventoryDetailPrewarm({
  enabled,
  selectedUrl,
  urls,
}: {
  enabled: boolean;
  selectedUrl: string;
  urls: readonly string[];
}): void {
  const documentVisible = useDocumentVisible();
  const urlKey = urls.join("\n");

  useEffect(() => {
    if (!enabled || !documentVisible) return;
    const decodedSelectedUrl = validatePublicPetUrl(selectedUrl, "detail");
    if (decodedSelectedUrl) {
      failedDetailUrls.delete(decodedSelectedUrl);
      decodedDetailUrls.add(decodedSelectedUrl);
    }
    if (!urlKey) return;
    let cancelled = false;

    const prepareSequentially = async () => {
      for (const url of urlKey.split("\n")) {
        if (cancelled || document.visibilityState !== "visible") return;
        await enqueueDetailImage(
          url,
          () => !cancelled && document.visibilityState === "visible",
        );
      }
    };

    void prepareSequentially();
    return () => {
      cancelled = true;
    };
  }, [documentVisible, enabled, selectedUrl, urlKey]);
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    const synchronize = () =>
      setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", synchronize);
    return () => document.removeEventListener("visibilitychange", synchronize);
  }, []);
  return visible;
}

function prepareDetailImage(value: string): Promise<void> {
  const url = validatePublicPetUrl(value, "detail");
  if (!url || decodedDetailUrls.has(url) || failedDetailUrls.has(url))
    return Promise.resolve();
  const pending = pendingDetailUrls.get(url);
  if (pending) return pending;

  const operation = loadAndDecode(url).then((decoded) => {
    if (decoded) decodedDetailUrls.add(url);
    else failedDetailUrls.add(url);
  });
  pendingDetailUrls.set(url, operation);
  void operation.finally(() => {
    if (pendingDetailUrls.get(url) === operation) pendingDetailUrls.delete(url);
  });
  return operation;
}

function enqueueDetailImage(
  url: string,
  shouldStart: () => boolean,
): Promise<void> {
  const operation = detailPreparationTail.then(() =>
    shouldStart() ? prepareDetailImage(url) : undefined,
  );
  detailPreparationTail = operation;
  return operation;
}

function loadAndDecode(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    let decoding = false;
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      resolve(success);
    };
    image.decoding = "async";
    image.fetchPriority = "low";
    image.onload = () => {
      if (decoding) return;
      decoding = true;
      void image.decode().then(
        () => finish(true),
        () => finish(false),
      );
    };
    image.onerror = () => finish(false);
    image.src = url;
  });
}
