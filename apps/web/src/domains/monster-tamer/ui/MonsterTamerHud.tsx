import {
  Backpack,
  Heart,
  Home,
  Map,
  MapPin,
  Package,
  Shield,
  Sparkles,
  Swords,
  X,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button, CatalogImage } from "../../../shared/ui/index.tsx";
import {
  monsterAbilityLabels,
  monsterElementLabels,
  monsterRegionLabels,
  monsterSkillEffectLabels,
  type MonsterAbility,
  type MonsterInventoryItem,
  type MonsterTamerBootstrap,
} from "../types.ts";

export type MonsterTamerPanelName = "map" | "backpack" | "abilities";

export function MonsterTamerHud({
  snapshot,
  panel,
  busy,
  saveMessage,
  onPanelChange,
  onClose,
  onUseSkill,
  onUseSupply,
  onContinueAfterBattle,
}: {
  snapshot: MonsterTamerBootstrap;
  panel: MonsterTamerPanelName | null;
  busy: boolean;
  saveMessage: string | null;
  onPanelChange(panel: MonsterTamerPanelName | null): void;
  onClose(): void;
  onUseSkill(slot: 1 | 2 | 3): void;
  onUseSupply(templateId: string): void;
  onContinueAfterBattle(): void;
}): ReactNode {
  const battle = snapshot.active_battle;
  const party = battle
    ? battle.party.map((member) => ({
        templateId: member.template_id,
        name: member.name,
        element: member.element,
        imageThumbnailPath: member.image_thumbnail_path,
        currentHp: member.current_hp,
        maxHp: member.max_hp,
      }))
    : snapshot.progress.party.flatMap((member) => {
        const item = snapshot.inventory.find(
          (candidate) => candidate.template_id === member.template_id,
        );
        return item
          ? [
              {
                templateId: member.template_id,
                name: item.name,
                element: item.element,
                imageThumbnailPath: item.image_thumbnail_path,
                currentHp: member.current_hp,
                maxHp: member.max_hp,
              },
            ]
          : [];
      });

  return (
    <>
      <div className="monster-tamer-hud" aria-label="探索状态">
        <section className="monster-tamer-party-hud">
          {party.map((member) => (
            <PartyStatus
              key={member.templateId}
              name={member.name}
              element={member.element}
              imageThumbnailPath={member.imageThumbnailPath}
              currentHp={member.currentHp}
              maxHp={member.maxHp}
              active={battle?.active_template_id === member.templateId}
            />
          ))}
        </section>

        <section className="monster-tamer-region-hud">
          <span>当前区域</span>
          <strong>
            {monsterRegionLabels[snapshot.progress.current_region]}
          </strong>
          <button
            type="button"
            aria-label="查看探索能力"
            disabled={Boolean(battle)}
            onClick={() =>
              onPanelChange(panel === "abilities" ? null : "abilities")
            }
          >
            <Sparkles aria-hidden="true" />
            {snapshot.progress.abilities.length}/5
          </button>
        </section>

        {snapshot.progress.regional_boost && !battle ? (
          <div className="monster-tamer-regional-boost-status" role="status">
            <Zap aria-hidden="true" />
            本区域下一场攻击 +
            {formatBasisPoints(snapshot.progress.regional_boost.attack_bp)}
          </div>
        ) : null}

        <button
          type="button"
          className="monster-tamer-close"
          aria-label="关闭 Monster Tamer"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>

        <nav className="monster-tamer-hud-tools" aria-label="探索工具">
          <button
            type="button"
            className={panel === "map" ? "active" : ""}
            aria-pressed={panel === "map"}
            disabled={Boolean(battle)}
            onClick={() => onPanelChange(panel === "map" ? null : "map")}
          >
            <Map aria-hidden="true" />
            <span>地图</span>
          </button>
          <button
            type="button"
            className={panel === "backpack" ? "active" : ""}
            aria-pressed={panel === "backpack"}
            disabled={Boolean(battle)}
            onClick={() =>
              onPanelChange(panel === "backpack" ? null : "backpack")
            }
          >
            <Backpack aria-hidden="true" />
            <span>背包</span>
          </button>
          <button
            type="button"
            disabled={busy || Boolean(battle)}
            onClick={() => onPanelChange("map")}
          >
            <Home aria-hidden="true" />
            <span>出口</span>
          </button>
        </nav>

        {saveMessage ? (
          <div className="monster-tamer-save-status" role="status">
            {saveMessage}
          </div>
        ) : null}
      </div>

      {panel && !battle ? (
        <MonsterTamerDrawer
          panel={panel}
          snapshot={snapshot}
          busy={busy}
          onClose={() => onPanelChange(null)}
          onUseSupply={onUseSupply}
        />
      ) : null}

      {battle ? (
        <MonsterTamerBattleControls
          snapshot={snapshot}
          busy={busy}
          onUseSkill={onUseSkill}
          onContinue={onContinueAfterBattle}
        />
      ) : null}
    </>
  );
}

function PartyStatus({
  name,
  element,
  imageThumbnailPath,
  currentHp,
  maxHp,
  active,
}: {
  name: string;
  element: MonsterInventoryItem["element"];
  imageThumbnailPath: string;
  currentHp: number;
  maxHp: number;
  active: boolean;
}): ReactNode {
  const hpPercent =
    maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  return (
    <article
      className={`monster-tamer-party-member element-${element} ${active ? "active" : ""}`}
      aria-label={`${name}，生命 ${currentHp}/${maxHp}${active ? "，当前行动" : ""}`}
    >
      <CatalogImage
        path={imageThumbnailPath}
        alt=""
        variant="thumbnail"
        loading="eager"
      />
      <div>
        <strong>{name}</strong>
        <span>
          <i style={{ width: `${hpPercent}%` }} />
        </span>
        <small>
          <Heart aria-hidden="true" />
          {currentHp}/{maxHp}
        </small>
      </div>
    </article>
  );
}

function MonsterTamerDrawer({
  panel,
  snapshot,
  busy,
  onClose,
  onUseSupply,
}: {
  panel: MonsterTamerPanelName;
  snapshot: MonsterTamerBootstrap;
  busy: boolean;
  onClose(): void;
  onUseSupply(templateId: string): void;
}): ReactNode {
  const heading = {
    map: "迷雾地图",
    backpack: "可用藏品",
    abilities: "探索能力",
  }[panel];
  return (
    <aside
      className={`monster-tamer-drawer monster-tamer-${panel}-drawer`}
      aria-labelledby={`monster-tamer-${panel}-title`}
    >
      <header>
        <div>
          <span>FIELD PANEL</span>
          <h2 id={`monster-tamer-${panel}-title`}>{heading}</h2>
        </div>
        <button type="button" aria-label={`关闭${heading}`} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      {panel === "map" ? <MapPanel snapshot={snapshot} /> : null}
      {panel === "backpack" ? (
        <BackpackPanel
          snapshot={snapshot}
          busy={busy}
          onUseSupply={onUseSupply}
        />
      ) : null}
      {panel === "abilities" ? (
        <AbilitiesPanel abilities={snapshot.progress.abilities} />
      ) : null}
    </aside>
  );
}

function MapPanel({
  snapshot,
}: {
  snapshot: MonsterTamerBootstrap;
}): ReactNode {
  const unlocked = new Set(["camp", ...snapshot.progress.unlocked_regions]);
  return (
    <div className="monster-tamer-map-list">
      <p className="monster-tamer-map-guidance">
        前往当前区域地图中的出口返回中心营地；探索途中不能直接传送。
      </p>
      {snapshot.world.regions
        .filter((region) => region.id !== "camp" && unlocked.has(region.id))
        .map((region) => {
          const revealedCellIds =
            snapshot.progress.revealed_cells[region.id] ?? [];
          const revealedCells = new Set(revealedCellIds);
          const revealedPositions = revealedCellIds.flatMap((cellId) => {
            const position = parseMapCell(
              cellId,
              region.width_tiles,
              region.height_tiles,
            );
            return position ? [position] : [];
          });
          const revealed = revealedPositions.length;
          const total = region.width_tiles * region.height_tiles;
          const percent =
            total > 0 ? Math.min(100, Math.round((revealed / total) * 100)) : 0;
          const nodes = snapshot.world.nodes.filter(
            (node) =>
              node.region_id === region.id &&
              revealedCells.has(mapCellId(node.position)),
          );
          const encounters = snapshot.world.encounters.filter(
            (encounter) =>
              encounter.region_id === region.id &&
              ["elite", "boss", "guardian"].includes(encounter.kind) &&
              revealedCells.has(mapCellId(encounter.position)),
          );
          const playerPosition =
            region.id === snapshot.progress.current_region &&
            revealedCells.has(mapCellId(snapshot.progress.resume_position))
              ? snapshot.progress.resume_position
              : null;
          const revealedPath = revealedPositions
            .map(({ x, y }) => `M${x} ${y}h1v1h-1z`)
            .join("");
          return (
            <article
              key={region.id}
              className={`monster-tamer-map-region element-${region.element ?? "neutral"} ${
                region.id === snapshot.progress.current_region ? "active" : ""
              }`}
            >
              <header>
                <MapPin aria-hidden="true" />
                <div>
                  <strong>{region.name}</strong>
                  <span>{revealed} 格已探索</span>
                </div>
                <b>{percent}%</b>
              </header>
              <div
                className="monster-tamer-mini-map"
                role="img"
                aria-label={`${region.name}，已揭开 ${revealed} 格；地图只显示已揭开的固定地标、精英和首领`}
              >
                <svg
                  viewBox={`0 0 ${region.width_tiles} ${region.height_tiles}`}
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <rect
                    className="monster-tamer-mini-map-ground"
                    width={region.width_tiles}
                    height={region.height_tiles}
                  />
                  <path
                    className="monster-tamer-mini-map-revealed"
                    d={revealedPath}
                  />
                  {nodes.map((node) => (
                    <g
                      key={node.id}
                      className={`monster-tamer-mini-map-marker node ${node.kind} ${
                        node.completed || node.claimed ? "complete" : ""
                      }`}
                      transform={`translate(${node.position.x + 0.5} ${node.position.y + 0.5})`}
                    >
                      <title>{node.name}</title>
                      <rect
                        x="-0.62"
                        y="-0.62"
                        width="1.24"
                        height="1.24"
                        rx="0.2"
                        transform="rotate(45)"
                      />
                    </g>
                  ))}
                  {encounters.map((encounter) => (
                    <g
                      key={encounter.id}
                      className={`monster-tamer-mini-map-marker encounter ${encounter.kind}`}
                      transform={`translate(${encounter.position.x + 0.5} ${encounter.position.y + 0.5})`}
                    >
                      <title>{encounter.name}</title>
                      <circle r={encounter.kind === "elite" ? "0.72" : "1"} />
                      <path d="M0 -0.46L0.42 0.3H-0.42Z" />
                    </g>
                  ))}
                  {playerPosition ? (
                    <g
                      className="monster-tamer-mini-map-marker player"
                      transform={`translate(${playerPosition.x + 0.5} ${playerPosition.y + 0.5})`}
                    >
                      <title>当前位置</title>
                      <circle r="0.82" />
                      <circle r="0.28" />
                    </g>
                  ) : null}
                </svg>
              </div>
              <footer className="monster-tamer-mini-map-legend">
                <small>
                  <i className="node" />
                  地标
                </small>
                <small>
                  <i className="elite" />
                  精英
                </small>
                <small>
                  <i className="boss" />
                  首领
                </small>
                <small>
                  <i className="exit" />
                  出口
                </small>
                <small>
                  <i className="rematch" />
                  再战
                </small>
                <small>
                  <i className="player" />
                  当前位置
                </small>
              </footer>
            </article>
          );
        })}
    </div>
  );
}

function mapCellId(position: { x: number; y: number }): string {
  return `${position.x}:${position.y}`;
}

function parseMapCell(
  cellId: string,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const match = /^(\d+):(\d+)$/.exec(cellId);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return x < width && y < height ? { x, y } : null;
}

function BackpackPanel({
  snapshot,
  busy,
  onUseSupply,
}: {
  snapshot: MonsterTamerBootstrap;
  busy: boolean;
  onUseSupply(templateId: string): void;
}): ReactNode {
  const partyIds = new Set(
    snapshot.progress.party.map((member) => member.template_id),
  );
  return (
    <div className="monster-tamer-backpack-content">
      <div className="monster-tamer-supply-summary">
        <Package aria-hidden="true" />
        <span>治疗补给</span>
        <strong>×{snapshot.progress.supply_count}</strong>
      </div>
      <div className="monster-tamer-backpack-list">
        {snapshot.inventory.map((item) => {
          const partyMember = snapshot.progress.party.find(
            (member) => member.template_id === item.template_id,
          );
          return (
            <article key={item.template_id}>
              <CatalogImage
                path={item.image_thumbnail_path}
                alt=""
                variant="thumbnail"
                loading="lazy"
              />
              <div>
                <strong>{item.name}</strong>
                <span>
                  {monsterElementLabels[item.element]} · 战斗力{" "}
                  {item.combat_power.toLocaleString("zh-CN")}
                </span>
                <small>可用 ×{item.available_quantity}</small>
              </div>
              {partyIds.has(item.template_id) && partyMember ? (
                <Button
                  className="secondary"
                  disabled={
                    busy ||
                    snapshot.progress.supply_count === 0 ||
                    partyMember.current_hp >= partyMember.max_hp
                  }
                  onClick={() => onUseSupply(item.template_id)}
                >
                  恢复
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AbilitiesPanel({
  abilities,
}: {
  abilities: MonsterAbility[];
}): ReactNode {
  const acquired = new Set(abilities);
  return (
    <div className="monster-tamer-ability-list">
      {(Object.keys(monsterAbilityLabels) as MonsterAbility[]).map(
        (ability) => (
          <article
            key={ability}
            className={acquired.has(ability) ? "owned" : ""}
          >
            {acquired.has(ability) ? (
              <Zap aria-hidden="true" />
            ) : (
              <Shield aria-hidden="true" />
            )}
            <div>
              <strong>{monsterAbilityLabels[ability]}</strong>
              <span>{acquired.has(ability) ? "已永久解锁" : "尚未获得"}</span>
            </div>
          </article>
        ),
      )}
    </div>
  );
}

function MonsterTamerBattleControls({
  snapshot,
  busy,
  onUseSkill,
  onContinue,
}: {
  snapshot: MonsterTamerBootstrap;
  busy: boolean;
  onUseSkill(slot: 1 | 2 | 3): void;
  onContinue(): void;
}): ReactNode {
  const battle = snapshot.active_battle;
  if (!battle) return null;
  const activeCombatant = battle.party.find(
    (member) => member.template_id === battle.active_template_id,
  );
  const terminal = battle.status !== "active";
  return (
    <section
      className={`monster-tamer-battle-controls ${terminal ? `result-${battle.status}` : ""}`}
      aria-labelledby="monster-tamer-battle-title"
    >
      <header>
        <div>
          <span>
            {battle.kind === "guardian"
              ? "最终守护者"
              : battle.kind === "boss"
                ? "区域首领"
                : battle.kind === "elite"
                  ? "精英生态怪"
                  : "生态遭遇"}
          </span>
          <h2 id="monster-tamer-battle-title">{battle.enemy.name}</h2>
        </div>
        <strong>
          <Swords aria-hidden="true" />
          {terminal ? `已结算 ${battle.turn} 回合` : `回合 ${battle.turn + 1}`}
        </strong>
      </header>
      <div className="monster-tamer-enemy-health">
        <span>
          <i
            style={{
              width: `${Math.max(
                0,
                Math.min(
                  100,
                  battle.enemy.max_hp > 0
                    ? (battle.enemy.current_hp / battle.enemy.max_hp) * 100
                    : 0,
                ),
              )}%`,
            }}
          />
        </span>
        <small>
          {battle.enemy.current_hp}/{battle.enemy.max_hp}
        </small>
      </div>
      {battle.mechanic_notice || snapshot.progress.regional_boost ? (
        <div className="monster-tamer-battle-notices">
          {battle.mechanic_notice ? (
            <span>{battle.mechanic_notice}</span>
          ) : null}
          {snapshot.progress.regional_boost ? (
            <span className="boost">
              <Zap aria-hidden="true" />
              本区域下一场攻击 +
              {formatBasisPoints(snapshot.progress.regional_boost.attack_bp)}
            </span>
          ) : null}
        </div>
      ) : null}
      {terminal ? (
        <div className="monster-tamer-battle-result">
          <strong>{battle.status === "won" ? "战斗胜利" : "队伍倒下"}</strong>
          <span>
            {battle.status === "won"
              ? "服务器已确认本场结果。"
              : "将返回营地并完全恢复队伍。"}
          </span>
          <Button disabled={busy} onClick={onContinue}>
            继续
          </Button>
        </div>
      ) : (
        <div className="monster-tamer-skill-grid">
          {activeCombatant?.skills.map((skill) => (
            <button
              key={skill.slot}
              type="button"
              className={`element-${skill.element}`}
              disabled={busy}
              onClick={() => onUseSkill(skill.slot)}
            >
              <span>{monsterElementLabels[skill.element]}</span>
              <strong>{skill.name}</strong>
              <small>
                威力 {formatBasisPoints(skill.power_bp)} ·{" "}
                {monsterSkillEffectLabels[skill.effect_kind]}
              </small>
            </button>
          )) ?? (
            <div className="monster-tamer-inline-alert" role="alert">
              当前出战藏品资料不可用，正在重新读取真实状态。
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatBasisPoints(value: number): string {
  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}
