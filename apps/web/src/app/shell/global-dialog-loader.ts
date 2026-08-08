export type LoadedGlobalDialog =
  | {
      kind: "topup";
      module: typeof import("../../domains/topup/ui/TopupDialog.tsx");
    }
  | {
      kind: "vip";
      module: typeof import("../../domains/vip/ui/VipDialog.tsx");
    };

export type GlobalDialogKind = LoadedGlobalDialog["kind"];

const topupLoader = cachedLoader(
  () => import("../../domains/topup/ui/TopupDialog.tsx"),
);
const vipLoader = cachedLoader(
  () => import("../../domains/vip/ui/VipDialog.tsx"),
);

export function preloadGlobalDialog(
  kind: GlobalDialogKind,
): Promise<LoadedGlobalDialog> {
  if (kind === "topup")
    return topupLoader().then((module) => ({ kind, module }));
  return vipLoader().then((module) => ({ kind, module }));
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
