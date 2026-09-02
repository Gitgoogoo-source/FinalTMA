import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { t } from "../../platform/i18n/index.ts";
import { useSession } from "../../platform/session/store.ts";
import type { WelcomeReward } from "../session-bootstrap/useBootstrap.ts";
import TelegramChatOnboarding from "../telegram-chat-onboarding/TelegramChatOnboarding.tsx";
import {
  initializeTutorialStatus,
  writeTutorialStatus,
} from "./new-user-gacha-tutorial-storage.ts";
import type { PersistedTutorialStatus } from "./new-user-gacha-tutorial-state.ts";

type TutorialProps = {
  entryNotice: string | null;
  onNoticePresented(): void;
  onPersistCompletion(): void;
  onSettled(status: PersistedTutorialStatus, noticePresented: boolean): void;
};

export default function EntryExperienceCoordinator({
  notice,
  welcomeReward,
}: {
  notice: string | null;
  welcomeReward: WelcomeReward;
}): ReactNode {
  const session = useSession();
  const userId = session?.accountStatus === "normal" ? session.userId : "";
  const [tutorialStatus, setTutorialStatus] = useState(() =>
    userId
      ? initializeTutorialStatus(userId, welcomeReward !== null)
      : "inactive",
  );
  const [tutorial, setTutorial] = useState<ComponentType<TutorialProps> | null>(
    null,
  );
  const [tutorialLoadFailed, setTutorialLoadFailed] = useState(false);
  const [noticeConsumed, setNoticeConsumed] = useState(false);
  const tutorialPending = tutorialStatus === "pending";

  useEffect(() => {
    if (!tutorialPending) return;
    let active = true;
    void import("./NewUserGachaTutorial.tsx")
      .then(({ NewUserGachaTutorial }) => {
        if (active) setTutorial(() => NewUserGachaTutorial);
      })
      .catch(() => {
        if (active) setTutorialLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [tutorialPending]);

  const settle = useCallback(
    (status: PersistedTutorialStatus, noticePresented: boolean) => {
      if (userId) writeTutorialStatus(userId, status);
      if (noticePresented) setNoticeConsumed(true);
      setTutorialStatus(status);
    },
    [userId],
  );
  const consumeNotice = useCallback(() => setNoticeConsumed(true), []);
  const persistCompletion = useCallback(() => {
    if (userId) writeTutorialStatus(userId, "completed");
  }, [userId]);
  const fallbackNotice = tutorialLoadFailed
    ? mergeNotices(t("免费普通盲盒已到账"), notice)
    : notice;
  const Tutorial = tutorial;
  return (
    <>
      {tutorialPending && Tutorial ? (
        <Tutorial
          entryNotice={notice}
          onNoticePresented={consumeNotice}
          onPersistCompletion={persistCompletion}
          onSettled={settle}
        />
      ) : null}
      <TelegramChatOnboarding
        deferred={tutorialPending && !tutorialLoadFailed}
      />
      {(!tutorialPending || tutorialLoadFailed) &&
      fallbackNotice &&
      !noticeConsumed ? (
        <EntryNotice key={fallbackNotice} message={fallbackNotice} />
      ) : null}
    </>
  );
}

function EntryNotice({ message }: { message: string }): ReactNode {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return visible ? <div className="entry-notice">{message}</div> : null;
}

function mergeNotices(first: string, second: string | null): string {
  return second ? `${first} · ${second}` : first;
}
