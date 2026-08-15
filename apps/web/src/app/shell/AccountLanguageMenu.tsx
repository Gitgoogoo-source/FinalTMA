import { Check, Languages, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { apiRequest } from "../../platform/api/client.ts";
import {
  setAppLanguage,
  synchronizeAccountLanguage,
  tr,
  type AppLanguage,
} from "../../platform/i18n/index.ts";
import { refreshUserState } from "../../platform/query/index.ts";
import { selectionHaptic } from "../../platform/telegram/index.ts";
import { AppModal } from "../../shared/ui/AppModal.tsx";

const options = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
] as const satisfies readonly { value: AppLanguage; label: string }[];

export function AccountLanguageMenu({
  savedLanguage,
  close,
}: {
  savedLanguage: AppLanguage;
  close(): void;
}): ReactNode {
  const [saving, setSaving] = useState<AppLanguage | null>(null);
  const [error, setError] = useState(false);

  const choose = (next: AppLanguage) => {
    if (saving || next === savedLanguage) return;
    const previous = savedLanguage;
    selectionHaptic();
    setError(false);
    setSaving(next);
    setAppLanguage(next);
    void apiRequest("identity.language.update", { preferred_language: next })
      .then((result) => {
        synchronizeAccountLanguage(result.data.preferred_language);
        close();
        void refreshUserState().catch(() => undefined);
      })
      .catch(() => {
        setAppLanguage(previous);
        setError(true);
      })
      .finally(() => setSaving(null));
  };

  return (
    <AppModal
      className="account-language-backdrop"
      labelledBy="account-language-title"
      onClose={saving ? undefined : close}
    >
      <section className="modal account-language-menu">
        <button
          type="button"
          className="account-language-close"
          aria-label={tr("Close account menu", "关闭账号菜单")}
          disabled={Boolean(saving)}
          onClick={close}
        >
          <X />
        </button>
        <span className="account-language-icon" aria-hidden="true">
          <Languages />
        </span>
        <div className="account-language-heading">
          <h2 id="account-language-title">{tr("Language", "语言")}</h2>
          <p>
            {tr(
              "Your choice follows your Telegram account on every device.",
              "语言选择会跟随你的 Telegram 账号，并在所有设备同步。",
            )}
          </p>
        </div>
        <div className="account-language-options" role="radiogroup">
          {options.map((option) => {
            const selected = option.value === savedLanguage;
            const pending = option.value === saving;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={Boolean(saving)}
                className={selected ? "selected" : ""}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {selected || pending ? <Check aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        {error ? (
          <p className="account-language-error" role="alert">
            {tr(
              "We couldn't save your language. Your previous choice is still active.",
              "语言保存失败，已恢复到之前的语言。",
            )}
          </p>
        ) : null}
      </section>
    </AppModal>
  );
}
