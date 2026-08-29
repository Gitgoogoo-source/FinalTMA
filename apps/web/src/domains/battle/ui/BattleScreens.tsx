import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Gem,
  RefreshCw,
  Send,
  ShieldCheck,
  Swords,
  UserRound,
  X,
} from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";
import type {
  BattleEntryTier,
  BattleLobbyDto,
  BattleParticipation,
  BattleRoomSnapshotDto,
  BattleTerminalResultDto,
  RouteOutput,
} from "@evomypet/api-contracts/app-client";

import { getIdentityInitial } from "../../../shared/identityInitial.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import {
  battleArenaTierLabels,
  battleRarityLabels,
  battleResultLabels,
  formatBattleTime,
  tierTitle,
} from "../labels.ts";
import { BattleModal } from "./BattleModal.tsx";
import { TeamSelector, type BattleTeamSlots } from "./TeamSelector.tsx";
import { formatDate, t, tp } from "../../../platform/i18n/index.ts";

type TeamOption = RouteOutput<"battle.team_options">["items"][number];
type InviteRoom = Extract<
  RouteOutput<"battle.current_invite">,
  { room_id: string }
>;

export function BattleHome({
  tiers,
  loading,
  onChooseTier,
}: {
  tiers: readonly BattleEntryTier[];
  loading: boolean;
  onChooseTier(tier: BattleEntryTier["id"]): void;
}): ReactNode {
  const [selectedTierId, setSelectedTierId] = useState<
    BattleEntryTier["id"] | null
  >(null);
  const selectedTier =
    tiers.find((tier) => tier.id === selectedTierId) ??
    tiers.find((tier) => tier.entry_fee === 100) ??
    tiers[0] ??
    null;
  const selectionDisabled = loading;

  return (
    <div className="battle-home">
      <section className="battle-home-hero">
        <div className="battle-home-hero-copy">
          <h1>1v1 BATTLE</h1>
          <p>{t("胜者拿走奖池")}</p>
        </div>
        <BattleHomePixelDuel />
      </section>

      <section className="battle-tier-stage" aria-label={t("选择战场")}>
        <div className="battle-tier-heading">
          <Swords aria-hidden="true" />
          <h2>{t("选择战场")}</h2>
        </div>
        <div className="battle-tier-list">
          {tiers.map((tier) => {
            const arena = battleArenaTierLabels[tier.id];
            const selected = selectedTier?.id === tier.id;

            return (
              <button
                key={tier.id}
                type="button"
                className={selected ? "selected" : ""}
                data-entry-fee={tier.entry_fee}
                disabled={selectionDisabled}
                aria-label={tp(
                  "{{0}}，稀有度{{1}}，奖池 {{2}} Stars，门票 {{3}} Stars",
                  [t(arena.name), arena.rarity, tier.pool, tier.entry_fee],
                )}
                aria-pressed={selected}
                onClick={() => setSelectedTierId(tier.id)}
              >
                <span className="battle-tier-art" aria-hidden="true" />
                <span className="battle-tier-details">
                  <span className="battle-tier-title-row">
                    <strong>{t(arena.name)}</strong>
                  </span>
                  <span className="battle-tier-rarity-row">
                    <span className="battle-tier-rarity-name">
                      <small>{t("稀有度")}</small>
                      <strong>{arena.rarity}</strong>
                    </span>
                    <span
                      className="battle-tier-rarity-gems"
                      aria-hidden="true"
                    >
                      {Array.from({ length: arena.rarityGems }, (_, index) => (
                        <Gem key={index} />
                      ))}
                    </span>
                  </span>
                  <span className="battle-tier-economy">
                    <span>
                      <small>{t("奖池")}</small>
                      <strong>{tier.pool}</strong>
                    </span>
                    <span>
                      <small>{t("门票")}</small>
                      <strong>{tierTitle(tier)}</strong>
                    </span>
                  </span>
                </span>
                <span className="battle-tier-action" aria-hidden="true">
                  {selected ? <Check /> : <ChevronRight />}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          className="battle-tier-submit"
          disabled={selectionDisabled || selectedTier === null}
          onClick={() => selectedTier && onChooseTier(selectedTier.id)}
        >
          <Swords />
          {selectedTier
            ? tp("选择队伍 · {{0}}", [tierTitle(selectedTier)])
            : t("选择队伍")}
        </Button>
      </section>
    </div>
  );
}

export function BattleAuthorityRecovery(): ReactNode {
  return (
    <section
      className="battle-authority-recovery"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="battle-authority-recovery-emblem" aria-hidden="true">
        <Swords />
      </span>
      <h1>{t("正在找回冒险")}</h1>
      <p>{t("请稍候，伙伴们正在重新集合")}</p>
      <span className="battle-authority-recovery-progress" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </section>
  );
}

function BattleHomePixelDuel(): ReactNode {
  return (
    <div className="battle-pixel-duel" aria-hidden="true">
      <span className="battle-pixel-ground" />
      <svg
        className="battle-pixel-monster battle-pixel-monster-left"
        viewBox="0 0 64 64"
        shapeRendering="crispEdges"
      >
        <path fill="#a53d32" d="M15 36H9v-5H4v-8h5v4h8z" />
        <path
          fill="#6e2d32"
          d="M18 19h6v-8h7v7h12v5h7v8h5v15h-7v8H19v-7h-6V29h5z"
        />
        <path fill="#ec6a3b" d="M20 23h22v5h7v18h-7v5H22v-7h-5V30h3z" />
        <path fill="#ffb24a" d="M23 34h11v13H23z" />
        <path fill="#ffd071" d="M24 35h8v4h-8z" />
        <path fill="#fff8dc" d="M39 27h7v7h-7z" />
        <path fill="#26323a" d="M42 28h4v4h-4zM44 38h8v3h-8z" />
        <path fill="#6e2d32" d="M23 52h8v7H20v-4h3zM39 51h9v8H36v-4h3z" />
        <path fill="#ffb24a" d="M20 15h5V6h5v12H20zM39 17V8h5v4h5v8H39z" />
      </svg>
      <span className="battle-pixel-shot battle-pixel-shot-left" />
      <span className="battle-pixel-impact" />
      <span className="battle-pixel-shot battle-pixel-shot-right" />
      <svg
        className="battle-pixel-monster battle-pixel-monster-right"
        viewBox="0 0 64 64"
        shapeRendering="crispEdges"
      >
        <path fill="#266c66" d="M49 37h6v-6h5v-9h-5v5h-8z" />
        <path
          fill="#25544f"
          d="M14 27h5v-8h8v-6h7v7h12v5h6v21h-6v8H17v-7h-7V34h4z"
        />
        <path fill="#55a968" d="M16 29h7v-5h22v5h5v17h-8v5H20v-6h-6V35h2z" />
        <path fill="#94ce6f" d="M30 35h11v12H30z" />
        <path fill="#d6ee9b" d="M32 36h8v4h-8z" />
        <path fill="#f8ffe5" d="M18 28h7v7h-7z" />
        <path fill="#20363a" d="M18 29h4v4h-4zM12 39h9v3h-9z" />
        <path fill="#25544f" d="M17 51h9v8H14v-4h3zM35 51h9v8H32v-4h3z" />
        <path fill="#86c56d" d="M18 22h-6v-9h5v4h5v7h-4zM39 21v-8h5V8h5v13z" />
      </svg>
    </div>
  );
}

export function BattleTeamSelect({
  tier,
  items,
  slots,
  balance,
  loading,
  disabled,
  matching,
  onChange,
  onBack,
  onMatch,
  onInvite,
}: {
  tier: BattleEntryTier;
  items: readonly TeamOption[];
  slots: BattleTeamSlots;
  balance: number | null;
  loading: boolean;
  disabled: boolean;
  matching: boolean;
  onChange(slots: BattleTeamSlots): void;
  onBack(): void;
  onMatch(): void;
  onInvite(): void;
}): ReactNode {
  const complete = slots.every(
    (value) =>
      value !== null &&
      items.some(
        (item) => item.template_id === value && item.available_quantity > 0,
      ),
  );
  return (
    <div className="battle-team-page">
      <BattleScreenHeader
        kicker="CREATE CHALLENGE"
        title={t("排列三宠队伍")}
        description={tp("固定入场费 {{0}} Stars，第 1 位自动首发。", [
          tier.entry_fee,
        ])}
        back={onBack}
        disabled={disabled}
      />
      <TeamSelector
        items={items}
        slots={slots}
        disabled={disabled}
        loading={loading}
        onChange={onChange}
      />
      <div className="battle-confirm-bar">
        <span>
          {t("当前可用 Stars")} <strong>{balance ?? "—"}</strong>
        </span>
        <div className="battle-confirm-actions">
          <Button
            className="secondary"
            disabled={disabled || !complete || loading}
            onClick={onMatch}
          >
            <Swords />
            {matching
              ? t("正在确认匹配")
              : disabled
                ? t("正在确认原操作")
                : t("随机匹配")}
          </Button>
          <Button
            disabled={disabled || !complete || loading}
            onClick={onInvite}
          >
            <Send />
            {disabled ? t("正在确认原操作") : t("邀请好友")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BattlePreparingShare({
  snapshot,
  remainingSeconds,
  progressPercent,
}: {
  snapshot: BattleRoomSnapshotDto | null;
  remainingSeconds: number | null;
  progressPercent: number | null;
}): ReactNode {
  return (
    <section className="battle-preparing" aria-busy="true" aria-live="polite">
      <span className="battle-kicker">PREPARING SHARE</span>
      <div className="battle-preparing-orbit">
        <Send />
        <i />
      </div>
      <h1>{t("正在准备挑战卡")}</h1>
      <p>{t("挑战卡生成后会自动进入等待页面，请稍候。")}</p>
      {snapshot ? (
        <>
          <div
            className="battle-prepare-progress"
            role="progressbar"
            aria-label={t("挑战卡准备时限")}
            aria-valuemin={0}
            aria-valuemax={60}
            aria-valuenow={
              remainingSeconds === null ? undefined : 60 - remainingSeconds
            }
          >
            <i style={{ width: `${100 - (progressPercent ?? 100)}%` }} />
          </div>
          <strong>{formatBattleTime(remainingSeconds)}</strong>
          <small>{t("请保持当前页面开启")}</small>
        </>
      ) : (
        <>
          <strong>{t("准备中")}</strong>
          <small>{t("正在确认本次队伍，请勿重复操作")}</small>
        </>
      )}
    </section>
  );
}

export function BattleWaiting({
  snapshot,
  entryFee,
  remainingSeconds,
  realtimeOffline,
  onlineState,
  shareState,
  shareSupported,
  commandPending,
  onShare,
  onCancel,
  onRefresh,
}: {
  snapshot: BattleRoomSnapshotDto;
  entryFee: BattleParticipation["entry_fee"];
  remainingSeconds: number | null;
  realtimeOffline: boolean;
  onlineState: "syncing" | "online" | "offline";
  shareState: string | null;
  shareSupported: boolean;
  commandPending: boolean;
  onShare(): void;
  onCancel(): void;
  onRefresh(): void;
}): ReactNode {
  const publicMatch = snapshot.room_mode === "public_match";
  return (
    <div className="battle-waiting">
      <BattleScreenHeader
        kicker="WAITING ROOM"
        title={publicMatch ? t("正在匹配同档对手") : t("挑战卡已准备")}
        description={
          publicMatch
            ? tp("仅匹配 {{0}} Stars 档位；找到对手后自动进入开战倒计时。", [
                entryFee,
              ])
            : t("挑战有效期内始终可被首位合格对手接受；在线状态只作展示。")
        }
      />
      <section className="battle-waiting-stage">
        <div className="battle-waiting-ring">
          <Clock3 />
          <strong>{formatBattleTime(remainingSeconds)}</strong>
          <span>{publicMatch ? t("120 秒匹配期") : t("30 分钟等待期")}</span>
          <small>{tp("已锁定入场费 {{0}} Stars", [entryFee])}</small>
        </div>
        <div className="battle-online-line">
          <i className={onlineState} aria-hidden="true" />
          <span>
            {publicMatch
              ? onlineState === "online"
                ? t("公开房间等待中 · 同档玩家可自动加入")
                : onlineState === "offline"
                  ? t("离线展示 · 房间仍在 120 秒内等待")
                  : t("正在同步匹配状态")
              : onlineState === "online"
                ? t("已进入等待页 · 对手可接受")
                : onlineState === "offline"
                  ? t("离线展示 · 对手仍可接受")
                  : t("正在同步展示状态 · 对手仍可接受")}
          </span>
        </div>
        {realtimeOffline ? (
          <p className="battle-offline-note" role="status">
            {t("实时连接暂不可用，正在自动恢复。")}
          </p>
        ) : null}
        {!publicMatch && shareState ? (
          <p className="battle-share-note" role="status" aria-live="polite">
            {shareState}
          </p>
        ) : null}
        {!publicMatch && !shareSupported ? (
          <p className="battle-share-note" role="alert">
            {t("当前 Telegram 版本不支持发送挑战卡，请更新 Telegram 后重试")}
          </p>
        ) : null}
        <div className="battle-waiting-actions">
          {!publicMatch ? (
            <Button
              disabled={
                !shareSupported ||
                !snapshot.prepared_message_id ||
                commandPending
              }
              onClick={onShare}
            >
              <Send />
              {t("分享挑战卡")}
            </Button>
          ) : null}
          <Button className="secondary" onClick={onRefresh}>
            <RefreshCw />
            {t("刷新状态")}
          </Button>
          <Button
            className="danger"
            disabled={commandPending}
            onClick={onCancel}
          >
            <X />
            {publicMatch ? t("取消匹配") : t("取消挑战")}
          </Button>
        </div>
      </section>
      <SelfTeamSummary snapshot={snapshot} />
    </div>
  );
}

export function BattleLobby({
  lobby,
  remainingSeconds,
  countdownSeconds,
  creatorReconnectSeconds,
  opponentReconnectSeconds,
  realtimeOffline,
  onlineState,
}: {
  lobby: BattleLobbyDto;
  remainingSeconds: number | null;
  countdownSeconds: number | null;
  creatorReconnectSeconds: number | null;
  opponentReconnectSeconds: number | null;
  realtimeOffline: boolean;
  onlineState: "syncing" | "online" | "offline";
}): ReactNode {
  const creator = lobby.presence.creator;
  const opponent = lobby.presence.opponent;
  const recoveryMessage =
    onlineState === "syncing"
      ? t("正在恢复连接，双方在线状态确认中。")
      : onlineState === "offline"
        ? t("连接尚未恢复，正在确认双方在线状态。")
        : null;
  if (lobby.phase === "lobby_countdown")
    return (
      <BattleCountdownLock
        countdownSeconds={countdownSeconds}
        realtimeOffline={realtimeOffline}
        recoveryMessage={recoveryMessage}
      />
    );
  return (
    <div className="battle-lobby">
      <BattleScreenHeader
        kicker="BATTLE LOBBY"
        title={t("双方等待房间")}
        description={t("双方都已准备，并完成 3 秒倒计时后开始第 1 回合。")}
      />
      <section
        className="battle-lobby-stage"
        aria-live="polite"
        aria-label={t("双方在线和开战倒计时状态")}
      >
        <LobbyPlayer
          side="creator"
          title={t("邀请者")}
          online={creator.online}
          reconnectSeconds={creatorReconnectSeconds}
          imageUrl="/assets/pets/pet-silhouette.svg"
        />
        <div className="battle-lobby-versus" aria-label={t("对战双方")}>
          <strong>VS</strong>
          <span>{t("等待双方进入房间")}</span>
        </div>
        <LobbyPlayer
          side="opponent"
          title={t("被邀请者")}
          online={opponent.online}
          reconnectSeconds={opponentReconnectSeconds}
          imageUrl="/assets/pets/pet-silhouette.svg"
        />
      </section>
      <section className="battle-lobby-timers" aria-live="polite">
        <div>
          <span>{t("房间剩余时限")}</span>
          <strong>{formatBattleTime(remainingSeconds)}</strong>
        </div>
        <div>
          <span>{t("开战倒计时")}</span>
          <strong>{t("尚未开始")}</strong>
        </div>
      </section>
      {recoveryMessage ? (
        <p className="battle-offline-note" role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {realtimeOffline ? (
        <p className="battle-offline-note" role="status">
          {t("实时连接暂不可用，正在自动恢复。")}
        </p>
      ) : null}
      <p className="battle-lobby-authority">
        {t(
          "倒计时开始后，离开不会取消战斗；退款和藏品占用将按战斗规则处理。本页不提供取消、分享或重新选队。",
        )}
      </p>
    </div>
  );
}

function BattleCountdownLock({
  countdownSeconds,
  realtimeOffline,
  recoveryMessage,
}: {
  countdownSeconds: number | null;
  realtimeOffline: boolean;
  recoveryMessage: string | null;
}): ReactNode {
  const display =
    countdownSeconds === null
      ? 3
      : countdownSeconds > 0
        ? countdownSeconds
        : "GO";
  return (
    <section
      className="battle-countdown-lock"
      role="dialog"
      aria-modal="true"
      aria-label={t("开战倒计时已锁定")}
    >
      <div className="battle-countdown-energy red" aria-hidden="true" />
      <div className="battle-countdown-energy blue" aria-hidden="true" />
      <header>
        <span>COMBAT COMMITMENT LOCKED</span>
        <h1>{t("倒计时已锁定")}</h1>
      </header>
      <div
        className="battle-countdown-core"
        aria-live="assertive"
        aria-atomic="true"
      >
        <span key={display}>{display}</span>
      </div>
      <footer>
        <strong>{t("离开不会取消战斗")}</strong>
        <span>{t("倒计时结束后将自动进入对战")}</span>
        {recoveryMessage ? (
          <small role="status">{recoveryMessage}</small>
        ) : null}
        {realtimeOffline ? (
          <small>{t("实时连接暂不可用，倒计时仍会继续")}</small>
        ) : null}
      </footer>
    </section>
  );
}

function LobbyPlayer({
  side,
  title,
  online,
  reconnectSeconds,
  imageUrl,
}: {
  side: "creator" | "opponent";
  title: string;
  online: boolean;
  reconnectSeconds: number | null;
  imageUrl: string;
}): ReactNode {
  return (
    <article
      className={`battle-lobby-player ${side} ${online ? "online" : "offline"}`}
    >
      <div className="battle-lobby-avatar">
        {online ? (
          <img
            src={imageUrl}
            alt={tp("{{0}}固定阵营头像", [title])}
            width={112}
            height={112}
          />
        ) : (
          <UserRound aria-hidden="true" />
        )}
        <i aria-hidden="true" />
      </div>
      <strong>{title}</strong>
      <span>
        {online
          ? t("已进入房间")
          : tp("已离线 · 重连剩余 {{0}}", [formatBattleTime(reconnectSeconds)])}
      </span>
    </article>
  );
}

export function BattleInviteMissing({
  invalid,
  loading,
  onHome,
  onRefresh,
}: {
  invalid: boolean;
  loading: boolean;
  onHome(): void;
  onRefresh(): void;
}): ReactNode {
  return (
    <div className="battle-accept">
      <BattleScreenHeader
        kicker="INVITED BATTLE"
        title={invalid ? t("这张挑战卡不可用") : t("没有可接受的挑战")}
        description={t("当前入口没有可接受的挑战。")}
        back={onHome}
        disabled={loading}
      />
      <section className="battle-invite-unavailable">
        <h2>
          {invalid ? t("挑战标识无效或已失效") : t("当前入口没有有效挑战")}
        </h2>
        <p>{t("无法确认当前挑战状态，请刷新后重试，或返回 Battle 首页。")}</p>
        <div>
          <Button className="secondary" disabled={loading} onClick={onHome}>
            <ArrowLeft />
            {t("返回首页")}
          </Button>
          <Button disabled={loading} onClick={onRefresh}>
            <RefreshCw />
            {loading ? t("正在刷新") : t("重新刷新")}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function BattleAccept({
  invite,
  items,
  slots,
  balance,
  remainingSeconds,
  loading,
  disabled,
  realtimeOffline,
  resumeNotice,
  onChange,
  onConfirm,
  onHome,
  onRefresh,
}: {
  invite: InviteRoom;
  items: readonly TeamOption[];
  slots: BattleTeamSlots;
  balance: number | null;
  remainingSeconds: number | null;
  loading: boolean;
  disabled: boolean;
  realtimeOffline: boolean;
  resumeNotice: string | null;
  onChange(slots: BattleTeamSlots): void;
  onConfirm(): void;
  onHome(): void;
  onRefresh(): void;
}): ReactNode {
  const available = invite.invite_status === "available";
  const complete = slots.every(
    (value) =>
      value !== null &&
      items.some(
        (item) => item.template_id === value && item.available_quantity > 0,
      ),
  );
  return (
    <div className="battle-accept">
      <BattleScreenHeader
        kicker="INVITED BATTLE"
        title={tp("{{0}} 发起挑战", [invite.creator_display_name])}
        description={tp(
          "固定入场费 {{0}} Stars。接受前不会公开创建者模板、属性、四维或技能。",
          [invite.entry_fee],
        )}
        back={onHome}
        disabled={disabled}
      />
      <section className="battle-invite-summary">
        <span aria-hidden="true">
          {getIdentityInitial(invite.creator_display_name)}
        </span>
        <div>
          <strong>{invite.creator_display_name}</strong>
          <p>
            {invite.rarity_summary
              .map(
                (item) => `${battleRarityLabels[item.rarity]} ×${item.count}`,
              )
              .join("、")}
          </p>
        </div>
        <dl>
          <div>
            <dt>{t("入场费")}</dt>
            <dd>{invite.entry_fee}</dd>
          </div>
          <div>
            <dt>{t("剩余")}</dt>
            <dd>{formatBattleTime(remainingSeconds)}</dd>
          </div>
          <div>
            <dt>{t("创建者")}</dt>
            <dd>{invite.creator_online ? t("在线") : t("离线 · 仍可接受")}</dd>
          </div>
        </dl>
      </section>
      {resumeNotice ? (
        <p className="battle-resume-note" role="status">
          {resumeNotice}
        </p>
      ) : null}
      {realtimeOffline ? (
        <p className="battle-offline-note" role="status">
          {t("实时连接暂不可用，正在自动恢复。")}
        </p>
      ) : null}
      {!available ? (
        <section className="battle-invite-unavailable">
          <h2>{inviteStatusText(invite.invite_status)}</h2>
          <p>
            {t("页面不会支付或占用藏品。请刷新最新状态，或返回 Battle 首页。")}
          </p>
          <div>
            <Button className="secondary" onClick={onHome}>
              <ArrowLeft />
              {t("返回首页")}
            </Button>
            <Button onClick={onRefresh}>
              <RefreshCw />
              {t("重新读取")}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <TeamSelector
            items={items}
            slots={slots}
            disabled={disabled}
            loading={loading}
            onChange={onChange}
          />
          <div className="battle-confirm-bar">
            <span>
              {t("当前可用 Stars")} <strong>{balance ?? "—"}</strong>
            </span>
            <Button
              disabled={disabled || loading || !complete}
              onClick={onConfirm}
            >
              <Check />
              {disabled
                ? t("正在确认原操作")
                : tp("确认接受 · {{0}}", [invite.entry_fee])}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function BattleResult({
  result,
  onReturnHome,
}: {
  result: BattleTerminalResultDto;
  onReturnHome(): void;
}): ReactNode {
  const refund = result.result === "draw" || result.result === "void";
  return (
    <section
      className={`battle-result ${result.result}`}
      aria-labelledby="battle-result-title"
    >
      <span className="battle-kicker">BATTLE RESULT</span>
      <div className="battle-result-mark" aria-hidden="true">
        {result.result === "win" ? <Swords /> : <ShieldCheck />}
      </div>
      <h1 id="battle-result-title">{battleResultLabels[result.result]}</h1>
      <p>{tp("对手：{{0}}", [result.opponent_display_name])}</p>
      <dl>
        <div>
          <dt>{t("本人入场费")}</dt>
          <dd>{result.entry_fee} Stars</dd>
        </div>
        <div>
          <dt>{refund ? t("已退款") : t("本次到账")}</dt>
          <dd>{result.payout} Stars</dd>
        </div>
        <div>
          <dt>{t("净变化")}</dt>
          <dd>
            {result.net_change > 0 ? "+" : ""}
            {result.net_change} Stars
          </dd>
        </div>
        <div>
          <dt>{t("平台手续费")}</dt>
          <dd>{result.fee} Stars</dd>
        </div>
      </dl>
      <small>{tp("结算原因：{{0}}", [result.reason])}</small>
      <time dateTime={result.finished_at}>
        {formatDate(result.finished_at, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </time>
      <Button onClick={onReturnHome}>
        <Check />
        {t("返回 Battle 首页")}
      </Button>
    </section>
  );
}

export function BattleCancelSheet({
  publicMatch,
  pending,
  backgroundRef,
  onClose,
  onConfirm,
}: {
  publicMatch: boolean;
  pending: boolean;
  backgroundRef: RefObject<HTMLElement | null>;
  onClose(): void;
  onConfirm(): void;
}): ReactNode {
  return (
    <BattleModal
      labelledBy="battle-cancel-title"
      panelClassName="battle-cancel-sheet"
      backgroundRef={backgroundRef}
      dismissible
      closeLabel={publicMatch ? t("关闭取消匹配确认") : t("关闭取消挑战确认")}
      onClose={onClose}
    >
      <span className="battle-sheet-kicker">
        {publicMatch ? "CANCEL MATCHING" : "CANCEL CHALLENGE"}
      </span>
      <h2 id="battle-cancel-title">
        {publicMatch ? t("取消正在进行的匹配？") : t("取消等待中的挑战？")}
      </h2>
      <p>{t("确认取消后，将退还入场费并恢复三只参战藏品。")}</p>
      <div>
        <Button className="secondary" disabled={pending} onClick={onClose}>
          {t("继续等待")}
        </Button>
        <Button className="danger" disabled={pending} onClick={onConfirm}>
          {pending ? t("正在取消") : t("确认取消")}
        </Button>
      </div>
    </BattleModal>
  );
}

function BattleScreenHeader({
  kicker,
  title,
  description,
  back,
  disabled = false,
}: {
  kicker: string;
  title: string;
  description: string;
  back?: (() => void) | undefined;
  disabled?: boolean;
}): ReactNode {
  return (
    <header className="battle-screen-header">
      {back ? (
        <button
          type="button"
          aria-label={t("返回")}
          disabled={disabled}
          onClick={back}
        >
          <ArrowLeft />
        </button>
      ) : null}
      <div>
        <span>{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

function SelfTeamSummary({
  snapshot,
}: {
  snapshot: BattleRoomSnapshotDto;
}): ReactNode {
  return (
    <section className="battle-waiting-team" aria-label={t("本人锁定队伍")}>
      {snapshot.self_team.map((member) => (
        <div key={member.slot}>
          <CatalogImage
            url={member.image_thumbnail_url}
            alt={t(member.name)}
            variant="thumbnail"
            loading="lazy"
          />
          <span>
            {member.slot === 1 ? t("首发") : tp("{{0}} 号位", [member.slot])}
          </span>
          <strong>{t(member.name)}</strong>
          <small>
            {tp("{{0}} · {{1}} 阶", [
              battleRarityLabels[member.rarity],
              member.stage,
            ])}
          </small>
        </div>
      ))}
    </section>
  );
}

function inviteStatusText(status: InviteRoom["invite_status"]): string {
  const labels: Record<InviteRoom["invite_status"], string> = {
    available: t("请选择三宠接受挑战"),
    self: t("不能接受自己创建的挑战"),
    accepted: t("挑战已被其他玩家接受"),
    cancelled: t("挑战已取消"),
    expired: t("挑战已过期"),
    voided: t("挑战已安全作废"),
  };
  return labels[status];
}
