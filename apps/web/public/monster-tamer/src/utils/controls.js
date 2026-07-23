import Phaser from '../lib/phaser.js';
import { DIRECTION } from '../common/direction.js';
import { CONTROL, touchControls } from './touch-controls.js';

export class Controls {
  /** @type {Phaser.Scene} */
  #scene;
  /** @type {Phaser.Types.Input.Keyboard.CursorKeys | undefined} */
  #cursorKeys;
  /** @type {boolean} */
  #lockPlayerInput;
  /** @type {Phaser.Input.Keyboard.Key | undefined} */
  #enterKey;
  /** @type {Phaser.Input.Keyboard.Key | undefined} */
  #fKey;

  /**
   * @param {Phaser.Scene} scene the Phaser 3 Scene the cursor keys will be created in
   */
  constructor(scene) {
    this.#scene = scene;
    this.#cursorKeys = this.#scene.input.keyboard?.createCursorKeys();
    this.#enterKey = this.#scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.#fKey = this.#scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.#lockPlayerInput = false;
  }

  /** @type {boolean} */
  get isInputLocked() {
    return this.#lockPlayerInput;
  }

  /** @param {boolean} val the value that will be assigned */
  set lockInput(val) {
    this.#lockPlayerInput = val;
  }

  /** @returns {boolean} */
  wasEnterKeyPressed() {
    const wasTouched = touchControls.consumePress(CONTROL.MENU);
    return (this.#enterKey !== undefined && Phaser.Input.Keyboard.JustDown(this.#enterKey)) || wasTouched;
  }

  /** @returns {boolean} */
  wasSpaceKeyPressed() {
    const wasTouched = touchControls.consumePress(CONTROL.CONFIRM);
    return (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.space)) || wasTouched;
  }

  /** @returns {boolean} */
  wasBackKeyPressed() {
    const wasTouched = touchControls.consumePress(CONTROL.BACK);
    return (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.shift)) || wasTouched;
  }

  /** @returns {boolean} */
  wasFKeyPressed() {
    const wasTouched = touchControls.consumePress(CONTROL.FULLSCREEN);
    return (this.#fKey !== undefined && Phaser.Input.Keyboard.JustDown(this.#fKey)) || wasTouched;
  }

  /**
   * Returns if the shift key is currently being held down.
   * @returns {boolean}
   */
  isShiftKeyDown() {
    return (this.#cursorKeys !== undefined && this.#cursorKeys.shift.isDown) || touchControls.isDown(CONTROL.BACK);
  }

  /** @returns {import('../common/direction.js').Direction} */
  getDirectionKeyJustPressed() {
    /** @type {import('../common/direction.js').Direction} */
    let selectedDirection = DIRECTION.NONE;
    if (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.left)) {
      selectedDirection = DIRECTION.LEFT;
    } else if (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.right)) {
      selectedDirection = DIRECTION.RIGHT;
    } else if (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.up)) {
      selectedDirection = DIRECTION.UP;
    } else if (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.down)) {
      selectedDirection = DIRECTION.DOWN;
    }

    const touchedDirection = touchControls.consumeDirectionPress();
    if (selectedDirection !== DIRECTION.NONE) {
      return selectedDirection;
    }
    if (touchedDirection === CONTROL.LEFT) {
      return DIRECTION.LEFT;
    }
    if (touchedDirection === CONTROL.RIGHT) {
      return DIRECTION.RIGHT;
    }
    if (touchedDirection === CONTROL.UP) {
      return DIRECTION.UP;
    }
    if (touchedDirection === CONTROL.DOWN) {
      return DIRECTION.DOWN;
    }

    return selectedDirection;
  }

  /** @returns {import('../common/direction.js').Direction} */
  getDirectionKeyPressedDown() {
    /** @type {import('../common/direction.js').Direction} */
    let selectedDirection = DIRECTION.NONE;
    if (this.#cursorKeys !== undefined && this.#cursorKeys.left.isDown) {
      selectedDirection = DIRECTION.LEFT;
    } else if (this.#cursorKeys !== undefined && this.#cursorKeys.right.isDown) {
      selectedDirection = DIRECTION.RIGHT;
    } else if (this.#cursorKeys !== undefined && this.#cursorKeys.up.isDown) {
      selectedDirection = DIRECTION.UP;
    } else if (this.#cursorKeys !== undefined && this.#cursorKeys.down.isDown) {
      selectedDirection = DIRECTION.DOWN;
    }

    if (selectedDirection !== DIRECTION.NONE) {
      return selectedDirection;
    }
    const touchedDirection = touchControls.getHeldDirection();
    if (touchedDirection === CONTROL.LEFT) {
      return DIRECTION.LEFT;
    }
    if (touchedDirection === CONTROL.RIGHT) {
      return DIRECTION.RIGHT;
    }
    if (touchedDirection === CONTROL.UP) {
      return DIRECTION.UP;
    }
    if (touchedDirection === CONTROL.DOWN) {
      return DIRECTION.DOWN;
    }

    return selectedDirection;
  }
}
