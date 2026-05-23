import { ChevronRight, Sparkles } from "lucide-react";

export type MarketBannerItem = {
  title: string;
  description: string | null;
  imageUrl: string | null;
  targetHref: string | null;
};

type MarketBannerProps = {
  banner?: MarketBannerItem | null;
};

export function MarketBanner({ banner = null }: MarketBannerProps) {
  if (!banner) {
    return (
      <section className="market-banner" aria-label="市场活动">
        <div className="market-banner__copy">
          <span className="market-banner__kicker">
            <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
            市场活动
          </span>
          <h2>精选藏品交易</h2>
          <p>用 K-coin 购买出售中的藏品，市场状态以服务端返回为准。</p>
        </div>
      </section>
    );
  }

  const content = (
    <>
      {banner.imageUrl ? (
        <img src={banner.imageUrl} alt="" className="market-banner__image" />
      ) : null}
      <div className="market-banner__copy">
        <span className="market-banner__kicker">
          <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
          市场活动
        </span>
        <h2>{banner.title}</h2>
        {banner.description ? <p>{banner.description}</p> : null}
      </div>
      {banner.targetHref ? (
        <span className="market-banner__action" aria-hidden="true">
          <ChevronRight size={18} strokeWidth={2.5} />
        </span>
      ) : null}
    </>
  );

  if (banner.targetHref) {
    return (
      <a className="market-banner market-banner--link" href={banner.targetHref}>
        {content}
      </a>
    );
  }

  return (
    <section className="market-banner" aria-label="市场活动">
      {content}
    </section>
  );
}
