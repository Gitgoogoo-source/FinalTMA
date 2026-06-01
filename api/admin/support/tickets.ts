import { parseJsonBody } from "../../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  firstQueryValue,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
  toJsonObject,
} from "../_shared.js";
import {
  assertSupportStatusPayload,
  getAdminDb,
  getPage,
  jsonRecord,
  nextCursorFor,
  normalizeSupportStatus,
  normalizeTicketType,
  optionalUuid,
  rows,
  sanitizeJson,
  serializeTicket,
  SUPPORT_TICKET_COLUMNS,
  writeAdminAudit,
  type SupportTicketRow,
} from "../users/_shared.js";

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
  async (req, _res, ctx) => {
    if (req.method === "GET") {
      const admin = await requireAdmin(req, {
        permissions: ["support:read", "users:read", "admin:read"],
        requireAll: false,
      });

      void admin;
      return listTickets(req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: ["support:write", "tickets:write", "admin:write"],
      requireAll: false,
    });

    requireAdminConfirmHeader(req);

    const idempotencyKey = readHeaderIdempotencyKey(req);
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    if (req.method === "POST") {
      return createTicket(body, idempotencyKey, admin, ctx);
    }

    return updateTicket(body, idempotencyKey, admin, ctx);
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

async function listTickets(query: Record<string, unknown>) {
  const db = getAdminDb();
  const { limit, offset } = getPage(query);
  const status = normalizeSupportStatus(query.status);
  const userId = optionalUuid(query.userId ?? query.user_id);
  const assignedAdminId = optionalUuid(
    query.assignedAdminId ?? query.assigned_admin_id,
  );
  const relatedId = optionalUuid(query.relatedId ?? query.related_id);
  const relatedType = firstQueryValue(query.relatedType ?? query.related_type);
  let dbQuery = db
    .schema("ops")
    .from("support_tickets")
    .select(SUPPORT_TICKET_COLUMNS);

  if (status) {
    dbQuery = dbQuery.eq("status", status);
  }

  if (userId) {
    dbQuery = dbQuery.eq("user_id", userId);
  }

  if (assignedAdminId) {
    dbQuery = dbQuery.eq("assigned_admin_id", assignedAdminId);
  }

  if (relatedId) {
    dbQuery = dbQuery.eq("related_id", relatedId);
  }

  if (relatedType) {
    dbQuery = dbQuery.eq("related_type", relatedType);
  }

  const { data, error } = await dbQuery
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_SUPPORT_TICKETS_LOOKUP_FAILED",
      "工单查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const page = nextCursorFor(rows<SupportTicketRow>(data), limit, offset);
  const compensationByTicketId = await loadCompensationRequestsForTickets(
    page.pageRows,
  );

  return {
    items: page.pageRows.map((ticket) => ({
      ...serializeTicket(ticket),
      compensationRequests: compensationByTicketId.get(ticket.id) ?? [],
      compensation_requests: compensationByTicketId.get(ticket.id) ?? [],
    })),
    summary: summarizeTickets(page.pageRows),
    nextCursor: page.nextCursor,
    serverTime: new Date().toISOString(),
  };
}

async function createTicket(
  body: Record<string, unknown>,
  idempotencyKey: string,
  admin: Awaited<ReturnType<typeof requireAdmin>>,
  ctx: Parameters<typeof writeAdminAudit>[0]["ctx"],
) {
  const db = getAdminDb();
  const ticketType = normalizeTicketType(body.ticketType ?? body.ticket_type);
  const subject = normalizeRequiredText(body.subject, "subject");
  const status = normalizeSupportStatus(body.status) ?? "open";
  const resolution = normalizeOptionalText(body.resolution);
  const rejectedReason = normalizeOptionalText(
    body.rejectedReason ?? body.rejectionReason ?? body.rejected_reason,
  );
  const escalationOwner = normalizeOptionalText(
    body.escalationOwner ?? body.escalation_owner,
  );
  const escalationQueue = normalizeOptionalText(
    body.escalationQueue ?? body.escalation_queue,
  );

  assertSupportStatusPayload({
    status,
    resolution,
    rejectedReason,
    escalationOwner,
    escalationQueue,
  });

  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) {
    return {
      item: serializeTicket(existing),
      auditLogId: null,
      idempotent: true,
      serverTime: new Date().toISOString(),
    };
  }

  const insertPayload = {
    user_id: optionalUuid(body.userId ?? body.user_id) ?? null,
    ticket_type: ticketType,
    subject,
    message: normalizeOptionalText(body.message) ?? null,
    status,
    related_type:
      normalizeOptionalText(body.relatedType ?? body.related_type) ?? null,
    related_id: optionalUuid(body.relatedId ?? body.related_id) ?? null,
    assigned_admin_id:
      optionalUuid(body.assignedAdminId ?? body.assigned_admin_id) ?? null,
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
    resolution: resolution ?? null,
    rejected_reason: rejectedReason ?? null,
    escalation_owner: escalationOwner ?? null,
    escalation_queue: escalationQueue ?? null,
    status_reason:
      normalizeOptionalText(body.statusReason ?? body.status_reason) ?? null,
    last_handled_by_admin_id: admin.adminId,
    last_handled_at: new Date().toISOString(),
    metadata: toJsonObject({
      ...jsonRecord(body.metadata),
      idempotency_key: idempotencyKey,
      created_by_admin_id: admin.adminId,
    }),
  };

  const { data, error } = await (
    db.schema("ops").from("support_tickets") as any
  )
    .insert(insertPayload)
    .select(SUPPORT_TICKET_COLUMNS)
    .single();

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_SUPPORT_TICKET_CREATE_FAILED",
      "工单创建失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const ticket = data as SupportTicketRow;
  const auditLogId = await writeAdminAudit({
    db,
    admin,
    ctx,
    action: "support.ticket.create",
    targetTable: "support_tickets",
    targetId: ticket.id,
    beforeState: {},
    afterState: ticket,
    reason: subject,
  });

  return {
    item: serializeTicket(ticket),
    auditLogId,
    idempotent: false,
    serverTime: new Date().toISOString(),
  };
}

async function updateTicket(
  body: Record<string, unknown>,
  idempotencyKey: string,
  admin: Awaited<ReturnType<typeof requireAdmin>>,
  ctx: Parameters<typeof writeAdminAudit>[0]["ctx"],
) {
  const db = getAdminDb();
  const ticketId = normalizeRequiredUuid(
    body.ticketId ?? body.ticket_id,
    "ticketId",
  );
  const before = await loadTicket(ticketId);
  const existingMetadata = jsonRecord(before.metadata);

  if (existingMetadata.last_idempotency_key === idempotencyKey) {
    return {
      item: serializeTicket(before),
      auditLogId: null,
      idempotent: true,
      serverTime: new Date().toISOString(),
    };
  }

  const status = normalizeSupportStatus(body.status) ?? before.status;
  const resolution =
    normalizeOptionalText(body.resolution) ?? before.resolution ?? null;
  const rejectedReason =
    normalizeOptionalText(body.rejectedReason ?? body.rejected_reason) ??
    normalizeOptionalText(body.rejectionReason) ??
    before.rejected_reason ??
    null;
  const escalationOwner =
    normalizeOptionalText(body.escalationOwner ?? body.escalation_owner) ??
    before.escalation_owner ??
    null;
  const escalationQueue =
    normalizeOptionalText(body.escalationQueue ?? body.escalation_queue) ??
    before.escalation_queue ??
    null;
  const handlingResult = jsonRecord(
    body.result ?? body.resolutionResult ?? body.resolution_result,
  );

  assertSupportStatusPayload({
    status,
    resolution,
    rejectedReason,
    escalationOwner,
    escalationQueue,
  });

  const patchPayload = {
    status,
    assigned_admin_id:
      optionalUuid(body.assignedAdminId ?? body.assigned_admin_id) ??
      before.assigned_admin_id,
    resolution,
    rejected_reason: rejectedReason,
    escalation_owner: escalationOwner,
    escalation_queue: escalationQueue,
    status_reason:
      normalizeOptionalText(body.statusReason ?? body.status_reason) ??
      before.status_reason ??
      null,
    resolved_at:
      status === "resolved"
        ? (before.resolved_at ?? new Date().toISOString())
        : null,
    last_handled_by_admin_id: admin.adminId,
    last_handled_at: new Date().toISOString(),
    metadata: toJsonObject({
      ...existingMetadata,
      last_idempotency_key: idempotencyKey,
      last_handled_by_admin_id: admin.adminId,
      result:
        Object.keys(handlingResult).length > 0
          ? handlingResult
          : (existingMetadata.result ?? null),
      handling_note:
        normalizeOptionalText(body.handlingNote ?? body.handling_note) ??
        existingMetadata.handling_note ??
        null,
    }),
  };

  const { data, error } = await (
    db.schema("ops").from("support_tickets") as any
  )
    .update(patchPayload)
    .eq("id", ticketId)
    .select(SUPPORT_TICKET_COLUMNS)
    .single();

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_SUPPORT_TICKET_UPDATE_FAILED",
      "工单更新失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const ticket = data as SupportTicketRow;
  const auditLogId = await writeAdminAudit({
    db,
    admin,
    ctx,
    action:
      before.status === ticket.status
        ? "support.ticket.update"
        : "support.ticket.status",
    targetTable: "support_tickets",
    targetId: ticketId,
    beforeState: before,
    afterState: ticket,
    reason:
      normalizeOptionalText(body.reason) ??
      normalizeOptionalText(body.handlingNote ?? body.handling_note) ??
      ticket.status_reason ??
      ticket.resolution ??
      ticket.rejected_reason ??
      null,
  });

  return {
    item: serializeTicket(ticket),
    auditLogId,
    idempotent: false,
    serverTime: new Date().toISOString(),
  };
}

async function loadTicket(ticketId: string): Promise<SupportTicketRow> {
  const db = getAdminDb();
  const { data, error } = await db
    .schema("ops")
    .from("support_tickets")
    .select(SUPPORT_TICKET_COLUMNS)
    .eq("id", ticketId)
    .maybeSingle<SupportTicketRow>();

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_SUPPORT_TICKET_LOOKUP_FAILED",
      "工单查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  if (!data) {
    throw new ApiError(
      404,
      "SUPPORT_TICKET_NOT_FOUND",
      "Support ticket not found",
    );
  }

  return data;
}

async function findByIdempotencyKey(
  idempotencyKey: string,
): Promise<SupportTicketRow | null> {
  const db = getAdminDb();
  const { data, error } = await (
    db.schema("ops").from("support_tickets") as any
  )
    .select(SUPPORT_TICKET_COLUMNS)
    .contains("metadata", { idempotency_key: idempotencyKey })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_SUPPORT_TICKET_IDEMPOTENCY_LOOKUP_FAILED",
      "工单幂等查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return (data as SupportTicketRow | null) ?? null;
}

function summarizeTickets(tickets: SupportTicketRow[]): Record<string, number> {
  const summary: Record<string, number> = {
    count: tickets.length,
  };

  for (const ticket of tickets) {
    summary[ticket.status] = (summary[ticket.status] ?? 0) + 1;
  }

  return summary;
}

async function loadCompensationRequestsForTickets(
  tickets: SupportTicketRow[],
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const ticketIds = new Set(tickets.map((ticket) => ticket.id));
  const userIds = tickets
    .map((ticket) => ticket.user_id)
    .filter((userId): userId is string => Boolean(userId));
  const byTicketId = new Map<string, Array<Record<string, unknown>>>();

  if (ticketIds.size === 0 || userIds.length === 0) {
    return byTicketId;
  }

  const db = getAdminDb();
  const { data, error } = await db
    .schema("ops")
    .from("admin_approval_requests")
    .select(
      "id,target_id,payload,status,reason,request_audit_log_id,execute_audit_log_id,created_at,updated_at",
    )
    .eq("action", "user.compensate")
    .in("target_id", userIds)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_SUPPORT_COMPENSATION_LOOKUP_FAILED",
      "工单补偿申请查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  for (const row of rows<CompensationApprovalRow>(data)) {
    const serialized = serializeCompensationRequest(row);
    const ticketId =
      readText(serialized.ticketId) ?? readText(serialized.ticket_id);

    if (!ticketId || !ticketIds.has(ticketId)) {
      continue;
    }

    const list = byTicketId.get(ticketId) ?? [];
    list.push(serialized);
    byTicketId.set(ticketId, list);
  }

  return byTicketId;
}

function serializeCompensationRequest(
  row: CompensationApprovalRow,
): Record<string, unknown> {
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
