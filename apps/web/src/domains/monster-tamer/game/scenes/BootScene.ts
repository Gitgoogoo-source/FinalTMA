import Phaser from "phaser";

import { ensureProceduralTextures } from "../assets/ProceduralTextures.ts";

export const BOOT_SCENE_KEY = "monster-tamer-boot";
export const WORLD_SCENE_KEY = "monster-tamer-world";

export class BootScene extends Phaser.Scene {
  public constructor() {
    super(BOOT_SCENE_KEY);
  }

  public create(): void {
    ensureProceduralTextures(this);
    this.scene.start(WORLD_SCENE_KEY);
  }
}
