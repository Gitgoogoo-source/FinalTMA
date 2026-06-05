import { describe, expect, it } from "vitest";

import {
  createTaskFetchRequester,
  createTasksClient,
  TASK_API_ENDPOINTS,
  type TaskApiRequestOptions,
} from "../../packages/api-client/src/tasks.client";

type RequestCall = {
  path: string;
  options: TaskApiRequestOptions;
};

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const COMMISSION_ID = "33333333-3333-4333-8333-333333333333";

describe("packages/api-client tasks client", () => {
  it("wraps task mutation endpoints with stable body and idempotency headers", async () => {
    const calls: RequestCall[] = [];
    const client = createTasksClient({
      createIdempotencyKey: (scope) => `${scope}:unit-key`,
      request: async (path, options) => {
        calls.push({ path, options });
        return responseForPath(path);
      },
    });

    await client.claimTaskReward({
      taskId: TASK_ID,
      periodKey: "2026-05-27",
    });
    await client.dailyCheckIn({ campaignId: CAMPAIGN_ID });
    await client.createPreparedShareMessage({
      scene: "TASK_PAGE",
      source: "task_center",
    });
    await client.recordInviteShare({
      scene: "TASK_PAGE",
      referralCode: "TASKUNIT",
      campaignId: CAMPAIGN_ID,
      metadata: {
        share_method: "prepared",
      },
    });
    await client.claimCommission({ commissionIds: [COMMISSION_ID] });

    expect(calls).toHaveLength(5);
    expect(calls[0]).toMatchObject({
      path: TASK_API_ENDPOINTS.claim,
      options: {
        method: "POST",
        body: {
          task_id: TASK_ID,
          period_key: "2026-05-27",
          idempotency_key: "task:claim:unit-key",
        },
        headers: {
          "X-Idempotency-Key": "task:claim:unit-key",
        },
      },
    });
    expect(calls[1]).toMatchObject({
      path: TASK_API_ENDPOINTS.checkIn,
      options: {
        method: "POST",
        body: {
          campaign_id: CAMPAIGN_ID,
          idempotency_key: "task:signin:unit-key",
        },
        headers: {
          "X-Idempotency-Key": "task:signin:unit-key",
        },
      },
    });
    expect(calls[2]).toMatchObject({
      path: TASK_API_ENDPOINTS.preparedShareMessage,
      options: {
        method: "POST",
        body: {
          scene: "TASK_PAGE",
          source: "task_center",
        },
      },
    });
    expect(calls[3]).toMatchObject({
      path: TASK_API_ENDPOINTS.shareEvent,
      options: {
        method: "POST",
        body: {
          scene: "TASK_PAGE",
          referral_code: "TASKUNIT",
          campaign_id: CAMPAIGN_ID,
          metadata: {
            share_method: "prepared",
          },
          idempotency_key: "task:share:unit-key",
        },
        headers: {
          "X-Idempotency-Key": "task:share:unit-key",
        },
      },
    });
    expect(calls[4]).toMatchObject({
      path: TASK_API_ENDPOINTS.claimCommission,
      options: {
        method: "POST",
        body: {
          commission_ids: [COMMISSION_ID],
          idempotency_key: "task:commission:unit-key",
        },
        headers: {
          "X-Idempotency-Key": "task:commission:unit-key",
        },
      },
    });

    for (const call of calls) {
      expect(call.options.body).not.toHaveProperty("user_id");
      expect(call.options.body).not.toHaveProperty("telegram_user_id");
    }
  });

  it("normalizes task overview payloads from snake_case API data", async () => {
    const client = createTasksClient({
      request: async () => ({
        tasks: [
          {
            task_id: TASK_ID,
            code: "daily_open_box",
            title: "完成一次开盒",
            task_type: "gacha",
            action_type: "open_box",
            status: "completed",
            period_type: "daily",
            progress: {
              progress_count: 1,
              target_count: 1,
              period_key: "2026-05-27",
            },
            reward: [
              {
                type: "currency",
                currency_code: "KCOIN",
                amount: "50",
              },
            ],
          },
        ],
        task_summary: {
          total_count: 1,
          completed_count: 1,
          claimable_count: 1,
        },
        signin_status: {
          campaign: {
            campaign_id: CAMPAIGN_ID,
            title: "7 日签到",
          },
          current_streak: 2,
          already_claimed_today: true,
        },
        invite_stats: {
          summary: {
            invited_count: 3,
            valid_invite_count: 2,
            commission_bps: 1000,
          },
        },
        commission_stats: {
          pending_amount_kcoin: 25,
          granted_amount_kcoin: 75,
        },
        server_time: "2026-05-27T00:00:00.000Z",
      }),
    });

    const overview = await client.fetchTaskOverview();

    expect(overview.tasks[0]).toMatchObject({
      taskId: TASK_ID,
      category: "gacha",
      status: "claimable",
      progress: {
        current: 1,
        target: 1,
        percent: 100,
      },
      rewards: [
        {
          type: "currency",
          currency: "KCOIN",
          amount: 50,
        },
      ],
    });
    expect(overview.taskSummary.claimableCount).toBe(1);
    expect(overview.checkInStatus.alreadyClaimedToday).toBe(true);
    expect(overview.inviteStats.invitedCount).toBe(3);
    expect(overview.commissionStats.totalAmountKcoin).toBe(100);
  });

  it("can create a fetch requester that unwraps the standard API response", async () => {
    const fetchCalls: Array<{ input: string; init: RequestInit | undefined }> =
      [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push({ input: String(input), init });

      return new Response(
        JSON.stringify({
          ok: true,
          success: true,
          data: {
            referral_code: "TASKUNIT",
            start_payload: "TASKUNIT",
            invite_url: "https://t.me/test_bot/app?startapp=TASKUNIT",
            share_text: "来开盒。",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };
    const request = createTaskFetchRequester({ fetch: fetchMock });
    const client = createTasksClient({ request });

    const link = await client.createReferralLink({
      scene: "TASK_PAGE",
      source: "task_center",
    });

    expect(link.referralCode).toBe("TASKUNIT");
    expect(fetchCalls[0]?.input).toBe("/api/tasks/referral-link");
    expect(fetchCalls[0]?.init).toMatchObject({
      credentials: "include",
      method: "POST",
      body: JSON.stringify({
        scene: "TASK_PAGE",
        source: "task_center",
      }),
    });
  });
});

function responseForPath(path: string): unknown {
  switch (path) {
    case TASK_API_ENDPOINTS.claim:
      return {
        task_id: TASK_ID,
        status: "claimed",
        rewards: [],
        claimed_at: "2026-05-27T00:00:00.000Z",
        idempotent: false,
      };
    case TASK_API_ENDPOINTS.checkIn:
      return {
        campaign_id: CAMPAIGN_ID,
        day_index: 2,
        current_streak: 2,
        reward: [],
        checked_in_at: "2026-05-27T00:00:00.000Z",
        idempotent: false,
      };
    case TASK_API_ENDPOINTS.shareEvent:
      return {
        accepted: true,
        event_id: "44444444-4444-4444-8444-444444444444",
        share_type: "copy_link",
        idempotent: false,
      };
    case TASK_API_ENDPOINTS.preparedShareMessage:
      return {
        prepared_message_id: "prepared_task_unit",
        expires_at: "2026-05-27T00:10:00.000Z",
        referral_code: "TASKUNIT",
        start_payload: "TASKUNIT",
        invite_url: "https://t.me/test_bot/app?startapp=TASKUNIT",
        share_text: "来开盒。",
      };
    case TASK_API_ENDPOINTS.claimCommission:
      return {
        processed: true,
        claimed: true,
        claimed_count: 1,
        claimed_amount_kcoin: 100,
        amount_kcoin: 100,
        commission_ids: [COMMISSION_ID],
        status: "granted",
        idempotent: false,
      };
    default:
      throw new Error(`Unexpected path ${path}`);
  }
}
