import {
  ArrowRight,
  BadgeCheck,
  Copy,
  Gem,
  Gift,
  Send,
  UsersRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { Badge, Button, Card } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

export function ReferralPanel(): ReactNode {
  const query = useApiQuery("referral.get");
  const { isBlocked, run } = useOperationRegistry();
  const [recording, setRecording] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "pending" | "error";
    message: string;
  } | null>(null);
  const blocked = recording || isBlocked("referral.share_event");
  const event = async (name: "copy_link" | "telegram_invite") => {
    const link = query.data?.link ?? "";
    setRecording(true);
    setFeedback(null);
    try {
      if (name === "copy_link") {
        await navigator.clipboard.writeText(link);
        setFeedback({ kind: "success", message: "链接已复制" });
      } else {
        const app = telegram();
        if (!app) {
          setFeedback({ kind: "error", message: "请在 Telegram 内打开" });
          return;
        }
        app.openTelegramLink(
          `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(query.data?.share_text ?? "")}`,
        );
        setFeedback({ kind: "success", message: "已打开 Telegram 分享" });
      }
      const result = await run(
        name === "copy_link" ? "正在记录复制邀请" : "正在记录 Telegram 邀请",
        "referral.share_event",
        { event: name },
        { dialog: false },
      );
      if (!result)
        setFeedback({
          kind: "pending",
          message:
            name === "copy_link"
              ? "链接已复制，任务进度待刷新"
              : "已打开 Telegram 分享，任务进度待刷新",
        });
    } catch {
      setFeedback({
        kind: "error",
        message:
          name === "copy_link"
            ? "复制失败，请稍后重试"
            : "分享失败，请复制邀请链接",
      });
    } finally {
      setRecording(false);
    }
  };
  if (query.isLoading)
    return (
      <Card>
        <p>正在加载邀请数据</p>
      </Card>
    );
  if (query.error)
    return (
      <Card>
        <p>{(query.error as Error).message}</p>
        <Button onClick={() => void query.refetch()}>重新加载</Button>
      </Card>
    );
  return (
    <div className="referral-stack">
      <Card className="invite-card">
        <div className="invite-copy">
          <span>好友邀请奖励</span>
          <h2>
            邀请好友
            <em>一起开盲盒</em>
          </h2>
          <p>好友通过你的链接加入并完成首次有效充值后，你可获得 500 Fgems。</p>
          <div className="invite-benefits">
            <span>
              <Gift aria-hidden="true" />
              <small>首次有效充值</small>
              <strong>邀请人 +500 Fgems</strong>
            </span>
            <span>
              <BadgeCheck aria-hidden="true" />
              <small>5 / 10 阶梯资格</small>
              <strong>
                {Math.min(query.data?.valid_recharge_friends ?? 0, 10)} / 10
                位好友
              </strong>
            </span>
          </div>
        </div>
        <img
          className="invite-art"
          src="/assets/tasks/invite-gifts.png"
          alt="半透明橙色礼盒"
        />
        <div className="invite-actions">
          <Button
            id="task-referral-telegram"
            className="invite-primary"
            disabled={blocked}
            onClick={() => void event("telegram_invite")}
          >
            <Send aria-hidden="true" />
            立即邀请
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            id="task-referral-copy"
            className="secondary invite-copy-button"
            disabled={blocked}
            onClick={() => void event("copy_link")}
          >
            <Copy aria-hidden="true" />
            复制邀请链接
          </Button>
          {feedback ? (
            <p
              className={`invite-feedback ${feedback.kind}`}
              role="status"
              aria-live="polite"
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
      </Card>
      <div className="stats-row">
        <Card>
          <span className="stat-icon">
            <UsersRound aria-hidden="true" />
          </span>
          <Badge>已绑定好友</Badge>
          <strong>{query.data?.bound_friends ?? 0}</strong>
        </Card>
        <Card>
          <span className="stat-icon">
            <BadgeCheck aria-hidden="true" />
          </span>
          <Badge>有效充值好友</Badge>
          <strong>{query.data?.valid_recharge_friends ?? 0}</strong>
        </Card>
        <Card>
          <span className="stat-icon">
            <Gem aria-hidden="true" />
          </span>
          <Badge>累计奖励</Badge>
          <strong>{query.data?.reward_fgems_total ?? 0} Fgems</strong>
        </Card>
      </div>
    </div>
  );
}
