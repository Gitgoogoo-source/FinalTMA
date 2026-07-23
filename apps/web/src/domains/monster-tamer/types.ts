import type { RouteInput, RouteOutput } from "@pokepets/api-contracts/app";

export type MonsterTamerBootstrap = RouteOutput<"monster_tamer.bootstrap">;
export type MonsterCheckpointInput = RouteInput<"monster_tamer.checkpoint">;
export type MonsterCheckpointResult = RouteOutput<"monster_tamer.checkpoint">;
export type MonsterBattleInput = RouteInput<"monster_tamer.battle">;
export type MonsterBattleResult = RouteOutput<"monster_tamer.battle">;
export type MonsterCheckpointCommand = MonsterCheckpointInput["command"];
export type MonsterInventoryItem = MonsterTamerBootstrap["inventory"][number];
export type MonsterSkill = MonsterInventoryItem["skills"][number];
export type MonsterProgress = MonsterTamerBootstrap["progress"];
export type MonsterPartyMember = MonsterProgress["party"][number];
export type MonsterBattle = NonNullable<MonsterTamerBootstrap["active_battle"]>;
export type MonsterBattleCombatant = MonsterBattle["party"][number];
export type MonsterWorldRegion =
  MonsterTamerBootstrap["world"]["regions"][number];
export type MonsterWorldNode = MonsterTamerBootstrap["world"]["nodes"][number];
export type MonsterEncounter =
  MonsterTamerBootstrap["world"]["encounters"][number];
export type MonsterRegionId = MonsterProgress["current_region"];
export type MonsterAbility = MonsterProgress["abilities"][number];
export type MonsterElement = MonsterInventoryItem["element"];

export const monsterRegionLabels: Record<MonsterRegionId, string> = {
  camp: "中心营地",
  luminous_forest: "萤光森林",
  tidal_wetland: "潮汐湿地",
  windswept_highlands: "风蚀高原",
  crystal_cavern: "晶矿洞窟",
  molten_basin: "熔火盆地",
  hidden_cave: "隐藏洞穴",
  guardian_lair: "最终守护者巢穴",
};

export const monsterAbilityLabels: Record<MonsterAbility, string> = {
  vine_bridge: "藤桥生长",
  tidal_walk: "潮汐行走",
  wind_glide: "风流滑翔",
  lightning_charge: "雷能充能",
  heat_shield: "炽热护盾",
};

export const monsterElementLabels: Record<MonsterElement, string> = {
  water: "水",
  fire: "火",
  wood: "木",
  wind: "风",
  lightning: "雷",
};

export const monsterSkillEffectLabels: Record<
  MonsterSkill["effect_kind"],
  string
> = {
  none: "无附加效果",
  heal_self: "恢复生命",
  shield_self: "获得护盾",
  burn_enemy: "施加灼烧",
  attack_up_self: "提升攻击",
  drain_self: "吸收生命",
  regen_self: "持续恢复",
  weaken_enemy: "削弱敌人",
  charge_self: "蓄力攻击",
};

export const monsterRarityLabels: Record<
  MonsterInventoryItem["rarity"],
  string
> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
