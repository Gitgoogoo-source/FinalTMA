export const OBJECT_LAYER_NAMES = Object.freeze({
  AREA_METADATA: 'Area-Metadata',
  EVENTS: 'Events',
  ITEM: 'Item',
  PLAYER_SPAWN_LOCATION: 'Player-Spawn-Location',
  REVIVE_LOCATION: 'Revive-Location',
  SCENERY: 'Scenery',
  SHADOW_LEVEL_1: 'Shadow-Level-1',
  SHADOW_LEVEL_2: 'Shadow-Level-2',
  SIGN: 'Sign',
  WATER_SCENERY: 'Water-Scenery',
});

export const TILED_SCENERY_PROPERTY = Object.freeze({
  ANIMATION_KEY: 'animation_key',
  ASSET_KEY: 'asset_key',
  DEPTH_MODE: 'depth_mode',
  FIXED_DEPTH: 'fixed_depth',
  FRAME_COUNT: 'frame_count',
  ORIGIN_X: 'origin_x',
  ORIGIN_Y: 'origin_y',
});

export const TILED_SIGN_PROPERTY = Object.freeze({
  ID: 'id',
});

export const CUSTOM_TILED_TYPES = Object.freeze({
  NPC: 'npc',
  NPC_PATH: 'npc_path',
});

export const TILED_NPC_PROPERTY = Object.freeze({
  MOVEMENT_PATTERN: 'movement_pattern',
  FRAME: 'frame',
  ID: 'id',
});

export const TILED_ENCOUNTER_PROPERTY = Object.freeze({
  AREA: 'area',
  TILE_TYPE: 'tileType',
});

export const TILED_ITEM_PROPERTY = Object.freeze({
  ITEM_ID: 'item_id',
  ID: 'id',
});

export const TILED_AREA_METADATA_PROPERTY = Object.freeze({
  FAINT_LOCATION: 'faint_location',
  ID: 'id',
});

export const TILED_EVENT_PROPERTY = Object.freeze({
  ID: 'id',
});
