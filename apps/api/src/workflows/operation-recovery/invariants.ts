import { ApiError } from "../../http/errors.ts";

type RecoverableOperation = {
  use_case: string;
  acknowledged_at: string | null;
};

export function assertEvolutionRecoveryCeiling(
  operations: readonly RecoverableOperation[],
): void {
  let blockingEvolutionCount = 0;
  for (const operation of operations) {
    if (
      operation.use_case === "inventory.evolve" &&
      operation.acknowledged_at === null &&
      ++blockingEvolutionCount > 1
    )
      throw new ApiError(
        500,
        "INTERNAL_ERROR",
        "进化恢复结果违反单槽不变量",
        true,
      );
  }
}
