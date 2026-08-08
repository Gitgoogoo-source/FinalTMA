import { ArrowDownUp, Clock3, Shield, Swords } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import type {
  BattleActionEventDto,
  BattleRoomSnapshotDto,
  BattleSelfTeamDto,
} from "@pokepets/api-contracts/app-client";

import { Button, CatalogImage } from "../../../shared/ui/index.tsx";
import { battleRarityLabels, formatBattleTime } from "../labels.ts";
import {
  useBattleAnimation,
  type BattleLocalActionIntent,
} from "../useBattleAnimation.ts";
import { BattleModal } from "./BattleModal.tsx";

type SelfMember = BattleSelfTeamDto[number];
type Skill = SelfMember["skills"][number];
type SkillPosition = Skill["position"];
type TeamSlot = SelfMember["slot"];

export function BattleArena({
  snapshot,
  events,
  localAction,
  cancelledLocalActionKey,
  presentationResetVersion,
  remainingSeconds,
  actionIntent,
  commandPending,
  switchOpen,
  modalActive,
  modalBackgroundRef,
  setSwitchOpen,
  onPresentationBusyChange,
  onAttack,
  onSwitch,
  onReplaceAttack,
}: {
  snapshot: BattleRoomSnapshotDto;
  events: readonly BattleActionEventDto[];
  localAction: BattleLocalActionIntent | null;
  cancelledLocalActionKey: string | null;
  presentationResetVersion: number;
  remainingSeconds: number | null;
  actionIntent: string | null;
  commandPending: boolean;
  switchOpen: boolean;
  modalActive: boolean;
  modalBackgroundRef: RefObject<HTMLElement | null>;
  setSwitchOpen(open: boolean): void;
  onPresentationBusyChange(busy: boolean): void;
  onAttack(position: SkillPosition, name: string, effectKey: string): void;
  onSwitch(slot: TeamSlot, name: string): void;
  onReplaceAttack(
    slot: TeamSlot,
    position: SkillPosition,
    name: string,
    effectKey: string,
  ): void;
}): ReactNode {
  const arenaRef = useRef<HTMLDivElement>(null);
  const actionIdentity = `${snapshot.room_id}:${snapshot.round_no}:${snapshot.action_ordinal}:${snapshot.active_action_mode}:${presentationResetVersion}`;
  const [replacementSelection, setReplacementSelection] = useState<{
    actionIdentity: string;
    slot: TeamSlot | null;
  }>({ actionIdentity, slot: null });
  const replacementSlot =
    replacementSelection.actionIdentity === actionIdentity
      ? replacementSelection.slot
      : null;
  const authoritySelfActive = snapshot.self_team.find(
    (member) => member.active,
  );
  const candidates = snapshot.self_team.filter(
    (member) => member.alive && !member.active,
  );
  const selectedReplacement = snapshot.self_team.find(
    (member) => member.slot === replacementSlot && member.alive,
  );
  const available =
    snapshot.status === "active_turn" &&
    snapshot.active_actor === "self" &&
    snapshot.viewer_action_state === "available" &&
    !commandPending;
  const waitingForOpponent =
    !actionIntent &&
    snapshot.status === "active_turn" &&
    snapshot.active_actor === "opponent";
  const presentation = useBattleAnimation({
    arenaRef,
    snapshot,
    events,
    localAction,
    cancelledLocalActionKey,
    resetVersion: presentationResetVersion,
    onBusyChange: onPresentationBusyChange,
  });
  const selfActive =
    selectedReplacement ??
    presentation.selfTeam.find((member) => member.active);
  const opponentActive = presentation.opponentTeam.find(
    (member) => member.active,
  );
  return (
    <section
      ref={arenaRef}
      className="battle-arena"
      data-battle-phase={snapshot.status}
      data-battle-has-resolution={presentation.feedback ? "true" : "false"}
      aria-label="Battle 单战场"
    >
      <header className="battle-turn-hud">
        <span>
          <Swords />第 {Math.max(1, snapshot.round_no)} / 20 回合 · 行动
          {Math.max(1, snapshot.action_ordinal)}
        </span>
        <strong>
          <Clock3 />
          {formatBattleTime(remainingSeconds)}
        </strong>
        <span className="battle-side-chip">
          {snapshot.active_actor === "self"
            ? "轮到我方"
            : snapshot.active_actor === "opponent"
              ? "轮到对手"
              : snapshot.side === "creator"
                ? "创建方"
                : "接受方"}
        </span>
      </header>

      <ArenaSide
        actor="opponent"
        label="对手"
        team={presentation.opponentTeam}
        active={opponentActive}
      />

      <div className="battle-stage-feedback">
        <div
          className="battle-effect-layer"
          data-battle-effect-layer
          aria-hidden="true"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <i key={index} data-effect-piece={index + 1} />
          ))}
        </div>
        <ActionFeedback event={presentation.feedback} />
        <small>
          {presentation.busy
            ? "动作正在按服务端顺序播放；操作区保持可用"
            : snapshot.status !== "active_turn"
              ? "服务端已完成战斗结算"
              : snapshot.active_actor === "self"
                ? "你的 15 秒行动窗口已经开放"
                : "等待对手在其 15 秒行动窗口内操作"}
        </small>
      </div>

      <ArenaSide
        actor="self"
        label="我方"
        team={presentation.selfTeam}
        active={selfActive}
      />

      <section
        className="battle-action-hud"
        aria-label="当前行动"
        data-waiting-for-opponent={waitingForOpponent ? "true" : "false"}
      >
        <div className="battle-command-strip" aria-live="polite">
          <strong>{actionPrompt(snapshot, actionIntent)}</strong>
          <span>
            回合 {Math.max(1, snapshot.round_no)} · 行动
            {Math.max(1, snapshot.action_ordinal)} ·{" "}
            {formatBattleTime(remainingSeconds)}
          </span>
        </div>

        {available &&
        !actionIntent &&
        snapshot.active_action_mode === "normal" &&
        authoritySelfActive ? (
          <>
            <SkillGrid
              skills={authoritySelfActive.skills}
              disabled={!available}
              choose={onAttack}
            />
            <Button
              className="secondary battle-switch-trigger"
              disabled={!available || candidates.length === 0}
              onClick={() => setSwitchOpen(true)}
            >
              <ArrowDownUp />
              更换宠物
            </Button>
          </>
        ) : available &&
          !actionIntent &&
          snapshot.active_action_mode === "replace_attack" ? (
          <ReplacementAction
            candidates={candidates}
            selected={selectedReplacement}
            disabled={!available}
            chooseMember={(slot) =>
              setReplacementSelection({ actionIdentity, slot })
            }
            chooseSkill={onReplaceAttack}
          />
        ) : waitingForOpponent ? null : (
          <ActionStatus
            icon={<Shield />}
            text={
              actionIntent
                ? `已提交：${actionIntent}`
                : snapshot.status !== "active_turn"
                  ? "服务端已结算，等待表现队列完成"
                  : "正在同步当前可用动作"
            }
          />
        )}
      </section>

      {modalActive &&
      switchOpen &&
      snapshot.status === "active_turn" &&
      snapshot.active_action_mode === "normal" ? (
        <SwitchSheet
          title="主动换宠"
          description="选择后立即提交，换宠消耗本次行动且不会同时攻击。"
          candidates={candidates}
          disabled={!available}
          backgroundRef={modalBackgroundRef}
          close={() => setSwitchOpen(false)}
          choose={onSwitch}
        />
      ) : null}
    </section>
  );
}

function actionPrompt(
  snapshot: BattleRoomSnapshotDto,
  actionIntent: string | null,
): string {
  if (actionIntent) return `已提交：${actionIntent}`;
  if (snapshot.status !== "active_turn") return "战斗已由服务器结算";
  if (snapshot.active_actor !== "self") return "等待对手行动";
  return snapshot.active_action_mode === "replace_attack"
    ? "选择存活宠物，再直接选择其反击技能"
    : "选择技能或主动换宠";
}

function SkillGrid({
  skills,
  disabled,
  choose,
}: {
  skills: readonly Skill[];
  disabled: boolean;
  choose(position: SkillPosition, name: string, effectKey: string): void;
}): ReactNode {
  return (
    <div className="battle-skill-grid">
      {skills.map((skill) => (
        <button
          key={skill.skill_id}
          type="button"
          disabled={disabled}
          onClick={() => choose(skill.position, skill.name, skill.effect_key)}
        >
          <span>{skill.name}</span>
          <small>
            威力 {skill.power} · 命中 {skill.accuracy_bps / 100}%
          </small>
        </button>
      ))}
    </div>
  );
}

function ReplacementAction({
  candidates,
  selected,
  disabled,
  chooseMember,
  chooseSkill,
}: {
  candidates: readonly SelfMember[];
  selected: SelfMember | undefined;
  disabled: boolean;
  chooseMember(slot: TeamSlot | null): void;
  chooseSkill(
    slot: TeamSlot,
    position: SkillPosition,
    name: string,
    effectKey: string,
  ): void;
}): ReactNode {
  if (!selected)
    return (
      <div className="battle-replace-action">
        <strong>第一步：选择存活宠物</strong>
        <SwitchCandidates
          candidates={candidates}
          disabled={disabled}
          choose={(slot) => chooseMember(slot)}
        />
      </div>
    );
  return (
    <div className="battle-replace-action">
      <div className="battle-replace-heading">
        <strong>第二步：选择 {selected.name} 的反击技能</strong>
        <button
          type="button"
          disabled={disabled}
          onClick={() => chooseMember(null)}
        >
          重新选宠
        </button>
      </div>
      <SkillGrid
        skills={selected.skills}
        disabled={disabled}
        choose={(position, name, effectKey) =>
          chooseSkill(selected.slot, position, name, effectKey)
        }
      />
    </div>
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
            className={`${member.slot === active?.slot ? "active" : ""} ${member.alive ? "" : "knocked-out"}`}
          >
            <CatalogImage
              url={member.image_thumbnail_url}
              alt={`${member.name}${member.alive ? "" : "，已击倒"}`}
              variant="thumbnail"
              loading="lazy"
            />
            <span>{member.slot}</span>
          </div>
        ))}
      </div>
      {active ? (
        <div key={active.slot} className="battle-active-pet">
          <div className="battle-active-art" data-battle-active-sprite>
            <CatalogImage
              url={active.image_detail_url}
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

function ActionFeedback({
  event,
}: {
  event: BattleActionEventDto | null;
}): ReactNode {
  if (!event)
    return (
      <div className="battle-resolution" aria-live="polite">
        等待权威动作结果
      </div>
    );
  return (
    <div className="battle-resolution" aria-live="assertive">
      {event.actions.map((action, index) => {
        const actor = action.actor === "self" ? "我方" : "对手";
        if (action.kind === "attack") {
          const damage = action.hit
            ? action.actor === "self"
              ? `${Math.max(0, action.target_hp_percent_before - action.target_hp_percent_after).toFixed(2)}% 生命`
              : `${Math.max(0, action.target_current_hp_before - action.target_current_hp_after)} 点伤害`
            : null;
          return (
            <span key={`${actor}-${index}`}>
              <strong>
                {actor}使用{action.skill_name}
              </strong>
              {action.hit
                ? action.effectiveness === "super_effective"
                  ? `，命中并造成 ${damage}，效果拔群`
                  : action.effectiveness === "not_effective"
                    ? `，命中并造成 ${damage}，效果有限`
                    : `，命中并造成 ${damage}`
                : "，未命中"}
              {action.knockout ? "，目标被击倒" : ""}
            </span>
          );
        }
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
  backgroundRef,
  close,
  choose,
}: {
  title: string;
  description: string;
  candidates: readonly SelfMember[];
  disabled: boolean;
  backgroundRef: RefObject<HTMLElement | null>;
  close(): void;
  choose(slot: TeamSlot, name: string): void;
}): ReactNode {
  return (
    <BattleModal
      labelledBy="battle-voluntary-switch-title"
      panelClassName="battle-switch-sheet"
      backgroundRef={backgroundRef}
      dismissible
      closeLabel="关闭换宠选择"
      onClose={close}
    >
      <h2 id="battle-voluntary-switch-title">{title}</h2>
      <p>{description}</p>
      <SwitchCandidates
        candidates={candidates}
        disabled={disabled}
        choose={(slot, name) => {
          close();
          choose(slot, name);
        }}
      />
    </BattleModal>
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
          type="button"
          key={member.slot}
          disabled={disabled}
          onClick={() => choose(member.slot, member.name)}
        >
          <CatalogImage
            url={member.image_thumbnail_url}
            alt={member.name}
            variant="thumbnail"
            loading="lazy"
          />
          <span>
            <strong>{member.name}</strong>
            <small>
              {battleRarityLabels[member.rarity]} · {member.stage} 阶 · HP{" "}
              {member.current_hp}/{member.max_hp}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
