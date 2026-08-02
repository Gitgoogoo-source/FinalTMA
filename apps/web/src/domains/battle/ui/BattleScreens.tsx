import {
  ArrowLeft,
  Check,
  Clock3,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Swords,
  UserRound,
  X,
} from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";
import type {
  BattleCurrentResult,
  BattleEntryTier,
  BattleLobbyDto,
  BattleParticipation,
  BattleRoomSnapshotDto,
  RouteOutput,
} from "@pokepets/api-contracts/app";

import { Button, CatalogImage } from "../../../shared/ui/index.tsx";
import {
  battleRarityLabels,
  battleResultLabels,
  battleStatusLabels,
  formatBattleTime,
  tierTitle,
} from "../labels.ts";
import { BattleModal } from "./BattleModal.tsx";
import { TeamSelector, type BattleTeamSlots } from "./TeamSelector.tsx";

type TeamOption = RouteOutput<"battle.team_options">["items"][number];
type InviteRoom = Extract<
  RouteOutput<"battle.current_invite">,
  { room_id: string }
>;

export function BattleHome({
  tiers,
  participation,
  loading,
  onChooseTier,
  onRefresh,
}: {
  tiers: readonly BattleEntryTier[];
  participation: BattleParticipation | null;
  loading: boolean;
  onChooseTier(tier: BattleEntryTier["id"]): void;
  onRefresh(): void;
}): ReactNode {
  const [selectedTierId, setSelectedTierId] = useState<
    BattleEntryTier["id"] | null
  >(null);
  const selectedTier =
    tiers.find((tier) => tier.id === selectedTierId) ??
    tiers.find((tier) => tier.entry_fee === 100) ??
    tiers[0] ??
    null;
  const selectionDisabled = loading || Boolean(participation);

  return (
    <div className="battle-home">
      <section className="battle-home-hero">
        <div className="battle-home-hero-copy">
          <h1>1v1 BATTLE</h1>
          <p>胜者拿走奖池</p>
        </div>
        <BattleHomePixelDuel />
      </section>

      {participation ? (
        <section className="battle-participation-notice" aria-live="polite">
          <div>
            <Radio />
            <span>
              <strong>{battleStatusLabels[participation.status]}</strong>
              当前入场费 {participation.entry_fee} K-coin
            </span>
          </div>
          <Button onClick={onRefresh}>
            <RefreshCw />
            恢复当前 Battle
          </Button>
        </section>
      ) : null}

      <section className="battle-tier-stage" aria-label="Battle 入场费档位">
        <div className="battle-tier-list">
          {tiers.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className={selectedTier?.id === tier.id ? "selected" : ""}
              data-entry-fee={tier.entry_fee}
              disabled={selectionDisabled}
              aria-pressed={selectedTier?.id === tier.id}
              onClick={() => setSelectedTierId(tier.id)}
            >
              <span className="battle-tier-selected" aria-hidden="true">
                <Check />
              </span>
              <span className="battle-tier-summary">
                奖池金额：{tier.pool}
                <span aria-hidden="true">　</span>
                门票：{tierTitle(tier)}
              </span>
            </button>
          ))}
        </div>
        <Button
          className="battle-tier-submit"
          disabled={selectionDisabled || selectedTier === null}
          onClick={() => selectedTier && onChooseTier(selectedTier.id)}
        >
          <Swords />
          {selectedTier ? `选择队伍 · ${tierTitle(selectedTier)}` : "选择队伍"}
        </Button>
      </section>
    </div>
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
  onChange,
  onBack,
  onConfirm,
}: {
  tier: BattleEntryTier;
  items: readonly TeamOption[];
  slots: BattleTeamSlots;
  balance: number | null;
  loading: boolean;
  disabled: boolean;
  onChange(slots: BattleTeamSlots): void;
  onBack(): void;
  onConfirm(): void;
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
        title="排列三宠队伍"
        description={`固定入场费 ${tier.entry_fee} K-coin，第 1 位自动首发。`}
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
          当前可用 K-coin <strong>{balance ?? "—"}</strong>
        </span>
        <Button disabled={disabled || !complete || loading} onClick={onConfirm}>
          <Swords />
          {disabled ? "正在确认原操作" : `确认创建 · ${tier.entry_fee}`}
        </Button>
      </div>
    </div>
  );
}

export function BattlePreparingShare({
  snapshot,
  remainingSeconds,
  progressPercent,
  onRefresh,
}: {
  snapshot: BattleRoomSnapshotDto;
  remainingSeconds: number | null;
  progressPercent: number | null;
  onRefresh(): void;
}): ReactNode {
  return (
    <section className="battle-preparing" aria-live="polite">
      <span className="battle-kicker">PREPARING SHARE</span>
      <div className="battle-preparing-orbit">
        <Send />
        <i />
      </div>
      <h1>正在准备挑战卡</h1>
      <p>入场费和三宠占用只以后端事务为准。页面只读取原房间，不会重复创建。</p>
      <div
        className="battle-prepare-progress"
        role="progressbar"
        aria-label="挑战卡准备时限"
        aria-valuemin={0}
        aria-valuemax={60}
        aria-valuenow={
          remainingSeconds === null ? undefined : 60 - remainingSeconds
        }
      >
        <i style={{ width: `${100 - (progressPercent ?? 100)}%` }} />
      </div>
      <strong>{formatBattleTime(remainingSeconds)}</strong>
      <small>房间 {snapshot.room_id.slice(0, 8)}</small>
      <Button className="secondary" onClick={onRefresh}>
        <RefreshCw />
        重新读取服务器状态
      </Button>
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
  return (
    <div className="battle-waiting">
      <BattleScreenHeader
        kicker="WAITING ROOM"
        title="挑战卡已准备"
        description="挑战有效期内始终可被首位合格对手接受；在线状态只作展示。"
      />
      <section className="battle-waiting-stage">
        <div className="battle-waiting-ring">
          <Clock3 />
          <strong>{formatBattleTime(remainingSeconds)}</strong>
          <span>30 分钟等待期</span>
          <small>已锁定入场费 {entryFee} K-coin</small>
        </div>
        <div className="battle-online-line">
          <i className={onlineState} aria-hidden="true" />
          <span>
            {onlineState === "online"
              ? "已进入等待页 · 对手可接受"
              : onlineState === "offline"
                ? "离线展示 · 对手仍可接受"
                : "正在同步展示状态 · 对手仍可接受"}
          </span>
        </div>
        {realtimeOffline ? (
          <p className="battle-offline-note" role="status">
            实时通知不可用，页面正按固定 2 秒间隔通过 REST 回正。
          </p>
        ) : null}
        {shareState ? (
          <p className="battle-share-note" role="status" aria-live="polite">
            {shareState}
          </p>
        ) : null}
        {!shareSupported ? (
          <p className="battle-share-note" role="alert">
            当前 Telegram 版本不支持发送挑战卡，请更新 Telegram 后重试
          </p>
        ) : null}
        <div className="battle-waiting-actions">
          <Button
            disabled={
              !shareSupported || !snapshot.prepared_message_id || commandPending
            }
            onClick={onShare}
          >
            <Send />
            分享挑战卡
          </Button>
          <Button className="secondary" onClick={onRefresh}>
            <RefreshCw />
            刷新状态
          </Button>
          <Button
            className="danger"
            disabled={commandPending}
            onClick={onCancel}
          >
            <X />
            取消挑战
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
      ? "正在恢复连接，在线状态以后端 Presence 确认为准。"
      : onlineState === "offline"
        ? "连接尚未恢复，页面正在读取后端 Presence。"
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
        title="双方等待房间"
        description="数据库确认双方在线并完成 3 秒倒计时后才会创建第 1 回合。"
      />
      <section
        className="battle-lobby-stage"
        aria-live="polite"
        aria-label="双方在线和开战倒计时状态"
      >
        <LobbyPlayer
          side="creator"
          title="邀请者"
          online={creator.online}
          reconnectSeconds={creatorReconnectSeconds}
          imagePath="/assets/catalog/v1/thumb/pet-n-001-1.webp"
        />
        <div className="battle-lobby-versus" aria-label="对战双方">
          <strong>VS</strong>
          <span>等待双方进入房间</span>
        </div>
        <LobbyPlayer
          side="opponent"
          title="被邀请者"
          online={opponent.online}
          reconnectSeconds={opponentReconnectSeconds}
          imagePath="/assets/catalog/v1/thumb/pet-n-002-1.webp"
        />
      </section>
      <section className="battle-lobby-timers" aria-live="polite">
        <div>
          <span>房间剩余时限</span>
          <strong>{formatBattleTime(remainingSeconds)}</strong>
        </div>
        <div>
          <span>服务器开战倒计时</span>
          <strong>尚未开始</strong>
        </div>
      </section>
      {recoveryMessage ? (
        <p className="battle-offline-note" role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {realtimeOffline ? (
        <p className="battle-offline-note" role="status">
          实时通知不可用，页面正按固定 2 秒间隔通过 REST 读取权威房间状态。
        </p>
      ) : null}
      <p className="battle-lobby-authority">
        开战、离线终结、退款和藏品释放只由数据库裁决；本页不会提供取消、分享或重新选队。
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
      aria-label="开战倒计时已锁定"
    >
      <div className="battle-countdown-energy red" aria-hidden="true" />
      <div className="battle-countdown-energy blue" aria-hidden="true" />
      <header>
        <span>COMBAT COMMITMENT LOCKED</span>
        <h1>倒计时已锁定</h1>
      </header>
      <div
        className="battle-countdown-core"
        aria-live="assertive"
        aria-atomic="true"
      >
        <span key={display}>{display}</span>
      </div>
      <footer>
        <strong>离开不会取消战斗</strong>
        <span>服务器将在截止时自动进入对战</span>
        {recoveryMessage ? (
          <small role="status">{recoveryMessage}</small>
        ) : null}
        {realtimeOffline ? (
          <small>实时通知暂不可用，数据库倒计时仍会继续</small>
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
  imagePath,
}: {
  side: "creator" | "opponent";
  title: string;
  online: boolean;
  reconnectSeconds: number | null;
  imagePath: string;
}): ReactNode {
  return (
    <article
      className={`battle-lobby-player ${side} ${online ? "online" : "offline"}`}
    >
      <div className="battle-lobby-avatar">
        {online ? (
          <img
            src={imagePath}
            alt={`${title}固定阵营头像`}
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
          ? "已进入房间"
          : `已离线 · 重连剩余 ${formatBattleTime(reconnectSeconds)}`}
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
        title={invalid ? "这张挑战卡不可用" : "没有可接受的挑战"}
        description="页面未发现可支付、可占用藏品的权威邀请。"
        back={onHome}
        disabled={loading}
      />
      <section className="battle-invite-unavailable">
        <h2>{invalid ? "挑战标识无效或已失效" : "当前入口没有有效挑战"}</h2>
        <p>
          前端不会猜测房间或继续提交接受请求。请重新读取权威状态，或返回 Battle
          首页。
        </p>
        <div>
          <Button className="secondary" disabled={loading} onClick={onHome}>
            <ArrowLeft />
            返回首页
          </Button>
          <Button disabled={loading} onClick={onRefresh}>
            <RefreshCw />
            {loading ? "正在读取" : "重新读取"}
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
        title={`${invite.creator_display_name} 发起挑战`}
        description={`固定入场费 ${invite.entry_fee} K-coin。接受前不会公开创建者模板、属性、四维或技能。`}
        back={onHome}
        disabled={disabled}
      />
      <section className="battle-invite-summary">
        {invite.creator_avatar_url ? (
          <img
            src={invite.creator_avatar_url}
            alt={`${invite.creator_display_name}头像`}
            width={64}
            height={64}
          />
        ) : (
          <span aria-hidden="true">
            {invite.creator_display_name.slice(0, 1).toLocaleUpperCase("zh-CN")}
          </span>
        )}
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
            <dt>入场费</dt>
            <dd>{invite.entry_fee}</dd>
          </div>
          <div>
            <dt>剩余</dt>
            <dd>{formatBattleTime(remainingSeconds)}</dd>
          </div>
          <div>
            <dt>创建者</dt>
            <dd>{invite.creator_online ? "在线" : "离线 · 仍可接受"}</dd>
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
          实时通知不可用，接受页正按固定 2 秒间隔通过 REST 回正。
        </p>
      ) : null}
      {!available ? (
        <section className="battle-invite-unavailable">
          <h2>{inviteStatusText(invite.invite_status)}</h2>
          <p>
            页面不会尝试支付或占用藏品。请刷新权威状态，或返回 Battle 首页。
          </p>
          <div>
            <Button className="secondary" onClick={onHome}>
              <ArrowLeft />
              返回首页
            </Button>
            <Button onClick={onRefresh}>
              <RefreshCw />
              重新读取
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
              当前可用 K-coin <strong>{balance ?? "—"}</strong>
            </span>
            <Button
              disabled={disabled || loading || !complete}
              onClick={onConfirm}
            >
              <Check />
              {disabled ? "正在确认原操作" : `确认接受 · ${invite.entry_fee}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function BattleResult({
  result,
  acknowledging,
  onAcknowledge,
}: {
  result: BattleCurrentResult;
  acknowledging: boolean;
  onAcknowledge(): void;
}): ReactNode {
  const refund = result.result === "draw" || result.result === "void";
  return (
    <section
      className={`battle-result ${result.result}`}
      aria-labelledby="battle-result-title"
    >
      <span className="battle-kicker">AUTHORITATIVE RESULT</span>
      <div className="battle-result-mark" aria-hidden="true">
        {result.result === "win" ? <Swords /> : <ShieldCheck />}
      </div>
      <h1 id="battle-result-title">{battleResultLabels[result.result]}</h1>
      <p>对手：{result.opponent_display_name}</p>
      <dl>
        <div>
          <dt>本人入场费</dt>
          <dd>{result.entry_fee} K-coin</dd>
        </div>
        <div>
          <dt>{refund ? "权威退款" : "权威到账"}</dt>
          <dd>{result.payout} K-coin</dd>
        </div>
        <div>
          <dt>净变化</dt>
          <dd>
            {result.net_change > 0 ? "+" : ""}
            {result.net_change} K-coin
          </dd>
        </div>
        <div>
          <dt>平台手续费</dt>
          <dd>{result.fee} K-coin</dd>
        </div>
      </dl>
      <small>结算原因：{result.reason}</small>
      <time dateTime={result.finished_at}>
        {new Intl.DateTimeFormat("zh-CN", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(result.finished_at))}
      </time>
      <Button disabled={acknowledging} onClick={onAcknowledge}>
        <Check />
        {acknowledging ? "正在确认结果" : "确认并返回 Battle 首页"}
      </Button>
    </section>
  );
}

export function BattleResultPending({
  onRefresh,
}: {
  onRefresh(): void;
}): ReactNode {
  return (
    <section className="battle-result" aria-live="polite">
      <span className="battle-kicker">AUTHORITATIVE RESULT</span>
      <div className="battle-result-mark" aria-hidden="true">
        <Clock3 />
      </div>
      <h1>正在读取权威结算</h1>
      <p>房间已经终局。页面不会根据最后一帧生命值推测胜负、退款或到账结果。</p>
      <Button onClick={onRefresh}>
        <RefreshCw />
        重新读取结算
      </Button>
    </section>
  );
}

export function BattleCancelSheet({
  pending,
  backgroundRef,
  onClose,
  onConfirm,
}: {
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
      closeLabel="关闭取消挑战确认"
      onClose={onClose}
    >
      <span className="battle-sheet-kicker">CANCEL CHALLENGE</span>
      <h2 id="battle-cancel-title">取消等待中的挑战？</h2>
      <p>服务端将在同一终结事务中退款并释放三宠占用。前端不会提前宣称成功。</p>
      <div>
        <Button className="secondary" disabled={pending} onClick={onClose}>
          继续等待
        </Button>
        <Button className="danger" disabled={pending} onClick={onConfirm}>
          {pending ? "正在等待服务器裁决" : "确认取消"}
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
          aria-label="返回"
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
    <section className="battle-waiting-team" aria-label="本人锁定队伍">
      {snapshot.self_team.map((member) => (
        <div key={member.slot}>
          <CatalogImage
            path={member.image_thumbnail_path}
            alt={member.name}
            variant="thumbnail"
            loading="lazy"
          />
          <span>{member.slot === 1 ? "首发" : `${member.slot} 号位`}</span>
          <strong>{member.name}</strong>
          <small>
            {battleRarityLabels[member.rarity]} · {member.stage} 阶
          </small>
        </div>
      ))}
    </section>
  );
}

function inviteStatusText(status: InviteRoom["invite_status"]): string {
  const labels: Record<InviteRoom["invite_status"], string> = {
    available: "请选择三宠接受挑战",
    self: "不能接受自己创建的挑战",
    accepted: "挑战已被其他玩家接受",
    cancelled: "挑战已取消",
    expired: "挑战已过期",
    voided: "挑战已安全作废",
  };
  return labels[status];
}
