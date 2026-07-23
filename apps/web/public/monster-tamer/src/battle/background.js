import Phaser from '../lib/phaser.js';
import { BATTLE_BACKGROUND_ASSET_KEYS } from '../assets/asset-keys.js';

export class Background {
  /** @type {Phaser.Scene} */
  #scene;
  /** @type {Phaser.GameObjects.Image} */
  #backgroundGameObject;

  /**
   * @param {Phaser.Scene} scene the Phaser 3 Scene the health bar will be added to
   */
  constructor(scene) {
    this.#scene = scene;

    this.#backgroundGameObject = this.#scene.add
      .image(0, 0, BATTLE_BACKGROUND_ASSET_KEYS.FOREST, 0)
      .setOrigin(0.5)
      .setAlpha(0);
    this.#scene.scale.on(Phaser.Scale.Events.RESIZE, this.#layout, this);
    this.#scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.#scene.scale.off(Phaser.Scale.Events.RESIZE, this.#layout, this);
    });
    this.#layout();
  }

  showForest() {
    this.#backgroundGameObject.setTexture(BATTLE_BACKGROUND_ASSET_KEYS.FOREST).setAlpha(1);
    this.#layout();
  }

  #layout() {
    const { width, height } = this.#scene.scale.gameSize;
    const scale = Math.max(width / this.#backgroundGameObject.width, height / this.#backgroundGameObject.height);
    this.#backgroundGameObject.setPosition(width / 2, height / 2).setScale(scale);
  }
}
