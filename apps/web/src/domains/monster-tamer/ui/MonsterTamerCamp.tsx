import {
  ArrowRight,
  Check,
  HeartPulse,
  LockKeyhole,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button, CatalogImage } from "../../../shared/ui/index.tsx";
import {
  monsterElementLabels,
  monsterRarityLabels,
  monsterRegionLabels,
  type MonsterInventoryItem,
  type MonsterRegionId,
  type MonsterTamerBootstrap,
} from "../types.ts";

const regionOrder: MonsterRegionId[] = [
  "luminous_forest",
  "tidal_wetland",
  "windswept_highlands",
  "crystal_cavern",
  "molten_basin",
  "hidden_cave",
  "guardian_lair",
];

export function MonsterTamerCamp({
  snapshot,
  selection,
  busy,
  onToggle,
  onConfirm,
  onEnterRegion,
}: {
  snapshot: MonsterTamerBootstrap;
  selection: string[];
  busy: boolean;
  onToggle(templateId: string): void;
  onConfirm(): void;
  onEnterRegion(regionId: MonsterRegionId): void;
}): ReactNode {
  const canonicalTeam = snapshot.progress.party.map(
    (member) => member.template_id,
  );
  const teamConfirmed =
    selection.length > 0 &&
    selection.length === canonicalTeam.length &&
    selection.every((templateId, index) => templateId === canonicalTeam[index]);
  const unlocked = new Set(snapshot.progress.unlocked_regions);
  const regions = regionOrder.filter((regionId) => unlocked.has(regionId));
  const fullyRecovered = snapshot.progress.party.every(
    (member) => member.current_hp === member.max_hp,
  );

  return (
    <div className="monster-tamer-camp">
      <section className="monster-tamer-camp-hero">
        <div className="monster-tamer-camp-mark" aria-hidden="true">
          <ShieldCheck />
        </div>
        <div>
          <span>CENTRAL CAMP</span>
          <h2>中心营地</h2>
          <p>选择 1–3 个当前可用藏品，确认队伍后再进入生态区域。</p>
        </div>
        <div className="monster-tamer-camp-recovery">
          <HeartPulse aria-hidden="true" />
          <span>营地恢复</span>
          <strong>
            {fullyRecovered ? "队伍已完全恢复" : "正在确认恢复状态"}
          </strong>
        </div>
      </section>

      {snapshot.entry_state === "team_reselection_required" ? (
        <div className="monster-tamer-inline-alert" role="alert">
          原队伍中有藏品已不可用，请重新选择出战队伍。
        </div>
      ) : null}
      {snapshot.progress.guardian_completed_at ? (
        <div className="monster-tamer-completion-banner">
          <Trophy aria-hidden="true" />
          <div>
            <strong>最终守护者已击败</strong>
            <span>通关记录已经保存，所有区域仍可自由探索和重复挑战。</span>
          </div>
        </div>
      ) : null}

      <section
        className="monster-tamer-team-builder"
        aria-labelledby="monster-tamer-team-title"
      >
        <header>
          <div>
            <span>出战准备</span>
            <h3 id="monster-tamer-team-title">选择队伍</h3>
          </div>
          <strong>
            <Users aria-hidden="true" />
            {selection.length}/3
          </strong>
        </header>

        <div className="monster-tamer-collection-grid">
          {snapshot.inventory.map((item) => (
            <CollectionChoice
              key={item.template_id}
              item={item}
              selected={selection.includes(item.template_id)}
              disabled={
                busy ||
                (!selection.includes(item.template_id) && selection.length >= 3)
              }
              onToggle={onToggle}
            />
          ))}
        </div>

        <footer className="monster-tamer-team-footer">
          <div className="monster-tamer-selected-team">
            {selection.length === 0 ? (
              <span>尚未选择出战藏品</span>
            ) : (
              selection.map((templateId, index) => {
                const item = snapshot.inventory.find(
                  (candidate) => candidate.template_id === templateId,
                );
                return item ? (
                  <span key={templateId}>
                    <i>{index + 1}</i>
                    {item.name}
                  </span>
                ) : null;
              })
            )}
          </div>
          <Button
            className="monster-tamer-confirm-team"
            disabled={busy || selection.length === 0 || teamConfirmed}
            onClick={onConfirm}
          >
            <Check aria-hidden="true" />
            {busy ? "正在确认" : teamConfirmed ? "队伍已确认" : "确认出战队伍"}
          </Button>
        </footer>
      </section>

      <section
        className="monster-tamer-region-picker"
        aria-labelledby="monster-tamer-region-title"
      >
        <header>
          <div>
            <span>生态出口</span>
            <h3 id="monster-tamer-region-title">选择探索区域</h3>
          </div>
          <small>区域切换前会再次校验队伍</small>
        </header>
        <div>
          {regions.map((regionId) => {
            const region = snapshot.world.regions.find(
              (candidate) => candidate.id === regionId,
            );
            return (
              <button
                key={regionId}
                type="button"
                className={`monster-tamer-region-card element-${region?.element ?? "neutral"}`}
                disabled={busy || !teamConfirmed}
                onClick={() => onEnterRegion(regionId)}
              >
                <span>{region?.name ?? monsterRegionLabels[regionId]}</span>
                <small>
                  {region?.element
                    ? `${monsterElementLabels[region.element]}生态`
                    : "生态区域"}
                </small>
                {teamConfirmed ? (
                  <ArrowRight aria-hidden="true" />
                ) : (
                  <LockKeyhole aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CollectionChoice({
  item,
  selected,
  disabled,
  onToggle,
}: {
  item: MonsterInventoryItem;
  selected: boolean;
  disabled: boolean;
  onToggle(templateId: string): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={`monster-tamer-collection-choice element-${item.element} ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      aria-label={`${selected ? "移除" : "选择"}${item.name}，${monsterElementLabels[item.element]}属性，战斗力${item.combat_power}，可用${item.available_quantity}`}
      disabled={disabled}
      onClick={() => onToggle(item.template_id)}
    >
      <span className="monster-tamer-collection-art">
        <CatalogImage
          path={item.image_thumbnail_path}
          alt=""
          variant="thumbnail"
          loading="lazy"
        />
        <i>{monsterElementLabels[item.element]}</i>
        {selected ? (
          <b>
            <Check aria-hidden="true" />
          </b>
        ) : null}
      </span>
      <span className="monster-tamer-collection-copy">
        <strong>{item.name}</strong>
        <small>
          {monsterRarityLabels[item.rarity]} · {item.stage} 阶
        </small>
        <span>
          战斗力 {item.combat_power.toLocaleString("zh-CN")}
          <em>可用 ×{item.available_quantity}</em>
        </span>
      </span>
    </button>
  );
}
