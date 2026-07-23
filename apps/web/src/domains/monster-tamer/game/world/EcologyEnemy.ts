import Phaser from "phaser";

import type { MonsterEncounter, MonsterTamerElement } from "../bridge.ts";
import { CatalogTextureLoader } from "../assets/CatalogTextureLoader.ts";
import {
  cellCenter,
  cellKey,
  manhattan,
  sameCell,
  type Cell,
} from "../content/areas.ts";

export class EcologyEnemy {
  private readonly container: Phaser.GameObjects.Container;
  private readonly alert: Phaser.GameObjects.Text;
  private readonly aura: Phaser.GameObjects.Arc;
  private readonly originMarker: Phaser.GameObjects.Arc;
  private cell: Cell;
  private moving = false;
  private nextMoveAt = 0;
  private encounterRequested = false;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly loader: CatalogTextureLoader,
    public readonly encounter: MonsterEncounter,
    element: MonsterTamerElement | null,
  ) {
    this.cell = { ...encounter.position };
    const position = cellCenter(this.cell);
    const color = elementColor(element);
    this.originMarker = scene.add
      .circle(position.x, position.y + 14, 25, color, 0.08)
      .setStrokeStyle(3, color, 0.42)
      .setDepth(78 + this.cell.y);
    const shadow = scene.add.ellipse(0, 34, 62, 21, 0x132838, 0.32);
    this.aura = scene.add
      .circle(0, 0, 43, color, 0.2)
      .setStrokeStyle(encounter.kind === "normal" ? 4 : 6, color, 0.9);
    const portraitBackground = scene.add
      .circle(0, 0, 35, 0xf7fbff, 0.96)
      .setStrokeStyle(2, 0xffffff, 0.9);
    const missing = scene.add
      .text(0, 0, "资源\n缺失", {
        align: "center",
        color: "#31506a",
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const badge = scene.add
      .text(0, 48, kindLabel(encounter.kind), {
        backgroundColor: kindColor(encounter.kind),
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: encounter.kind === "normal" ? "11px" : "12px",
        fontStyle: "bold",
        padding: { x: 7, y: 3 },
      })
      .setOrigin(0.5);
    this.alert = scene.add
      .text(32, -41, "!", {
        backgroundColor: "#ffdd57",
        color: "#28384a",
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        fontStyle: "bold",
        padding: { x: 7, y: 1 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.container = scene.add
      .container(position.x, position.y - 15, [
        shadow,
        this.aura,
        portraitBackground,
        missing,
        badge,
        this.alert,
      ])
      .setDepth(120 + this.cell.y);

    scene.tweens.add({
      targets: [this.aura],
      scale: { from: 0.94, to: 1.08 },
      alpha: { from: 0.15, to: 0.34 },
      duration: 900 + (encounter.id.length % 5) * 90,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
    scene.tweens.add({
      targets: this.container,
      scaleY: { from: 0.98, to: 1.02 },
      duration: 1_100 + (encounter.name.length % 4) * 120,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    void loader
      .loadCircularThumbnail(
        encounter.template_id,
        encounter.image_thumbnail_path,
      )
      .then((textureKey) => {
        if (!textureKey || !this.container.active) return;
        const portrait = scene.add
          .image(0, 0, textureKey)
          .setDisplaySize(68, 68);
        this.container.addAt(portrait, 3);
        missing.destroy();
      });
  }

  public get position(): Cell {
    return this.cell;
  }

  public update({
    time,
    playerCell,
    occupiedCellIds,
    canEnter,
    onEncounter,
  }: {
    time: number;
    playerCell: Cell;
    occupiedCellIds: ReadonlySet<string>;
    canEnter(cell: Cell): boolean;
    onEncounter(encounterId: string): void;
  }): void {
    const distance = manhattan(this.cell, playerCell);
    const alertDistance = this.encounter.engage_radius;
    const playerWithinEngageArea =
      manhattan(this.encounter.position, playerCell) <= alertDistance;
    this.alert.setVisible(playerWithinEngageArea);
    if (distance > 1 || !playerWithinEngageArea) {
      this.encounterRequested = false;
    }

    if (distance <= 1 && playerWithinEngageArea) {
      if (!this.encounterRequested) {
        this.encounterRequested = true;
        onEncounter(this.encounter.id);
      }
      return;
    }

    if (
      this.moving ||
      time < this.nextMoveAt ||
      !playerWithinEngageArea ||
      this.encounter.kind === "boss" ||
      this.encounter.kind === "guardian"
    ) {
      return;
    }

    const horizontalFirst =
      Math.abs(playerCell.x - this.cell.x) >=
      Math.abs(playerCell.y - this.cell.y);
    const candidates = horizontalFirst
      ? [
          {
            x: this.cell.x + Math.sign(playerCell.x - this.cell.x),
            y: this.cell.y,
          },
          {
            x: this.cell.x,
            y: this.cell.y + Math.sign(playerCell.y - this.cell.y),
          },
        ]
      : [
          {
            x: this.cell.x,
            y: this.cell.y + Math.sign(playerCell.y - this.cell.y),
          },
          {
            x: this.cell.x + Math.sign(playerCell.x - this.cell.x),
            y: this.cell.y,
          },
        ];
    const target = candidates.find(
      (candidate) =>
        !sameCell(candidate, this.cell) &&
        manhattan(this.encounter.position, candidate) <= alertDistance &&
        canEnter(candidate) &&
        !occupiedCellIds.has(cellKey(candidate)),
    );

    if (!target) {
      this.nextMoveAt = time + 450;
      return;
    }

    this.moving = true;
    this.cell = target;
    const center = cellCenter(target);
    this.container.setDepth(120 + target.y);
    this.scene.tweens.add({
      targets: this.container,
      x: center.x,
      y: center.y - 21,
      duration: 260,
      ease: "Sine.easeInOut",
      onComplete: () => {
        this.moving = false;
        this.nextMoveAt = time + 520;
        if (sameCell(this.cell, playerCell) && !this.encounterRequested) {
          this.encounterRequested = true;
          onEncounter(this.encounter.id);
        }
      },
    });
  }

  public destroy(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.killTweensOf(this.aura);
    this.originMarker.destroy();
    this.container.destroy(true);
  }
}

function elementColor(element: MonsterTamerElement | null): number {
  switch (element) {
    case "water":
      return 0x48c9ff;
    case "fire":
      return 0xff704d;
    case "wood":
      return 0x66df7a;
    case "wind":
      return 0xc7f6ff;
    case "lightning":
      return 0xffdf55;
    case null:
      return 0xc9a8ff;
  }
}

function kindLabel(kind: MonsterEncounter["kind"]): string {
  switch (kind) {
    case "normal":
      return "生态怪兽";
    case "elite":
      return "精英";
    case "boss":
      return "区域首领";
    case "guardian":
      return "最终守护者";
  }
}

function kindColor(kind: MonsterEncounter["kind"]): string {
  switch (kind) {
    case "normal":
      return "#27868d";
    case "elite":
      return "#7745c9";
    case "boss":
      return "#cf593f";
    case "guardian":
      return "#7e3a9c";
  }
}
