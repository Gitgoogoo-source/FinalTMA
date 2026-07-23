const BATTLE_MENU_HEIGHT = 128;
const BASE_PLAYFIELD_HEIGHT = 448;

/**
 * Returns the responsive battle positions for the current logical viewport.
 * The original 1024x576 layout is preserved while portrait viewports spread
 * the two monsters across the available playfield.
 * @param {Phaser.Scene} scene
 */
export function getBattleLayout(scene) {
  const { width, height } = scene.scale.gameSize;
  const playfieldHeight = Math.max(BASE_PLAYFIELD_HEIGHT, height - BATTLE_MENU_HEIGHT);
  const enemyMonster = {
    x: Math.round(width * 0.75),
    y: Math.max(144, Math.round(playfieldHeight * 0.25)),
  };
  const playerMonster = {
    x: Math.round(width * 0.25),
    y: Math.max(316, Math.round(playfieldHeight * 0.68)),
  };

  return {
    enemyMonster,
    playerMonster,
    enemyHealthBar: {
      x: 0,
      y: Math.max(0, enemyMonster.y - 144),
    },
    playerHealthBar: {
      x: width - 468,
      y: playerMonster.y + 2,
    },
    enemyNpc: {
      x: enemyMonster.x,
      y: enemyMonster.y + 32,
    },
    enemyAttack: {
      x: enemyMonster.x - 23,
      y: enemyMonster.y - 4,
    },
    playerAttack: {
      x: playerMonster.x,
      y: playerMonster.y + 28,
    },
    playerParty: {
      x: width - 24,
      y: playerMonster.y - 12,
    },
    enemyParty: {
      x: 24,
      y: enemyMonster.y - 28,
    },
    ball: {
      start: {
        x: 0,
        y: playerMonster.y + 184,
      },
      control: {
        x: Math.round(width * 0.2),
        y: playerMonster.y - 216,
      },
      end: {
        x: enemyMonster.x - 43,
        y: enemyMonster.y + 36,
      },
    },
  };
}
