import Phaser from "phaser";

import type { MonsterTamerPanel } from "../bridge.ts";
import type { Cell } from "../content/areas.ts";

type MovementKeys = Readonly<{
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  action: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  map: Phaser.Input.Keyboard.Key;
  backpack: Phaser.Input.Keyboard.Key;
  team: Phaser.Input.Keyboard.Key;
  abilities: Phaser.Input.Keyboard.Key;
  close: Phaser.Input.Keyboard.Key;
}>;

export class InputController {
  private readonly keyboard: MovementKeys | null;
  private readonly controls: Phaser.GameObjects.GameObject[] = [];
  private readonly joystickBase: Phaser.GameObjects.Arc;
  private readonly joystickKnob: Phaser.GameObjects.Arc;
  private joystickPointerId: number | null = null;
  private joystickVector: Cell = { x: 0, y: 0 };
  private actionQueued = false;

  public constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    this.keyboard = keyboard
      ? (keyboard.addKeys({
          up: Phaser.Input.Keyboard.KeyCodes.UP,
          down: Phaser.Input.Keyboard.KeyCodes.DOWN,
          left: Phaser.Input.Keyboard.KeyCodes.LEFT,
          right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
          w: Phaser.Input.Keyboard.KeyCodes.W,
          a: Phaser.Input.Keyboard.KeyCodes.A,
          s: Phaser.Input.Keyboard.KeyCodes.S,
          d: Phaser.Input.Keyboard.KeyCodes.D,
          action: Phaser.Input.Keyboard.KeyCodes.SPACE,
          enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
          map: Phaser.Input.Keyboard.KeyCodes.M,
          backpack: Phaser.Input.Keyboard.KeyCodes.B,
          team: Phaser.Input.Keyboard.KeyCodes.T,
          abilities: Phaser.Input.Keyboard.KeyCodes.K,
          close: Phaser.Input.Keyboard.KeyCodes.ESC,
        }) as MovementKeys)
      : null;

    const touchVisible =
      navigator.maxTouchPoints > 0 ||
      globalThis.matchMedia?.("(pointer: coarse)").matches === true;

    this.joystickBase = this.track(
      scene.add
        .circle(92, 92, 58, 0x112d42, 0.48)
        .setStrokeStyle(3, 0xffffff, 0.72)
        .setScrollFactor(0)
        .setDepth(2_000)
        .setVisible(touchVisible)
        .setInteractive(
          new Phaser.Geom.Circle(58, 58, 66),
          Phaser.Geom.Circle.Contains,
        ),
    );
    this.joystickKnob = this.track(
      scene.add
        .circle(92, 92, 25, 0xffffff, 0.78)
        .setStrokeStyle(3, 0x54c6e8, 0.9)
        .setScrollFactor(0)
        .setDepth(2_001)
        .setVisible(touchVisible),
    );

    this.joystickBase.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        this.joystickPointerId = pointer.id;
        this.updateJoystick(pointer);
      },
    );

    const actionButton = this.createRoundButton(
      "A",
      54,
      0xffcc4d,
      touchVisible,
      () => {
        this.actionQueued = true;
      },
    );
    actionButton.setName("action");

    scene.input.on(
      Phaser.Input.Events.POINTER_MOVE,
      this.handlePointerMove,
      this,
    );
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
    scene.input.on(
      Phaser.Input.Events.POINTER_UP_OUTSIDE,
      this.handlePointerUp,
      this,
    );
    scene.input.on(Phaser.Input.Events.GAME_OUT, this.reset, this);
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    globalThis.addEventListener("blur", this.handleExternalInputLoss);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    scene.game.canvas.addEventListener(
      "pointercancel",
      this.handleExternalInputLoss,
    );
    this.layout();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  public direction(): Cell | null {
    const keyboardX =
      Number(this.isDown("right") || this.isDown("d")) -
      Number(this.isDown("left") || this.isDown("a"));
    const keyboardY =
      Number(this.isDown("down") || this.isDown("s")) -
      Number(this.isDown("up") || this.isDown("w"));
    const x = keyboardX || this.joystickVector.x;
    const y = keyboardY || this.joystickVector.y;

    if (x === 0 && y === 0) return null;
    if (Math.abs(x) > Math.abs(y)) return { x: Math.sign(x), y: 0 };
    return { x: 0, y: Math.sign(y) };
  }

  public consumeAction(): boolean {
    const keyboardAction = this.justDown("action") || this.justDown("enter");
    const queued = this.actionQueued;
    this.actionQueued = false;
    return keyboardAction || queued;
  }

  public consumePanel(): MonsterTamerPanel | null {
    const keyboardPanel = this.justDown("map")
      ? "map"
      : this.justDown("backpack")
        ? "backpack"
        : this.justDown("abilities")
          ? "abilities"
          : this.justDown("team")
            ? "team"
            : null;
    return keyboardPanel;
  }

  public consumeClose(): boolean {
    return this.justDown("close");
  }

  public reset(): void {
    if (this.keyboard) {
      for (const key of Object.values(this.keyboard)) key.reset();
    }
    this.joystickPointerId = null;
    this.joystickVector = { x: 0, y: 0 };
    this.actionQueued = false;
    this.joystickKnob.setPosition(this.joystickBase.x, this.joystickBase.y);
  }

  public destroy(): void {
    this.scene.input.off(
      Phaser.Input.Events.POINTER_MOVE,
      this.handlePointerMove,
      this,
    );
    this.scene.input.off(
      Phaser.Input.Events.POINTER_UP,
      this.handlePointerUp,
      this,
    );
    this.scene.input.off(
      Phaser.Input.Events.POINTER_UP_OUTSIDE,
      this.handlePointerUp,
      this,
    );
    this.scene.input.off(Phaser.Input.Events.GAME_OUT, this.reset, this);
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    globalThis.removeEventListener("blur", this.handleExternalInputLoss);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.scene.game.canvas.removeEventListener(
      "pointercancel",
      this.handleExternalInputLoss,
    );
    for (const control of this.controls) control.destroy();
    this.controls.length = 0;
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.joystickPointerId) this.updateJoystick(pointer);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.joystickPointerId) return;
    this.joystickPointerId = null;
    this.joystickVector = { x: 0, y: 0 };
    this.joystickKnob.setPosition(this.joystickBase.x, this.joystickBase.y);
  }

  private readonly handleExternalInputLoss = (): void => {
    this.reset();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.reset();
  };

  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const deltaX = pointer.x - this.joystickBase.x;
    const deltaY = pointer.y - this.joystickBase.y;
    const distance = Math.hypot(deltaX, deltaY);
    const radius = 42;
    const scale = distance > radius ? radius / distance : 1;
    this.joystickKnob.setPosition(
      this.joystickBase.x + deltaX * scale,
      this.joystickBase.y + deltaY * scale,
    );
    this.joystickVector =
      distance < 12
        ? { x: 0, y: 0 }
        : Math.abs(deltaX) > Math.abs(deltaY)
          ? { x: Math.sign(deltaX), y: 0 }
          : { x: 0, y: Math.sign(deltaY) };
  }

  private createRoundButton(
    label: string,
    radius: number,
    color: number,
    visible: boolean,
    action: () => void,
  ): Phaser.GameObjects.Container {
    const circle = this.scene.add
      .circle(0, 0, radius, color, 0.88)
      .setStrokeStyle(3, 0xffffff, 0.8)
      .setInteractive(
        new Phaser.Geom.Circle(radius, radius, radius + 8),
        Phaser.Geom.Circle.Contains,
      );
    const text = this.scene.add
      .text(0, 0, label, {
        color: "#173248",
        fontFamily: "system-ui, sans-serif",
        fontSize: `${Math.round(radius * 0.75)}px`,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const container = this.track(
      this.scene.add
        .container(0, 0, [circle, text])
        .setScrollFactor(0)
        .setDepth(2_000)
        .setVisible(visible),
    );
    circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, action);
    return container;
  }

  private layout(): void {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const actionY = Math.max(88, height - 96);
    const joystickY = Math.max(88, height - 158);
    this.joystickBase.setPosition(88, joystickY);
    this.joystickKnob.setPosition(88, joystickY);

    const action = this.controls.find(
      (control) =>
        control instanceof Phaser.GameObjects.Container &&
        control.name === "action",
    );
    if (action instanceof Phaser.GameObjects.Container) {
      action.setPosition(width - 88, actionY);
    }
  }

  private isDown(key: keyof MovementKeys): boolean {
    return this.keyboard?.[key].isDown === true;
  }

  private justDown(key: keyof MovementKeys): boolean {
    const keyboardKey = this.keyboard?.[key];
    return keyboardKey ? Phaser.Input.Keyboard.JustDown(keyboardKey) : false;
  }

  private track<T extends Phaser.GameObjects.GameObject>(value: T): T {
    this.controls.push(value);
    return value;
  }
}
