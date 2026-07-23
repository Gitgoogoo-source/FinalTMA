import Phaser from "phaser";

import { CatalogTextureLoader } from "../assets/CatalogTextureLoader.ts";
import {
  PARTICLE_TEXTURE_KEY,
  ensureProceduralTextures,
} from "../assets/ProceduralTextures.ts";
import type { MonsterBattleCombatant } from "../../types.ts";
import type { MonsterBattle } from "../bridge.ts";
import { getAreaDefinition } from "../content/areas.ts";
import { runtimeFromScene, type GameRuntime } from "../runtime/GameRuntime.ts";
import { WORLD_SCENE_KEY } from "./BootScene.ts";

export const BATTLE_EFFECTS_SCENE_KEY = "monster-tamer-battle-effects";

export class BattleEffectsScene extends Phaser.Scene {
  private runtime!: GameRuntime;
  private loader!: CatalogTextureLoader;
  private unsubscribeSnapshot: (() => void) | null = null;
  private readonly battleObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly ambientParticles: Array<{
    object: Phaser.GameObjects.Image;
    speed: number;
    drift: number;
  }> = [];
  private readonly battlefieldSurfaces: Phaser.GameObjects.Ellipse[] = [];
  private previousTurn = -1;
  private exiting = false;

  public constructor() {
    super(BATTLE_EFFECTS_SCENE_KEY);
  }

  public create(): void {
    this.runtime = runtimeFromScene(this);
    this.previousTurn = -1;
    this.exiting = false;
    if (!this.runtime.snapshot.activeBattle) {
      this.scene.stop();
      return;
    }

    ensureProceduralTextures(this);
    this.loader = new CatalogTextureLoader(this);
    this.scene.pause(WORLD_SCENE_KEY);
    this.cameras.main.resetFX();
    this.cameras.main.setBackgroundColor("rgba(10, 20, 34, 0)");
    this.createBackdrop();
    this.renderBattle();

    this.unsubscribeSnapshot = this.runtime.onSnapshot((snapshot, previous) => {
      if (!snapshot.activeBattle) {
        this.playExitAndStop();
        return;
      }
      this.renderBattle();
      if (previous.activeBattle) {
        this.showHealthDeltas(snapshot.activeBattle, previous.activeBattle);
      }
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.renderBattle, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    this.cameras.main.setZoom(1.08);
    this.tweens.add({
      targets: this.cameras.main,
      zoom: 1,
      duration: 420,
      ease: "Back.easeOut",
    });
  }

  public override update(_time: number, delta: number): void {
    const width = this.scale.width;
    const height = this.scale.height;
    for (const particle of this.ambientParticles) {
      particle.object.y -= particle.speed * (delta / 1_000);
      particle.object.x += particle.drift * (delta / 1_000);
      particle.object.rotation += 0.3 * (delta / 1_000);
      if (particle.object.y < -20) {
        particle.object.y = height + 20;
        particle.object.x = Phaser.Math.Between(0, Math.max(1, width));
      }
      if (particle.object.x < -20) particle.object.x = width + 20;
      if (particle.object.x > width + 20) particle.object.x = -20;
    }
  }

  private createBackdrop(): void {
    const definition = getAreaDefinition(this.runtime.snapshot.areaId);
    const width = this.scale.width;
    const height = this.scale.height;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x101a2b, 0.82)
      .setScrollFactor(0);
    this.battlefieldSurfaces.push(
      this.add
        .ellipse(
          width * 0.2,
          height * 0.84,
          width * 0.7,
          height * 0.3,
          definition.palette.base,
          0.45,
        )
        .setScrollFactor(0),
    );
    this.battlefieldSurfaces.push(
      this.add
        .ellipse(
          width * 0.8,
          height * 0.84,
          width * 0.7,
          height * 0.3,
          definition.palette.patch,
          0.5,
        )
        .setScrollFactor(0),
    );

    for (let index = 0; index < 22; index += 1) {
      const object = this.add
        .image(
          Phaser.Math.Between(0, Math.max(1, width)),
          Phaser.Math.Between(0, Math.max(1, height)),
          PARTICLE_TEXTURE_KEY,
        )
        .setTint(definition.palette.accent)
        .setAlpha(0.18 + (index % 5) * 0.07)
        .setScale(0.45 + (index % 4) * 0.16)
        .setScrollFactor(0);
      this.ambientParticles.push({
        object,
        speed: 11 + (index % 6) * 5,
        drift: ((index % 5) - 2) * 3,
      });
    }
  }

  private renderBattle(): void {
    const battle = this.runtime.snapshot.activeBattle;
    if (!battle) return;

    this.clearBattleObjects();

    const width = this.scale.width;
    const height = this.scale.height;
    const compact = width < 620;
    const playerX = compact ? width * 0.29 : width * 0.27;
    const enemyX = compact ? width * 0.71 : width * 0.73;
    const stageY = compact ? height * 0.43 : height * 0.55;
    const activeParty =
      battle.party.find(
        (member) => member.template_id === battle.active_template_id,
      ) ??
      battle.party.find((member) => !member.down) ??
      battle.party[0];
    const environmentColor = battle.environment.element
      ? elementColor(battle.environment.element)
      : getAreaDefinition(this.runtime.snapshot.areaId).palette.accent;

    this.battlefieldSurfaces[0]?.setFillStyle(environmentColor, 0.28);
    this.battlefieldSurfaces[1]?.setFillStyle(environmentColor, 0.4);
    for (const particle of this.ambientParticles) {
      particle.object.setTint(environmentColor);
    }

    const title = this.track(
      this.add
        .text(
          width / 2,
          Math.max(compact ? 92 : 88, height * 0.13),
          battleTitle(battle.kind),
          {
            color: "#ffffff",
            fontFamily: "system-ui, sans-serif",
            fontSize: compact ? "23px" : "30px",
            fontStyle: "bold",
            stroke: "#18253b",
            strokeThickness: 6,
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    this.track(
      this.add
        .text(
          width / 2,
          title.y + (compact ? 33 : 42),
          `${
            battle.status === "active"
              ? `回合 ${battle.turn + 1}`
              : `已结算 ${battle.turn} 回合`
          } · ${environmentLabel(battle.environment.effect_code)}`,
          {
            color: "#d6efff",
            fontFamily: "system-ui, sans-serif",
            fontSize: compact ? "13px" : "16px",
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    if (battle.mechanic_notice) {
      this.track(
        this.add
          .text(
            width / 2,
            title.y + (compact ? 57 : 72),
            battle.mechanic_notice,
            {
              align: "center",
              backgroundColor: "rgba(20, 34, 52, 0.78)",
              color: "#fff1a8",
              fontFamily: "system-ui, sans-serif",
              fontSize: compact ? "12px" : "14px",
              fontStyle: "bold",
              padding: { x: 9, y: 5 },
              wordWrap: { width: Math.min(width - 44, 620) },
            },
          )
          .setOrigin(0.5, 0)
          .setScrollFactor(0),
      );
    }

    if (activeParty) {
      this.renderCombatant(activeParty, playerX, stageY, "我方");
    }
    this.renderCombatant(battle.enemy, enemyX, stageY, "对手");

    if (battle.turn !== this.previousTurn && this.previousTurn >= 0) {
      this.cameras.main.flash(190, 255, 255, 255, false);
      this.cameras.main.shake(150, 0.008);
    }
    this.previousTurn = battle.turn;
  }

  private renderCombatant(
    combatant: MonsterBattleCombatant,
    x: number,
    y: number,
    side: string,
  ): void {
    const compact = this.scale.width < 620;
    const frameSize = compact ? 130 : 178;
    const container = this.add
      .container(x, y)
      .setScrollFactor(0)
      .setDepth(side === "我方" ? 30 : 31);
    this.track(container);

    const glowColor = elementColor(combatant.element);
    const glow = this.add
      .circle(0, 0, frameSize * 0.57, glowColor, 0.22)
      .setStrokeStyle(compact ? 5 : 7, glowColor, 0.8);
    const frame = this.add
      .circle(0, 0, frameSize * 0.5, 0xf6fbff, 0.96)
      .setStrokeStyle(3, 0xffffff, 0.92);
    const missing = this.add
      .text(0, 0, "目录图片\n加载失败", {
        align: "center",
        color: "#334e68",
        fontFamily: "system-ui, sans-serif",
        fontSize: compact ? "13px" : "15px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const name = this.add
      .text(0, frameSize * 0.67, combatant.name, {
        align: "center",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: compact ? "15px" : "19px",
        fontStyle: "bold",
        stroke: "#15263b",
        strokeThickness: 5,
        wordWrap: { width: frameSize * 1.18 },
      })
      .setOrigin(0.5);
    const hpWidth = compact ? 128 : 172;
    const hpY = frameSize * 0.91;
    const hpRatio = Phaser.Math.Clamp(
      combatant.current_hp / combatant.max_hp,
      0,
      1,
    );
    const hpBackground = this.add.rectangle(0, hpY, hpWidth, 13, 0x162b3c, 0.9);
    const hpBar = this.add
      .rectangle(
        -hpWidth / 2,
        hpY,
        hpWidth * hpRatio,
        9,
        hpRatio > 0.5 ? 0x54d98c : hpRatio > 0.2 ? 0xffc84a : 0xff625f,
        1,
      )
      .setOrigin(0, 0.5);
    const hpText = this.add
      .text(0, hpY + 18, `${combatant.current_hp} / ${combatant.max_hp}`, {
        color: "#e9f6ff",
        fontFamily: "system-ui, sans-serif",
        fontSize: compact ? "12px" : "14px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    container.add([glow, frame, missing, name, hpBackground, hpBar, hpText]);
    if (combatant.down) container.setAlpha(0.45);

    this.tweens.add({
      targets: glow,
      scale: { from: 0.94, to: 1.08 },
      alpha: { from: 0.14, to: 0.3 },
      duration: 850,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    void this.loader
      .loadDetail(combatant.template_id, combatant.image_detail_path)
      .then((textureKey) => {
        if (!textureKey || !container.active) return;
        const portrait = this.add.image(0, 0, textureKey);
        const scale = Math.min(
          (frameSize * 0.9) / portrait.width,
          (frameSize * 0.9) / portrait.height,
        );
        portrait.setScale(scale);
        container.addAt(portrait, 2);
        missing.destroy();
      });
  }

  private showHealthDeltas(
    nextBattle: MonsterBattle,
    previousBattle: MonsterBattle,
  ): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const compact = width < 620;
    const stageY = compact ? height * 0.43 : height * 0.55;
    const partyDelta = nextBattle.party.reduce((total, nextMember) => {
      const previousMember = previousBattle.party.find(
        (candidate) => candidate.template_id === nextMember.template_id,
      );
      return (
        total +
        (previousMember ? nextMember.current_hp - previousMember.current_hp : 0)
      );
    }, 0);
    const enemyDelta =
      nextBattle.enemy.template_id === previousBattle.enemy.template_id
        ? nextBattle.enemy.current_hp - previousBattle.enemy.current_hp
        : 0;

    this.showHealthDelta(
      partyDelta,
      compact ? width * 0.29 : width * 0.27,
      stageY - (compact ? 72 : 96),
    );
    this.showHealthDelta(
      enemyDelta,
      compact ? width * 0.71 : width * 0.73,
      stageY - (compact ? 72 : 96),
    );
  }

  private showHealthDelta(delta: number, x: number, y: number): void {
    if (delta === 0) return;
    const text = this.add
      .text(x, y, `${delta > 0 ? "+" : ""}${delta}`, {
        color: delta > 0 ? "#8dffbc" : "#ff8a78",
        fontFamily: "system-ui, sans-serif",
        fontSize: this.scale.width < 620 ? "26px" : "34px",
        fontStyle: "bold",
        stroke: "#142237",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(120);
    this.tweens.add({
      targets: text,
      y: y - 58,
      alpha: 0,
      scale: { from: 0.82, to: 1.12 },
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private clearBattleObjects(): void {
    for (const object of this.battleObjects) {
      this.tweens.killTweensOf(object);
      if (object instanceof Phaser.GameObjects.Container) {
        this.tweens.killTweensOf(object.list);
      }
      object.destroy();
    }
    this.battleObjects.length = 0;
  }

  private playExitAndStop(delay = 0): void {
    if (this.exiting) return;
    this.exiting = true;
    this.time.delayedCall(delay, () => {
      this.cameras.main.fadeOut(220, 245, 250, 255);
      this.time.delayedCall(230, () => {
        if (this.scene.isActive()) this.scene.stop();
      });
    });
  }

  private shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.renderBattle, this);
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = null;
    this.loader?.destroy();
    this.clearBattleObjects();
    this.ambientParticles.length = 0;
    this.battlefieldSurfaces.length = 0;
    if (
      this.scene.isPaused(WORLD_SCENE_KEY) &&
      !this.runtime.snapshot.activeBattle
    ) {
      this.scene.resume(WORLD_SCENE_KEY);
    }
  }

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.battleObjects.push(object);
    return object;
  }
}

function battleTitle(kind: "normal" | "elite" | "boss" | "guardian"): string {
  switch (kind) {
    case "normal":
      return "生态遭遇";
    case "elite":
      return "精英挑战";
    case "boss":
      return "区域首领";
    case "guardian":
      return "最终守护者";
  }
}

function environmentLabel(effectCode: string): string {
  const labels: Readonly<Record<string, string>> = {
    camp_rest: "中心营地休整",
    forest_regen: "萤光森林再生",
    wetland_shield: "潮汐湿地护盾",
    highland_tailwind: "风蚀高原顺风",
    cavern_charge: "晶矿洞窟蓄雷",
    basin_heat_guard: "熔火盆地护体",
    guardian_cycle: "守护元素轮转",
  };
  return labels[effectCode] ?? "区域生态生效";
}

function elementColor(element: MonsterBattleCombatant["element"]): number {
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
  }
  return 0xc9a8ff;
}
