import { getBattleLayout } from '../battle-layout.js';
import { BattleMonster } from './battle-monster.js';

export class EnemyBattleMonster extends BattleMonster {
  /**
   * @param {import('../../types/typedef.js').BattleMonsterConfig} config
   */
  constructor(config) {
    super({ ...config, scaleHealthBarBackgroundImageByY: 0.8 }, getBattleLayout(config.scene).enemyMonster);
    this.layout();
  }

  layout() {
    const layout = getBattleLayout(this._scene);
    if (!this._scene.tweens.isTweening(this._phaserGameObject)) {
      this._phaserGameObject.setPosition(layout.enemyMonster.x, layout.enemyMonster.y);
    }
    if (!this._scene.tweens.isTweening(this._phaserHealthBarGameContainer)) {
      this._phaserHealthBarGameContainer.setPosition(layout.enemyHealthBar.x, layout.enemyHealthBar.y);
    }
  }

  /** @type {number} */
  get baseExpValue() {
    return this._monsterDetails.baseExp;
  }

  /**
   * @param {() => void} callback
   * @returns {void}
   */
  playMonsterAppearAnimation(callback) {
    const enemyPosition = getBattleLayout(this._scene).enemyMonster;
    const startXPos = -30;
    const endXPos = enemyPosition.x;
    this._phaserGameObject.setPosition(startXPos, enemyPosition.y);
    this._phaserGameObject.setAlpha(1);

    if (this._skipBattleAnimations) {
      this._phaserGameObject.setX(endXPos);
      this.layout();
      callback();
      return;
    }

    this._scene.tweens.add({
      delay: 0,
      duration: 1600,
      x: {
        from: startXPos,
        start: startXPos,
        to: endXPos,
      },
      targets: this._phaserGameObject,
      onComplete: () => {
        this.layout();
        callback();
      },
    });
  }

  /**
   * @param {() => void} callback
   * @returns {void}
   */
  playMonsterHealthBarAppearAnimation(callback) {
    const enemyHealthBarPosition = getBattleLayout(this._scene).enemyHealthBar;
    const startXPos = -600;
    const endXPos = 0;
    this._phaserHealthBarGameContainer.setPosition(startXPos, enemyHealthBarPosition.y);
    this._phaserHealthBarGameContainer.setAlpha(1);

    if (this._skipBattleAnimations) {
      this._phaserHealthBarGameContainer.setX(endXPos);
      this.layout();
      callback();
      return;
    }

    this._scene.tweens.add({
      delay: 0,
      duration: 1500,
      x: {
        from: startXPos,
        start: startXPos,
        to: endXPos,
      },
      targets: this._phaserHealthBarGameContainer,
      onComplete: () => {
        this.layout();
        callback();
      },
    });
  }

  /**
   * @param {() => void} callback
   * @returns {void}
   */
  playDeathAnimation(callback) {
    const startYPos = this._phaserGameObject.y;
    const endYPos = startYPos - 400;
    const healthBarStartXPos = this._phaserHealthBarGameContainer.x;
    const healthBarEndXPos = -600;

    if (this._skipBattleAnimations) {
      this._phaserGameObject.setY(endYPos);
      this._phaserHealthBarGameContainer.setAlpha(0);
      callback();
      return;
    }

    this._scene.tweens.add({
      delay: 0,
      duration: 2000,
      y: {
        from: startYPos,
        start: startYPos,
        to: endYPos,
      },
      targets: this._phaserGameObject,
      onComplete: () => {
        callback();
      },
    });

    this._scene.tweens.add({
      delay: 0,
      duration: 2000,
      x: {
        from: this._phaserHealthBarGameContainer.x,
        start: this._phaserHealthBarGameContainer.x,
        to: healthBarEndXPos,
      },
      targets: this._phaserHealthBarGameContainer,
      onComplete: () => {
        this._phaserHealthBarGameContainer.setAlpha(0);
        this._phaserHealthBarGameContainer.setX(healthBarStartXPos);
      },
    });
  }

  /**
   * @returns {number}
   */
  pickRandomMove() {
    return Phaser.Math.Between(0, this._monsterAttacks.length - 1);
  }

  /**
   * @returns {Promise<void>}
   */
  playCatchAnimation() {
    return new Promise((resolve) => {
      if (this._skipBattleAnimations) {
        this._phaserGameObject.setAlpha(0);
        resolve();
        return;
      }

      this._scene.tweens.add({
        duration: 500,
        targets: this._phaserGameObject,
        alpha: {
          from: 1,
          start: 1,
          to: 0,
        },
        ease: Phaser.Math.Easing.Sine.InOut,
        onComplete: () => {
          resolve();
        },
      });
    });
  }

  /**
   * @returns {Promise<void>}
   */
  playCatchAnimationFailed() {
    return new Promise((resolve) => {
      if (this._skipBattleAnimations) {
        this._phaserGameObject.setAlpha(1);
        resolve();
        return;
      }

      this._scene.tweens.add({
        duration: 500,
        targets: this._phaserGameObject,
        alpha: {
          from: 0,
          start: 0,
          to: 1,
        },
        ease: Phaser.Math.Easing.Sine.InOut,
        onComplete: () => {
          resolve();
        },
      });
    });
  }
}
