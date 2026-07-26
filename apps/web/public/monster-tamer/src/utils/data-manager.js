import Phaser from '../lib/phaser.js';
import { DIRECTION } from '../common/direction.js';
import { DataUtils } from './data-utils.js';
import { GAME_FLAG } from '../types/typedef.js';

/**
 * @typedef PlayerLocation
 * @type {object}
 * @property {string} area
 * @property {boolean} isInterior
 */

/**
 * @typedef MonsterData
 * @type {object}
 * @property {import('../types/typedef.js').Monster[]} inParty
 */

/**
 * @typedef SessionState
 * @type {object}
 * @property {object} player
 * @property {object} player.position
 * @property {number} player.position.x
 * @property {number} player.position.y
 * @property {PlayerLocation} player.location
 * @property {import('../common/direction.js').Direction} player.direction
 * @property {PlayerLocation} player.location
 * @property {boolean} worldInitialized
 * @property {MonsterData} monsters
 * @property {import('../types/typedef.js').Inventory} inventory
 * @property {number[]} itemsPickedUp
 * @property {number[]} viewedEvents
 * @property {import('../types/typedef.js').GameFlag[]} flags
 * @property {string[]} defeatedNpcs
 */

/** @type {SessionState} */
const initialState = {
  player: {
    position: {
      x: 0,
      y: 0,
    },
    direction: DIRECTION.DOWN,
    location: {
      area: 'main_1',
      isInterior: false,
    },
  },
  worldInitialized: false,
  monsters: {
    inParty: [],
  },
  inventory: [
    {
      item: {
        id: 1,
      },
      quantity: 10,
    },
    {
      item: {
        id: 2,
      },
      quantity: 5,
    },
  ],
  itemsPickedUp: [],
  viewedEvents: [],
  flags: [],
  defeatedNpcs: [],
};

export const DATA_MANAGER_STORE_KEYS = Object.freeze({
  PLAYER_POSITION: 'PLAYER_POSITION',
  PLAYER_DIRECTION: 'PLAYER_DIRECTION',
  PLAYER_LOCATION: 'PLAYER_LOCATION',
  WORLD_INITIALIZED: 'WORLD_INITIALIZED',
  MONSTERS_IN_PARTY: 'MONSTERS_IN_PARTY',
  INVENTORY: 'INVENTORY',
  ITEMS_PICKED_UP: 'ITEMS_PICKED_UP',
  VIEWED_EVENTS: 'VIEWED_EVENTS',
  FLAGS: 'FLAGS',
  DEFEATED_NPCS: 'DEFEATED_NPCS',
});

class DataManager extends Phaser.Events.EventEmitter {
  /** @type {Phaser.Data.DataManager} */
  #store;

  constructor() {
    super();
    this.#store = new Phaser.Data.DataManager(this);
    // initialize state with initial values
    this.#updateDataManger(initialState);
  }

  /** @type {Phaser.Data.DataManager} */
  get store() {
    return this.#store;
  }

  /**
   * @param {Phaser.Scene} scene
   * @returns {import('../types/typedef.js').InventoryItem[]}
   */
  getInventory(scene) {
    /** @type {import('../types/typedef.js').InventoryItem[]} */
    const items = [];
    /** @type {import('../types/typedef.js').Inventory} */
    const inventory = this.#store.get(DATA_MANAGER_STORE_KEYS.INVENTORY);
    inventory.forEach((baseItem) => {
      const item = DataUtils.getItem(scene, baseItem.item.id);
      items.push({
        item: item,
        quantity: baseItem.quantity,
      });
    });
    return items;
  }

  /**
   * @param {import('../types/typedef.js').InventoryItem[]} items
   * @returns {void}
   */
  updateInventory(items) {
    /** @type {import('../types/typedef.js').BaseInventoryItem[]} */
    const inventory = items.map((item) => {
      return {
        item: {
          id: item.item.id,
        },
        quantity: item.quantity,
      };
    });
    this.#store.set(DATA_MANAGER_STORE_KEYS.INVENTORY, inventory);
  }

  /**
   * @param {import('../types/typedef.js').Item} item
   * @param {number} quantity
   * @returns {void}
   */
  addItem(item, quantity) {
    /** @type {import('../types/typedef.js').Inventory} */
    const inventory = this.#store.get(DATA_MANAGER_STORE_KEYS.INVENTORY);
    const existingItem = inventory.find((inventoryItem) => {
      return inventoryItem.item.id === item.id;
    });
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      inventory.push({
        item,
        quantity,
      });
    }
    this.#store.set(DATA_MANAGER_STORE_KEYS.INVENTORY, inventory);
  }

  /**
   * @param {number} itemId
   * @returns {void}
   */
  addItemPickedUp(itemId) {
    /** @type {number[]} */
    const itemsPickedUp = this.#store.get(DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP) || [];
    itemsPickedUp.push(itemId);
    this.#store.set(DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP, itemsPickedUp);
  }

  /**
   * @returns {boolean}
   */
  isPartyFull() {
    const partySize = this.#store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY).length;
    return partySize === 6;
  }

  /**
   * Adds the provided eventId to the viewed events in the data manager so player does
   * not see the event again.
   * @param {number} eventId
   * @returns {void}
   */
  viewedEvent(eventId) {
    /** @type {Set<number>} */
    const viewedEvents = new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS) || []);
    viewedEvents.add(eventId);
    this.#store.set(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS, Array.from(viewedEvents));
  }

  /**
   * @returns {Set<string>}
   */
  getFlags() {
    return new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || []);
  }

  /**
   * @param {GAME_FLAG} flag
   * @returns {void}
   */
  addFlag(flag) {
    /** @type {Set<string>} */
    const existingFlags = new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || []);
    existingFlags.add(flag);
    this.#store.set(DATA_MANAGER_STORE_KEYS.FLAGS, Array.from(existingFlags));
  }

  /**
   * @param {GAME_FLAG} flag
   * @returns {void}
   */
  removeFlag(flag) {
    /** @type {Set<string>} */
    const existingFlags = new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || []);
    existingFlags.delete(flag);
    this.#store.set(DATA_MANAGER_STORE_KEYS.FLAGS, Array.from(existingFlags));
  }

  /**
   * Adds the provided npcId to the defeated npc set in the data manager so player does
   * not battle that npc again.
   * @param {number} npcId
   * @returns {void}
   */
  addDefeatedNpc(npcId) {
    /** @type {Set<number>} */
    const defeatedNpcs = this.#store.get(DATA_MANAGER_STORE_KEYS.DEFEATED_NPCS);
    defeatedNpcs.add(npcId);
  }

  /**
   * @returns {Set<number>}
   */
  getDefeatedNpcs() {
    return this.#store.get(DATA_MANAGER_STORE_KEYS.DEFEATED_NPCS);
  }

  /**
   * @param {SessionState} data
   * @returns {void}
   */
  #updateDataManger(data) {
    this.#store.set({
      [DATA_MANAGER_STORE_KEYS.PLAYER_POSITION]: data.player.position,
      [DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION]: data.player.direction,
      [DATA_MANAGER_STORE_KEYS.PLAYER_LOCATION]: data.player.location || { ...initialState.player.location },
      [DATA_MANAGER_STORE_KEYS.WORLD_INITIALIZED]: data.worldInitialized,
      [DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY]: data.monsters.inParty,
      [DATA_MANAGER_STORE_KEYS.INVENTORY]: data.inventory,
      [DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP]: data.itemsPickedUp || [...initialState.itemsPickedUp],
      [DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS]: data.viewedEvents || [...initialState.viewedEvents],
      [DATA_MANAGER_STORE_KEYS.FLAGS]: data.flags || [...initialState.flags],
      [DATA_MANAGER_STORE_KEYS.DEFEATED_NPCS]: new Set(data.defeatedNpcs || []),
    });
  }
}

export const dataManager = new DataManager();
