import Phaser from "phaser";

import type {
  MonsterTamerGameHandle,
  MonsterTamerMountOptions,
} from "./bridge.ts";
import { GameRuntime } from "./runtime/GameRuntime.ts";
import { BattleEffectsScene } from "./scenes/BattleEffectsScene.ts";
import { BootScene } from "./scenes/BootScene.ts";
import { WorldScene } from "./scenes/WorldScene.ts";

export function mountMonsterTamer({
  container,
  snapshot,
  onEvent,
}: MonsterTamerMountOptions): MonsterTamerGameHandle {
  container.replaceChildren();
  const runtime = new GameRuntime(snapshot, onEvent);
  const initialWidth = Math.max(1, container.clientWidth || 960);
  const initialHeight = Math.max(1, container.clientHeight || 640);
  let destroyed = false;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: initialWidth,
    height: initialHeight,
    backgroundColor: "#b9f3ff",
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: initialWidth,
      height: initialHeight,
    },
    input: {
      activePointers: 3,
    },
    audio: {
      noAudio: true,
    },
    scene: [BootScene, WorldScene, BattleEffectsScene],
    callbacks: {
      preBoot: (bootingGame) => {
        runtime.attachGame(bootingGame);
      },
    },
  });

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (destroyed) return;
          const width = Math.max(1, container.clientWidth);
          const height = Math.max(1, container.clientHeight);
          if (width !== game.scale.width || height !== game.scale.height) {
            game.scale.resize(width, height);
          }
        })
      : null;
  resizeObserver?.observe(container);

  return {
    setPaused(paused) {
      runtime.setPaused(paused);
    },
    replaceSnapshot(nextSnapshot) {
      runtime.replaceSnapshot(nextSnapshot);
    },
    resolveCommand(commandId, result) {
      runtime.resolveCommand(commandId, result);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      runtime.destroy();
      game.destroy(true);
      container.replaceChildren();
    },
  };
}
