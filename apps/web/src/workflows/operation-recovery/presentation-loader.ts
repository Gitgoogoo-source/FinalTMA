import type { RecoverableRouteId } from "@pokepets/api-contracts/app-client";

type GachaModule = typeof import("./presentations/GachaPresentation.ts");
type EvolutionModule =
  typeof import("./presentations/EvolutionPresentation.ts");
type DecompositionModule =
  typeof import("./presentations/DecompositionPresentation.ts");
type MarketModule = typeof import("./presentations/MarketPresentation.ts");
type WheelModule = typeof import("./presentations/WheelPresentation.ts");
type AlbumModule = typeof import("./presentations/AlbumPresentation.ts");

export type LoadedOperationPresentation =
  | { kind: "gacha"; module: GachaModule }
  | { kind: "evolution"; module: EvolutionModule }
  | { kind: "decomposition"; module: DecompositionModule }
  | { kind: "market"; module: MarketModule }
  | { kind: "wheel"; module: WheelModule }
  | { kind: "album"; module: AlbumModule };

type PresentationKind = LoadedOperationPresentation["kind"];
type PresentationModule = LoadedOperationPresentation["module"];
type PresentationLoader = () => Promise<PresentationModule>;

const loaders: Record<PresentationKind, PresentationLoader> = {
  gacha: cachedLoader(() => import("./presentations/GachaPresentation.ts")),
  evolution: cachedLoader(
    () => import("./presentations/EvolutionPresentation.ts"),
  ),
  decomposition: cachedLoader(
    () => import("./presentations/DecompositionPresentation.ts"),
  ),
  market: cachedLoader(() => import("./presentations/MarketPresentation.ts")),
  wheel: cachedLoader(() => import("./presentations/WheelPresentation.ts")),
  album: cachedLoader(() => import("./presentations/AlbumPresentation.ts")),
};

export function preloadOperationPresentation(
  routeId: RecoverableRouteId,
): Promise<LoadedOperationPresentation | null> {
  const kind = presentationKind(routeId);
  if (!kind) return Promise.resolve(null);
  return loaders[kind]().then(
    (module) => ({ kind, module }) as LoadedOperationPresentation,
  );
}

function presentationKind(
  routeId: RecoverableRouteId,
): PresentationKind | null {
  if (routeId === "gacha.open") return "gacha";
  if (routeId === "inventory.evolve") return "evolution";
  if (routeId === "inventory.decompose") return "decomposition";
  if (routeId === "market.create_listing" || routeId === "market.purchase")
    return "market";
  if (routeId === "wheel.spin") return "wheel";
  if (routeId === "album.claim") return "album";
  return null;
}

function cachedLoader(loader: PresentationLoader): PresentationLoader {
  let task: Promise<PresentationModule> | null = null;
  return () => {
    task ??= loader().catch((cause: unknown) => {
      task = null;
      throw cause;
    });
    return task;
  };
}
