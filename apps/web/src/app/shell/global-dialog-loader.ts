export type LoadedGlobalDialog =
  | { kind: "account"; module: typeof import("./AccountLanguageMenu.tsx") }
  | {
      kind: "wallet";
      module: typeof import("../../domains/wallet/ui/WalletCapabilityDialog.tsx");
    }
  | {
      kind: "topup";
      module: typeof import("../../domains/topup/ui/TopupDialog.tsx");
    }
  | {
      kind: "vip";
      module: typeof import("../../domains/vip/ui/VipDialog.tsx");
    };

export type GlobalDialogKind = LoadedGlobalDialog["kind"];

const loaders = {
  account: cachedLoader(() => import("./AccountLanguageMenu.tsx")),
  topup: cachedLoader(() => import("../../domains/topup/ui/TopupDialog.tsx")),
  wallet: cachedLoader(
    () => import("../../domains/wallet/ui/WalletCapabilityDialog.tsx"),
  ),
  vip: cachedLoader(() => import("../../domains/vip/ui/VipDialog.tsx")),
};

export function preloadGlobalDialog(
  kind: GlobalDialogKind,
): Promise<LoadedGlobalDialog> {
  return loaders[kind]().then(
    (module) => ({ kind, module }) as LoadedGlobalDialog,
  );
}

function cachedLoader<Module>(
  loader: () => Promise<Module>,
): () => Promise<Module> {
  let task: Promise<Module> | null = null;
  return () => {
    task ??= loader().catch((cause: unknown) => {
      task = null;
      throw cause;
    });
    return task;
  };
}

// Browsers cache failed module fetches. Reload the document and restore only
// the requested panel; retrying import() at the same URL can fail forever.
export function reloadGlobalDialog(kind: GlobalDialogKind): void {
  try {
    sessionStorage.setItem("evomypet.dialog-reload", kind);
  } catch {
    /* Still allow a manual reload. */
  }
  window.location.reload();
}
