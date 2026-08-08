import type { UseQueryResult } from "@tanstack/react-query";
import type {
  DormantRecoverableRouteId,
  DormantRouteId,
  DormantRouteInput,
  DormantRouteOutput,
} from "@pokepets/api-contracts/dormant-app";

import { apiRequest, type ApiResult } from "../platform/api/client.ts";
import {
  fetchApiQueryBatchAsOwner,
  invalidateApiQueries,
  useApiQuery,
} from "../platform/query/index.ts";
import { useOperationRegistry } from "../workflows/operation-recovery/context.ts";

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

export function useDormantOperationRegistry(): {
  run<Id extends DormantRecoverableRouteId>(
    label: string,
    routeId: Id,
    input: DormantRouteInput<Id>,
  ): Promise<DormantRouteOutput<Id> | null>;
  isBlocked(routeId: DormantRecoverableRouteId): boolean;
} {
  const registry = useOperationRegistry();
  return registry as unknown as {
    run<Id extends DormantRecoverableRouteId>(
      label: string,
      routeId: Id,
      input: DormantRouteInput<Id>,
    ): Promise<DormantRouteOutput<Id> | null>;
    isBlocked(routeId: DormantRecoverableRouteId): boolean;
  };
}
