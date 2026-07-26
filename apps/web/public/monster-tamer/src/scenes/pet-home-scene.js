import Phaser from "../lib/phaser.js";
import {
  TINY_SWORDS_ASSET_KEYS,
  TINY_SWORDS_IMAGE_ASSETS,
  TINY_SWORDS_SPRITESHEET_ASSETS,
} from "../assets/tiny-swords-world.js";
import {
  PLAYER_ASSET_KEY,
  PLAYER_ASSET_PATH,
  PLAYER_DIRECTIONS,
  PLAYER_FRAME_HEIGHT,
  PLAYER_FRAME_WIDTH,
} from "../assets/player-character.js";
import { postToParent } from "../bridge.js";
import { findGridPath } from "../systems/grid-pathfinder.js";

const SCENE_KEY = "PET_HOME";
const MAP_KEY = "PET_HOME_MAP";
const TERRAIN_KEY = "PET_HOME_TERRAIN";
const TILE_SIZE = 64;
const MAP_TILES = 50;
const WORLD_SIZE = MAP_TILES * TILE_SIZE;
const PET_SIZE = 56;
const PLAYER_MOVE_DURATION = 320;
const PET_TEXTURE_PREFIX = "PET:";
const KEY_MOVEMENT = Object.freeze({
  KeyW: { x: 0, y: -1 },
  KeyA: { x: -1, y: 0 },
  KeyS: { x: 0, y: 1 },
  KeyD: { x: 1, y: 0 },
});
const ASSET_KEYS = Object.freeze({
  archery: TINY_SWORDS_ASSET_KEYS.ARCHERY,
  barracks: TINY_SWORDS_ASSET_KEYS.BARRACKS,
  castle: TINY_SWORDS_ASSET_KEYS.CASTLE,
  "house-1": TINY_SWORDS_ASSET_KEYS.HOUSE_1,
  "house-2": TINY_SWORDS_ASSET_KEYS.HOUSE_2,
  "house-3": TINY_SWORDS_ASSET_KEYS.HOUSE_3,
  monastery: TINY_SWORDS_ASSET_KEYS.MONASTERY,
  tower: TINY_SWORDS_ASSET_KEYS.TOWER,
  "bush-1": TINY_SWORDS_ASSET_KEYS.BUSH_1,
  "bush-2": TINY_SWORDS_ASSET_KEYS.BUSH_2,
  "bush-3": TINY_SWORDS_ASSET_KEYS.BUSH_3,
  "bush-4": TINY_SWORDS_ASSET_KEYS.BUSH_4,
  "rock-1": TINY_SWORDS_ASSET_KEYS.ROCK_1,
  "rock-2": TINY_SWORDS_ASSET_KEYS.ROCK_2,
  "rock-3": TINY_SWORDS_ASSET_KEYS.ROCK_3,
  "rock-4": TINY_SWORDS_ASSET_KEYS.ROCK_4,
  "water-rock-1": TINY_SWORDS_ASSET_KEYS.WATER_ROCK_1,
  "water-rock-2": TINY_SWORDS_ASSET_KEYS.WATER_ROCK_2,
  "water-rock-3": TINY_SWORDS_ASSET_KEYS.WATER_ROCK_3,
  "water-rock-4": TINY_SWORDS_ASSET_KEYS.WATER_ROCK_4,
  "stump-1": TINY_SWORDS_ASSET_KEYS.STUMP_1,
  "stump-2": TINY_SWORDS_ASSET_KEYS.STUMP_2,
  "stump-3": TINY_SWORDS_ASSET_KEYS.STUMP_3,
  "stump-4": TINY_SWORDS_ASSET_KEYS.STUMP_4,
  "tree-1": TINY_SWORDS_ASSET_KEYS.TREE_1,
  "tree-2": TINY_SWORDS_ASSET_KEYS.TREE_2,
  "tree-3": TINY_SWORDS_ASSET_KEYS.TREE_3,
  "tree-4": TINY_SWORDS_ASSET_KEYS.TREE_4,
  "water-foam": TINY_SWORDS_ASSET_KEYS.WATER_FOAM,
});

export class PetHomeScene extends Phaser.Scene {
  constructor({ items, reducedMotion }) {
    super({ key: SCENE_KEY });
    this.items = items;
    this.reducedMotion = reducedMotion;
    this.walkable = [];
    this.walkableKeys = new Set();
    this.occupied = new Set();
    this.reserved = new Set();
    this.player = undefined;
    this.playerReserved = "";
    this.groundPointerDown = undefined;
    this.suppressGroundTap = false;
    this.failedImages = 0;
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_KEY, "assets/data/main_1.json");
    this.load.image(
      TERRAIN_KEY,
      "assets/images/tiny-swords/tiny-swords-terrain-extruded.png",
    );
    TINY_SWORDS_IMAGE_ASSETS.forEach(({ key, path }) =>
      this.load.image(key, path),
    );
    TINY_SWORDS_SPRITESHEET_ASSETS.forEach(
      ({ key, path, frameWidth, frameHeight }) =>
        this.load.spritesheet(key, path, { frameWidth, frameHeight }),
    );
    this.load.spritesheet(PLAYER_ASSET_KEY, PLAYER_ASSET_PATH, {
      frameWidth: PLAYER_FRAME_WIDTH,
      frameHeight: PLAYER_FRAME_HEIGHT,
    });
    this.items.forEach((item) =>
      this.load.image(
        `${PET_TEXTURE_PREFIX}${item.templateId}`,
        item.imageThumbnailPath,
      ),
    );
    this.load.on("loaderror", (file) => {
      if (String(file.key).startsWith(PET_TEXTURE_PREFIX))
        this.failedImages += 1;
    });
  }

  create() {
    this.cameras.main.setBackgroundColor("#47aba9");
    const tilemap = this.make.tilemap({ key: MAP_KEY });
    const tileset = tilemap.addTilesetImage("tiny-swords-terrain", TERRAIN_KEY);
    if (!tileset) throw new Error("Monster Tamer terrain tileset is missing.");
    const ground = tilemap.createLayer("Flat-Ground", tileset, 0, 0);
    if (!ground) throw new Error("Monster Tamer ground layer is missing.");
    ground.setDepth(-100);

    const rawMap = this.cache.tilemap.get(MAP_KEY).data;
    const collisionLayer = rawMap.layers.find(
      (layer) => layer.name === "Collision",
    );
    if (
      !collisionLayer ||
      collisionLayer.width !== MAP_TILES ||
      collisionLayer.height !== MAP_TILES
    )
      throw new Error("Monster Tamer collision layer is invalid.");
    collisionLayer.data.forEach((blocked, index) => {
      if (!blocked) {
        const cell = {
          x: index % MAP_TILES,
          y: Math.floor(index / MAP_TILES),
        };
        this.walkable.push(cell);
        this.walkableKeys.add(cellKey(cell));
      }
    });

    this.createScenery(rawMap, "Water-Scenery", -60);
    this.createScenery(rawMap, "Scenery", 0);
    this.createPlayer();
    this.spawnPets();
    this.configureCamera();
    this.configurePointerMovement();
    this.configureKeyboardMovement();
    postToParent({ type: "asset-error", failed: this.failedImages });
  }

  createScenery(rawMap, layerName, baseDepth) {
    const layer = rawMap.layers.find((candidate) => candidate.name === layerName);
    for (const object of layer?.objects ?? []) {
      const key = ASSET_KEYS[object.name];
      if (!key || !this.textures.exists(key)) continue;
      const definition = TINY_SWORDS_SPRITESHEET_ASSETS.find(
        (candidate) => candidate.key === key,
      );
      const image = definition
        ? this.add.sprite(object.x, object.y, key, 0)
        : this.add.image(object.x, object.y, key);
      image.setOrigin(0.5, 1);
      image.setDepth(baseDepth + object.y);
      if (definition) this.animateScenery(image, key);
    }
  }

  animateScenery(sprite, key) {
    const animationKey = `${key}:HOME`;
    if (!this.anims.exists(animationKey)) {
      this.anims.create({
        key: animationKey,
        frames: this.anims.generateFrameNumbers(key),
        frameRate: key === TINY_SWORDS_ASSET_KEYS.WATER_FOAM ? 7 : 5,
        repeat: -1,
      });
    }
    sprite.play(animationKey);
  }

  spawnPets() {
    const availableItems = this.items
      .filter((item) =>
        this.textures.exists(`${PET_TEXTURE_PREFIX}${item.templateId}`),
      )
      .sort((left, right) => left.templateId.localeCompare(right.templateId));
    const spawnCells = this.walkable.filter(
      (cell) =>
        cell.x % 2 === 0 &&
        cell.y % 2 === 0 &&
        cellKey(cell) !== cellKey(this.player.cell),
    );
    if (availableItems.length > spawnCells.length)
      throw new Error("Monster Tamer island cannot place every owned Monster.");
    availableItems.forEach((item, index) => {
      const positionIndex = Math.min(
        spawnCells.length - 1,
        Math.floor(
          ((index + 0.5) * spawnCells.length) /
            Math.max(availableItems.length, 1),
        ),
      );
      const cell = spawnCells[positionIndex];
      const key = cellKey(cell);
      this.occupied.add(key);
      this.createPet(item, cell);
    });
  }

  createPet(item, cell) {
    const x = (cell.x + 0.5) * TILE_SIZE;
    const y = (cell.y + 0.5) * TILE_SIZE;
    const shadow = this.add
      .image(0, PET_SIZE * 0.31, TINY_SWORDS_ASSET_KEYS.SHADOW)
      .setDisplaySize(PET_SIZE * 0.68, PET_SIZE * 0.31)
      .setAlpha(0.28);
    const image = this.add
      .image(0, 0, `${PET_TEXTURE_PREFIX}${item.templateId}`)
      .setDisplaySize(PET_SIZE, PET_SIZE);
    const body = this.add.container(0, -PET_SIZE * 0.16, [image]);
    const pet = this.add
      .container(x, y, [shadow, body])
      .setSize(PET_SIZE, PET_SIZE)
      .setDepth(y + 1)
      .setInteractive(
        new Phaser.Geom.Rectangle(
          -PET_SIZE / 2,
          -PET_SIZE * 0.72,
          PET_SIZE,
          PET_SIZE,
        ),
        Phaser.Geom.Rectangle.Contains,
      );
    const entity = { item, cell, pet, body, image, idle: undefined };
    this.startIdle(entity);
    pet.on("pointerdown", (pointer, _x, _y, event) => {
      event.stopPropagation();
      this.suppressGroundTap = true;
      entity.pointerDown = { x: pointer.x, y: pointer.y };
    });
    pet.on("pointerup", (pointer, _x, _y, event) => {
      event.stopPropagation();
      this.suppressGroundTap = true;
      queueMicrotask(() => {
        this.suppressGroundTap = false;
      });
      if (
        !entity.pointerDown ||
        Phaser.Math.Distance.Between(
          entity.pointerDown.x,
          entity.pointerDown.y,
          pointer.x,
          pointer.y,
        ) > 12
      )
        return;
      postToParent({ type: "select", templateId: item.templateId });
      this.scene.pause();
    });
    this.scheduleMove(entity, 500 + Math.random() * 1_500);
  }

  startIdle(entity) {
    if (this.reducedMotion) return;
    entity.idle = this.tweens.add({
      targets: entity.body,
      y: -PET_SIZE * 0.16 - 2,
      duration: 900 + Math.random() * 600,
      ease: "Sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  }

  scheduleMove(entity, delay) {
    this.time.delayedCall(delay, () => this.movePet(entity));
  }

  movePet(entity) {
    const candidates = Phaser.Utils.Array.Shuffle([
      { x: entity.cell.x - 1, y: entity.cell.y },
      { x: entity.cell.x + 1, y: entity.cell.y },
      { x: entity.cell.x, y: entity.cell.y - 1 },
      { x: entity.cell.x, y: entity.cell.y + 1 },
    ]).filter((candidate) => {
      const index = candidate.y * MAP_TILES + candidate.x;
      return (
        index >= 0 &&
        index < MAP_TILES * MAP_TILES &&
        this.walkableKeys.has(cellKey(candidate)) &&
        this.isPetCellAvailable(candidate, cellKey(entity.cell))
      );
    });
    const target = candidates[0];
    if (!target) {
      this.scheduleMove(entity, 600 + Math.random() * 1_200);
      return;
    }
    const currentKey = cellKey(entity.cell);
    const targetKey = cellKey(target);
    this.reserved.add(targetKey);
    entity.idle?.stop();
    entity.image.setFlipX(target.x < entity.cell.x);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: entity.body,
        scaleX: 1.08,
        scaleY: 0.94,
        y: -PET_SIZE * 0.22,
        duration: 230,
        ease: "Sine.inOut",
        yoyo: true,
        repeat: 2,
      });
    }
    this.tweens.add({
      targets: entity.pet,
      x: (target.x + 0.5) * TILE_SIZE,
      y: (target.y + 0.5) * TILE_SIZE,
      duration: this.reducedMotion ? 1_500 : 1_050 + Math.random() * 450,
      ease: "Sine.inOut",
      onUpdate: () => entity.pet.setDepth(entity.pet.y + 1),
      onComplete: () => {
        this.occupied.delete(currentKey);
        this.reserved.delete(targetKey);
        this.occupied.add(targetKey);
        entity.cell = target;
        entity.body.setPosition(0, -PET_SIZE * 0.16).setScale(1);
        this.startIdle(entity);
        this.scheduleMove(entity, 550 + Math.random() * 1_650);
      },
    });
  }

  isPetCellAvailable(candidate, ignoredKey) {
    const candidateKey = cellKey(candidate);
    if (
      candidateKey === cellKey(this.player.cell) ||
      candidateKey === this.playerReserved
    )
      return false;
    for (const key of [...this.occupied, ...this.reserved]) {
      if (key === ignoredKey) continue;
      const [x, y] = key.split(",").map(Number);
      if (
        Math.max(Math.abs(candidate.x - x), Math.abs(candidate.y - y)) < 2
      )
        return false;
    }
    return true;
  }

  createPlayer() {
    const center = { x: MAP_TILES / 2, y: MAP_TILES / 2 };
    const cell = this.walkable.reduce((closest, candidate) =>
      Phaser.Math.Distance.Squared(candidate.x, candidate.y, center.x, center.y) <
      Phaser.Math.Distance.Squared(closest.x, closest.y, center.x, center.y)
        ? candidate
        : closest,
    );
    for (const [direction, definition] of Object.entries(PLAYER_DIRECTIONS)) {
      const key = playerAnimationKey(direction);
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: definition.frames.map((frame) => ({
          key: PLAYER_ASSET_KEY,
          frame,
        })),
        frameRate: 9,
        repeat: -1,
        yoyo: true,
      });
    }
    const sprite = this.add
      .sprite(
        (cell.x + 0.5) * TILE_SIZE,
        (cell.y + 0.78) * TILE_SIZE,
        PLAYER_ASSET_KEY,
        PLAYER_DIRECTIONS.down.idle,
      )
      .setOrigin(0.5, 0.78)
      .setDepth((cell.y + 1) * TILE_SIZE + 2);
    this.player = {
      sprite,
      cell,
      direction: "down",
      goal: undefined,
      path: [],
      moving: false,
      stepTarget: undefined,
    };
  }

  configureCamera() {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    camera.setZoom(0.5);
    camera.startFollow(this.player.sprite, true, 0.14, 0.14);
  }

  configurePointerMovement() {
    this.input.on("pointerdown", (pointer) => {
      if (!isPrimaryMovePointer(pointer)) return;
      this.groundPointerDown = { x: pointer.x, y: pointer.y };
    });
    this.input.on("pointerup", (pointer) => {
      const pointerDown = this.groundPointerDown;
      this.groundPointerDown = undefined;
      if (
        !pointerDown ||
        this.suppressGroundTap ||
        !isPrimaryMovePointer(pointer) ||
        Phaser.Math.Distance.Between(
          pointerDown.x,
          pointerDown.y,
          pointer.x,
          pointer.y,
        ) > 14
      )
        return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const goal = {
        x: Math.floor(world.x / TILE_SIZE),
        y: Math.floor(world.y / TILE_SIZE),
      };
      this.setPlayerGoal(goal);
    });
  }

  configureKeyboardMovement() {
    this.input.keyboard?.on("keydown", (event) => {
      const movement = KEY_MOVEMENT[event.code];
      if (!movement) return;
      event.preventDefault();
      const base = this.player.stepTarget ?? this.player.cell;
      this.player.goal = undefined;
      this.player.path = [];
      this.setPlayerGoal({
        x: base.x + movement.x,
        y: base.y + movement.y,
      });
    });
  }

  setPlayerGoal(goal) {
    const goalKey = cellKey(goal);
    if (
      !this.walkableKeys.has(goalKey) ||
      this.occupied.has(goalKey) ||
      this.reserved.has(goalKey)
    )
      return;
    this.player.goal = goal;
    this.player.path = [];
    if (!this.player.moving) this.planPlayerPath();
  }

  planPlayerPath() {
    if (!this.player.goal) return;
    const blocked = new Set([...this.occupied, ...this.reserved]);
    blocked.delete(cellKey(this.player.cell));
    this.player.path = findGridPath(
      this.player.cell,
      this.player.goal,
      this.walkableKeys,
      blocked,
    );
    if (this.player.path.length === 0) {
      this.player.goal = undefined;
      this.setPlayerIdle();
      return;
    }
    this.movePlayerStep();
  }

  movePlayerStep() {
    if (this.player.moving) return;
    const target = this.player.path.shift();
    if (!target) {
      this.player.goal = undefined;
      this.setPlayerIdle();
      return;
    }
    const targetKey = cellKey(target);
    if (this.occupied.has(targetKey) || this.reserved.has(targetKey)) {
      this.planPlayerPath();
      return;
    }

    const direction = directionBetween(this.player.cell, target);
    this.player.direction = direction;
    this.player.moving = true;
    this.player.stepTarget = target;
    this.playerReserved = targetKey;
    if (this.reducedMotion) {
      this.player.sprite
        .anims.stop()
        .setFrame(PLAYER_DIRECTIONS[direction].idle);
    } else {
      this.player.sprite.play(playerAnimationKey(direction), true);
    }
    this.tweens.add({
      targets: this.player.sprite,
      x: (target.x + 0.5) * TILE_SIZE,
      y: (target.y + 0.78) * TILE_SIZE,
      duration: PLAYER_MOVE_DURATION,
      ease: "Linear",
      onUpdate: () =>
        this.player.sprite.setDepth(this.player.sprite.y + TILE_SIZE + 2),
      onComplete: () => {
        this.player.cell = target;
        this.player.moving = false;
        this.player.stepTarget = undefined;
        this.playerReserved = "";
        if (
          this.player.goal &&
          cellKey(this.player.goal) !== cellKey(this.player.cell)
        ) {
          this.planPlayerPath();
          return;
        }
        this.player.goal = undefined;
        this.setPlayerIdle();
      },
    });
  }

  setPlayerIdle() {
    const definition = PLAYER_DIRECTIONS[this.player.direction];
    this.player.sprite.anims.stop().setFrame(definition.idle);
  }
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function playerAnimationKey(direction) {
  return `PLAYER_${direction.toUpperCase()}`;
}

function directionBetween(current, target) {
  if (target.x < current.x) return "left";
  if (target.x > current.x) return "right";
  if (target.y < current.y) return "up";
  return "down";
}

function isTouchPointer(pointer) {
  const type = String(pointer.event?.pointerType ?? pointer.event?.type ?? "");
  return type === "touch" || type.startsWith("touch");
}

function isPrimaryMovePointer(pointer) {
  return isTouchPointer(pointer) || pointer.event?.button === 0;
}
