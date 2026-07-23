const CONTROL = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  CONFIRM: 'confirm',
  BACK: 'back',
  MENU: 'menu',
  FULLSCREEN: 'fullscreen',
});

const DIRECTION_CONTROLS = Object.freeze([CONTROL.LEFT, CONTROL.RIGHT, CONTROL.UP, CONTROL.DOWN]);
const RETURN_PATH = '/game';
const JOYSTICK_DEADZONE = 0.18;
const JOYSTICK_RADIUS = 56;
const JOYSTICK_KNOB_TRAVEL = 32;

class TouchControls {
  /** @type {Map<number, { control: string, button: HTMLButtonElement }>} */
  #activePointers = new Map();
  /** @type {Map<number, { x: number, y: number }>} */
  #gesturePointers = new Map();
  /** @type {Map<string, number>} */
  #pressed = new Map();
  #pressSequence = 0;
  /** @type {Map<string, Set<HTMLButtonElement>>} */
  #buttonsByControl = new Map();
  /** @type {'menu' | 'world'} */
  #inputMode = 'menu';
  /** @type {HTMLElement | null} */
  #joystick = null;
  /** @type {number | null} */
  #joystickPointerId = null;
  /** @type {{ x: number, y: number }} */
  #joystickVector = { x: 0, y: 0 };
  /** @type {string | undefined} */
  #joystickDirection;

  constructor() {
    this.#bindButtons();
    this.#bindJoystick();
    this.#bindGameGestures();
    this.#bindLifecycle();
    this.#initializeTelegram();
    this.#bindAudioResume();
  }

  /**
   * World movement owns map gestures; every other scene maps a tap to confirm
   * and a swipe to one menu direction.
   * @param {boolean} enabled
   */
  setWorldPointerMode(enabled) {
    this.#inputMode = enabled ? 'world' : 'menu';
    document.documentElement.classList.toggle('is-world-scene', enabled);
    this.#joystick?.setAttribute('aria-hidden', String(!enabled));
    this.#gesturePointers.clear();
    this.#resetJoystick();
  }

  releaseWorldMovement() {
    DIRECTION_CONTROLS.forEach((control) => this.#pressed.delete(control));
    this.#resetJoystick();
  }

  /**
   * Returns and consumes a one-shot control press.
   * @param {string} control
   * @returns {boolean}
   */
  consumePress(control) {
    if (!this.#pressed.has(control)) {
      return false;
    }
    this.#pressed.delete(control);
    return true;
  }

  /**
   * Returns and consumes one directional press.
   * @returns {string | undefined}
   */
  consumeDirectionPress() {
    const selected = DIRECTION_CONTROLS.find((control) => this.#pressed.has(control));
    DIRECTION_CONTROLS.forEach((control) => this.#pressed.delete(control));
    return selected;
  }

  /**
   * @param {string} control
   * @returns {boolean}
   */
  isDown(control) {
    return Array.from(this.#activePointers.values()).some((pointer) => pointer.control === control);
  }

  /**
   * @returns {string | undefined}
   */
  getHeldDirection() {
    const { x, y } = this.getJoystickVector();
    if (Math.max(Math.abs(x), Math.abs(y)) === 0) {
      return DIRECTION_CONTROLS.find((control) => this.isDown(control));
    }
    if (Math.abs(x) >= Math.abs(y)) {
      return x < 0 ? CONTROL.LEFT : CONTROL.RIGHT;
    }
    return y < 0 ? CONTROL.UP : CONTROL.DOWN;
  }

  /**
   * Returns the normalized radial joystick vector after applying its deadzone.
   * @returns {{ x: number, y: number }}
   */
  getJoystickVector() {
    return { ...this.#joystickVector };
  }

  #bindButtons() {
    document.querySelectorAll('[data-control]').forEach((element) => {
      if (!(element instanceof HTMLButtonElement)) {
        return;
      }
      const control = element.dataset.control;
      if (!control || !Object.values(CONTROL).includes(control)) {
        return;
      }

      const buttons = this.#buttonsByControl.get(control) ?? new Set();
      buttons.add(element);
      this.#buttonsByControl.set(control, buttons);

      element.addEventListener('pointerdown', (event) => this.#handlePointerDown(event, control, element));
      element.addEventListener('pointerup', (event) => this.#releasePointer(event.pointerId));
      element.addEventListener('pointercancel', (event) => this.#releasePointer(event.pointerId));
      element.addEventListener('lostpointercapture', (event) => this.#releasePointer(event.pointerId));
      element.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  #bindJoystick() {
    const joystick = document.querySelector('#movement-joystick');
    if (!(joystick instanceof HTMLElement)) {
      return;
    }
    this.#joystick = joystick;
    joystick.dataset.active = 'false';

    joystick.addEventListener('pointerdown', (event) => {
      if (
        this.#inputMode !== 'world' ||
        this.#joystickPointerId !== null ||
        (event.pointerType === 'mouse' && event.button !== 0)
      ) {
        return;
      }

      event.preventDefault();
      this.#resumeAudio();
      this.#joystickPointerId = event.pointerId;
      joystick.dataset.active = 'true';
      try {
        joystick.setPointerCapture(event.pointerId);
      } catch {
        // Lifecycle and pointer terminal events still clear the vector.
      }
      this.#updateJoystick(event);
    });
    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.#joystickPointerId) {
        event.preventDefault();
        this.#updateJoystick(event);
      }
    });
    joystick.addEventListener('pointerup', (event) => this.#releaseJoystickPointer(event.pointerId));
    joystick.addEventListener('pointercancel', (event) => this.#releaseJoystickPointer(event.pointerId));
    joystick.addEventListener('lostpointercapture', (event) => this.#releaseJoystickPointer(event.pointerId));
    joystick.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('pointerup', (event) => this.#releaseJoystickPointer(event.pointerId));
    window.addEventListener('pointercancel', (event) => this.#releaseJoystickPointer(event.pointerId));
  }

  /**
   * @param {PointerEvent} event
   */
  #updateJoystick(event) {
    if (!this.#joystick) {
      return;
    }

    const bounds = this.#joystick.getBoundingClientRect();
    const rawX = (event.clientX - (bounds.left + bounds.width / 2)) / JOYSTICK_RADIUS;
    const rawY = (event.clientY - (bounds.top + bounds.height / 2)) / JOYSTICK_RADIUS;
    const rawMagnitude = Math.hypot(rawX, rawY);
    const clampedMagnitude = Math.min(rawMagnitude, 1);
    const unitX = rawMagnitude === 0 ? 0 : rawX / rawMagnitude;
    const unitY = rawMagnitude === 0 ? 0 : rawY / rawMagnitude;
    const adjustedMagnitude =
      clampedMagnitude <= JOYSTICK_DEADZONE
        ? 0
        : (clampedMagnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
    this.#joystickVector = {
      x: unitX * adjustedMagnitude,
      y: unitY * adjustedMagnitude,
    };
    let direction;
    if (adjustedMagnitude > 0) {
      if (Math.abs(this.#joystickVector.x) >= Math.abs(this.#joystickVector.y)) {
        direction = this.#joystickVector.x < 0 ? CONTROL.LEFT : CONTROL.RIGHT;
      } else {
        direction = this.#joystickVector.y < 0 ? CONTROL.UP : CONTROL.DOWN;
      }
    }
    if (direction && direction !== this.#joystickDirection) {
      this.#markPressed(direction);
    }
    this.#joystickDirection = direction;
    this.#joystick.style.setProperty('--joystick-x', `${unitX * clampedMagnitude * JOYSTICK_KNOB_TRAVEL}px`);
    this.#joystick.style.setProperty('--joystick-y', `${unitY * clampedMagnitude * JOYSTICK_KNOB_TRAVEL}px`);
  }

  /**
   * @param {number} pointerId
   */
  #releaseJoystickPointer(pointerId) {
    if (pointerId === this.#joystickPointerId) {
      this.#resetJoystick();
    }
  }

  #resetJoystick() {
    const pointerId = this.#joystickPointerId;
    this.#joystickPointerId = null;
    this.#joystickVector = { x: 0, y: 0 };
    this.#joystickDirection = undefined;
    if (!this.#joystick) {
      return;
    }
    if (pointerId !== null && this.#joystick.hasPointerCapture(pointerId)) {
      try {
        this.#joystick.releasePointerCapture(pointerId);
      } catch {
        // Pointer terminal events still leave the logical input released.
      }
    }
    this.#joystick.dataset.active = 'false';
    this.#joystick.style.setProperty('--joystick-x', '0px');
    this.#joystick.style.setProperty('--joystick-y', '0px');
  }

  #bindGameGestures() {
    const container = document.querySelector('#game-container');
    if (!(container instanceof HTMLElement)) {
      return;
    }

    container.addEventListener('pointerdown', (event) => {
      if (this.#inputMode === 'world' || (event.pointerType === 'mouse' && event.button !== 0)) {
        return;
      }
      this.#gesturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    container.addEventListener('pointerup', (event) => {
      const start = this.#gesturePointers.get(event.pointerId);
      this.#gesturePointers.delete(event.pointerId);
      if (!start || this.#inputMode === 'world') {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const swipeThreshold = Math.max(36, Math.min(window.innerWidth, window.innerHeight) * 0.05);
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < swipeThreshold) {
        this.#markPressed(CONTROL.CONFIRM);
        return;
      }

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        this.#markPressed(deltaX > 0 ? CONTROL.RIGHT : CONTROL.LEFT);
        return;
      }
      this.#markPressed(deltaY > 0 ? CONTROL.DOWN : CONTROL.UP);
    });
    container.addEventListener('pointercancel', (event) => {
      this.#gesturePointers.delete(event.pointerId);
    });
  }

  /**
   * @param {PointerEvent} event
   * @param {string} control
   * @param {HTMLButtonElement} button
   */
  #handlePointerDown(event, control, button) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.#resumeAudio();

    if (this.#activePointers.has(event.pointerId)) {
      return;
    }

    const wasAlreadyDown = this.isDown(control);
    this.#activePointers.set(event.pointerId, { control, button });
    if (!wasAlreadyDown) {
      this.#markPressed(control);
    }
    this.#setPressedVisual(control, true);

    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; pointercancel and lifecycle cleanup remain active.
    }
  }

  /**
   * @param {number} pointerId
   */
  #releasePointer(pointerId) {
    const activePointer = this.#activePointers.get(pointerId);
    if (!activePointer) {
      return;
    }
    this.#activePointers.delete(pointerId);
    this.#setPressedVisual(activePointer.control, this.isDown(activePointer.control));
  }

  /**
   * @param {string} control
   * @param {boolean} isPressed
   */
  #setPressedVisual(control, isPressed) {
    this.#buttonsByControl.get(control)?.forEach((button) => {
      button.classList.toggle('is-pressed', isPressed);
      button.setAttribute('aria-pressed', String(isPressed));
    });
  }

  #releaseAll() {
    this.#activePointers.clear();
    this.#gesturePointers.clear();
    this.#pressed.clear();
    this.#resetJoystick();
    this.#buttonsByControl.forEach((_, control) => this.#setPressedVisual(control, false));
  }

  /**
   * Keeps a one-shot input alive for the next animation frame, matching
   * Phaser's keyboard JustDown behavior without leaving stale touch actions.
   * @param {string} control
   */
  #markPressed(control) {
    const sequence = ++this.#pressSequence;
    this.#pressed.set(control, sequence);
    window.requestAnimationFrame(() => {
      if (this.#pressed.get(control) === sequence) {
        this.#pressed.delete(control);
      }
    });
  }

  #bindLifecycle() {
    window.addEventListener('blur', () => this.#releaseAll());
    window.addEventListener('pagehide', () => this.#releaseAll());
    window.addEventListener('resize', () => this.#releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        this.#releaseAll();
      }
    });
  }

  #bindAudioResume() {
    const resume = () => this.#resumeAudio();
    window.addEventListener('pointerdown', resume, {
      capture: true,
      passive: true,
    });
    window.addEventListener('touchstart', resume, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', resume, { capture: true });
  }

  async #resumeAudio() {
    const games = window.Phaser?.GAMES ?? [];
    const contexts = games.map((game) => game?.sound?.context).filter(Boolean);
    if (contexts.length === 0) {
      return;
    }

    await Promise.allSettled(
      contexts.map((context) => (context.state === 'suspended' ? context.resume() : Promise.resolve()))
    );
  }

  #initializeTelegram() {
    const telegram = window.Telegram?.WebApp;
    if (!telegram) {
      return;
    }

    document.documentElement.classList.add('is-telegram');
    const returnToGame = () => window.location.assign(RETURN_PATH);
    const releaseAll = () => this.#releaseAll();
    const syncLayout = () => {
      this.#releaseAll();
      this.#setInsets('--tg-safe-area-inset', telegram.safeAreaInset);
      this.#setInsets('--tg-content-safe-area-inset', telegram.contentSafeAreaInset);
      if (telegram.viewportStableHeight) {
        document.documentElement.style.setProperty('--tg-viewport-stable-height', `${telegram.viewportStableHeight}px`);
      }
    };

    telegram.ready();
    telegram.expand();
    telegram.disableVerticalSwipes?.();
    try {
      telegram.requestFullscreen?.();
    } catch {
      // Expanded mode remains the deterministic fallback on older clients.
    }
    telegram.BackButton?.show();
    telegram.BackButton?.onClick(returnToGame);
    ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged', 'fullscreenChanged', 'fullscreenFailed'].forEach(
      (eventName) => telegram.onEvent(eventName, syncLayout)
    );
    telegram.onEvent('deactivated', releaseAll);
    syncLayout();

    window.addEventListener(
      'pagehide',
      () => {
        telegram.enableVerticalSwipes?.();
        telegram.BackButton?.offClick(returnToGame);
        telegram.BackButton?.hide();
        ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged', 'fullscreenChanged', 'fullscreenFailed'].forEach(
          (eventName) => telegram.offEvent(eventName, syncLayout)
        );
        telegram.offEvent('deactivated', releaseAll);
      },
      { once: true }
    );
  }

  /**
   * @param {string} prefix
   * @param {{ top: number, right: number, bottom: number, left: number } | undefined} insets
   */
  #setInsets(prefix, insets) {
    if (!insets) {
      return;
    }
    Object.entries(insets).forEach(([side, value]) => {
      document.documentElement.style.setProperty(`${prefix}-${side}`, `${value}px`);
    });
  }
}

export { CONTROL };
export const touchControls = new TouchControls();
