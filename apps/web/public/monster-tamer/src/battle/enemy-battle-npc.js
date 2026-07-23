import { getBattleLayout } from './battle-layout.js';

export class EnemyBattleNpc {
  /** @type {Phaser.Scene} */
  #scene;
  /** @type {Phaser.GameObjects.Image} */
  #phaserGameObject;
  /** @type {boolean} */
  #skipBattleAnimations;

  /**
   * @param {import('../types/typedef.js').BattleNpcConfig} config
   */
  constructor(config) {
    this.#scene = config.scene;
    this.#skipBattleAnimations = config.skipBattleAnimations || false;
    const enemyPosition = getBattleLayout(this.#scene).enemyNpc;
    this.#phaserGameObject = this.#scene.add
      .image(enemyPosition.x, enemyPosition.y, config.assetKey, config.assetFrame || 0)
      .setVisible(false)
      .setScale(0.8);
  }

  layout() {
    if (!this.#scene.tweens.isTweening(this.#phaserGameObject)) {
      const enemyPosition = getBattleLayout(this.#scene).enemyNpc;
      this.#phaserGameObject.setPosition(enemyPosition.x, enemyPosition.y);
    }
  }

  /**
   * @public
   * @returns {Promise<void>}
   */
  playAppearAnimation() {
    return new Promise((resolve) => {
      const enemyPosition = getBattleLayout(this.#scene).enemyNpc;
      const startXPos = -30;
      const endXPos = enemyPosition.x;
      this.#phaserGameObject.setPosition(startXPos, enemyPosition.y);
      this.#phaserGameObject.setVisible(true);

      if (this.#skipBattleAnimations) {
        this.#phaserGameObject.setX(endXPos);
        this.layout();
        resolve();
        return;
      }

      this.#scene.tweens.add({
        delay: 0,
        duration: 1600,
        x: {
          from: startXPos,
          start: startXPos,
          to: endXPos,
        },
        targets: this.#phaserGameObject,
        onComplete: () => {
          this.layout();
          resolve();
        },
      });
    });
  }

  /**
   * @public
   * @returns {void}
   */
  hide() {
    this.#phaserGameObject.setVisible(false);
  }
}
