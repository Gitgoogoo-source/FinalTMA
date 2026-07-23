import { CHARACTER_ASSET_KEYS } from '../../assets/asset-keys.js';
import { DIRECTION } from '../../common/direction.js';
import { exhaustiveGuard } from '../../utils/guard.js';
import { Character } from './character.js';

/**
 * @typedef {Omit<import('./character').CharacterConfig, 'assetKey' | 'idleFrameConfig'>} PlayerConfig
 */

export class Player extends Character {
  /**
   * @param {PlayerConfig} config
   */
  constructor(config) {
    super({
      ...config,
      assetKey: CHARACTER_ASSET_KEYS.PLAYER,
      origin: { x: 0, y: 0.2 },
      idleFrameConfig: {
        DOWN: 7,
        UP: 1,
        NONE: 7,
        LEFT: 10,
        RIGHT: 4,
      },
    });
  }

  /**
   * @param {import('../../common/direction.js').Direction} direction
   * @param {boolean} [isRunning=false]
   * @returns {boolean}
   */
  moveCharacter(direction, isRunning = false) {
    const didMove = super.moveCharacter(direction, isRunning);

    if (!didMove) {
      this._phaserGameObject.anims.stop();
      this._phaserGameObject.setFrame(this._getIdleFrame());
      return false;
    }

    switch (this._direction) {
      case DIRECTION.DOWN:
      case DIRECTION.LEFT:
      case DIRECTION.RIGHT:
      case DIRECTION.UP:
        if (
          !this._phaserGameObject.anims.isPlaying ||
          this._phaserGameObject.anims.currentAnim?.key !== `PLAYER_${this._direction}`
        ) {
          this._phaserGameObject.play(`PLAYER_${this._direction}`);
        }
        this._phaserGameObject.anims.timeScale = this._isRunning ? 1.5 : 1;
        break;
      case DIRECTION.NONE:
        break;
      default:
        exhaustiveGuard(this._direction);
    }

    return didMove;
  }
}
