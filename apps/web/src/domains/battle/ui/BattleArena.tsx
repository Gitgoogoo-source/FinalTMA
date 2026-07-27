import {
  ArrowDownUp,
  Clock3,
  LockKeyhole,
  Shield,
  Swords,
  X,
  Zap,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import type {
  BattleResolutionEventDto,
  BattleRoomSnapshotDto,
  BattleSelfTeamDto,
} from "@pokepets/api-contracts/app";

import { Button, CatalogImage } from "../../../shared/ui/index.tsx";
import { battleRarityLabels, formatBattleTime } from "../labels.ts";
import { useBattleAnimation } from "../useBattleAnimation.ts";

type SelfMember = BattleSelfTeamDto[number];
type SkillPosition = SelfMember["skills"][number]["position"];
type TeamSlot = SelfMember["slot"];

export function BattleArena({
  snapshot,
  remainingSeconds,
  actionIntent,
  commandPending,
  switchOpen,
  setSwitchOpen,
  onAttack,
  onSwitch,
  onForcedSwitch,
}: {
  snapshot: BattleRoomSnapshotDto;
  remainingSeconds: number | null;
  actionIntent: string | null;
  commandPending: boolean;
  switchOpen: boolean;
  setSwitchOpen(open: boolean): void;
  onAttack(position: SkillPosition, name: string): void;
  onSwitch(slot: TeamSlot, name: string): void;
  onForcedSwitch(slot: TeamSlot, name: string): void;
}): ReactNode {
  const arenaRef = useRef<HTMLDivElement>(null);
  const selfActive = snapshot.self_team.find((member) => member.active);
  const opponentActive = snapshot.opponent_team.find((member) => member.active);
  const candidates = snapshot.self_team.filter(
    (member) => member.alive && !member.active,
  );
  const available =
    snapshot.viewer_action_state === "available" && !commandPending;
  useBattleAnimation({
    arenaRef,
    resolution: snapshot.resolution_event,
    serverTime: snapshot.server_time,
  });

  return (
    <section
      ref={arenaRef}
      className="battle-arena"
      data-battle-phase={snapshot.status}
      aria-label="Battle 单战场"
    >
      <header className="battle-turn-hud">
        <span>
          <Swords />第 {snapshot.turn_no || 1} / 20 回合
        </span>
        <strong>
          <Clock3 />
          {formatBattleTime(remainingSeconds)}
        </strong>
        <span className="battle-side-chip">
          {snapshot.side === "creator" ? "创建方" : "接受方"}
        </span>
      </header>

      <ArenaSide
        actor="opponent"
        label="对手"
        team={snapshot.opponent_team}
        active={opponentActive}
      />

      <div className="battle-stage-feedback">
        <div
          className="battle-effect-layer"
          data-battle-effect-layer
          aria-hidden="true"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <ResolutionFeedback event={snapshot.resolution_event} />
        {snapshot.status === "active_select" ? (
          <small>双方行动保持秘密，服务器确认后统一结算</small>
        ) : snapshot.status === "reveal" ? (
          <small>当前为 3 秒权威结算展示窗口</small>
        ) : (
          <small>强制换宠不计入正常回合</small>
        )}
      </div>

      <ArenaSide
        actor="self"
        label="我方"
        team={snapshot.self_team}
        active={selfActive}
      />

      {snapshot.status === "active_select" ? (
        <section className="battle-action-hud" aria-label="本回合动作">
          {snapshot.viewer_action_state === "locked" ? (
            <ActionStatus icon={<LockKeyhole />} text="已锁定" />
          ) : actionIntent ? (
            <ActionStatus icon={<Clock3 />} text={`已提交：${actionIntent}`} />
          ) : snapshot.viewer_action_state === "not_applicable" ? (
            <ActionStatus
              icon={<Clock3 />}
              text="当前不可提交，正在读取服务器下一状态"
            />
          ) : selfActive ? (
            <>
              <div className="battle-skill-grid">
                {selfActive.skills.map((skill) => (
                  <button
                    key={skill.skill_id}
                    type="button"
                    disabled={!available}
                    onClick={() => onAttack(skill.position, skill.name)}
                  >
                    <span>
                      <Zap />
                      {skill.name}
                    </span>
                    <small>
                      威力 {skill.power} · 命中 {skill.accuracy_bps / 100}% ·
                      优先级{" "}
                      {skill.priority > 0
                        ? `+${skill.priority}`
                        : skill.priority}
                    </small>
                  </button>
                ))}
              </div>
              <Button
                className="secondary battle-switch-trigger"
                disabled={!available || candidates.length === 0}
                onClick={() => setSwitchOpen(true)}
              >
                <ArrowDownUp />
                主动换宠
              </Button>
            </>
          ) : (
            <ActionStatus icon={<Shield />} text="正在读取当前出战宠物" />
          )}
        </section>
      ) : snapshot.status === "reveal" ? (
        <section className="battle-action-hud">
          <ActionStatus icon={<Shield />} text="结算展示中，动作入口已锁定" />
        </section>
      ) : null}

      {switchOpen && snapshot.status === "active_select" ? (
        <SwitchSheet
          title="主动换宠"
          description="选择后立即提交并消耗本回合，换入宠物承受对手本回合攻击。"
          candidates={candidates}
          disabled={!available}
          close={() => setSwitchOpen(false)}
          choose={onSwitch}
        />
      ) : null}

      {snapshot.status === "forced_switch" ? (
        <div className="battle-forced-overlay" role="dialog" aria-modal="true">
          <div className="battle-forced-sheet">
            <span className="battle-sheet-kicker">FORCED SWITCH</span>
            <h2>选择存活宠物换入</h2>
            {snapshot.viewer_action_state === "locked" ? (
              <ActionStatus
                icon={<LockKeyhole />}
                text="已锁定，等待服务器推进"
              />
            ) : snapshot.viewer_action_state === "not_applicable" ? (
              <ActionStatus
                icon={<Clock3 />}
                text="当前无需提交，等待服务器推进"
              />
            ) : actionIntent ? (
              <ActionStatus
                icon={<Clock3 />}
                text={`已提交：${actionIntent}`}
              />
            ) : (
              <SwitchCandidates
                candidates={candidates}
                disabled={commandPending}
                choose={onForcedSwitch}
              />
            )}
            <p>本地倒计时归零只会重新读取权威状态，前端不会代替你选择。</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ArenaSide({
  actor,
  label,
  team,
  active,
}: {
  actor: "self" | "opponent";
  label: string;
  team:
    | BattleRoomSnapshotDto["self_team"]
    | BattleRoomSnapshotDto["opponent_team"];
  active:
    | BattleRoomSnapshotDto["self_team"][number]
    | BattleRoomSnapshotDto["opponent_team"][number]
    | undefined;
}): ReactNode {
  return (
    <div
      className={`battle-arena-side ${actor}`}
      data-battle-actor={actor}
      aria-label={`${label}队伍`}
    >
      <div className="battle-bench">
        {team.map((member) => (
          <div
            key={member.slot}
            className={`${member.active ? "active" : ""} ${member.alive ? "" : "knocked-out"}`}
          >
            <CatalogImage
              path={member.image_thumbnail_path}
              alt={`${member.name}${member.alive ? "" : "，已击倒"}`}
              variant="thumbnail"
              loading="lazy"
            />
            <span>{member.slot}</span>
          </div>
        ))}
      </div>
      {active ? (
        <div className="battle-active-pet" data-battle-active-sprite>
          <div className="battle-active-art">
            <CatalogImage
              path={active.image_detail_path}
              alt={active.name}
              variant="detail"
              loading="eager"
              fetchPriority="high"
            />
          </div>
          <div className="battle-pet-hud">
            <span>
              {label} · {battleRarityLabels[active.rarity]} · {active.stage} 阶
            </span>
            <strong>{active.name}</strong>
            {"current_hp" in active ? (
              <HpBar
                label={`${active.name}生命`}
                percent={(active.current_hp / active.max_hp) * 100}
                text={`${active.current_hp} / ${active.max_hp}`}
              />
            ) : (
              <HpBar
                label={`${active.name}生命百分比`}
                percent={active.hp_percent}
                text={`${Math.round(active.hp_percent)}%`}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="battle-empty-active">
          {team.length === 0 ? "正在读取权威阵容" : "等待存活宠物换入"}
        </div>
      )}
    </div>
  );
}

function HpBar({
  label,
  percent,
  text,
}: {
  label: string;
  percent: number;
  text: string;
}): ReactNode {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="battle-hp"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe)}
    >
      <i style={{ width: `${safe}%` }} />
      <span>{text}</span>
    </div>
  );
}

function ResolutionFeedback({
  event,
}: {
  event: BattleResolutionEventDto | null;
}): ReactNode {
  if (!event)
    return (
      <div className="battle-resolution" aria-live="polite">
        等待权威动作
      </div>
    );
  return (
    <div className="battle-resolution" aria-live="assertive">
      {event.actions.map((action, index) => {
        const actor = action.actor === "self" ? "我方" : "对手";
        if (action.kind === "attack")
          return (
            <span key={`${actor}-${index}`}>
              <strong>
                {actor}使用{action.skill_name}
              </strong>
              {action.hit
                ? action.effectiveness === "super_effective"
                  ? "，命中且效果拔群"
                  : action.effectiveness === "not_effective"
                    ? "，命中但效果有限"
                    : "，命中"
                : "，未命中"}
              {action.knockout ? "，目标被击倒" : ""}
            </span>
          );
        return (
          <span key={`${actor}-${index}`}>
            <strong>{actor}换入</strong>
            {action.switch_to.name}
          </span>
        );
      })}
    </div>
  );
}

function ActionStatus({
  icon,
  text,
}: {
  icon: ReactNode;
  text: string;
}): ReactNode {
  return (
    <div className="battle-action-status" role="status" aria-live="polite">
      {icon}
      <strong>{text}</strong>
    </div>
  );
}

function SwitchSheet({
  title,
  description,
  candidates,
  disabled,
  close,
  choose,
}: {
  title: string;
  description: string;
  candidates: readonly SelfMember[];
  disabled: boolean;
  close(): void;
  choose(slot: TeamSlot, name: string): void;
}): ReactNode {
  return (
    <div className="battle-sheet-backdrop" role="dialog" aria-modal="true">
      <div className="battle-switch-sheet">
        <button
          type="button"
          className="battle-sheet-close"
          aria-label="关闭换宠选择"
          onClick={close}
        >
          <X />
        </button>
        <h2>{title}</h2>
        <p>{description}</p>
        <SwitchCandidates
          candidates={candidates}
          disabled={disabled}
          choose={(slot, name) => {
            close();
            choose(slot, name);
          }}
        />
      </div>
    </div>
  );
}

function SwitchCandidates({
  candidates,
  disabled,
  choose,
}: {
  candidates: readonly SelfMember[];
  disabled: boolean;
  choose(slot: TeamSlot, name: string): void;
}): ReactNode {
  return (
    <div className="battle-switch-candidates">
      {candidates.map((member) => (
        <button
          key={member.slot}
          type="button"
          disabled={disabled}
          onClick={() => choose(member.slot, member.name)}
        >
          <CatalogImage
            path={member.image_thumbnail_path}
            alt={member.name}
            variant="thumbnail"
            loading="lazy"
          />
          <strong>{member.name}</strong>
          <span>
            HP {member.current_hp} / {member.max_hp}
          </span>
        </button>
      ))}
    </div>
  );
}
