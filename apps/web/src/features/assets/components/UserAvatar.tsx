import { useEffect, useState } from "react";

import { getAssetProfileDisplayName } from "../assets.api";
import type { AssetProfile } from "../assets.types";

type UserAvatarProps = {
  profile: AssetProfile;
};

export function UserAvatar({ profile }: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = getAssetProfileDisplayName(profile);
  const username = profile.username ? `@${profile.username}` : null;
  const canShowImage = Boolean(profile.avatarUrl) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [profile.avatarUrl]);

  return (
    <div className="user-avatar">
      <div className="user-avatar__image" aria-hidden="true">
        {canShowImage ? (
          <img
            alt=""
            decoding="async"
            loading="lazy"
            onError={() => setImageFailed(true)}
            src={profile.avatarUrl ?? undefined}
          />
        ) : (
          <span>{getInitials(displayName)}</span>
        )}
        <span className="user-avatar__status" />
      </div>
      <div className="user-avatar__text">
        <strong>{displayName}</strong>
        {username ? <span>{username}</span> : null}
      </div>
    </div>
  );
}

function getInitials(displayName: string): string {
  const normalized = displayName.replace(/^@/, "").trim();

  if (!normalized) {
    return "玩";
  }

  return Array.from(normalized).slice(0, 2).join("").toUpperCase();
}
