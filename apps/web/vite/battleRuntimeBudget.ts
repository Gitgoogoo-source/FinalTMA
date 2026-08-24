import { gzipSync } from "node:zlib";
import type { Plugin, Rolldown } from "vite";

type OutputAsset = Rolldown.OutputAsset;
type OutputBundle = Rolldown.OutputBundle;
type OutputChunk = Rolldown.OutputChunk;

type ViteChunk = OutputChunk & {
  viteMetadata?: {
    importedCss?: ReadonlySet<string>;
  };
};

const limits = {
  jsRaw: 160_000,
  jsGzip: 45_000,
  cssRaw: 45_000,
  cssGzip: 9_000,
} as const;

const gamePageSuffix = "/apps/web/src/pages/game/GamePage.tsx";
const forbiddenModuleFragments = [
  "/node_modules/ably/",
  "/apps/web/src/domains/battle/battleEffectPlayer.ts",
  "/apps/web/src/domains/battle/ui/battle-effects.css",
] as const;

export function battleRuntimeBudgetPlugin(): Plugin {
  return {
    name: "evomypet-battle-runtime-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = outputChunks(bundle);
      const entryRoots = new Set(
        [...chunks.values()].filter((chunk) => chunk.isEntry),
      );
      const gameRoots = new Set(
        [...chunks.values()].filter((chunk) =>
          Object.keys(chunk.modules)
            .map(normalizeModuleId)
            .some((moduleId) => moduleId.endsWith(gamePageSuffix)),
        ),
      );
      if (entryRoots.size === 0)
        this.error("Battle budget root is missing: application entry");
      if (gameRoots.size === 0)
        this.error("Battle budget root is missing: GamePage");

      const entryClosure = collectStaticClosure(entryRoots, chunks);
      const gameClosure = collectStaticClosure(gameRoots, chunks);
      const incrementalBattleClosure = new Set(
        [...gameClosure].filter((chunk) => !entryClosure.has(chunk)),
      );
      const cssFiles = new Set<string>();
      for (const chunk of incrementalBattleClosure)
        for (const fileName of (chunk as ViteChunk).viteMetadata?.importedCss ??
          [])
          cssFiles.add(fileName);

      const js = measureChunks(incrementalBattleClosure);
      const css = measureAssets(bundle, cssFiles);
      const preloadEntryDependencies = [...gameRoots].flatMap((chunk) =>
        battlePreloadEntryDependencies(chunk.code),
      );
      const forbiddenModules = [...incrementalBattleClosure]
        .flatMap((chunk) => Object.keys(chunk.modules))
        .map(normalizeModuleId)
        .filter((moduleId) =>
          forbiddenModuleFragments.some((fragment) =>
            moduleId.includes(fragment),
          ),
        );
      const forbiddenCss = [...cssFiles].filter((fileName) => {
        const output = bundle[fileName];
        if (!output || output.type !== "asset") return false;
        return Buffer.from(assetBytes(output)).includes(
          ".battle-effect-layer[data-trajectory=",
        );
      });
      const failures: string[] = [];
      if (js.raw > limits.jsRaw)
        failures.push(
          `Battle Core JS raw ${js.raw} B exceeds ${limits.jsRaw} B`,
        );
      if (js.gzip > limits.jsGzip)
        failures.push(
          `Battle Core JS gzip ${js.gzip} B exceeds ${limits.jsGzip} B`,
        );
      if (css.raw > limits.cssRaw)
        failures.push(
          `Battle Core CSS raw ${css.raw} B exceeds ${limits.cssRaw} B`,
        );
      if (css.gzip > limits.cssGzip)
        failures.push(
          `Battle Core CSS gzip ${css.gzip} B exceeds ${limits.cssGzip} B`,
        );
      if (forbiddenModules.length > 0)
        failures.push(
          `forbidden modules entered the Battle Core closure:\n${[
            ...new Set(forbiddenModules),
          ].join("\n")}`,
        );
      if (forbiddenCss.length > 0)
        failures.push(
          `heavy Battle effect CSS entered the Battle Core closure: ${forbiddenCss.join(", ")}`,
        );
      if (preloadEntryDependencies.length > 0)
        failures.push(
          `application entry JS entered Battle dynamic preload hints: ${[
            ...new Set(preloadEntryDependencies),
          ].join(", ")}`,
        );

      const report = [
        `Battle Core JS ${js.raw} B / gzip ${js.gzip} B`,
        `Battle Core CSS ${css.raw} B / gzip ${css.gzip} B`,
        `Battle Core chunks: ${[...incrementalBattleClosure]
          .map(
            (chunk) =>
              `${chunk.fileName} (${Buffer.byteLength(chunk.code)}/${gzipSync(chunk.code).byteLength})`,
          )
          .sort()
          .join(", ")}`,
        `Battle Core CSS assets: ${[...cssFiles].sort().join(", ") || "none"}`,
        `Battle dynamic preload entry JS: ${preloadEntryDependencies.length}`,
      ].join("\n");
      if (failures.length > 0) this.error(`${failures.join("\n")}\n${report}`);
      this.info(report);
    },
  };
}

function battlePreloadEntryDependencies(code: string): string[] {
  const preloadMap = code
    .split("\n", 1)
    .find((line) => line.startsWith("const __vite__mapDeps="));
  if (!preloadMap) return [];
  return [...preloadMap.matchAll(/["`](assets\/index-[^"`]+\.js)["`]/g)].map(
    (match) => match[1]!,
  );
}

function outputChunks(bundle: OutputBundle): Map<string, OutputChunk> {
  return new Map(
    Object.values(bundle)
      .filter((output): output is OutputChunk => output.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
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
      throw new Error(`Battle Core CSS asset is missing: ${fileName}`);
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
