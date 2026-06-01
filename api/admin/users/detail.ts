import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildDataBlock,
  getAdminDb,
  jsonRecord,
  loadProfilesByUserId,
  loadUserById,
  maxIso,
  requireUserId,
  rows,
  sanitizeJson,
  serializeTicket,
  serializeUserProfile,
  SUPPORT_TICKET_COLUMNS,
  type SupportTicketRow,
} from "./_shared.js";

type AdminSchema =
  | "core"
  | "economy"
  | "gacha"
  | "inventory"
  | "market"
  | "payments"
  | "tasks"
  | "onchain"
  | "ops";

type CompensationApprovalRow = {
  id: string;
  target_id: string | null;
  payload: unknown;
  status: string;
  reason: string;
  request_audit_log_id: string | null;
  execute_audit_log_id: string | null;
  created_at: string;
  updated_at: string;
};

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["users:read", "support:read", "admin:read"],
      requireAll: false,
    });

    const db = getAdminDb();
    const userId = requireUserId(req.query.userId ?? req.query.user_id);
    const user = await loadUserById(db, userId);
    const profilesByUserId = await loadProfilesByUserId(db, [userId]);
    const [
      balances,
      payments,
      starPayments,
      drawOrders,
      drawResults,
      inventory,
      listings,
      tasks,
      referrals,
      referralRewards,
      wallets,
      mintQueue,
      flags,
      riskEvents,
      tickets,
      compensationRequests,
    ] = await Promise.all([
      selectMany(
        "economy",
        "user_balances",
        "user_id",
        userId,
        "*",
        "updated_at",
      ),
      selectMany(
        "payments",
        "star_orders",
        "user_id",
        userId,
        "id,status,business_type,business_id,xtr_amount,paid_at,fulfilled_at,created_at,updated_at",
        "updated_at",
      ),
      selectMany(
        "payments",
        "star_payments",
        "user_id",
        userId,
        "id,star_order_id,user_id,telegram_payment_charge_id,provider_payment_charge_id,xtr_amount,currency,paid_at,created_at",
        "created_at",
      ),
      selectMany(
        "gacha",
        "draw_orders",
        "user_id",
        userId,
        "id,box_id,status,quantity,draw_count,total_price_stars,paid_at,opened_at,created_at,updated_at",
        "updated_at",
      ),
      selectMany(
        "gacha",
        "draw_results",
        "user_id",
        userId,
        "id,draw_order_id,item_instance_id,template_id,rarity_code,was_pity,created_at",
        "created_at",
      ),
      selectMany(
        "inventory",
        "item_instances",
        "owner_user_id",
        userId,
        "id,template_id,form_id,serial_no,level,power,status,source_type,nft_mint_status,acquired_at,created_at,updated_at",
        "updated_at",
      ),
      selectMany(
        "market",
        "listings",
        "seller_user_id",
        userId,
        "id,template_id,form_id,rarity_code,status,item_count,remaining_count,unit_price_kcoin,created_at,updated_at",
        "updated_at",
      ),
      selectMany(
        "tasks",
        "user_task_progress",
        "user_id",
        userId,
        "id,task_id,period_key,progress_count,target_count,status,completed_at,claimed_at,created_at,updated_at",
        "updated_at",
      ),
      selectReferralRows(userId),
      selectMany(
        "tasks",
        "referral_rewards",
        "user_id",
        userId,
        "id,referral_id,reward_role,currency_code,amount,status,created_at",
        "created_at",
      ),
      selectMany(
        "core",
        "user_wallets",
        "user_id",
        userId,
        "id,chain,network,address,wallet_app_name,is_primary,status,verified_at,disconnected_at,last_sync_at,created_at,updated_at",
        "updated_at",
      ),
      selectMany(
        "onchain",
        "mint_queue",
        "user_id",
        userId,
        "id,item_instance_id,template_id,form_id,status,attempt_count,max_attempts,next_attempt_at,nft_item_id,tx_hash,created_at,updated_at,completed_at",
        "updated_at",
      ),
      selectMany(
        "core",
        "user_flags",
        "user_id",
        userId,
        "id,flag_code,flag_level,reason,active,starts_at,ends_at,created_by_admin_id,created_at,updated_at",
        "updated_at",
      ),
      selectMany(
        "ops",
        "risk_events",
        "user_id",
        userId,
        "id,event_type,severity,status,source_type,source_id,score_delta,detail,resolved_by_admin_id,resolved_at,created_at",
        "created_at",
      ),
      selectTickets(userId),
      selectCompensationRequests(userId),
    ]);
    const serializedCompensationRequests = compensationRequests.map(
      serializeCompensationRequest,
    );
    const serializedTickets = tickets.map((ticket) => ({
      ...serializeTicket(ticket),
      compensationRequests: serializedCompensationRequests.filter(
        (request) => request.ticketId === ticket.id,
      ),
    }));

    return {
      user: serializeUserProfile(user, profilesByUserId.get(userId) ?? null),
      profile: serializeUserProfile(user, profilesByUserId.get(userId) ?? null),
      balances,
      wallets: wallets.map(redactWallet),
      marketListings: listings,
      market_listings: listings,
      taskProgress: tasks,
      task_progress: tasks,
      referrals,
      mintQueue,
      mint_queue: mintQueue,
      riskEvents: riskEvents.map((row) => ({
        ...row,
        detail: sanitizeJson((row as { detail?: unknown }).detail),
      })),
      risk_events: riskEvents.map((row) => ({
        ...row,
        detail: sanitizeJson((row as { detail?: unknown }).detail),
      })),
      flags,
      supportTickets: serializedTickets,
      support_tickets: serializedTickets,
      compensationRequests: serializedCompensationRequests,
      compensation_requests: serializedCompensationRequests,
      summary: {
        balanceCount: balances.length,
        paymentCount: payments.length,
        starPaymentCount: starPayments.length,
        inventoryCount: inventory.length,
        drawOrderCount: drawOrders.length,
        drawResultCount: drawResults.length,
        marketListingCount: listings.length,
        taskProgressCount: tasks.length,
        walletCount: wallets.length,
        riskEventCount: riskEvents.length,
        supportTicketCount: tickets.length,
        compensationRequestCount: compensationRequests.length,
      },
      sources: {
        assets: "economy.user_balances",
        payments: "payments.star_orders,payments.star_payments",
        gacha: "gacha.draw_orders,gacha.draw_results",
        inventory: "inventory.item_instances",
        support: "ops.support_tickets",
      },
      assets: buildDataBlock(
        "economy.user_balances",
        {
          count: balances.length,
          items: balances,
        },
        latestUpdatedAt(balances),
      ),
      payments: buildDataBlock(
        "payments.star_orders,payments.star_payments",
        summarizePaymentBlock(payments, starPayments),
        maxIso(latestUpdatedAt(payments), latestUpdatedAt(starPayments)),
      ),
      gacha: buildDataBlock(
        "gacha.draw_orders,gacha.draw_results",
        {
          count: drawOrders.length + drawResults.length,
          orderCount: drawOrders.length,
          order_count: drawOrders.length,
          resultCount: drawResults.length,
          result_count: drawResults.length,
          recentOrders: drawOrders.slice(0, 5),
          recent_orders: drawOrders.slice(0, 5),
          recentResults: drawResults.slice(0, 10),
          recent_results: drawResults.slice(0, 10),
          items: [
            ...drawOrders
              .slice(0, 5)
              .map((row) => ({ record_type: "draw_order", ...row })),
            ...drawResults
              .slice(0, 10)
              .map((row) => ({ record_type: "draw_result", ...row })),
          ],
        },
        maxIso(latestUpdatedAt(drawOrders), latestUpdatedAt(drawResults)),
      ),
      inventory: buildDataBlock(
        "inventory.item_instances",
        summarizeRows(inventory, "status"),
        latestUpdatedAt(inventory),
      ),
      market: buildDataBlock(
        "market.listings",
        summarizeRows(listings, "status"),
        latestUpdatedAt(listings),
      ),
      tasks: buildDataBlock(
        "tasks.user_task_progress,tasks.referrals,tasks.referral_rewards",
        {
          taskProgress: summarizeRows(tasks, "status"),
          task_progress: summarizeRows(tasks, "status"),
          referralCount: referrals.length,
          referral_count: referrals.length,
          referralRewardCount: referralRewards.length,
          referral_reward_count: referralRewards.length,
        },
        maxIso(
          latestUpdatedAt(tasks),
          latestUpdatedAt(referrals),
          latestUpdatedAt(referralRewards),
        ),
      ),
      walletsBlock: buildDataBlock(
        "core.user_wallets",
        {
          count: wallets.length,
          items: wallets.map(redactWallet),
        },
        latestUpdatedAt(wallets),
      ),
      wallets_block: buildDataBlock(
        "core.user_wallets",
        {
          count: wallets.length,
          items: wallets.map(redactWallet),
        },
        latestUpdatedAt(wallets),
      ),
      mint: buildDataBlock(
        "onchain.mint_queue",
        summarizeRows(mintQueue, "status"),
        latestUpdatedAt(mintQueue),
      ),
      risk: buildDataBlock(
        "core.user_flags,ops.risk_events",
        {
          flags: flags.map((row) => ({ ...row, metadata: undefined })),
          flagCount: flags.length,
          flag_count: flags.length,
          riskEvents: riskEvents.map((row) => ({
            ...row,
            detail: sanitizeJson((row as { detail?: unknown }).detail),
          })),
          risk_events: riskEvents.map((row) => ({
            ...row,
            detail: sanitizeJson((row as { detail?: unknown }).detail),
          })),
        },
        maxIso(latestUpdatedAt(flags), latestUpdatedAt(riskEvents)),
      ),
      support: buildDataBlock(
        "ops.support_tickets,ops.admin_approval_requests",
        {
          count: tickets.length,
          items: serializedTickets,
          compensationRequests: serializedCompensationRequests,
          compensation_requests: serializedCompensationRequests,
        },
        maxIso(latestUpdatedAt(tickets), latestUpdatedAt(compensationRequests)),
      ),
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

async function selectMany(
  schema: AdminSchema,
  table: string,
  column: string,
  userId: string,
  select: string,
  orderColumn: string,
): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const { data, error } = await db
    .schema(schema)
    .from(table)
    .select(select)
    .eq(column, userId)
    .order(orderColumn, { ascending: false })
    .limit(25);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_DETAIL_LOOKUP_FAILED",
      "用户详情查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return rows<Record<string, unknown>>(data);
}

async function selectReferralRows(
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const { data, error } = await db
    .schema("tasks")
    .from("referrals")
    .select(
      "id,inviter_user_id,invitee_user_id,status,first_open_order_id,qualified_at,rewarded_at,created_at,updated_at",
    )
    .or(`inviter_user_id.eq.${userId},invitee_user_id.eq.${userId}`)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_REFERRALS_LOOKUP_FAILED",
      "邀请数据查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return rows<Record<string, unknown>>(data);
}

async function selectTickets(userId: string): Promise<SupportTicketRow[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .schema("ops")
    .from("support_tickets")
    .select(SUPPORT_TICKET_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_TICKETS_LOOKUP_FAILED",
      "工单查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return rows<SupportTicketRow>(data);
}

async function selectCompensationRequests(
  userId: string,
): Promise<CompensationApprovalRow[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .schema("ops")
    .from("admin_approval_requests")
    .select(
      "id,target_id,payload,status,reason,request_audit_log_id,execute_audit_log_id,created_at,updated_at",
    )
    .eq("action", "user.compensate")
    .eq("target_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_COMPENSATION_LOOKUP_FAILED",
      "补偿申请查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return rows<CompensationApprovalRow>(data);
}

function serializeCompensationRequest(row: CompensationApprovalRow) {
  const payload = jsonRecord(row.payload);
  const requestContext = jsonRecord(payload.request_context);
  const metadata = jsonRecord(payload.metadata);
  const ticketId =
    readText(requestContext.ticket_id) ??
    readText(requestContext.ticketId) ??
    readText(metadata.ticket_id) ??
    null;

  return {
    id: row.id,
    targetUserId: readText(payload.target_user_id) ?? row.target_id,
    target_user_id: readText(payload.target_user_id) ?? row.target_id,
    ticketId,
    ticket_id: ticketId,
    compensationType: readText(payload.compensation_type) ?? "unknown",
    compensation_type: readText(payload.compensation_type) ?? "unknown",
    currencyCode: readText(payload.currency_code),
    currency_code: readText(payload.currency_code),
    amount: payload.amount ?? null,
    itemTemplateId: readText(payload.item_template_id),
    item_template_id: readText(payload.item_template_id),
    sourceType: readText(requestContext.source_type),
    source_type: readText(requestContext.source_type),
    sourceId: readText(requestContext.source_id),
    source_id: readText(requestContext.source_id),
    status: row.status,
    impactPreview: sanitizeJson(requestContext.preview),
    impact_preview: sanitizeJson(requestContext.preview),
    approvalRequestId: row.id,
    approval_request_id: row.id,
    auditLogId: row.execute_audit_log_id ?? row.request_audit_log_id,
    audit_log_id: row.execute_audit_log_id ?? row.request_audit_log_id,
    reason: row.reason,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function summarizeRows(
  rowsValue: Array<Record<string, unknown>>,
  statusKey: string,
) {
  const byStatus: Record<string, number> = {};

  for (const row of rowsValue) {
    const status = String(row[statusKey] ?? "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return {
    count: rowsValue.length,
    items: rowsValue.slice(0, 10),
    byStatus,
    by_status: byStatus,
  };
}

function summarizePaymentBlock(
  starOrders: Array<Record<string, unknown>>,
  starPayments: Array<Record<string, unknown>>,
) {
  const starOrderSummary = summarizeRows(starOrders, "status");
  const starPaymentAmount = starPayments.reduce(
    (total, row) => total + toNumber(row.xtr_amount),
    0,
  );

  return {
    count: starOrders.length + starPayments.length,
    starOrders: starOrderSummary,
    star_orders: starOrderSummary,
    starPaymentCount: starPayments.length,
    star_payment_count: starPayments.length,
    starPaymentXtrAmount: starPaymentAmount,
    star_payment_xtr_amount: starPaymentAmount,
    recentOrders: starOrders.slice(0, 5),
    recent_orders: starOrders.slice(0, 5),
    recentPayments: starPayments.slice(0, 5),
    recent_payments: starPayments.slice(0, 5),
    items: [
      ...starOrders
        .slice(0, 5)
        .map((row) => ({ record_type: "star_order", ...row })),
      ...starPayments
        .slice(0, 5)
        .map((row) => ({ record_type: "star_payment", ...row })),
    ],
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function latestUpdatedAt(
  rowsValue: Array<{ updated_at?: unknown; created_at?: unknown }>,
): string | null {
  return maxIso(
    ...rowsValue.map((row) =>
      typeof row.updated_at === "string"
        ? row.updated_at
        : typeof row.created_at === "string"
          ? row.created_at
          : null,
    ),
  );
}

function redactWallet(row: Record<string, unknown>): Record<string, unknown> {
  const address = typeof row.address === "string" ? row.address : null;

  return {
    ...row,
    address: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null,
  };
}
