import Phaser from './lib/phaser.js';
import { SCENE_KEYS } from './scenes/scene-keys.js';
import { PreloadScene } from './scenes/preload-scene.js';
import { BattleScene } from './scenes/battle-scene.js';
import { WorldScene } from './scenes/world-scene.js';
import { TitleScene } from './scenes/title-scene.js';
import { OptionsScene } from './scenes/options-scene.js';
import { TestScene } from './scenes/test-scene.js';
import { MonsterPartyScene } from './scenes/monster-party-scene.js';
import { MonsterDetailsScene } from './scenes/monster-details-scene.js';
import { InventoryScene } from './scenes/inventory-scene.js';
import { CutsceneScene } from './scenes/cutscene-scene.js';
import { DialogScene } from './scenes/dialog-scene.js';

const GAME_WIDTH = 1024;
const MIN_GAME_HEIGHT = 576;
const gameContainer = document.querySelector('#game-container');

if (!(gameContainer instanceof HTMLElement)) {
  throw new Error('Monster Tamer game container was not found.');
}

function getGameHeight() {
  const { width, height } = gameContainer.getBoundingClientRect();
  if (width <= 0 || height <= 0) {
    return MIN_GAME_HEIGHT;
  }
  return Math.max(MIN_GAME_HEIGHT, Math.round((GAME_WIDTH * height) / width));
}

const game = new Phaser.Game({
  type: Phaser.CANVAS,
  pixelArt: true,
  render: {
    antialias: false,
    roundPixels: true,
  },
  scale: {
    parent: 'game-container',
    width: GAME_WIDTH,
    height: getGameHeight(),
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  backgroundColor: '#000000',
});

const resizeGame = () => {
  const height = getGameHeight();
  if (game.scale.gameSize.width !== GAME_WIDTH || game.scale.gameSize.height !== height) {
    game.scale.resize(GAME_WIDTH, height);
  }
};
const resizeObserver = new ResizeObserver(resizeGame);
resizeObserver.observe(gameContainer);
window.addEventListener('resize', resizeGame);
window.addEventListener(
  'pagehide',
  () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', resizeGame);
  },
  { once: true }
);

game.scene.add(SCENE_KEYS.PRELOAD_SCENE, PreloadScene);
game.scene.add(SCENE_KEYS.WORLD_SCENE, WorldScene);
game.scene.add(SCENE_KEYS.BATTLE_SCENE, BattleScene);
game.scene.add(SCENE_KEYS.TITLE_SCENE, TitleScene);
game.scene.add(SCENE_KEYS.OPTIONS_SCENE, OptionsScene);
game.scene.add(SCENE_KEYS.TEST_SCENE, TestScene);
game.scene.add(SCENE_KEYS.MONSTER_PARTY_SCENE, MonsterPartyScene);
game.scene.add(SCENE_KEYS.MONSTER_DETAILS_SCENE, MonsterDetailsScene);
game.scene.add(SCENE_KEYS.INVENTORY_SCENE, InventoryScene);
game.scene.add(SCENE_KEYS.CUTSCENE_SCENE, CutsceneScene);
game.scene.add(SCENE_KEYS.DIALOG_SCENE, DialogScene);
game.scene.start(SCENE_KEYS.PRELOAD_SCENE);
