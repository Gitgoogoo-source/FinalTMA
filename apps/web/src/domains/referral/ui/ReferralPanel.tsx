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
import {
  inviteGiftArtSizes,
  inviteGiftArtSrcSet,
  inviteGiftArtUrl,
} from "../../../shared/assets/responsiveArt.ts";
import {
  Badge,
  Button,
  Card,
  StaleContentNotice,
} from "../../../shared/ui/index.tsx";

export function ReferralPanel(): ReactNode {
  const query = useApiQuery("referral.get");
  const [inviteArtFallback, setInviteArtFallback] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const event = async (name: "copy_link" | "telegram_invite") => {
    const link = query.data?.link ?? "";
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
    } catch {
      setFeedback({
        kind: "error",
        message:
          name === "copy_link"
            ? "复制失败，请稍后重试"
            : "分享失败，请复制邀请链接",
      });
    }
  };
  if (query.isLoading && query.data === undefined)
    return (
      <Card>
        <p>正在加载邀请数据</p>
      </Card>
    );
  if (query.error && query.data === undefined)
    return (
      <Card>
        <p>{(query.error as Error).message}</p>
        <Button onClick={() => void query.refetch()}>重新加载</Button>
      </Card>
    );
  return (
    <div className="referral-stack">
      {query.error ? (
        <StaleContentNotice
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : null}
      <Card className="invite-card">
        <div className="invite-copy">
          <span>好友邀请奖励</span>
          <h2>
            邀请好友
            <em>一起开盲盒</em>
          </h2>
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
          src={
            inviteArtFallback
              ? "/assets/tasks/invite-gifts.png"
              : inviteGiftArtUrl(512)
          }
          srcSet={inviteArtFallback ? undefined : inviteGiftArtSrcSet()}
          sizes={inviteArtFallback ? undefined : inviteGiftArtSizes}
          alt="半透明橙色礼盒"
          width={768}
          height={576}
          loading="lazy"
          decoding="async"
          onError={() => setInviteArtFallback(true)}
        />
        <div className="invite-actions">
          <Button
            id="task-referral-telegram"
            className="invite-primary"
            onClick={() => void event("telegram_invite")}
          >
            <Send aria-hidden="true" />
            立即邀请
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            id="task-referral-copy"
            className="secondary invite-copy-button"
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
