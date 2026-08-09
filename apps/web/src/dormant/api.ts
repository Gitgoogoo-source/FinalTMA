import type { UseQueryResult } from "@tanstack/react-query";
import type {
  DormantRecoverableRouteId,
  DormantRouteId,
  DormantRouteInput,
  DormantRouteOutput,
} from "@pokepets/api-contracts/dormant-app";
import type { RecoverableRouteId } from "@pokepets/api-contracts/app-client";

import { apiRequest, type ApiResult } from "../platform/api/client.ts";
import {
  fetchApiQueryBatchAsOwner,
  invalidateApiQueries,
  useApiQuery,
} from "../platform/query/index.ts";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../workflows/operation-recovery/context.ts";

export const dormantApiRequest = apiRequest as unknown as <
  Id extends DormantRouteId,
>(
  routeId: Id,
  input: DormantRouteInput<Id>,
) => Promise<ApiResult<DormantRouteOutput<Id>>>;

export const useDormantApiQuery = useApiQuery as unknown as <
  Id extends DormantRouteId,
>(
  routeId: Id,
  input?: DormantRouteInput<Id>,
  enabled?: boolean,
) => UseQueryResult<DormantRouteOutput<Id>>;

export const fetchDormantApiQueryBatchAsOwner =
  fetchApiQueryBatchAsOwner as unknown as (
    owner: symbol,
    requests: readonly {
      [Id in DormantRouteId]: {
        routeId: Id;
        input: DormantRouteInput<Id>;
      };
    }[DormantRouteId][],
  ) => Promise<void>;

export const invalidateDormantApiQueries = invalidateApiQueries as unknown as (
  routeIds: readonly DormantRouteId[],
) => Promise<void>;

export function useDormantOperationCommands(): {
  run<Id extends DormantRecoverableRouteId>(
    label: string,
    routeId: Id,
    input: DormantRouteInput<Id>,
  ): Promise<DormantRouteOutput<Id> | null>;
} {
  const commands = useOperationCommands();
  return commands as unknown as {
    run<Id extends DormantRecoverableRouteId>(
      label: string,
      routeId: Id,
      input: DormantRouteInput<Id>,
    ): Promise<DormantRouteOutput<Id> | null>;
  };
}

export function useDormantOperationBlocked(
  routeId: DormantRecoverableRouteId,
): boolean {
  return useOperationBlocked(routeId as unknown as RecoverableRouteId);
}
