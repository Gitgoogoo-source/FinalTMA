/* global window, document, HTMLElement */
// Local-only review. Never loads a real account or forwards an API request.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "../src/app/providers/AppProviders.tsx";
import { replaceSession } from "../src/platform/session/store.ts";
import { seedApiQuery } from "../src/platform/query/index.ts";
import { PageQueryActivityProvider } from "../src/platform/query/pageQueryActivity.tsx";
import {
  loadEnglishCatalog,
  setAppLanguage,
  useAppLanguage,
  apiErrorMessage,
} from "../src/platform/i18n/index.ts";
import { NavigationIntentProvider } from "../src/workflows/payment-recovery/NavigationIntentProvider.tsx";
import { OperationRegistryProvider } from "../src/workflows/operation-recovery/OperationRegistryProvider.tsx";
import {
  useOperationCommands,
  useOperationBlocked,
  useOperationNavigationLocked,
} from "../src/workflows/operation-recovery/context.ts";
import { VipDialog } from "../src/domains/vip/ui/VipDialog.tsx";
import { TopupDialog } from "../src/domains/topup/ui/TopupDialog.tsx";
import { EvolutionConfirmationDialog } from "../src/domains/evolution/ui/EvolutionConfirmationDialog.tsx";
import { DecompositionConfirmationDialog } from "../src/domains/decomposition/ui/DecompositionConfirmationDialog.tsx";
import { ExpeditionPanel } from "../src/domains/expedition/ui/ExpeditionPanel.tsx";
import { evolutionRoute } from "../src/domains/evolution/config.ts";
import TelegramChatOnboarding from "../src/workflows/telegram-chat-onboarding/TelegramChatOnboarding.tsx";
import { AppModal } from "../src/shared/ui/AppModal.tsx";
import { EvolutionOperationDialog } from "../src/workflows/operation-recovery/EvolutionOperationDialog.tsx";
import { DialogPlaceholder } from "../src/app/shell/DialogRenderer.tsx";
import "../src/shared/styles/foundation.css";
import "../src/shared/styles/inventory-page.css";
import "../src/shared/styles/game-page.css";
import "../src/shared/styles/evolution-presentation.css";

if (
  !import.meta.env.DEV ||
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
)
  throw new Error("Local dev only");
const lang =
  new URLSearchParams(window.location.search).get("lang") === "zh"
    ? "zh-CN"
    : "en";
await loadEnglishCatalog();
setAppLanguage(lang);
replaceSession({
  token: "local-review-only",
  userId: window.crypto.randomUUID(),
  generation: "dialog-review",
  accountStatus: "normal",
  expiresAt: "2099-01-01T00:00:00Z",
  entryKind: "direct",
  entryHandoffState: "complete",
  entryHandoffCode: null,
  entryHandoffResult: null,
  preferredLanguage: lang,
});
const item = {
  template_id: "PET-N-001-1",
  name: "苔核芽",
  rarity: "common" as const,
  stage: 1 as const,
  chain_id: "CHAIN-N-001",
  chain_type: "normal" as const,
  image_thumbnail_url: "",
  image_detail_url: "",
  combat_power: 101,
  expedition_fgems: 1,
  decompose_fgems: 2,
  total: 12,
  available: 12,
  listed: 0,
  trading: 0,
  expedition: 0,
  minting: 0,
  battling: 0,
};
const topup = {
  products: [50, 500, 1000, 5000, 10000] as (50 | 500 | 1000 | 5000 | 10000)[],
  orders: [],
};
const rules = ["normal", "intermediate", "advanced"].map((tier, i) => ({
  tier: tier as "normal" | "intermediate" | "advanced",
  duration_minutes: 60 * (i + 1),
  daily_limit: 3,
  allowed_rarities: ["common" as const],
}));
const expedition = {
  rules,
  active: [],
  used_today: { normal: 0, intermediate: 0, advanced: 0 },
  server_time: new Date().toISOString(),
};
seedApiQuery("topup.bootstrap", {}, topup);
seedApiQuery(
  "vip.get",
  {},
  {
    active: false,
    benefit_date: "2026-09-10",
    starts_on: null,
    ends_on: null,
    remaining_days: 0,
    renewals_used: 0,
    can_purchase: true,
    can_renew: false,
    fgems_claimed_today: false,
    free_box_claimed_today: false,
    free_box_used_today: false,
    stars_price: 999,
    free_rare_box_available: 0,
    payment_attention_order: null,
  },
);
seedApiQuery("expedition.list", {}, expedition);
for (const rule of rules)
  seedApiQuery(
    "expedition.eligible_items",
    { tier: rule.tier },
    {
      items: [
        item,
        { ...item, template_id: "PET-N-002-1", name: "炽尾核" },
        { ...item, template_id: "PET-N-003-1", name: "晶耳幼刺" },
      ].map((p) => ({ ...p, unit_reward_fgems: 10 })),
    },
  );
let mode: "success" | "unknown" | "failure" = "success";
let posts = 0,
  gets = 0,
  lastId = "",
  lastRoute = "tasks.check_in";
const reward = {
  day: 1,
  reward_kind: "fgems",
  reward_amount: 25,
  claimed: true,
};
const envelope = (
  data: unknown,
  operation_id: string | null = null,
  status = 200,
) =>
  new Response(
    JSON.stringify({
      data,
      operation_id,
      request_id: window.crypto.randomUUID(),
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.href);
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/")
  )
    throw new Error("Review fixture blocked fetch");
  if (init?.method === "POST") {
    posts++;
    lastId = new Headers(init.headers).get("Idempotency-Key") ?? "";
    lastRoute = url.pathname.includes("check-in")
      ? "tasks.check_in"
      : "tasks.claim";
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    if (mode === "unknown") throw new TypeError("Simulated connection loss");
    if (mode === "failure")
      return new Response(
        JSON.stringify({
          error: {
            code: "DATABASE_RPC_FAILED",
            message: "RAW_SQL_INTERNAL_TEST_SECRET",
            retryable: false,
          },
          request_id: window.crypto.randomUUID(),
          operation_id: lastId,
        }),
        { status: 500 },
      );
    return envelope(
      url.pathname.includes("/vip/")
        ? { kind: "fgems", amount: 100, claimed: true }
        : reward,
      lastId,
    );
  }
  if (url.pathname.startsWith("/api/operations/")) {
    gets++;
    return envelope(
      {
        operation_id: lastId,
        use_case: lastRoute,
        status: "succeeded",
        result: reward,
        error_code: null,
        acknowledged_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      lastId,
    );
  }
  if (url.pathname === "/api/expeditions") return envelope(expedition);
  throw new Error(`Review fixture has no GET for ${url.pathname}`);
};
const wait = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const notice = () => document.querySelector(".operation-feedback-card");
function Review() {
  const currentLanguage = useAppLanguage();
  const [view, setView] = useState<string | null>(
    new URLSearchParams(window.location.search).get("view"),
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const { run, present } = useOperationCommands();
  const blocked = useOperationBlocked("tasks.check_in");
  const navLocked = useOperationNavigationLocked();
  const close = () => setView(null);
  const tests = async () => {
    if (running) return;
    setRunning(true);
    const previousTelegram = window.Telegram;
    const report: string[] = [];
    const pass = (message: string) => {
      report.push(`PASS ${message}`);
      setResults([...report]);
    };
    const dismiss = async () => {
      (
        document.querySelector(
          ".operation-feedback-close",
        ) as HTMLElement | null
      )?.click();
      await wait(100);
    };
    try {
      mode = "success";
      posts = 0;
      gets = 0;
      await Promise.all([
        run("签到", "tasks.check_in", {}),
        run("签到", "tasks.check_in", {}),
      ]);
      await wait(300);
      assert(posts === 1, "duplicate POST");
      assert(notice()?.textContent?.includes("25"), "reward quantity missing");
      assert(
        !document.querySelector('[role="dialog"]'),
        "success opened a modal",
      );
      assert(
        !document
          .querySelector("[data-app-shell-background]")
          ?.hasAttribute("inert"),
        "success locked background",
      );
      pass(
        "Double action produces one POST, actual reward, no modal or background lock",
      );
      await wait(4700);
      assert(!notice(), "success did not dismiss");
      pass("Confirmed success dismisses automatically");
      await run(
        "VIP reward",
        "vip.claim_fgems",
        {},
        { dialog: false, retainOnFailure: true },
      );
      present("vip.claim_fgems");
      await wait(250);
      assert(
        notice()?.textContent?.includes("100"),
        "confirmed VIP notice disappeared under StrictMode",
      );
      pass(
        "A completed VIP claim survives StrictMode and shows the confirmed amount",
      );
      await dismiss();
      mode = "unknown";
      await run("签到", "tasks.check_in", {});
      await wait(200);
      const postBefore = posts,
        idBefore = lastId;
      await wait(4700);
      assert(notice(), "unknown expired");
      await run("签到", "tasks.check_in", {});
      assert(posts === postBefore, "unknown resubmitted");
      pass("Unknown result persists and duplicate action sends no POST");
      await dismiss();
      assert(
        document.querySelector(".operation-feedback-resume"),
        "missing resume entry",
      );
      (
        document.querySelector(".operation-feedback-resume") as HTMLElement
      ).click();
      await wait(200);
      assert(notice(), "could not resume hidden result");
      pass("Dismissed unknown result remains accessible without resubmission");
      (
        document.querySelector(".operation-feedback-link") as HTMLElement
      )?.click();
      await wait(500);
      assert(
        gets === 1 && posts === postBefore && lastId === idBefore,
        "recovery mutated request",
      );
      assert(notice()?.textContent?.includes("25"), "recover not successful");
      pass("Recovery queries original operation ID; no repeated reward POST");
      await dismiss();
      setView("vip");
      await wait(100);
      mode = "failure";
      await run("签到", "tasks.check_in", {});
      await wait(200);
      assert(
        !document.body.textContent?.includes("RAW_SQL_INTERNAL_TEST_SECRET"),
        "server text leaked",
      );
      assert(
        notice()?.textContent?.includes(
          apiErrorMessage("DATABASE_RPC_FAILED", ""),
        ),
        "safe copy missing",
      );
      pass("Server technical message replaced with localized player copy");
      assert(
        document.querySelector(
          ".app-modal-backdrop [data-modal-feedback-slot] .operation-feedback-card",
        ),
        "feedback outside modal focus scope",
      );
      assert(
        document.querySelectorAll('[role="dialog"]').length === 1,
        "error stacked a second dialog",
      );
      pass(
        "Error notice stays within an open modal's focus scope, without another modal",
      );
      await dismiss();
      setView(null);
      for (const language of ["en", "zh-CN"] as const) {
        setAppLanguage(language);
        assert(
          !apiErrorMessage("UNLISTED_CODE", "SECRET").includes("SECRET"),
          "unknown source leaked",
        );
      }
      setAppLanguage(lang);
      pass("Both languages hide unknown raw error messages");
      let permissionCalls = 0;
      window.Telegram = {
        WebApp: {
          initDataUnsafe: {
            user: { id: Date.now(), allows_write_to_pm: false },
          },
          isVersionAtLeast: () => true,
          requestWriteAccess: (callback?: (allowed: boolean) => void) => {
            permissionCalls++;
            window.setTimeout(() => callback?.(true), 200);
          },
        } as unknown as TelegramWebApp,
      };
      setView("permission");
      await wait(100);
      assert(permissionCalls === 0, "permission requested on mount");
      const permissionButton = document.querySelector(
        ".chat-permission button",
      ) as HTMLElement;
      permissionButton.click();
      permissionButton.click();
      await wait(300);
      assert(permissionCalls === 1, "duplicate permission request");
      setView(null);
      await wait(100);
      setView("permission");
      await wait(100);
      assert(
        !document.querySelector(".chat-permission button"),
        "accepted permission lost on reopen",
      );
      assert(permissionCalls === 1, "permission repeated on reopen");
      setView(null);
      if (previousTelegram) window.Telegram = previousTelegram;
      else delete window.Telegram;
      pass(
        "Telegram permission requires a click, prevents duplicates and remembers acceptance in this WebView",
      );
      setView("evolution-pending");
      await wait(300);
      assert(
        !document.querySelector(".ceremony-skip"),
        "unconfirmed result allowed skipping",
      );
      await wait(5000);
      assert(
        !document.body.textContent?.includes("保持原形态"),
        "unknown claimed unchanged inventory",
      );
      pass("Evolution waits honestly and cannot skip an unconfirmed result");
      setView(null);
    } catch (error) {
      setResults([...report, `FAIL ${String(error)}`]);
    } finally {
      if (previousTelegram) window.Telegram = previousTelegram;
      else delete window.Telegram;
      setRunning(false);
    }
  };
  return (
    <>
      <main
        className="app-shell"
        data-app-shell-background
        style={{ padding: 24, minHeight: "100dvh", background: "#f8f3e8" }}
      >
        <h1 style={{ fontSize: 22 }}>弹窗本地验收</h1>
        <p>模拟账户、模拟奖励；不会访问业务服务器。宠物缩略图使用缺图回退。</p>
        <p>
          操作锁：{String(blocked)} · 导航锁：{String(navLocked)}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            "vip",
            "topup",
            "evolution",
            "decomposition",
            "expedition",
            "skeleton",
          ].map((name) => (
            <button key={name} onClick={() => setView(name)}>
              {name}
            </button>
          ))}
          <button
            onClick={() =>
              setAppLanguage(currentLanguage === "en" ? "zh-CN" : "en")
            }
          >
            切换语言
          </button>
          <button disabled={running} onClick={() => void tests()}>
            运行回归检查
          </button>
        </div>
        <ol>
          {results.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ol>
        {view === "expedition" ? <ExpeditionPanel /> : null}
        {view === "permission" ? <TelegramChatOnboarding /> : null}
      </main>
      {view === "vip" ? <VipDialog close={close} /> : null}
      {view === "topup" ? (
        <TopupDialog
          close={close}
          request={{
            intent: { kind: "gacha", tier: "normal", draw_count: 1 },
            estimatedGap: 12,
            orderId: null,
          }}
        />
      ) : null}
      {view === "evolution" ? (
        <EvolutionConfirmationDialog
          source={item}
          route={evolutionRoute(item.template_id)!}
          targetImageUrl={undefined}
          availableFgems={1000}
          onCancel={close}
          onConfirm={close}
        />
      ) : null}
      {view === "decomposition" ? (
        <DecompositionConfirmationDialog
          item={item}
          onCancel={close}
          onConfirm={close}
        />
      ) : null}
      {view === "skeleton" ? (
        <DialogPlaceholder kind="vip" failed={false} close={close} />
      ) : null}
      {view === "evolution-pending" ? (
        <AppModal label="Evolution pending">
          <EvolutionOperationDialog
            operationId="0198de70-1234-7123-8123-123456789012"
            phase="unknown"
            input={{ template_id: item.template_id, quantity: 3 }}
            result={null}
            rejectedResult={null}
            errorCode={null}
            busy={false}
            actionError={null}
            onRecover={() => {}}
            onSuccess={close}
            onAcknowledge={close}
          />
        </AppModal>
      ) : null}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <NavigationIntentProvider>
        <PageQueryActivityProvider active={false}>
          <OperationRegistryProvider>
            <Review />
          </OperationRegistryProvider>
        </PageQueryActivityProvider>
      </NavigationIntentProvider>
    </AppProviders>
  </StrictMode>,
);
