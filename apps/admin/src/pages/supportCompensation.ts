import type { CreateCompensationRequestInput } from "../admin.types";

type CompensationKind =
  | "K-coin"
  | "Fgems"
  | "藏品"
  | "任务奖励补发"
  | "开盒结果补发"
  | "通知";

type CompensationPromptContext = {
  targetUserId: string;
  ticketId?: string | null;
};

type CompensationDraft = CreateCompensationRequestInput & {
  confirmationText: string;
};

const COMPENSATION_KINDS: CompensationKind[] = [
  "K-coin",
  "Fgems",
  "藏品",
  "任务奖励补发",
  "开盒结果补发",
  "通知",
];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function promptCompensationDraft(
  context: CompensationPromptContext,
): CompensationDraft | null {
  const kind = promptCompensationKind();

  if (!kind) {
    return null;
  }

  const draft = buildDraft(kind, context);

  if (!draft) {
    return null;
  }

  if (!window.confirm(draft.confirmationText)) {
    return null;
  }

  return draft;
}

function buildDraft(
  kind: CompensationKind,
  context: CompensationPromptContext,
): CompensationDraft | null {
  switch (kind) {
    case "K-coin":
      return buildCurrencyDraft(context, "K-coin", "KCOIN");
    case "Fgems":
      return buildCurrencyDraft(context, "Fgems", "FGEMS");
    case "藏品":
      return buildItemDraft(context);
    case "任务奖励补发":
      return buildTaskRewardDraft(context);
    case "开盒结果补发":
      return buildDrawResultDraft(context);
    case "通知":
      return buildNotificationDraft(context);
  }
}

function buildCurrencyDraft(
  context: CompensationPromptContext,
  compensationType: "K-coin" | "Fgems",
  currencyCode: "KCOIN" | "FGEMS",
): CompensationDraft | null {
  const amount = promptPositiveNumber(`请输入补偿 ${currencyCode} 数量`);
  if (amount === null) {
    return null;
  }

  const reason = promptRequiredText("请输入补偿原因");
  if (!reason) {
    return null;
  }

  const impactPreview = {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType,
    currencyCode,
    amount,
  };

  return {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType,
    currencyCode,
    amount,
    impactPreview,
    reason,
    confirmationText: formatConfirmation("确认创建货币补偿请求？", impactPreview),
  };
}

function buildItemDraft(
  context: CompensationPromptContext,
): CompensationDraft | null {
  const itemTemplateId = promptRequiredUuid("请输入藏品 template id");
  if (!itemTemplateId) {
    return null;
  }

  const itemFormId = promptOptionalUuid("请输入 form id，可留空");
  if (itemFormId === undefined) {
    return null;
  }

  const reason = promptRequiredText("请输入补偿原因");
  if (!reason) {
    return null;
  }

  const impactPreview = {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "藏品",
    itemTemplateId,
    itemFormId: itemFormId ?? null,
    sourceType: "admin_compensation",
    itemEventType: "admin_granted",
  };

  return {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "item",
    itemTemplateId,
    itemFormId,
    impactPreview,
    reason,
    confirmationText: formatConfirmation("确认创建藏品补偿请求？", impactPreview),
  };
}

function buildTaskRewardDraft(
  context: CompensationPromptContext,
): CompensationDraft | null {
  const sourceTaskProgressId = promptOptionalUuid(
    "请输入原 task progress id；如果没有可留空",
  );
  if (sourceTaskProgressId === undefined) {
    return null;
  }

  const sourceTaskId = sourceTaskProgressId
    ? null
    : promptRequiredUuid("请输入原 task id");
  if (sourceTaskId === undefined) {
    return null;
  }

  const sourceTaskPeriodKey = sourceTaskProgressId
    ? null
    : promptRequiredText("请输入任务 period key");
  if (sourceTaskPeriodKey === undefined) {
    return null;
  }

  const rewardKind = promptRewardKind("任务奖励内容：KCOIN / FGEMS / ITEM");
  if (!rewardKind) {
    return null;
  }

  const baseDraft = buildRewardPayload(context, rewardKind);
  if (!baseDraft) {
    return null;
  }

  const reason = promptRequiredText("请输入任务奖励补发原因");
  if (!reason) {
    return null;
  }

  const impactPreview = {
    ...baseDraft.impactPreview,
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "任务奖励补发",
    sourceTaskProgressId: sourceTaskProgressId ?? null,
    sourceTaskId: sourceTaskId ?? null,
    sourceTaskPeriodKey: sourceTaskPeriodKey ?? null,
  };

  return {
    ...baseDraft,
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "task_reward",
    sourceTaskProgressId: sourceTaskProgressId ?? null,
    sourceTaskId: sourceTaskId ?? null,
    sourceTaskPeriodKey: sourceTaskPeriodKey ?? null,
    impactPreview,
    reason,
    confirmationText: formatConfirmation("确认创建任务奖励补发请求？", impactPreview),
  };
}

function buildDrawResultDraft(
  context: CompensationPromptContext,
): CompensationDraft | null {
  const sourceDrawOrderId = promptOptionalUuid(
    "请输入原 draw order id；如果没有可留空",
  );
  if (sourceDrawOrderId === undefined) {
    return null;
  }

  const sourceStarOrderId = sourceDrawOrderId
    ? null
    : promptRequiredUuid("请输入原 star order id");
  if (sourceStarOrderId === undefined) {
    return null;
  }

  const itemTemplateId = promptRequiredUuid("请输入补发结果 template id");
  if (!itemTemplateId) {
    return null;
  }

  const itemFormId = promptOptionalUuid("请输入 form id，可留空");
  if (itemFormId === undefined) {
    return null;
  }

  const reason = promptRequiredText("请输入开盒结果补发原因");
  if (!reason) {
    return null;
  }

  const impactPreview = {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "开盒结果补发",
    sourceDrawOrderId: sourceDrawOrderId ?? null,
    sourceStarOrderId: sourceStarOrderId ?? null,
    itemTemplateId,
    itemFormId: itemFormId ?? null,
    sourceType: "admin_compensation",
    itemEventType: "admin_granted",
  };

  return {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "draw_result",
    itemTemplateId,
    itemFormId,
    sourceDrawOrderId: sourceDrawOrderId ?? null,
    sourceStarOrderId: sourceStarOrderId ?? null,
    impactPreview,
    reason,
    confirmationText: formatConfirmation("确认创建开盒结果补发请求？", impactPreview),
  };
}

function buildNotificationDraft(
  context: CompensationPromptContext,
): CompensationDraft | null {
  const notificationTitle = promptRequiredText("请输入通知标题");
  if (!notificationTitle) {
    return null;
  }

  const notificationBody = promptRequiredText("请输入通知正文");
  if (!notificationBody) {
    return null;
  }

  const reason = promptRequiredText("请输入通知原因");
  if (!reason) {
    return null;
  }

  const impactPreview = {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "通知",
    notificationType: "admin_compensation",
    notificationTitle,
    notificationBody,
  };

  return {
    targetUserId: context.targetUserId,
    ticketId: context.ticketId ?? null,
    compensationType: "notification",
    notificationTitle,
    notificationBody,
    impactPreview,
    reason,
    confirmationText: formatConfirmation("确认创建通知补偿请求？", impactPreview),
  };
}

function buildRewardPayload(
  context: CompensationPromptContext,
  rewardKind: "KCOIN" | "FGEMS" | "ITEM",
): Pick<
  CompensationDraft,
  | "currencyCode"
  | "amount"
  | "itemTemplateId"
  | "itemFormId"
  | "impactPreview"
> | null {
  if (rewardKind === "ITEM") {
    const itemTemplateId = promptRequiredUuid("请输入奖励藏品 template id");
    if (!itemTemplateId) {
      return null;
    }

    const itemFormId = promptOptionalUuid("请输入 form id，可留空");
    if (itemFormId === undefined) {
      return null;
    }

    return {
      itemTemplateId,
      itemFormId,
      impactPreview: {
        targetUserId: context.targetUserId,
        itemTemplateId,
        itemFormId: itemFormId ?? null,
      },
    };
  }

  const amount = promptPositiveNumber(`请输入补发 ${rewardKind} 数量`);
  if (amount === null) {
    return null;
  }

  return {
    currencyCode: rewardKind,
    amount,
    impactPreview: {
      targetUserId: context.targetUserId,
      currencyCode: rewardKind,
      amount,
    },
  };
}

function promptCompensationKind(): CompensationKind | null {
  const raw = window.prompt(
    `请输入补偿类型：${COMPENSATION_KINDS.join(" / ")}`,
    "K-coin",
  );
  const normalized = raw?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (["kcoin", "k-coin", "k_coin", "k"].includes(normalized)) {
    return "K-coin";
  }

  if (["fgems", "fgem", "f-gems", "f_gems", "f"].includes(normalized)) {
    return "Fgems";
  }

  if (["item", "collectible", "藏品", "nft"].includes(normalized)) {
    return "藏品";
  }

  if (["task", "task_reward", "任务", "任务奖励补发"].includes(normalized)) {
    return "任务奖励补发";
  }

  if (
    ["draw", "draw_result", "open_box", "开盒", "开盒结果补发"].includes(
      normalized,
    )
  ) {
    return "开盒结果补发";
  }

  if (["notification", "notice", "通知"].includes(normalized)) {
    return "通知";
  }

  window.alert("补偿类型不支持。");
  return null;
}

function promptRewardKind(
  message: string,
): "KCOIN" | "FGEMS" | "ITEM" | null {
  const raw = window.prompt(message, "KCOIN");
  const normalized = raw?.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "KCOIN" || normalized === "K-COIN") {
    return "KCOIN";
  }

  if (normalized === "FGEMS" || normalized === "F-GEMS") {
    return "FGEMS";
  }

  if (normalized === "ITEM" || normalized === "COLLECTIBLE") {
    return "ITEM";
  }

  window.alert("奖励内容不支持。");
  return null;
}

function promptPositiveNumber(message: string): number | null {
  const raw = window.prompt(message);

  if (!raw?.trim()) {
    return null;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    window.alert("补偿数量必须为正数。");
    return null;
  }

  return value;
}

function promptRequiredText(message: string): string | undefined {
  const value = window.prompt(message)?.trim();

  if (!value) {
    return undefined;
  }

  return value;
}

function promptRequiredUuid(message: string): string | undefined {
  const value = promptRequiredText(message);

  if (!value) {
    return undefined;
  }

  if (!UUID_RE.test(value)) {
    window.alert("必须输入有效 UUID。");
    return undefined;
  }

  return value;
}

function promptOptionalUuid(message: string): string | null | undefined {
  const value = window.prompt(message)?.trim();

  if (!value) {
    return null;
  }

  if (!UUID_RE.test(value)) {
    window.alert("必须输入有效 UUID，或留空。");
    return undefined;
  }

  return value;
}

function formatConfirmation(
  title: string,
  preview: Record<string, unknown>,
): string {
  return `${title}\n${Object.entries(preview)
    .map(([key, value]) => `${key}: ${formatPreviewValue(value)}`)
    .join("\n")}`;
}

function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}
