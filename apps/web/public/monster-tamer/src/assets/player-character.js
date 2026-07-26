export const PLAYER_ASSET_KEY = "PLAYER";
export const PLAYER_ASSET_PATH =
  "assets/images/axulart/character/custom.png";
export const PLAYER_FRAME_WIDTH = 64;
export const PLAYER_FRAME_HEIGHT = 88;

export const PLAYER_DIRECTIONS = Object.freeze({
  down: Object.freeze({ frames: [6, 7, 8], idle: 7 }),
  right: Object.freeze({ frames: [3, 4, 5], idle: 4 }),
  left: Object.freeze({ frames: [9, 10, 11], idle: 10 }),
  up: Object.freeze({ frames: [0, 1, 2], idle: 1 }),
});
