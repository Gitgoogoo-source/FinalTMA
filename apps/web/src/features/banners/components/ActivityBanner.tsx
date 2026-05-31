import { ChevronRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import type { ActivityBannerItem } from "../banners.types";

type ActivityBannerProps = {
  banner?: ActivityBannerItem | null;
  label: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
};

export function ActivityBanner({
  banner = null,
  label,
  fallbackTitle,
  fallbackDescription,
}: ActivityBannerProps) {
  if (!banner) {
    if (!fallbackTitle) {
      return null;
    }

    return (
      <section className="market-banner" aria-label={label}>
        <BannerCopy
          description={fallbackDescription ?? null}
          label={label}
          title={fallbackTitle}
        />
      </section>
    );
  }

  const content = (
    <>
      {banner.imageUrl ? (
        <img src={banner.imageUrl} alt="" className="market-banner__image" />
      ) : null}
      <BannerCopy
        description={banner.description}
        label={label}
        title={banner.title}
      />
      {banner.targetHref ? (
        <span className="market-banner__action" aria-hidden="true">
          <ChevronRight size={18} strokeWidth={2.5} />
        </span>
      ) : null}
    </>
  );

  if (!banner.targetHref) {
    return (
      <section className="market-banner" aria-label={label}>
        {content}
      </section>
    );
  }

  if (isExternalHref(banner.targetHref)) {
    return (
      <a
        className="market-banner market-banner--link"
        href={banner.targetHref}
        rel="noreferrer"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return (
    <Link className="market-banner market-banner--link" to={banner.targetHref}>
      {content}
    </Link>
  );
}

function BannerCopy({
  description,
  label,
  title,
}: {
  description: string | null;
  label: string;
  title: string;
}) {
  return (
    <div className="market-banner__copy">
      <span className="market-banner__kicker">
        <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
        {label}
      </span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function isExternalHref(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}
