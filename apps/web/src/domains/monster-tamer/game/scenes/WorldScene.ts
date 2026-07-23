import Phaser from "phaser";

import { CatalogTextureLoader } from "../assets/CatalogTextureLoader.ts";
import {
  PLAYER_TEXTURE_KEY,
  WORLD_TILESET_TEXTURE_KEY,
} from "../assets/ProceduralTextures.ts";
import {
  createCommandId,
  type MonsterCheckpointCommand,
  type MonsterTamerCommandResult,
  type MonsterWorldNode,
  type NormalizedMonsterTamerSnapshot,
} from "../bridge.ts";
import {
  cellCenter,
  cellKey,
  generateAreaLayout,
  getAreaDefinition,
  manhattan,
  MONSTER_TAMER_TILE_SIZE,
  sameCell,
  type AreaDecoration,
  type AreaLayout,
  type Cell,
} from "../content/areas.ts";
import { InputController } from "../input/InputController.ts";
import { runtimeFromScene, type GameRuntime } from "../runtime/GameRuntime.ts";
import { EcologyEnemy } from "../world/EcologyEnemy.ts";
import { BATTLE_EFFECTS_SCENE_KEY } from "./BattleEffectsScene.ts";
import { WORLD_SCENE_KEY } from "./BootScene.ts";
import { monsterAbilityLabels } from "../../types.ts";

type PostSyncAction =
  | Readonly<{
      kind: "battle";
      encounterId: string;
      sourceNodeId: string | null;
    }>
  | Readonly<{ kind: "checkpoint"; command: MonsterCheckpointCommand }>;

type PendingCheckpoint = Readonly<{
  signature: string;
  submittedRevealedCellIds: readonly string[];
  submittedTraversedCellIds: readonly string[];
  postSyncAction?: PostSyncAction;
}>;

type PendingBattle = Readonly<{ signature: string }>;

export class WorldScene extends Phaser.Scene {
  private runtime!: GameRuntime;
  private snapshot!: NormalizedMonsterTamerSnapshot;
  private layout!: AreaLayout;
  private inputController!: InputController;
  private textureLoader!: CatalogTextureLoader;
  private player!: Phaser.GameObjects.Image;
  private playerCell!: Cell;
  private fog!: Phaser.GameObjects.Graphics;
  private map!: Phaser.Tilemaps.Tilemap;
  private moving = false;
  private nextMoveAt = 0;
  private restartScheduled = false;
  private readonly locallyRevealedCellIds = new Set<string>();
  private readonly unsavedRevealedCellIds = new Set<string>();
  private readonly pendingTraversedCellIds: string[] = [];
  private readonly nodeObjects = new Map<
    string,
    Phaser.GameObjects.Container
  >();
  private readonly enemies: EcologyEnemy[] = [];
  private readonly worldObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly pendingCheckpoints = new Map<string, PendingCheckpoint>();
  private readonly pendingBattles = new Map<string, PendingBattle>();
  private readonly retryCommandIds = new Map<string, string>();
  private unsubscribeSnapshot: (() => void) | null = null;
  private unsubscribeCommand: (() => void) | null = null;
  private unsubscribePause: (() => void) | null = null;

  public constructor() {
    super(WORLD_SCENE_KEY);
  }

  public create(): void {
    this.runtime = runtimeFromScene(this);
    this.snapshot = this.runtime.snapshot;
    this.moving = false;
    this.nextMoveAt = 0;
    this.restartScheduled = false;
    this.textureLoader = new CatalogTextureLoader(this);
    this.inputController = new InputController(this);
    this.playerCell = { ...this.snapshot.resumePosition };
    for (const id of this.snapshot.revealedCellIds) {
      this.locallyRevealedCellIds.add(id);
    }

    this.createArea();
    this.revealAround(this.playerCell, 2);
    this.redrawFog();
    this.configureCamera();
    this.emitViewState();
    this.runtime.emitReady();

    this.unsubscribeSnapshot = this.runtime.onSnapshot(
      (nextSnapshot, previousSnapshot) => {
        if (
          nextSnapshot.areaId !== previousSnapshot.areaId ||
          nextSnapshot.raw.rules_version !==
            previousSnapshot.raw.rules_version ||
          nextSnapshot.raw.map_checksum !== previousSnapshot.raw.map_checksum ||
          nextSnapshot.region.width_tiles !==
            previousSnapshot.region.width_tiles ||
          nextSnapshot.region.height_tiles !==
            previousSnapshot.region.height_tiles ||
          !sameCell(nextSnapshot.region.spawn, previousSnapshot.region.spawn)
        ) {
          this.retryCommandIds.clear();
          this.scheduleAuthoritativeRestart();
          return;
        }
        if (
          !this.reconcileAuthoritativePosition(
            nextSnapshot.resumePosition,
            previousSnapshot.resumePosition,
            nextSnapshot.raw.progress.state_version !==
              previousSnapshot.raw.progress.state_version,
          )
        ) {
          this.scheduleAuthoritativeRestart();
          return;
        }

        this.snapshot = nextSnapshot;
        for (const id of nextSnapshot.revealedCellIds) {
          this.locallyRevealedCellIds.add(id);
          this.unsavedRevealedCellIds.delete(id);
        }
        if (interactiveWorldChanged(nextSnapshot, previousSnapshot)) {
          this.refreshInteractiveObjects();
        }
        this.syncBattleEffects();
        this.redrawFog();
        this.emitViewState();
      },
    );
    this.unsubscribeCommand = this.runtime.onCommandResult(
      (commandId, result) => {
        this.handleCommandResult(commandId, result);
      },
    );
    this.unsubscribePause = this.runtime.onPause((paused) => {
      if (paused) this.inputController.reset();
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.configureCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.syncBattleEffects();
    this.cameras.main.fadeIn(260, 240, 250, 255);
  }

  public override update(time: number): void {
    if (this.snapshot.activeBattle) return;

    if (this.inputController.consumeClose()) {
      this.runtime.emit({ type: "close" });
      return;
    }
    const panel = this.inputController.consumePanel();
    if (panel) this.runtime.emit({ type: "open-panel", panel });
    if (this.pendingCheckpoints.size > 0 || this.pendingBattles.size > 0)
      return;

    if (this.inputController.consumeAction() && !this.moving) {
      this.interact();
      return;
    }

    const direction = this.inputController.direction();
    if (direction && !this.moving && time >= this.nextMoveAt) {
      this.movePlayer(direction, time);
    }
    if (this.moving) return;

    const occupiedCellIds = new Set(
      this.enemies.map((enemy) => cellKey(enemy.position)),
    );
    for (const enemy of this.enemies) {
      occupiedCellIds.delete(cellKey(enemy.position));
      enemy.update({
        time,
        playerCell: this.playerCell,
        occupiedCellIds,
        canEnter: (cell) =>
          this.canEnter(cell) &&
          !this.snapshot.nodes.some((node) => sameCell(node.position, cell)),
        onEncounter: (encounterId) => {
          this.startBattle(encounterId);
        },
      });
      occupiedCellIds.add(cellKey(enemy.position));
    }
  }

  private createArea(): void {
    const definition = getAreaDefinition(this.snapshot.areaId);
    const protectedCells = [
      this.playerCell,
      ...this.snapshot.nodes.map(({ position }) => position),
      ...this.snapshot.encounters.map(({ position }) => position),
    ];
    this.layout = generateAreaLayout({
      definition,
      width: this.snapshot.region.width_tiles,
      height: this.snapshot.region.height_tiles,
      walkableCellIds: this.snapshot.region.walkable_cell_ids,
    });

    this.cameras.main.setBackgroundColor(definition.palette.sky);
    this.map = this.make.tilemap({
      data: this.layout.ground.map((row) => [...row]),
      tileWidth: MONSTER_TAMER_TILE_SIZE,
      tileHeight: MONSTER_TAMER_TILE_SIZE,
    });
    const tileset = this.map.addTilesetImage(
      WORLD_TILESET_TEXTURE_KEY,
      WORLD_TILESET_TEXTURE_KEY,
      MONSTER_TAMER_TILE_SIZE,
      MONSTER_TAMER_TILE_SIZE,
      0,
      0,
    );
    if (!tileset) throw new Error("Unable to bind Monster Tamer tileset.");
    const ground = this.map.createLayer(0, tileset, 0, 0);
    if (!ground) throw new Error("Unable to create Monster Tamer tile layer.");
    ground.setDepth(0);

    const protectedCellIds = new Set(protectedCells.map(cellKey));
    for (const decoration of this.layout.decorations) {
      if (!protectedCellIds.has(cellKey(decoration.cell))) {
        this.createDecoration(decoration);
      }
    }

    const spawnCenter = cellCenter(this.playerCell);
    this.player = this.add
      .image(spawnCenter.x, spawnCenter.y + 4, PLAYER_TEXTURE_KEY)
      .setOrigin(0.5, 0.76)
      .setDepth(300 + this.playerCell.y);
    const shadow = this.add
      .ellipse(spawnCenter.x, spawnCenter.y + 24, 38, 14, 0x173244, 0.3)
      .setDepth(299 + this.playerCell.y);
    shadow.setData("player-shadow", true);
    this.worldObjects.push(shadow);

    this.fog = this.add.graphics().setDepth(500);
    this.refreshInteractiveObjects();
  }

  private refreshInteractiveObjects(): void {
    for (const object of this.nodeObjects.values()) {
      this.tweens.killTweensOf(object.list);
      object.destroy(true);
    }
    this.nodeObjects.clear();
    for (const enemy of this.enemies) enemy.destroy();
    this.enemies.length = 0;

    for (const node of this.snapshot.nodes) this.createNode(node);
    for (const encounter of this.snapshot.encounters) {
      if (!encounter.available || encounter.claimed) continue;
      this.enemies.push(
        new EcologyEnemy(
          this,
          this.textureLoader,
          encounter,
          this.snapshot.raw.combat_catalog.find(
            (profile) => profile.template_id === encounter.template_id,
          )?.element ?? null,
        ),
      );
    }
  }

  private createNode(node: MonsterWorldNode): void {
    const center = cellCenter(node.position);
    const completed =
      node.kind === "rematch"
        ? false
        : node.refreshable
          ? node.claimed
          : node.completed;
    const container = this.add
      .container(center.x, center.y)
      .setDepth(90 + node.position.y)
      .setAlpha(completed && !node.target_region ? 0.38 : 1);
    const shadow = this.add.ellipse(0, 22, 48, 16, 0x173244, 0.24);
    container.add(shadow);

    switch (node.kind) {
      case "chest": {
        const chest = this.add
          .rectangle(0, 2, 42, 32, 0xe79d36)
          .setStrokeStyle(4, 0x7b4b27, 1);
        const lid = this.add
          .rectangle(0, -12, 44, 12, 0xffca55)
          .setStrokeStyle(3, 0x7b4b27, 1);
        const lock = this.add.rectangle(0, 3, 8, 12, 0xffed9b);
        container.add([chest, lid, lock]);
        break;
      }
      case "gate": {
        const left = this.add.rectangle(-18, 1, 10, 48, 0x4d6d72);
        const right = this.add.rectangle(18, 1, 10, 48, 0x4d6d72);
        const beam = this.add
          .rectangle(0, -21, 46, 10, 0x86a4a1)
          .setStrokeStyle(2, 0xdff8ee);
        container.add([left, right, beam]);
        break;
      }
      case "shortcut": {
        const portal = this.add
          .ellipse(0, 0, 43, 54, 0x75d8dd, 0.28)
          .setStrokeStyle(5, 0xb8ffff, 0.9);
        container.add(portal);
        this.tweens.add({
          targets: portal,
          scaleX: { from: 0.9, to: 1.08 },
          alpha: { from: 0.18, to: 0.42 },
          duration: 820,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
        });
        break;
      }
      case "supply": {
        const pack = this.add
          .circle(0, 0, 22, 0x4fc792)
          .setStrokeStyle(3, 0xe6fff4);
        const vertical = this.add.rectangle(0, 0, 8, 28, 0xffffff);
        const horizontal = this.add.rectangle(0, 0, 28, 8, 0xffffff);
        container.add([pack, vertical, horizontal]);
        break;
      }
      case "gather": {
        const stem = this.add.rectangle(0, 10, 5, 29, 0x278a5a);
        container.add(stem);
        for (let angle = 0; angle < 360; angle += 72) {
          const radians = Phaser.Math.DegToRad(angle);
          container.add(
            this.add.ellipse(
              Math.cos(radians) * 12,
              Math.sin(radians) * 12 - 4,
              15,
              22,
              0xffd75e,
            ),
          );
        }
        container.add(this.add.circle(0, -4, 7, 0xff7a63));
        break;
      }
      case "exit": {
        const pole = this.add.rectangle(-14, 6, 7, 50, 0x765038);
        const sign = this.add
          .rectangle(7, -9, 48, 24, 0xe8c481)
          .setStrokeStyle(3, 0x765038);
        const arrow = this.add
          .text(8, -10, "➜", {
            color: "#63442f",
            fontFamily: "system-ui, sans-serif",
            fontSize: "22px",
            fontStyle: "bold",
          })
          .setOrigin(0.5);
        container.add([pole, sign, arrow]);
        break;
      }
      case "rematch": {
        const base = this.add
          .ellipse(0, 15, 54, 25, 0x36495f)
          .setStrokeStyle(3, 0xaedfff, 0.82);
        const altar = this.add
          .rectangle(0, -2, 42, 30, 0x6e668f)
          .setStrokeStyle(3, 0xd6c9ff, 0.88);
        const sigil = this.add
          .star(0, -18, 5, 7, 15, node.available ? 0xffda6b : 0x718092)
          .setStrokeStyle(2, 0xffffff, node.available ? 0.84 : 0.3);
        container.add([base, altar, sigil]);
        if (node.available) {
          this.tweens.add({
            targets: sigil,
            angle: 360,
            duration: 3_600,
            repeat: -1,
          });
        }
        break;
      }
    }

    const requiredAbility = node.required_ability;
    const requiredAbilityMissing =
      requiredAbility !== null && !this.snapshot.abilities.has(requiredAbility);
    const labelText = requiredAbilityMissing
      ? `🔒 ${monsterAbilityLabels[requiredAbility]}`
      : node.kind === "rematch" && !node.available
        ? "重战祭坛暂未激活"
        : node.name;
    const label = this.add
      .text(0, 39, labelText, {
        align: "center",
        backgroundColor: "rgba(18, 43, 59, 0.82)",
        color: requiredAbilityMissing ? "#ffd989" : "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        padding: { x: 7, y: 3 },
        wordWrap: { width: 140 },
      })
      .setOrigin(0.5, 0);
    container.add(label);
    this.nodeObjects.set(node.id, container);
  }

  private createDecoration(decoration: AreaDecoration): void {
    const center = cellCenter(decoration.cell);
    const definition = getAreaDefinition(this.snapshot.areaId);
    const depth = 30 + decoration.cell.y;
    const small = !decoration.blocked;
    let object:
      | Phaser.GameObjects.Container
      | Phaser.GameObjects.Graphics
      | Phaser.GameObjects.Shape;

    switch (decoration.kind) {
      case "tree": {
        const trunk = this.add.rectangle(
          center.x,
          center.y + 13,
          small ? 8 : 15,
          small ? 22 : 39,
          0x795038,
        );
        const crown = this.add
          .circle(
            center.x,
            center.y - (small ? 5 : 17),
            small ? 14 : 27,
            definition.palette.wall,
          )
          .setStrokeStyle(3, definition.palette.accent, 0.25);
        crown.setDepth(depth + 1);
        trunk.setDepth(depth);
        this.worldObjects.push(trunk);
        object = crown;
        break;
      }
      case "crystal": {
        object = this.add
          .triangle(
            center.x,
            center.y,
            0,
            small ? 25 : 40,
            small ? 9 : 18,
            0,
            small ? 18 : 36,
            small ? 25 : 40,
            definition.palette.accent,
            0.88,
          )
          .setStrokeStyle(2, 0xe8fdff, 0.8);
        break;
      }
      case "rock": {
        object = this.add
          .ellipse(
            center.x,
            center.y + 9,
            small ? 24 : 48,
            small ? 17 : 34,
            definition.palette.wall,
          )
          .setStrokeStyle(2, definition.palette.path, 0.38);
        break;
      }
      case "water":
      case "lava": {
        object = this.add
          .ellipse(
            center.x,
            center.y + 6,
            small ? 35 : 58,
            small ? 17 : 37,
            decoration.kind === "water" ? 0x45c8e8 : 0xff7a3f,
            0.72,
          )
          .setStrokeStyle(
            2,
            decoration.kind === "water" ? 0xc8f8ff : 0xffd45f,
            0.72,
          );
        break;
      }
      case "wind": {
        object = this.add
          .arc(
            center.x,
            center.y,
            small ? 15 : 26,
            30,
            310,
            false,
            0xdffcff,
            0.1,
          )
          .setStrokeStyle(4, 0xe9ffff, 0.78);
        break;
      }
      case "rune": {
        object = this.add
          .star(
            center.x,
            center.y,
            5,
            small ? 7 : 13,
            small ? 13 : 24,
            definition.palette.accent,
            0.62,
          )
          .setStrokeStyle(2, 0xffffff, 0.66);
        break;
      }
      case "fern":
      case "grass":
      case "reed": {
        const graphics = this.add.graphics();
        graphics.lineStyle(
          decoration.kind === "reed" ? 4 : 3,
          definition.palette.wall,
          0.8,
        );
        for (let index = -2; index <= 2; index += 1) {
          graphics.beginPath();
          graphics.moveTo(center.x + index * 5, center.y + 15);
          graphics.lineTo(
            center.x + index * 7,
            center.y - (small ? 6 : 16) - Math.abs(index) * 2,
          );
          graphics.strokePath();
        }
        object = graphics;
        break;
      }
      case "bloom": {
        const bloom = this.add.container(center.x, center.y);
        for (let index = 0; index < 5; index += 1) {
          const angle = (Math.PI * 2 * index) / 5;
          bloom.add(
            this.add.circle(
              Math.cos(angle) * (small ? 5 : 9),
              Math.sin(angle) * (small ? 5 : 9),
              small ? 4 : 7,
              definition.palette.accent,
              0.8,
            ),
          );
        }
        bloom.add(this.add.circle(0, 0, small ? 3 : 5, 0xffcf5a));
        object = bloom;
        break;
      }
    }

    object.setDepth(depth);
    this.worldObjects.push(object);
  }

  private movePlayer(direction: Cell, time: number): void {
    const target = {
      x: this.playerCell.x + direction.x,
      y: this.playerCell.y + direction.y,
    };
    const enemy = this.enemies.find((candidate) =>
      sameCell(candidate.position, target),
    );
    if (enemy) {
      this.startBattle(enemy.encounter.id);
      this.nextMoveAt = time + 450;
      return;
    }
    if (!this.canEnter(target)) {
      this.nextMoveAt = time + 180;
      this.cameras.main.shake(70, 0.002);
      return;
    }

    this.moving = true;
    this.playerCell = target;
    this.player.setFlipX(direction.x < 0);
    this.player.setDepth(300 + target.y);
    const targetCenter = cellCenter(target);
    const shadow = this.worldObjects.find(
      (object) => object.getData("player-shadow") === true,
    );
    if (shadow instanceof Phaser.GameObjects.Ellipse) {
      shadow.setDepth(299 + target.y);
    }

    this.tweens.add({
      targets: this.player,
      x: targetCenter.x,
      y: targetCenter.y - 3,
      duration: 165,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        if (shadow instanceof Phaser.GameObjects.Ellipse) {
          shadow.setPosition(this.player.x, this.player.y + 27);
        }
      },
      onComplete: () => {
        this.moving = false;
        this.nextMoveAt = time + 55;
        this.pendingTraversedCellIds.push(cellKey(this.playerCell));
        this.revealAround(this.playerCell, 2);
        this.redrawFog();
        this.emitViewState();
        this.interactWithExitOnCurrentCell();
        this.maybeAutoSyncExploration();
      },
    });
  }

  private canEnter(cell: Cell): boolean {
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= this.snapshot.region.width_tiles ||
      cell.y >= this.snapshot.region.height_tiles ||
      this.layout.blockedCellIds.has(cellKey(cell))
    ) {
      return false;
    }

    if (
      this.snapshot.encounters.some(
        (encounter) =>
          encounter.available &&
          !encounter.claimed &&
          sameCell(encounter.position, cell),
      )
    ) {
      return false;
    }

    const blockingNode = this.snapshot.nodes.find(
      (node) =>
        sameCell(node.position, cell) &&
        (node.kind === "gate" || node.kind === "shortcut") &&
        !(node.refreshable ? node.claimed : node.completed),
    );
    return !blockingNode;
  }

  private interact(): void {
    const nearbyEnemy = this.enemies.find(
      (enemy) =>
        manhattan(enemy.position, this.playerCell) <= 1 &&
        manhattan(enemy.encounter.position, this.playerCell) <=
          enemy.encounter.engage_radius,
    );
    if (nearbyEnemy) {
      this.startBattle(nearbyEnemy.encounter.id, null);
      return;
    }

    const cells = [
      this.playerCell,
      { x: this.playerCell.x, y: this.playerCell.y - 1 },
      { x: this.playerCell.x + 1, y: this.playerCell.y },
      { x: this.playerCell.x, y: this.playerCell.y + 1 },
      { x: this.playerCell.x - 1, y: this.playerCell.y },
    ];
    const node = cells
      .map((cell) =>
        this.snapshot.nodes.find((candidate) =>
          sameCell(candidate.position, cell),
        ),
      )
      .find((candidate): candidate is MonsterWorldNode => Boolean(candidate));

    if (!node) {
      this.emitViewState("附近没有可互动的探索目标");
      return;
    }
    this.interactWithNode(node);
  }

  private interactWithExitOnCurrentCell(): void {
    const node = this.snapshot.nodes.find(
      (candidate) =>
        candidate.kind === "exit" &&
        sameCell(candidate.position, this.playerCell),
    );
    if (node) this.interactWithNode(node);
  }

  private interactWithNode(node: MonsterWorldNode): void {
    if (this.pendingCheckpoints.size > 0) return;

    if (
      node.required_ability !== null &&
      !this.snapshot.abilities.has(node.required_ability)
    ) {
      this.emitViewState(
        `需要先获得「${monsterAbilityLabels[node.required_ability]}」`,
      );
      return;
    }

    if (node.kind === "rematch") {
      if (!node.available || node.encounter_id === null) {
        this.emitViewState("击败对应首领后才可使用重战祭坛");
        return;
      }
      this.startBattle(node.encounter_id, node.id);
      return;
    }

    const completed = node.refreshable ? node.claimed : node.completed;
    if (node.target_region !== null) {
      if (node.kind !== "exit" && !completed) {
        this.runAfterExplorationSync({
          kind: "checkpoint",
          command: {
            type: "complete_world_node",
            node_id: node.id,
          },
        });
        return;
      }
      if (
        node.target_region !== "camp" &&
        !this.snapshot.unlockedRegions.has(node.target_region)
      ) {
        this.emitViewState("目标区域尚未开放");
        return;
      }
      const command = {
        type: "enter_region",
        region_id: node.target_region,
        source_node_id: this.snapshot.areaId === "camp" ? null : node.id,
      } as const;
      this.runAfterExplorationSync({ kind: "checkpoint", command });
      return;
    }

    if (completed) {
      this.emitViewState("本次探索已经使用该节点");
      return;
    }

    this.runAfterExplorationSync({
      kind: "checkpoint",
      command: {
        type: "complete_world_node",
        node_id: node.id,
      },
    });
  }

  private emitCheckpoint(
    command: MonsterCheckpointCommand,
    postSyncAction?: PostSyncAction,
  ): void {
    const syncing = command.type === "sync_revealed_cells";
    const submittedTraversedCellIds = syncing
      ? this.pendingTraversedCellIds.slice(0, 256)
      : [];
    const submittedRevealedCellIds = syncing
      ? this.takeReachableRevealedCellIds(submittedTraversedCellIds)
      : [];
    if (
      syncing &&
      submittedTraversedCellIds.length === 0 &&
      submittedRevealedCellIds.length === 0
    ) {
      return;
    }
    const signature = JSON.stringify([
      "checkpoint",
      this.snapshot.raw.progress.state_version,
      command,
      submittedTraversedCellIds,
      submittedRevealedCellIds,
    ]);
    const commandId = this.retryCommandIds.get(signature) ?? createCommandId();
    this.retryCommandIds.set(signature, commandId);
    this.pendingCheckpoints.set(commandId, {
      signature,
      submittedTraversedCellIds,
      submittedRevealedCellIds,
      ...(postSyncAction ? { postSyncAction } : {}),
    });
    this.runtime.emit({
      type: "checkpoint",
      commandId,
      command,
      traversedCellIds: submittedTraversedCellIds,
      revealedCellIds: submittedRevealedCellIds,
    });
  }

  private takeReachableRevealedCellIds(
    submittedTraversedCellIds: readonly string[],
  ): readonly string[] {
    const centers = [
      this.snapshot.resumePosition,
      ...submittedTraversedCellIds.flatMap((id) => {
        const cell = parseCellKey(id);
        return cell ? [cell] : [];
      }),
    ];
    return [...this.unsavedRevealedCellIds]
      .filter((id) => {
        const cell = parseCellKey(id);
        return (
          cell !== null &&
          centers.some((center) => manhattan(center, cell) <= 2)
        );
      })
      .slice(0, 256);
  }

  private hasUnsavedExploration(): boolean {
    return (
      this.pendingTraversedCellIds.length > 0 ||
      this.unsavedRevealedCellIds.size > 0
    );
  }

  private emitRevealSync(postSyncAction?: PostSyncAction): boolean {
    if (!this.hasUnsavedExploration() || this.pendingCheckpoints.size > 0) {
      return false;
    }
    this.emitCheckpoint({ type: "sync_revealed_cells" }, postSyncAction);
    return true;
  }

  private maybeAutoSyncExploration(): void {
    if (
      (this.pendingTraversedCellIds.length >= 96 ||
        this.unsavedRevealedCellIds.size >= 192) &&
      !this.snapshot.activeBattle &&
      this.pendingBattles.size === 0
    ) {
      this.emitRevealSync();
    }
  }

  private runAfterExplorationSync(action: PostSyncAction): void {
    if (this.hasUnsavedExploration()) {
      this.emitRevealSync(action);
    } else {
      this.executePostSyncAction(action);
    }
  }

  private startBattle(
    encounterId: string,
    sourceNodeId: string | null = null,
  ): void {
    if (
      this.snapshot.activeBattle ||
      this.pendingCheckpoints.size > 0 ||
      this.pendingBattles.size > 0 ||
      this.snapshot.party.length === 0
    ) {
      if (this.snapshot.party.length === 0) {
        this.emitViewState("请先在营地选择出战藏品");
      }
      return;
    }

    const encounter = this.snapshot.encounters.find(
      (candidate) => candidate.id === encounterId,
    );
    const rematchNode =
      sourceNodeId === null
        ? null
        : this.snapshot.nodes.find(
            (node) =>
              node.id === sourceNodeId &&
              node.kind === "rematch" &&
              node.encounter_id === encounterId &&
              node.available,
          );
    if (
      !encounter ||
      (sourceNodeId === null && (!encounter.available || encounter.claimed)) ||
      (sourceNodeId !== null && !rematchNode)
    ) {
      return;
    }

    this.runAfterExplorationSync({
      kind: "battle",
      encounterId: encounter.id,
      sourceNodeId,
    });
  }

  private emitBattleStart(
    encounterId: string,
    sourceNodeId: string | null,
  ): void {
    const signature = JSON.stringify([
      "battle-start",
      this.snapshot.raw.progress.state_version,
      encounterId,
      sourceNodeId,
    ]);
    const commandId = this.retryCommandIds.get(signature) ?? createCommandId();
    this.retryCommandIds.set(signature, commandId);
    this.pendingBattles.set(commandId, { signature });
    this.runtime.emit({
      type: "battle",
      commandId,
      command: { kind: "start", encounterId, sourceNodeId },
    });
  }

  private handleCommandResult(
    commandId: string,
    result: MonsterTamerCommandResult,
  ): void {
    const checkpoint = this.pendingCheckpoints.get(commandId);
    if (checkpoint) {
      this.pendingCheckpoints.delete(commandId);
      this.retryCommandIds.delete(checkpoint.signature);
      if (result.ok) {
        for (const cellId of checkpoint.submittedRevealedCellIds) {
          this.unsavedRevealedCellIds.delete(cellId);
        }
        this.removeTraversedPrefix(checkpoint.submittedTraversedCellIds);
        this.emitViewState();
        if (checkpoint.postSyncAction) {
          this.continueAfterExplorationSync(checkpoint.postSyncAction);
        }
      } else {
        this.emitViewState(result.message ?? "探索进度暂时无法保存，请重试");
        this.scheduleAuthoritativeRestart();
      }
      return;
    }

    const battle = this.pendingBattles.get(commandId);
    if (battle) {
      this.pendingBattles.delete(commandId);
      this.retryCommandIds.delete(battle.signature);
      if (!result.ok) {
        this.emitViewState(result.message ?? "当前遭遇无法开始");
        this.scheduleAuthoritativeRestart();
      }
    }
  }

  private continueAfterExplorationSync(action: PostSyncAction): void {
    this.time.delayedCall(60, () => {
      if (!this.scene.isActive()) return;
      if (this.hasUnsavedExploration()) {
        this.emitRevealSync(action);
        return;
      }
      this.executePostSyncAction(action);
    });
  }

  private executePostSyncAction(action: PostSyncAction): void {
    if (action.kind === "battle") {
      this.emitBattleStart(action.encounterId, action.sourceNodeId);
    } else {
      this.emitCheckpoint(action.command);
    }
  }

  private scheduleAuthoritativeRestart(): void {
    if (this.restartScheduled) return;
    this.restartScheduled = true;
    globalThis.queueMicrotask(() => {
      if (this.scene.isActive() || this.scene.isPaused()) {
        this.scene.restart();
      }
    });
  }

  private removeTraversedPrefix(
    submittedTraversedCellIds: readonly string[],
  ): void {
    for (const submitted of submittedTraversedCellIds) {
      if (this.pendingTraversedCellIds[0] !== submitted) break;
      this.pendingTraversedCellIds.shift();
    }
  }

  private reconcileAuthoritativePosition(
    nextPosition: Cell,
    previousPosition: Cell,
    progressVersionChanged: boolean,
  ): boolean {
    const authoritativeCellId = cellKey(nextPosition);
    const confirmedSync = [...this.pendingCheckpoints.values()].find(
      ({ submittedTraversedCellIds }) =>
        submittedTraversedCellIds.length > 0 &&
        submittedTraversedCellIds.at(-1) === authoritativeCellId &&
        submittedTraversedCellIds.every(
          (id, index) => this.pendingTraversedCellIds[index] === id,
        ),
    );
    if (confirmedSync) {
      this.pendingTraversedCellIds.splice(
        0,
        confirmedSync.submittedTraversedCellIds.length,
      );
      return true;
    }
    if (progressVersionChanged && sameCell(nextPosition, this.playerCell)) {
      this.pendingTraversedCellIds.length = 0;
      return true;
    }
    if (sameCell(nextPosition, previousPosition)) return true;
    const traversedIndex =
      this.pendingTraversedCellIds.lastIndexOf(authoritativeCellId);
    if (traversedIndex >= 0) {
      this.pendingTraversedCellIds.splice(0, traversedIndex + 1);
      return true;
    }
    if (sameCell(nextPosition, this.playerCell)) {
      this.pendingTraversedCellIds.length = 0;
      return true;
    }
    return false;
  }

  private emitViewState(notice?: string): void {
    this.runtime.emitViewState(
      this.locallyRevealedCellIds,
      this.pendingTraversedCellIds,
      notice,
    );
  }

  private revealAround(center: Cell, radius: number): void {
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        if (
          x < 0 ||
          y < 0 ||
          x >= this.snapshot.region.width_tiles ||
          y >= this.snapshot.region.height_tiles ||
          Math.abs(x - center.x) + Math.abs(y - center.y) > radius
        ) {
          continue;
        }
        const id = cellKey({ x, y });
        if (!this.locallyRevealedCellIds.has(id)) {
          this.locallyRevealedCellIds.add(id);
          if (!this.snapshot.revealedCellIds.has(id)) {
            this.unsavedRevealedCellIds.add(id);
          }
        }
      }
    }
  }

  private redrawFog(): void {
    const definition = getAreaDefinition(this.snapshot.areaId);
    this.fog.clear();
    this.fog.fillStyle(definition.palette.fog, 0.82);

    for (let y = 0; y < this.snapshot.region.height_tiles; y += 1) {
      for (let x = 0; x < this.snapshot.region.width_tiles; x += 1) {
        if (!this.locallyRevealedCellIds.has(cellKey({ x, y }))) {
          this.fog.fillRect(
            x * MONSTER_TAMER_TILE_SIZE,
            y * MONSTER_TAMER_TILE_SIZE,
            MONSTER_TAMER_TILE_SIZE + 1,
            MONSTER_TAMER_TILE_SIZE + 1,
          );
        }
      }
    }
  }

  private configureCamera(): void {
    if (!this.map || !this.player) return;
    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    camera.startFollow(this.player, true, 0.12, 0.12);
    camera.setRoundPixels(true);
    camera.setZoom(
      this.scale.width < 520 ? 0.88 : this.scale.width < 900 ? 0.96 : 1,
    );
  }

  private syncBattleEffects(): void {
    if (
      this.snapshot.activeBattle &&
      !this.scene.isActive(BATTLE_EFFECTS_SCENE_KEY)
    ) {
      this.inputController.reset();
      this.scene.launch(BATTLE_EFFECTS_SCENE_KEY);
      this.scene.bringToTop(BATTLE_EFFECTS_SCENE_KEY);
    }
  }

  private shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.configureCamera, this);
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = null;
    this.unsubscribeCommand?.();
    this.unsubscribeCommand = null;
    this.unsubscribePause?.();
    this.unsubscribePause = null;
    this.textureLoader.destroy();
    for (const enemy of this.enemies) enemy.destroy();
    this.enemies.length = 0;
    for (const object of this.worldObjects) object.destroy();
    this.worldObjects.length = 0;
    for (const object of this.nodeObjects.values()) {
      this.tweens.killTweensOf(object.list);
      object.destroy(true);
    }
    this.nodeObjects.clear();
    this.pendingCheckpoints.clear();
    this.pendingBattles.clear();
    this.locallyRevealedCellIds.clear();
    this.unsavedRevealedCellIds.clear();
    this.pendingTraversedCellIds.length = 0;
  }
}

function interactiveWorldChanged(
  next: NormalizedMonsterTamerSnapshot,
  previous: NormalizedMonsterTamerSnapshot,
): boolean {
  return (
    JSON.stringify([
      ...next.abilities,
      ...next.unlockedRegions,
      next.nodes,
      next.encounters,
    ]) !==
    JSON.stringify([
      ...previous.abilities,
      ...previous.unlockedRegions,
      previous.nodes,
      previous.encounters,
    ])
  );
}

function parseCellKey(id: string): Cell | null {
  const match = /^(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
}
