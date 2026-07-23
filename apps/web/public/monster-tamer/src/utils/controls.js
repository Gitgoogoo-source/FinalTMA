import Phaser from '../lib/phaser.js';
import { DIRECTION } from '../common/direction.js';
import { CONTROL, touchControls } from './touch-controls.js';

export class Controls {
  /** @type {Phaser.Scene} */
  #scene;
  /** @type {Phaser.Types.Input.Keyboard.CursorKeys | undefined} */
  #cursorKeys;
  /** @type {Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key> | undefined} */
  #wasdKeys;
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
    this.#wasdKeys = this.#scene.input.keyboard?.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
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

  /** @param {boolean} enabled */
  setWorldPointerMode(enabled) {
    touchControls.setWorldPointerMode(enabled);
  }

  releaseWorldMovement() {
    touchControls.releaseWorldMovement();
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
    if (
      (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.left)) ||
      (this.#wasdKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#wasdKeys.left))
    ) {
      selectedDirection = DIRECTION.LEFT;
    } else if (
      (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.right)) ||
      (this.#wasdKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#wasdKeys.right))
    ) {
      selectedDirection = DIRECTION.RIGHT;
    } else if (
      (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.up)) ||
      (this.#wasdKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#wasdKeys.up))
    ) {
      selectedDirection = DIRECTION.UP;
    } else if (
      (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.down)) ||
      (this.#wasdKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#wasdKeys.down))
    ) {
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
    return this.getMovementDirections()[0]?.direction ?? DIRECTION.NONE;
  }

  /**
   * Returns up to two movement axes with their input strengths. Keeping the
   * strengths lets grid movement preserve an analog joystick's intended ratio
   * while still trying the secondary axis when the primary axis is blocked.
   * @returns {{ direction: import('../common/direction.js').Direction, strength: number }[]}
   */
  getMovementDirections() {
    const keyboardLeft = Boolean(this.#cursorKeys?.left.isDown || this.#wasdKeys?.left.isDown);
    const keyboardRight = Boolean(this.#cursorKeys?.right.isDown || this.#wasdKeys?.right.isDown);
    const keyboardUp = Boolean(this.#cursorKeys?.up.isDown || this.#wasdKeys?.up.isDown);
    const keyboardDown = Boolean(this.#cursorKeys?.down.isDown || this.#wasdKeys?.down.isDown);
    const joystickVector = touchControls.getJoystickVector();
    const hasJoystickInput = Math.max(Math.abs(joystickVector.x), Math.abs(joystickVector.y)) > 0;
    const vector = hasJoystickInput
      ? joystickVector
      : {
          x: Number(keyboardRight) - Number(keyboardLeft),
          y: Number(keyboardDown) - Number(keyboardUp),
        };
    /** @type {{ direction: import('../common/direction.js').Direction, strength: number, axis: number }[]} */
    const directions = [];

    if (vector.x !== 0) {
      directions.push({
        direction: vector.x < 0 ? DIRECTION.LEFT : DIRECTION.RIGHT,
        strength: Math.abs(vector.x),
        axis: 0,
      });
    }
    if (vector.y !== 0) {
      directions.push({
        direction: vector.y < 0 ? DIRECTION.UP : DIRECTION.DOWN,
        strength: Math.abs(vector.y),
        axis: 1,
      });
    }

    const orderedDirections = directions.sort(
      (left, right) => right.strength - left.strength || left.axis - right.axis
    );
    return orderedDirections.map(({ direction, strength }) => ({ direction, strength }));
  }
}
