import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Plugin, Rolldown } from "vite";

type OutputAsset = Rolldown.OutputAsset;
type OutputBundle = Rolldown.OutputBundle;
type OutputChunk = Rolldown.OutputChunk;

const limits = {
  jsRaw: 400_000,
  jsGzip: 125_000,
  cssRaw: 110_000,
  cssGzip: 23_000,
} as const;

const rootModuleSuffixes = {
  gacha: ["/apps/web/src/pages/gacha/GachaPage.tsx"],
  contracts: [
    "/packages/api-contracts/src/client-routes/first-screen.ts",
    "/packages/api-contracts/dist/client-routes/first-screen.js",
  ],
} as const;

const forbiddenContractRouteDomains = [
  "album",
  "battle",
  "expedition",
  "inventory",
  "market",
  "mint",
  "referral",
  "tasks",
  "wallet",
  "wheel",
] as const;

const forbiddenModuleFragments = [
  "/node_modules/react-router/",
  "/node_modules/react-router-dom/",
  "/apps/web/src/shared/ui/index.tsx",
  "/apps/web/src/shared/ui/AppModal.tsx",
  "/apps/web/src/shared/ui/Badge.tsx",
  "/apps/web/src/shared/ui/CollectionDetailShowcase.tsx",
  "/apps/web/src/shared/ui/InventoryActionDialogHeader.tsx",
  "/apps/web/src/shared/ui/QuantityControl.tsx",
  "/apps/web/src/pages/album/",
  "/apps/web/src/pages/game/",
  "/apps/web/src/pages/inventory/",
  "/apps/web/src/pages/market/",
  "/apps/web/src/pages/tasks/",
  "/apps/web/src/workflows/operation-recovery/OperationRegistryRuntimeProvider.tsx",
  "/apps/web/src/workflows/operation-recovery/presentations/",
  "/packages/api-contracts/src/domains/battle/models.ts",
  "/packages/api-contracts/dist/domains/battle/models.js",
  ...forbiddenContractRouteDomains.flatMap((domain) => [
    `/packages/api-contracts/src/domains/${domain}/routes.`,
    `/packages/api-contracts/dist/domains/${domain}/routes.`,
  ]),
  "/packages/api-contracts/src/registries/dormant-app.ts",
  "/packages/api-contracts/dist/registries/dormant-app.js",
  "/packages/api-contracts/src/dormant-app.ts",
  "/packages/api-contracts/dist/dormant-app.js",
  "evolution-catalog-v1.json",
] as const;

type ViteChunk = OutputChunk & {
  viteMetadata?: {
    importedCss?: ReadonlySet<string>;
  };
};

export function firstScreenBudgetPlugin(): Plugin {
  return {
    name: "pokepets-first-screen-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      if (
        existsSync(new URL("../src/shared/styles/global.css", import.meta.url))
      )
        this.error(
          "First-screen boundary violation: global.css must not exist",
        );

      const chunks = outputChunks(bundle);
      const roots = new Set<OutputChunk>();
      addRoots(roots, chunks, (chunk) => chunk.isEntry, "entry");
      addRoots(
        roots,
        chunks,
        (chunk) => containsModule(chunk, rootModuleSuffixes.gacha),
        "default GachaPage",
      );
      addRoots(
        roots,
        chunks,
        (chunk) => containsModule(chunk, rootModuleSuffixes.contracts),
        "first-screen contracts",
      );

      const closure = collectStaticClosure(roots, chunks);
      const cssFiles = new Set<string>();
      for (const chunk of closure)
        for (const fileName of (chunk as ViteChunk).viteMetadata?.importedCss ??
          [])
          cssFiles.add(fileName);

      const js = measureChunks(closure);
      const css = measureAssets(bundle, cssFiles);
      const forbidden = [...closure]
        .flatMap((chunk) => Object.keys(chunk.modules))
        .map(normalizeModuleId)
        .filter((moduleId) =>
          forbiddenModuleFragments.some((fragment) =>
            moduleId.includes(fragment),
          ),
        );
      const failures: string[] = [];
      if (js.raw > limits.jsRaw)
        failures.push(`JS raw ${js.raw} B exceeds ${limits.jsRaw} B`);
      if (js.gzip > limits.jsGzip)
        failures.push(`JS gzip ${js.gzip} B exceeds ${limits.jsGzip} B`);
      if (css.raw > limits.cssRaw)
        failures.push(`CSS raw ${css.raw} B exceeds ${limits.cssRaw} B`);
      if (css.gzip > limits.cssGzip)
        failures.push(`CSS gzip ${css.gzip} B exceeds ${limits.cssGzip} B`);
      if (forbidden.length > 0)
        failures.push(
          `forbidden modules entered the first-screen closure:\n${[
            ...new Set(forbidden),
          ].join("\n")}`,
        );

      const report = [
        `first-screen JS ${js.raw} B / gzip ${js.gzip} B`,
        `first-screen CSS ${css.raw} B / gzip ${css.gzip} B`,
        `JS chunks: ${[...closure]
          .map(
            (chunk) =>
              `${chunk.fileName} (${Buffer.byteLength(chunk.code)}/${gzipSync(chunk.code).byteLength})`,
          )
          .sort()
          .join(", ")}`,
        `CSS assets: ${[...cssFiles].sort().join(", ") || "none"}`,
        `Largest first-screen modules: ${[...closure]
          .flatMap((chunk) =>
            Object.entries(chunk.modules).map(([moduleId, detail]) => ({
              moduleId: normalizeModuleId(moduleId),
              renderedLength: detail.renderedLength,
            })),
          )
          .sort((left, right) => right.renderedLength - left.renderedLength)
          .slice(0, 20)
          .map(
            ({ moduleId, renderedLength }) => `${moduleId} (${renderedLength})`,
          )
          .join(", ")}`,
      ].join("\n");
      if (failures.length > 0) this.error(`${failures.join("\n")}\n${report}`);
      this.info(report);
    },
  };
}

function outputChunks(bundle: OutputBundle): Map<string, OutputChunk> {
  return new Map(
    Object.values(bundle)
      .filter((output): output is OutputChunk => output.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
}

function addRoots(
  roots: Set<OutputChunk>,
  chunks: Map<string, OutputChunk>,
  predicate: (chunk: OutputChunk) => boolean,
  label: string,
): void {
  const matches = [...chunks.values()].filter(predicate);
  if (matches.length === 0)
    throw new Error(`First-screen budget root is missing: ${label}`);
  matches.forEach((chunk) => roots.add(chunk));
}

function containsModule(
  chunk: OutputChunk,
  suffixes: readonly string[],
): boolean {
  return Object.keys(chunk.modules)
    .map(normalizeModuleId)
    .some((moduleId) => suffixes.some((suffix) => moduleId.endsWith(suffix)));
}

function collectStaticClosure(
  roots: ReadonlySet<OutputChunk>,
  chunks: ReadonlyMap<string, OutputChunk>,
): Set<OutputChunk> {
  const closure = new Set<OutputChunk>();
  const pending = [...roots];
  while (pending.length > 0) {
    const chunk = pending.pop();
    if (!chunk || closure.has(chunk)) continue;
    closure.add(chunk);
    for (const imported of chunk.imports) {
      const dependency = chunks.get(imported);
      if (dependency && !closure.has(dependency)) pending.push(dependency);
    }
  }
  return closure;
}

function measureChunks(chunks: ReadonlySet<OutputChunk>): {
  raw: number;
  gzip: number;
} {
  let raw = 0;
  let gzip = 0;
  for (const chunk of chunks) {
    raw += Buffer.byteLength(chunk.code);
    gzip += gzipSync(chunk.code).byteLength;
  }
  return { raw, gzip };
}

function measureAssets(
  bundle: OutputBundle,
  fileNames: ReadonlySet<string>,
): { raw: number; gzip: number } {
  let raw = 0;
  let gzip = 0;
  for (const fileName of fileNames) {
    const output = bundle[fileName];
    if (!output || output.type !== "asset")
      throw new Error(`First-screen CSS asset is missing: ${fileName}`);
    const source = assetBytes(output);
    raw += source.byteLength;
    gzip += gzipSync(source).byteLength;
  }
  return { raw, gzip };
}

function assetBytes(asset: OutputAsset): Uint8Array {
  return typeof asset.source === "string"
    ? Buffer.from(asset.source)
    : asset.source;
}

function normalizeModuleId(moduleId: string): string {
  return moduleId.replaceAll("\\", "/").split("?", 1)[0] ?? moduleId;
}
