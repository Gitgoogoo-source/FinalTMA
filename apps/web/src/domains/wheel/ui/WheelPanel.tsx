import {
  ChevronRight,
  Circle,
  Coins,
  Gem,
  ListChecks,
  RotateCw,
  Sparkles,
  Ticket,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app-client";

import { useApiQuery } from "../../../platform/query/index.ts";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { usePageSearchParams } from "../../../shared/navigation/pageActivity.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { StaleContentNotice } from "../../../shared/ui/PageState.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/context.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/context.ts";

type WheelSpinResult = RouteOutput<"wheel.spin">;
type WheelReward = WheelSpinResult["rewards"][number];
type WheelRewardKind = WheelReward["kind"];
type WheelMotion = "idle" | "spinning" | "settling";

type WheelSlot = {
  key: string;
  kind: WheelRewardKind;
  amount: number;
  primary: string;
  secondary: string;
  Icon: LucideIcon;
};

const WHEEL_SLOTS: readonly WheelSlot[] = [
  {
    key: "fgems-20",
    kind: "fgems",
    amount: 20,
    primary: "20",
    secondary: "Fgems",
    Icon: Gem,
  },
  {
    key: "fgems-30",
    kind: "fgems",
    amount: 30,
    primary: "30",
    secondary: "Fgems",
    Icon: Gem,
  },
  {
    key: "fgems-50",
    kind: "fgems",
    amount: 50,
    primary: "50",
    secondary: "Fgems",
    Icon: Gem,
  },
  {
    key: "fgems-100",
    kind: "fgems",
    amount: 100,
    primary: "100",
    secondary: "Fgems",
    Icon: Gem,
  },
  {
    key: "kcoin-10",
    kind: "kcoin",
    amount: 10,
    primary: "10",
    secondary: "K-coin",
    Icon: Coins,
  },
  {
    key: "kcoin-20",
    kind: "kcoin",
    amount: 20,
    primary: "20",
    secondary: "K-coin",
    Icon: Coins,
  },
  {
    key: "kcoin-30",
    kind: "kcoin",
    amount: 30,
    primary: "30",
    secondary: "K-coin",
    Icon: Coins,
  },
  {
    key: "kcoin-50",
    kind: "kcoin",
    amount: 50,
    primary: "50",
    secondary: "K-coin",
    Icon: Coins,
  },
  {
    key: "kcoin-100",
    kind: "kcoin",
    amount: 100,
    primary: "100",
    secondary: "K-coin",
    Icon: Coins,
  },
  {
    key: "free-rare",
    kind: "free_rare_box",
    amount: 1,
    primary: "免费",
    secondary: "稀有",
    Icon: Ticket,
  },
  {
    key: "free-normal",
    kind: "free_normal_box",
    amount: 1,
    primary: "免费",
    secondary: "普通",
    Icon: Ticket,
  },
] as const;

const SECTOR_ANGLE = 360 / WHEEL_SLOTS.length;
const MINIMUM_SPIN_MS = 720;

export function WheelPanel(): ReactNode {
  const { wheelPresentationEpoch } = useOperationRegistry();

  return (
    <WheelPanelRuntime
      key={wheelPresentationEpoch}
      wheelPresentationEpoch={wheelPresentationEpoch}
    />
  );
}

function WheelPanelRuntime({
  wheelPresentationEpoch,
}: {
  wheelPresentationEpoch: number;
}): ReactNode {
  const query = useApiQuery("wheel.get");
  const identity = useApiQuery("identity.bootstrap");
  const { isBlocked, preload, present, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked = isBlocked("wheel.spin");
  const [params, setParams] = usePageSearchParams();
  const heading = useRef<HTMLDivElement>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const activeAnimation = useRef<Animation | null>(null);
  const rotation = useRef(0);
  const mounted = useRef(true);
  const presentationEpoch = useRef(wheelPresentationEpoch);
  const [motion, setMotion] = useState<WheelMotion>("idle");
  const [confirmedState, setConfirmedState] = useState<{
    spin_count: number;
    remaining: number;
    daily_limit: number;
    milestone_10_claimed: boolean;
    milestone_20_claimed: boolean;
  } | null>(null);
  const resumedCount =
    params.get("resume") && params.get("count") === "10"
      ? 10
      : params.get("resume")
        ? 1
        : null;

  const status = confirmedState ?? query.data;
  const spinCount = status?.spin_count ?? 0;
  const remaining = status?.remaining ?? 0;
  const dailyLimit = status?.daily_limit ?? 50;
  const progress = Math.min(100, (spinCount / Math.max(1, dailyLimit)) * 100);
  const interactionLocked = blocked || motion !== "idle";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeAnimation.current?.cancel();
      activeAnimation.current = null;
    };
  }, []);

  useEffect(() => {
    if (params.get("focus") !== "wheel") return;
    return focusTaskTarget(heading.current);
  }, [params]);

  const spin = async (count: 1 | 10) => {
    if (interactionLocked) return;
    const startedPresentationEpoch = presentationEpoch.current;
    const cost = count === 10 ? query.data?.ten_cost : query.data?.single_cost;
    const balance = identity.data?.assets.kcoin.available;
    if (cost !== undefined && balance !== undefined && balance < cost) {
      requestTopup({ kind: "wheel", count }, cost - balance);
      return;
    }

    setMotion("spinning");
    startContinuousSpin(rotor.current, activeAnimation, rotation);
    const startedAt = performance.now();
    const result = await run(
      "幸运转盘正在转动",
      "wheel.spin",
      { count },
      {
        dialog: false,
        retainOnFailure: true,
      },
    );
    await waitFor(
      Math.max(0, MINIMUM_SPIN_MS - (performance.now() - startedAt)),
    );
    if (
      !mounted.current ||
      startedPresentationEpoch !== presentationEpoch.current
    )
      return;

    if (!result) {
      stopAtCurrentRotation(rotor.current, activeAnimation, rotation);
      setMotion("idle");
      present("wheel.spin");
      return;
    }

    const finalReward = [...result.rewards]
      .sort((left, right) => left.order - right.order)
      .at(-1);
    const slotIndex = finalReward ? wheelSlotIndex(finalReward) : 0;
    setConfirmedState({
      spin_count: result.spin_count,
      remaining: result.remaining,
      daily_limit: result.daily_limit,
      milestone_10_claimed: result.milestone.milestone_10_claimed,
      milestone_20_claimed: result.milestone.milestone_20_claimed,
    });
    setMotion("settling");
    await settleOnSlot(rotor.current, activeAnimation, rotation, slotIndex);
    if (
      !mounted.current ||
      startedPresentationEpoch !== presentationEpoch.current
    )
      return;
    setMotion("idle");
    setConfirmedState(null);
    present("wheel.spin");
  };

  return (
    <Card className="game-panel wheel wheel-card">
      <div ref={heading} className="panel-title wheel-title" tabIndex={-1}>
        <Sparkles />
        <div>
          <span>LUCKY WHEEL</span>
          <h2>幸运转盘</h2>
        </div>
        <strong className="wheel-remaining-badge">剩余 {remaining} 次</strong>
      </div>

      {resumedCount && (
        <div className="resume-intent">
          <strong>充值已到账</strong>
          <p>
            已恢复原转盘选择，将按当前余额与今日次数重新确认，不会自动转动。
          </p>
          <Button
            disabled={interactionLocked}
            onPointerDown={() => preload("wheel.spin")}
            onFocus={() => preload("wheel.spin")}
            onClick={() => {
              setParams({});
              void spin(resumedCount);
            }}
          >
            重新确认转动 {resumedCount} 次
          </Button>
        </div>
      )}

      {query.isLoading && query.data === undefined ? (
        <p className="wheel-preparing">转盘准备中…</p>
      ) : query.error && query.data === undefined ? (
        <div className="wheel-preparing">
          <p>转盘暂时没有准备好</p>
          <Button onClick={() => void query.refetch()}>再试一次</Button>
        </div>
      ) : (
        <>
          {query.error ? (
            <StaleContentNotice
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          ) : null}
          <MilestoneProgress
            spinCount={spinCount}
            dailyLimit={dailyLimit}
            progress={progress}
            milestone10Claimed={status?.milestone_10_claimed ?? false}
            milestone20Claimed={status?.milestone_20_claimed ?? false}
          />

          <div
            className={`wheel-stage motion-${motion}`}
            aria-busy={interactionLocked}
            aria-label="包含 11 个奖励格的幸运转盘"
          >
            <Triangle className="wheel-pointer" aria-hidden="true" />
            <div className="wheel-frame">
              {WHEEL_SLOTS.map((slot, index) => (
                <Circle
                  key={`pin-${slot.key}`}
                  className="wheel-pin"
                  style={
                    {
                      "--wheel-pin-angle": `${index * SECTOR_ANGLE}deg`,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                />
              ))}
              <div ref={rotor} className="wheel-rotor">
                {WHEEL_SLOTS.map(({ Icon, ...slot }, index) => (
                  <span
                    key={slot.key}
                    className={`wheel-reward wheel-reward-${slot.kind}`}
                    style={
                      {
                        "--wheel-slot-angle": `${index * SECTOR_ANGLE}deg`,
                      } as CSSProperties
                    }
                  >
                    <Icon aria-hidden="true" />
                    <strong>{slot.primary}</strong>
                    <small>{slot.secondary}</small>
                  </span>
                ))}
              </div>
              <span className="wheel-hub" aria-live="polite">
                <small>{motion === "idle" ? "今日" : "正在转动"}</small>
                <strong>
                  {motion === "idle" ? `${spinCount}/${dailyLimit}` : "…"}
                </strong>
                <RotateCw aria-hidden="true" />
              </span>
            </div>
          </div>

          <div className="wheel-price-line" aria-hidden="true">
            <Coins />
            <span>
              单次 <strong>{query.data?.single_cost ?? 20} K-coin</strong>
            </span>
            <i />
            <span>
              十次 <strong>{query.data?.ten_cost ?? 180} K-coin</strong>
            </span>
          </div>

          <div className="button-row wheel-actions">
            <Button
              disabled={interactionLocked || remaining < 1}
              onPointerDown={() => preload("wheel.spin")}
              onFocus={() => preload("wheel.spin")}
              onClick={() => void spin(1)}
            >
              {interactionLocked
                ? "转动中..."
                : remaining < 1
                  ? "今日次数已用完"
                  : `转动 1 次 · ${query.data?.single_cost ?? 20} K-coin`}
            </Button>
            <Button
              className="secondary"
              disabled={interactionLocked || remaining < 10}
              onPointerDown={() => preload("wheel.spin")}
              onFocus={() => preload("wheel.spin")}
              onClick={() => void spin(10)}
            >
              {interactionLocked
                ? "转动中..."
                : remaining < 10
                  ? "剩余次数不足"
                  : `转动 10 次 · ${query.data?.ten_cost ?? 180} K-coin`}
            </Button>
          </div>

          <details className="wheel-rules">
            <summary>
              <ListChecks aria-hidden="true" />
              查看奖品概率与规则
              <ChevronRight aria-hidden="true" />
            </summary>
            <div className="wheel-rule-grid">
              <span>
                20 Fgems <strong>24%</strong>
              </span>
              <span>
                30 Fgems <strong>17%</strong>
              </span>
              <span>
                50 Fgems <strong>7%</strong>
              </span>
              <span>
                100 Fgems <strong>1.5%</strong>
              </span>
              <span>
                10 K-coin <strong>21%</strong>
              </span>
              <span>
                20 K-coin <strong>12%</strong>
              </span>
              <span>
                30 K-coin <strong>7%</strong>
              </span>
              <span>
                50 K-coin <strong>4%</strong>
              </span>
              <span>
                100 K-coin <strong>2%</strong>
              </span>
              <span>
                免费普通资格 <strong>4.3%</strong>
              </span>
              <span>
                免费稀有资格 <strong>0.2%</strong>
              </span>
              <p>
                转盘格子大小不代表概率。免费资格达到当日上限后，将按规则替换为
                Fgems，并在结果中说明。
              </p>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}

function MilestoneProgress({
  spinCount,
  dailyLimit,
  progress,
  milestone10Claimed,
  milestone20Claimed,
}: {
  spinCount: number;
  dailyLimit: number;
  progress: number;
  milestone10Claimed: boolean;
  milestone20Claimed: boolean;
}): ReactNode {
  return (
    <section className="wheel-progress" aria-label="今日转盘里程碑">
      <p>
        {spinCount >= dailyLimit ? (
          <>今日转盘次数已用完 · 累计奖励已全部获得</>
        ) : spinCount >= 20 ? (
          <>
            累计奖励已全部获得 · 今日还可转
            <strong> {dailyLimit - spinCount}</strong> 次
          </>
        ) : spinCount >= 10 ? (
          <>
            已获得 25 Fgems · 再转 <strong>{20 - spinCount}</strong> 次可获得
            <em> 25 Fgems</em>
          </>
        ) : (
          <>
            再转 <strong>{10 - spinCount}</strong> 次可获得
            <em> 25 Fgems</em>
          </>
        )}
      </p>
      <div className="wheel-progress-rail">
        <i style={{ width: `${progress}%` }} aria-hidden="true" />
        <span
          className="wheel-progress-current"
          style={{ left: `${progress}%` }}
        >
          {spinCount}/{dailyLimit}
        </span>
        <span
          className={`wheel-progress-checkpoint checkpoint-10${milestone10Claimed ? " claimed" : ""}`}
        >
          <strong>10</strong>
          <small>+25 Fgems</small>
        </span>
        <span
          className={`wheel-progress-checkpoint checkpoint-20${milestone20Claimed ? " claimed" : ""}`}
        >
          <strong>20</strong>
          <small>+25 Fgems</small>
        </span>
      </div>
    </section>
  );
}

function wheelSlotIndex(reward: WheelReward): number {
  const kind = reward.replaced_kind ?? reward.kind;
  const amount = reward.replaced_kind ? 1 : reward.amount;
  const index = WHEEL_SLOTS.findIndex(
    (slot) => slot.kind === kind && slot.amount === amount,
  );
  return index < 0 ? 0 : index;
}

function startContinuousSpin(
  element: HTMLDivElement | null,
  animationRef: { current: Animation | null },
  rotationRef: { current: number },
): void {
  if (!element) return;
  animationRef.current?.cancel();
  const start = rotationRef.current;
  element.style.transform = `rotate(${start}deg)`;
  const animation = element.animate(
    [
      { transform: `rotate(${start}deg)` },
      { transform: `rotate(${start + 360}deg)` },
    ],
    {
      duration: prefersReducedMotion() ? 1_100 : 680,
      easing: "linear",
      iterations: Infinity,
    },
  );
  animationRef.current = animation;
}

function stopAtCurrentRotation(
  element: HTMLDivElement | null,
  animationRef: { current: Animation | null },
  rotationRef: { current: number },
): number {
  if (!element) return rotationRef.current;
  const animation = animationRef.current;
  const duration = prefersReducedMotion() ? 1_100 : 680;
  const currentTime =
    animation && typeof animation.currentTime === "number"
      ? animation.currentTime
      : 0;
  const current =
    rotationRef.current + ((currentTime % duration) / duration) * 360;
  animation?.cancel();
  animationRef.current = null;
  rotationRef.current = current;
  element.style.transform = `rotate(${current}deg)`;
  return current;
}

async function settleOnSlot(
  element: HTMLDivElement | null,
  animationRef: { current: Animation | null },
  rotationRef: { current: number },
  slotIndex: number,
): Promise<void> {
  if (!element) return;
  const current = stopAtCurrentRotation(element, animationRef, rotationRef);
  const currentModulo = normalizeDegrees(current);
  const targetModulo = normalizeDegrees(-slotIndex * SECTOR_ANGLE);
  const alignment = normalizeDegrees(targetModulo - currentModulo);
  const reducedMotion = prefersReducedMotion();
  const target = current + (reducedMotion ? 360 : 1_800) + alignment;
  const animation = element.animate(
    [
      { transform: `rotate(${current}deg)` },
      { transform: `rotate(${target}deg)` },
    ],
    {
      duration: reducedMotion ? 560 : 2_200,
      easing: "cubic-bezier(0.12, 0.72, 0.08, 1)",
      fill: "forwards",
    },
  );
  animationRef.current = animation;
  await animation.finished.catch(() => undefined);
  if (animationRef.current !== animation) return;
  element.style.transform = `rotate(${target}deg)`;
  rotationRef.current = target;
  animation.cancel();
  animationRef.current = null;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
