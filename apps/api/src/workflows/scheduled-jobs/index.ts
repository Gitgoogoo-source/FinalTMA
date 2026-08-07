import { removeStorageObjects, rpc } from "../../platform/db/index.ts";
import { reconcileSubmittedMints } from "../mint-reconciliation/reconcile.ts";

const names = [
  "reconcile-payments",
  "reconcile-mints",
  "cleanup-idempotency",
  "monitor-invariants",
  "cleanup-catalog-assets",
] as const;

export async function runScheduledJob(
  name: string,
): Promise<Record<string, unknown>> {
  if (!names.includes(name as (typeof names)[number]))
    throw new Error("JOB_NOT_FOUND:后台任务不存在");
  if (name === "cleanup-catalog-assets") return cleanupCatalogAssets();
  const database = await rpc<Record<string, unknown> & { status?: unknown }>(
    "run_job",
    {
      p_job_name: name,
      p_limit: 100,
    },
  );
  if (database.status === "failed")
    throw new Error("INTERNAL_ERROR:后台任务执行失败");
  if (database.status === "skipped" || name !== "reconcile-mints")
    return database;
  const jobRunId = String(database.job_run_id);
  const databaseCount = Number(database.processed_count ?? 0);
  try {
    const chain = await reconcileSubmittedMints();
    const completed = await rpc<Record<string, unknown>>("finish_job", {
      p_job_run_id: jobRunId,
      p_processed_count: databaseCount + chain.candidates,
      p_details: { chain },
      p_error: null,
    });
    return { ...completed, chain };
  } catch (cause) {
    await rpc("finish_job", {
      p_job_run_id: jobRunId,
      p_processed_count: databaseCount,
      p_details: { phase: "chain_reconciliation" },
      p_error:
        cause instanceof Error
          ? cause.message
          : "unknown_chain_reconciliation_error",
    });
    throw new Error("INTERNAL_ERROR:Mint 对账失败", { cause });
  }
}

type CatalogCleanupClaim = {
  job_run_id: string;
  job_name: "cleanup-catalog-assets";
  status: "running" | "skipped";
  processed_count: number;
  scan_from: string | null;
  scan_to: string;
  mutation_run_id?: string;
  mutation_fence?: number;
  objects: Array<{ key: string; sha256: string; bytes: number }>;
};

async function cleanupCatalogAssets(): Promise<Record<string, unknown>> {
  const claim = await rpc<CatalogCleanupClaim>("catalog_asset_cleanup_claim", {
    p_limit: 500,
  });
  if (claim.status === "skipped") {
    return {
      job_run_id: claim.job_run_id,
      job_name: claim.job_name,
      status: claim.status,
      processed_count: claim.processed_count,
      scan_from: claim.scan_from,
      scan_to: claim.scan_to,
    };
  }
  const deleted: string[] = [];
  const failed: Record<string, string> = {};
  if (
    typeof claim.mutation_run_id !== "string" ||
    typeof claim.mutation_fence !== "number" ||
    !Number.isSafeInteger(claim.mutation_fence) ||
    Number(claim.mutation_fence) <= 0
  )
    throw new Error("INTERNAL_ERROR:宠物资源清理租约无效");
  const mutationRunId = String(claim.mutation_run_id);
  const mutationFence = Number(claim.mutation_fence);
  for (let index = 0; index < claim.objects.length; index += 100) {
    const keys = claim.objects
      .slice(index, index + 100)
      .map((item) => item.key);
    try {
      await removeStorageObjects("pet-runtime", keys);
      deleted.push(...keys);
    } catch {
      for (const key of keys) failed[key] = "storage_delete_failed";
    }
    await rpc("catalog_asset_mutation_renew", {
      p_run_id: mutationRunId,
      p_fence: mutationFence,
    });
  }
  const result = await rpc<Record<string, unknown> & { status?: unknown }>(
    "catalog_asset_cleanup_finish",
    {
      p_job_run_id: claim.job_run_id,
      p_mutation_run_id: mutationRunId,
      p_mutation_fence: mutationFence,
      p_deleted_keys: deleted,
      p_failed: failed,
    },
  );
  if (result.status === "failed")
    throw new Error("INTERNAL_ERROR:宠物资源清理未全部完成");
  return result;
}
