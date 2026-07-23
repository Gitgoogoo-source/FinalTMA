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

class TouchControls {
  /** @type {Map<number, { control: string, button: HTMLButtonElement }>} */
  #activePointers = new Map();
  /** @type {Map<string, number>} */
  #pressed = new Map();
  #pressSequence = 0;
  /** @type {Map<string, Set<HTMLButtonElement>>} */
  #buttonsByControl = new Map();

  constructor() {
    this.#bindButtons();
    this.#bindLifecycle();
    this.#initializeTelegram();
    this.#bindAudioResume();
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
    return DIRECTION_CONTROLS.find((control) => this.isDown(control));
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
    this.#pressed.clear();
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

    const returnToGame = () => window.location.assign(RETURN_PATH);
    const syncLayout = () => {
      this.#setInsets('--tg-safe-area-inset', telegram.safeAreaInset);
      this.#setInsets('--tg-content-safe-area-inset', telegram.contentSafeAreaInset);
      if (telegram.viewportStableHeight) {
        document.documentElement.style.setProperty('--tg-viewport-stable-height', `${telegram.viewportStableHeight}px`);
      }
    };

    telegram.ready();
    telegram.expand();
    telegram.BackButton?.show();
    telegram.BackButton?.onClick(returnToGame);
    ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged'].forEach((eventName) =>
      telegram.onEvent(eventName, syncLayout)
    );
    syncLayout();

    window.addEventListener(
      'pagehide',
      () => {
        telegram.BackButton?.offClick(returnToGame);
        telegram.BackButton?.hide();
        ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged'].forEach((eventName) =>
          telegram.offEvent(eventName, syncLayout)
        );
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
