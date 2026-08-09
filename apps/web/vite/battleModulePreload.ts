import type { ResolveModulePreloadDependenciesFn } from "vite";

const battleRealtimeChunkPattern = /(?:^|\/)battleRealtimeRuntime-[^/]+\.js$/;
const applicationEntryChunkPattern = /(?:^|\/)index-[^/]+\.js$/;

export const resolveBattleModulePreloadDependencies: ResolveModulePreloadDependenciesFn =
  (filename, dependencies, context) => {
    if (context.hostType !== "js" || !battleRealtimeChunkPattern.test(filename))
      return dependencies;

    return dependencies.filter(
      (dependency) => !applicationEntryChunkPattern.test(dependency),
    );
  };
