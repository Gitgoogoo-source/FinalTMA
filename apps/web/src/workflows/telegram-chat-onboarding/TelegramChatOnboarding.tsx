import { useRef, useState, type ReactNode } from "react";
import { tr } from "../../platform/i18n/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { telegram } from "../../platform/telegram/index.ts";
import { Button } from "../../shared/ui/Button.tsx";

// Remember only affirmative native callbacks for this WebView, never for backend authorization.
const allowedUsers = new Set<number>();

// Telegram's native permission is requested only from an explicit player click.
export default function TelegramChatOnboarding(): ReactNode {
  const session = useSession();
  const app = telegram();
  const telegramUser = app?.initDataUnsafe.user;
  const [state, setState] = useState<
    "idle" | "pending" | "allowed" | "declined"
  >(
    telegramUser?.allows_write_to_pm ||
      (typeof telegramUser?.id === "number" &&
        allowedUsers.has(telegramUser.id))
      ? "allowed"
      : "idle",
  );
  const pending = useRef(false);
  if (
    session?.accountStatus !== "normal" ||
    session.entryHandoffState !== "complete" ||
    !app?.requestWriteAccess ||
    !app.isVersionAtLeast?.("6.9")
  )
    return null;
  const request = () => {
    if (pending.current || state === "allowed") return;
    pending.current = true;
    setState("pending");
    try {
      app.requestWriteAccess?.((allowed) => {
        if (allowed && typeof telegramUser?.id === "number")
          allowedUsers.add(telegramUser.id);
        pending.current = false;
        setState(allowed ? "allowed" : "declined");
      });
    } catch {
      pending.current = false;
      setState("declined");
    }
  };
  return (
    <section className="chat-permission">
      <strong>{tr("Messages from EvoMyPet", "EvoMyPet 消息")}</strong>
      <p>
        {tr(
          "Allow the game bot to send you messages in Telegram.",
          "允许游戏机器人在 Telegram 中向你发送消息。",
        )}
      </p>
      {state === "allowed" ? (
        <p role="status">{tr("Messages allowed", "已允许发送消息")}</p>
      ) : (
        <>
          <Button
            className="secondary"
            disabled={state === "pending"}
            onClick={request}
          >
            {state === "pending"
              ? tr("Confirm in Telegram", "请在 Telegram 中确认")
              : tr("Allow messages", "允许发送消息")}
          </Button>
          {state === "declined" ? (
            <p role="status">
              {tr(
                "You can enable this whenever you like.",
                "你可以随时在这里开启。",
              )}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
