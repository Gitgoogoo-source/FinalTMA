#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const paths = {
  query: path.join(ROOT, "apps/web/src/platform/query/index.ts"),
  coordinator: path.join(
    ROOT,
    "apps/web/src/domains/battle/useBattleTerminalRefresh.ts",
  ),
  command: path.join(ROOT, "apps/web/src/domains/battle/useBattleCommand.ts"),
  view: path.join(ROOT, "apps/web/src/domains/battle/ui/BattleView.tsx"),
  realtime: path.join(
    ROOT,
    "apps/web/src/workflows/battle-realtime/useBattleRealtime.ts",
  ),
  appShell: path.join(ROOT, "apps/web/src/app/shell/AppShell.tsx"),
  topAsset: path.join(ROOT, "apps/web/src/app/shell/TopAssetBar.tsx"),
  inventory: path.join(
    ROOT,
    "apps/web/src/domains/inventory/ui/InventoryView.tsx",
  ),
};
const terminalStatuses = new Set([
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
]);
const terminalReads = new Set([
  "battle.bootstrap",
  "identity.bootstrap",
  "inventory.list",
]);
const terminalTailRoutes = new Set([
  "battle.bootstrap",
  "battle.room",
  "battle.current_invite",
  "battle.team_options",
  "identity.bootstrap",
  "inventory.list",
]);

try {
  runChecks();
  if (process.argv.includes("--self-test")) runSelfTests();
  process.stdout.write(
    `Battle terminal refresh ownership is structurally valid${
      process.argv.includes("--self-test")
        ? " and negative architecture fixtures are effective"
        : ""
    }\n`,
  );
} catch (cause) {
  process.stderr.write(
    `${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exit(1);
}

function runChecks(overrides = new Map()) {
  const sources = Object.fromEntries(
    Object.entries(paths).map(([name, fileName]) => [
      name,
      parse(fileName, overrides),
    ]),
  );
  checkQueryBoundary(sources.query);
  checkCoordinator(sources.coordinator);
  checkView(sources.view);
  checkCommand(sources.command);
  checkRealtime(sources.realtime);
  checkAppShell(sources.appShell);
  checkObserverConsumers(sources.topAsset, sources.inventory);
  checkExclusiveOwnership(sources);
}

function checkQueryBoundary(source) {
  const client = variable(source, "queryClient");
  const constructor =
    client?.initializer && ts.isNewExpression(client.initializer)
      ? client.initializer
      : null;
  const clientOptions = objectArgument(constructor, 0);
  const defaults = objectPropertyObject(clientOptions, "defaultOptions");
  const queries = objectPropertyObject(defaults, "queries");
  must(
    booleanProperty(queries, "retry") === false &&
      booleanProperty(queries, "refetchOnWindowFocus") === false &&
      booleanProperty(queries, "refetchOnReconnect") === false,
    "TanStack queries must keep retry, focus refetch, and reconnect refetch disabled",
  );

  const prefetcher = topLevelFunction(source, "prefetchApiQuery");
  const prefetchQuery = calls(prefetcher, "queryClient.prefetchQuery");
  const prefetchOptions =
    prefetchQuery.length === 1 ? objectArgument(prefetchQuery[0], 0) : null;
  const prefetchQueryFn = functionProperty(prefetchOptions, "queryFn");
  const prefetchRequests = calls(prefetchQueryFn, "apiRequest");
  const prefetchGuards = calls(prefetchQueryFn, "assertApiQueryAllowed");
  must(
    prefetchRequests.length === 1 &&
      prefetchGuards.length === 1 &&
      prefetchGuards[0].pos < prefetchRequests[0].pos,
    "prefetch queryFn must recheck suppression before network I/O",
  );

  const fetcher = topLevelFunction(source, "fetchApiQuery");
  const fetchCalls = calls(fetcher, "queryClient.fetchQuery");
  must(
    fetchCalls.length === 1,
    "fetchApiQuery must own exactly one queryClient.fetchQuery call",
  );
  const fetchOptions = objectArgument(fetchCalls[0], 0);
  must(
    numberProperty(fetchOptions, "staleTime") === 0,
    "fetchApiQuery must force an authoritative network read with staleTime 0",
  );
  const queryKey = objectPropertyExpression(fetchOptions, "queryKey");
  must(
    queryKey &&
      ts.isArrayLiteralExpression(unwrap(queryKey)) &&
      sameArray(
        unwrap(queryKey).elements.map((element) => expressionValue(element)),
        ["generation", "v1", "routeId", "input"],
      ),
    "fetchApiQuery must populate the formal generation/v1/route/input cache key",
  );
  const queryFn = functionProperty(fetchOptions, "queryFn");
  const requests = calls(queryFn, "apiRequest");
  const fetchGuards = calls(queryFn, "assertApiQueryAllowed");
  must(
    requests.length === 1 &&
      fetchGuards.length === 1 &&
      fetchGuards[0].pos < requests[0].pos &&
      sameArray(
        fetchGuards[0].arguments.map((argument) => expressionValue(argument)),
        ["generation", "routeId", "suppressionOwner"],
      ) &&
      expressionValue(requests[0].arguments[0]) === "routeId" &&
      expressionValue(requests[0].arguments[1]) === "input" &&
      objectHasShorthand(objectArgument(requests[0], 2), "signal") &&
      calls(queryFn, "assertCurrentSession").length === 1,
    "fetchApiQuery must use the formal API client, owner gate, Query signal, and generation guard",
  );
  must(
    forbiddenQueryMethods(fetcher).length === 0,
    "fetchApiQuery cannot fall back to invalidate/refetch/ensure semantics",
  );

  const canceller = topLevelFunction(source, "cancelApiQueries");
  const cancelCalls = calls(canceller, "queryClient.cancelQueries");
  must(
    cancelCalls.length === 1,
    "cancelApiQueries must own exactly one queryClient.cancelQueries call",
  );
  const cancelOptions = objectArgument(cancelCalls[0], 0);
  const predicate = functionProperty(cancelOptions, "predicate");
  const predicatePaths = new Set(propertyPaths(predicate));
  must(
    predicatePaths.has("query.queryKey") &&
      calls(predicate, "selected.has").some(
        (call) => expressionValue(call.arguments[0]) === "query.queryKey[2]",
      ) &&
      binaryExpressions(predicate).some(
        (node) =>
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          sameSet(
            new Set([expressionValue(node.left), expressionValue(node.right)]),
            new Set(["query.queryKey[0]", "generation"]),
          ),
      ),
    "cancelApiQueries must isolate exact route IDs to the current generation",
  );

  const observer = topLevelFunction(source, "useApiQuery");
  const subscription = calls(observer, "useSyncExternalStore");
  const suppressed = variable(observer, "suppressed")?.initializer;
  const observerQuery = calls(observer, "useQuery");
  const observerOptions =
    observerQuery.length === 1 ? objectArgument(observerQuery[0], 0) : null;
  const observerEnabled = unwrap(
    objectPropertyExpression(observerOptions, "enabled"),
  );
  const observerQueryFn = functionProperty(observerOptions, "queryFn");
  const observerRequests = calls(observerQueryFn, "apiRequest");
  const observerGuards = calls(observerQueryFn, "assertApiQueryAllowed");
  must(
    subscription.length === 1 &&
      calls(suppressed, "isApiQuerySuppressed").some((call) =>
        sameArray(
          call.arguments.map((argument) => expressionValue(argument)),
          ["generation", "routeId"],
        ),
      ),
    "all useApiQuery observers must subscribe to the synchronous suppression store",
  );
  must(
    observerEnabled &&
      ts.isBinaryExpression(observerEnabled) &&
      observerEnabled.operatorToken.kind ===
        ts.SyntaxKind.AmpersandAmpersandToken &&
      expressionValue(observerEnabled.left) === "enabled" &&
      isNegatedIdentifier(observerEnabled.right, "suppressed") &&
      booleanProperty(observerOptions, "refetchOnReconnect") === false,
    "observer enabled state and reconnect behavior must stay behind the suppression gate",
  );
  must(
    observerRequests.length === 1 &&
      observerGuards.length === 1 &&
      observerGuards[0].pos < observerRequests[0].pos,
    "ordinary observer queryFn must recheck suppression before network I/O",
  );

  for (const functionName of [
    "refreshUserState",
    "refreshTopAssetSummary",
    "refreshForegroundState",
    "refreshScopes",
  ])
    must(
      calls(topLevelFunction(source, functionName), "isApiQuerySuppressed")
        .length >= 1,
      `${functionName} must filter suppressed observers`,
    );

  const foreground = topLevelFunction(source, "refreshForegroundState");
  const authorityRefresh = calls(foreground, "authority.refresh");
  const foregroundInvalidate = calls(
    foreground,
    "queryClient.invalidateQueries",
  );
  must(
    authorityRefresh.length === 1 &&
      foregroundInvalidate.length === 1 &&
      authorityRefresh[0].pos < foregroundInvalidate[0].pos &&
      calls(foreground, "hasApiQuerySuppression").length === 1 &&
      calls(foreground, "prefixes.delete").length === 1,
    "foreground refresh must await Battle authority, stop on suppression, and exclude handled prefixes",
  );

  const suppress = topLevelFunction(source, "suppressApiQueries");
  const release = topLevelFunction(source, "releaseApiQuerySuppression");
  must(
    calls(suppress, "apiQuerySuppressions.set").length === 1 &&
      calls(suppress, "publishApiQuerySuppressionChange").length === 1 &&
      calls(release, "apiQuerySuppressions.delete").length === 1 &&
      calls(release, "publishApiQuerySuppressionChange").length === 1,
    "suppression ownership must synchronously publish activation and release",
  );
  const allowed = topLevelFunction(source, "assertApiQueryAllowed");
  const allowedGuard = ifStatements(allowed).find(
    (node) =>
      calls(node.expression, "isApiQuerySuppressed").length === 1 &&
      throwStatements(node.thenStatement).length === 1,
  );
  must(
    allowedGuard &&
      ts.isCallExpression(unwrap(allowedGuard.expression)) &&
      sameArray(
        unwrap(allowedGuard.expression).arguments.map((argument) =>
          expressionValue(argument),
        ),
        ["generation", "routeId", "suppressionOwner"],
      ),
    "queryFn network guard must throw directly from the canonical suppression predicate",
  );
  const suppressionPredicate = topLevelFunction(source, "isApiQuerySuppressed");
  const some = calls(suppressionPredicate, "some");
  const suppressionCallback =
    some.length === 1 && some[0].arguments[0]
      ? unwrap(some[0].arguments[0])
      : null;
  must(
    suppressionCallback &&
      isFunction(suppressionCallback) &&
      calls(suppressionCallback, "suppression.routeIds.has").some(
        (call) => expressionValue(call.arguments[0]) === "routeId",
      ) &&
      binaryExpressions(suppressionCallback).some(
        (node) =>
          node.operatorToken.kind ===
            ts.SyntaxKind.ExclamationEqualsEqualsToken &&
          sameSet(
            new Set([expressionValue(node.left), expressionValue(node.right)]),
            new Set(["owner", "suppressionOwner"]),
          ),
      ) &&
      binaryExpressions(suppressionCallback).some(
        (node) =>
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          sameSet(
            new Set([expressionValue(node.left), expressionValue(node.right)]),
            new Set(["suppression.generation", "generation"]),
          ),
      ),
    "suppression predicate must require a different owner, exact generation, and exact route",
  );
}

function checkCoordinator(source) {
  const hook = topLevelFunction(source, "useBattleTerminalRefresh");
  checkTerminalPredicate(source);
  const reporter = variableFunction(hook, "reportTerminal");
  must(
    expressionValue(reporter.parameters[0]?.name) === "observation",
    "terminal reporter must receive a versioned observation object",
  );

  must(
    isRefCollection(variable(hook, "inFlight")?.initializer, "Map") &&
      isRefCollection(variable(hook, "completed")?.initializer, "Set") &&
      calls(variable(hook, "active")?.initializer, "useRef").length === 1 &&
      calls(variable(hook, "recovery")?.initializer, "useRef").length === 1 &&
      calls(variable(hook, "suppressionOwner")?.initializer, "useRef")
        .length === 1,
    "coordinator must own in-flight, completed, active, recovery, and suppression owner state",
  );
  const routeSet = variable(source, "terminalQueryRoutes")?.initializer;
  must(
    sameSet(new Set(arrayStrings(routeSet)), terminalTailRoutes),
    "coordinator suppression routes must cover every terminal observer and tail",
  );

  const keyFunction = topLevelFunction(source, "terminalRefreshKey");
  const keyReturn = returnExpressions(keyFunction)[0];
  must(
    keyReturn &&
      ts.isTemplateExpression(unwrap(keyReturn)) &&
      sameSet(
        new Set(propertyPaths(keyReturn)),
        new Set(["observation.roomId", "observation.stateVersion"]),
      ) &&
      identifiers(keyReturn).includes("generation"),
    "terminal key must be exactly generation + room_id + terminal state_version",
  );
  const key = variable(reporter, "key")?.initializer;
  must(
    key &&
      ts.isCallExpression(unwrap(key)) &&
      callPath(unwrap(key).expression) === "terminalRefreshKey" &&
      sameArray(
        unwrap(key).arguments.map((argument) => expressionValue(argument)),
        ["generation", "observation"],
      ),
    "terminal reporter must use the canonical versioned terminal key",
  );

  const safeInteger = calls(reporter, "Number.isSafeInteger");
  must(
    safeInteger.length === 1 &&
      expressionValue(safeInteger[0].arguments[0]) ===
        "observation.stateVersion" &&
      calls(reporter, "getSession").length >= 1,
    "terminal observations must validate state_version and current generation",
  );

  const activeAssignment = assignments(reporter).find(
    (node) => expressionValue(node.left) === "active.current",
  );
  const suppress = calls(reporter, "suppressApiQueries");
  const completedHas = calls(reporter, "completed.current.has")[0];
  const inFlightGet = calls(reporter, "inFlight.current.get")[0];
  const task = variable(reporter, "task");
  const inFlightSet = calls(reporter, "inFlight.current.set")[0];
  must(
    activeAssignment &&
      suppress.length === 1 &&
      completedHas &&
      inFlightGet &&
      task &&
      inFlightSet &&
      activeAssignment.pos < suppress[0].pos &&
      suppress[0].pos < completedHas.pos &&
      completedHas.pos < inFlightGet.pos &&
      inFlightGet.pos < task.pos &&
      task.pos < inFlightSet.pos &&
      sameArray(
        suppress[0].arguments.map((argument) => expressionValue(argument)),
        ["suppressionOwner.current", "generation", "terminalQueryRoutes"],
      ) &&
      sameArray(
        inFlightSet.arguments.map((argument) => expressionValue(argument)),
        ["key", "task"],
      ),
    "terminal latch must activate and publish suppression before completed/singleflight checks",
  );

  const cancel = calls(reporter, "cancelApiQueries");
  must(
    cancel.length === 1 &&
      sameArray(
        cancel[0].arguments.map((argument) => expressionValue(argument)),
        ["terminalQueryRoutes", "generation"],
      ),
    "terminal latch must cancel every suppressed route in the exact generation",
  );
  const promiseAll = calls(reporter, "Promise.all");
  must(
    promiseAll.length === 1 &&
      promiseAll[0].arguments.length === 1 &&
      ts.isArrayLiteralExpression(unwrap(promiseAll[0].arguments[0])),
    "terminal reads must be one awaited Promise.all batch",
  );
  const readCalls = calls(promiseAll[0], "fetchApiQuery");
  must(
    readCalls.length === terminalReads.size &&
      sameSet(
        new Set(readCalls.map((call) => stringArgument(call, 0))),
        terminalReads,
      ) &&
      readCalls.filter((call) => stringArgument(call, 0).startsWith("battle."))
        .length === 1 &&
      readCalls.every(
        (call) =>
          expressionValue(call.arguments[2]) === "suppressionOwner.current",
      ),
    "terminal batch must read exactly battle.bootstrap, identity.bootstrap, and inventory.list through its owner",
  );
  must(
    forbiddenQueryMethods(reporter).length === 0,
    "terminal coordinator cannot invalidate, refetch, or ensure cached scopes",
  );

  const completedAdd = calls(reporter, "completed.current.add");
  const failureWrites = calls(reporter, "setFailure");
  const unlock = calls(reporter, "inFlight.current.delete");
  must(
    completedAdd.length === 1 &&
      expressionValue(completedAdd[0].arguments[0]) === "key" &&
      completedAdd[0].pos > promiseAll[0].pos,
    "completion may be recorded only after every required terminal read",
  );
  const failureCatch = calls(reporter, "catch").find((call) =>
    containsNode(call.arguments[0], failureWrites.at(-1)),
  );
  must(
    failureWrites.length >= 2 &&
      failureCatch &&
      calls(failureCatch.arguments[0], "matchesObservation").some((call) =>
        sameArray(
          call.arguments.map((argument) => expressionValue(argument)),
          ["active.current", "generation", "observation"],
        ),
      ) &&
      unlock.length === 1 &&
      expressionValue(unlock[0].arguments[0]) === "key" &&
      calls(reporter, "finally").some((call) =>
        containsNode(call.arguments[0], unlock[0]),
      ),
    "failed terminal refresh must publish failure and always unlock singleflight",
  );

  const isLocked = variableFunction(hook, "isLocked");
  must(
    propertyPaths(isLocked).includes("active.current") &&
      identifiers(isLocked).includes("sessionGeneration") &&
      identifiers(isLocked).includes("roomId"),
    "tail-query lock must be generation-aware and room-aware",
  );

  const prepare = variableFunction(hook, "prepareAuthorityRecovery");
  const finish = variableFunction(hook, "finishAuthorityRecovery");
  must(
    calls(prepare, "suppressApiQueries").length === 1 &&
      assignments(prepare).some(
        (node) => expressionValue(node.left) === "recovery.current",
      ) &&
      calls(finish, "releaseApiQuerySuppression").length === 1 &&
      calls(finish, "matchesRoom").length === 1 &&
      propertyPaths(finish).includes("active.current"),
    "authority recovery must acquire suppression and release it only for the matching non-terminal room",
  );

  const roomRead = variableFunction(hook, "readAuthorityRoom");
  const roomCancel = calls(roomRead, "cancelApiQueries");
  const roomFetch = calls(roomRead, "fetchApiQuery");
  must(
    roomCancel.length === 1 &&
      roomFetch.length === 1 &&
      roomCancel[0].pos < roomFetch[0].pos &&
      stringArgument(roomFetch[0], 0) === "battle.room" &&
      expressionValue(roomFetch[0].arguments[2]) ===
        "suppressionOwner.current" &&
      calls(roomRead, "matchesRoom").length === 1 &&
      propertyPaths(roomRead).includes("active.current"),
    "authority room read must cancel tails, recheck active recovery, and use the formal owner queryFn",
  );
  const bootstrapRead = variableFunction(hook, "readAuthorityBootstrap");
  const bootstrapFetch = calls(bootstrapRead, "fetchApiQuery");
  must(
    bootstrapFetch.length === 1 &&
      stringArgument(bootstrapFetch[0], 0) === "battle.bootstrap" &&
      expressionValue(bootstrapFetch[0].arguments[2]) ===
        "suppressionOwner.current" &&
      calls(bootstrapRead, "matchesRoom").length === 1 &&
      propertyPaths(bootstrapRead).includes("active.current"),
    "non-terminal Battle bootstrap must remain owner-authorized inside recovery suppression",
  );

  const nonTerminal = variableFunction(hook, "reportNonTerminalRoom");
  const sameRoomGuard = ifStatements(nonTerminal).find(
    (node) =>
      binaryExpressions(node.expression).some(
        (binary) =>
          binary.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          sameSet(
            new Set([
              expressionValue(binary.left),
              expressionValue(binary.right),
            ]),
            new Set(["terminal.roomId", "roomId"]),
          ),
      ) && returnStatements(node.thenStatement).length === 1,
  );
  must(
    sameRoomGuard &&
      calls(nonTerminal, "releaseApiQuerySuppression").length === 1,
    "cancelled query rollback cannot let an old non-terminal snapshot unlock the same terminal room",
  );

  must(
    assignments(hook).some(
      (node) =>
        expressionValue(node.left) === "mounted.current" &&
        expressionValue(node.right) === "false",
    ) &&
      propertyPaths(reporter).includes("mounted.current") &&
      calls(hook, "releaseApiQuerySuppression").length >= 2 &&
      calls(hook, "cancelApiQueries").some(
        (call) => expressionValue(call.arguments[1]) === "generation",
      ),
    "session change or unmount must release suppression and cancel exact-generation work",
  );
}

function checkTerminalPredicate(source) {
  const statuses = variable(source, "terminalStatuses");
  const initializer = unwrap(statuses?.initializer);
  must(
    statuses &&
      initializer &&
      ts.isArrayLiteralExpression(initializer) &&
      sameSet(new Set(arrayStrings(initializer)), terminalStatuses),
    "terminal status set must stay exact",
  );
  const predicate = topLevelFunction(source, "isBattleAssetTerminal");
  must(
    calls(predicate, "terminalStatuses.some").length === 1 &&
      returnExpressions(predicate).length === 1,
    "terminal predicate must directly use the authoritative terminal set",
  );
}

function checkView(source) {
  const view = topLevelFunction(source, "BattleView");
  must(
    calls(view, "useBattleTerminalRefresh").length === 1 &&
      expressionValue(
        calls(view, "useBattleTerminalRefresh")[0].arguments[0],
      ) === "sessionGeneration",
    "BattleView must mount exactly one terminal coordinator",
  );

  const identityQuery = apiQueryCall(view, "identity.bootstrap");
  const bootstrapQuery = apiQueryCall(view, "battle.bootstrap");
  const roomQuery = apiQueryCall(view, "battle.room");
  const inviteQuery = apiQueryCall(view, "battle.current_invite");
  must(
    identityQuery &&
      binaryExpressions(identityQuery.arguments[2]).some(
        (node) =>
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          sameSet(
            new Set([expressionValue(node.left), expressionValue(node.right)]),
            new Set(["activeTerminal", "null"]),
          ),
      ) &&
      bootstrapQuery &&
      binaryExpressions(bootstrapQuery.arguments[2]).filter(
        (node) =>
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken,
      ).length >= 2,
    "Battle identity/bootstrap observers must stay disabled for seeded or latched terminal state",
  );
  must(
    roomQuery &&
      roomQuery.arguments[2] &&
      calls(roomQuery.arguments[2], "isTerminalLocked").length === 1,
    "terminal latch must disable the participant room query",
  );
  must(
    inviteQuery &&
      inviteQuery.arguments[2] &&
      binaryExpressions(inviteQuery.arguments[2]).some(
        (node) =>
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          sameSet(
            new Set([expressionValue(node.left), expressionValue(node.right)]),
            new Set(["activeTerminal", "null"]),
          ),
      ),
    "terminal latch must prevent a newly enabled current-invite tail query",
  );

  const authoritativeRoom = variableFunction(view, "onAuthoritativeRoom");
  const apply = calls(authoritativeRoom, "applySnapshot");
  const report = calls(authoritativeRoom, "reportTerminal");
  const nonTerminal = calls(authoritativeRoom, "reportNonTerminalRoom");
  must(
    apply.length === 1 &&
      report.length === 1 &&
      nonTerminal.length === 1 &&
      apply[0].pos < report[0].pos &&
      expressionValue(apply[0].arguments[0]) === "snapshot",
    "authoritative room snapshot must land before terminal or room-change coordination",
  );
  const reportInput = objectArgument(report[0], 0);
  must(
    expressionValue(objectPropertyExpression(reportInput, "roomId")) ===
      "snapshot.room_id" &&
      expressionValue(objectPropertyExpression(reportInput, "stateVersion")) ===
        "snapshot.state_version" &&
      enclosingIf(authoritativeRoom, report[0], (node) =>
        calls(node.expression, "isBattleAssetTerminal").some(
          (call) => expressionValue(call.arguments[0]) === "snapshot.status",
        ),
      ),
    "authoritative room signals must report room_id plus terminal state_version",
  );
  must(
    calls(authoritativeRoom, "request.abort").length === 1 &&
      calls(authoritativeRoom, "heartbeatRequests.current.clear").length ===
        1 &&
      calls(authoritativeRoom, "heartbeatRequests.current.clear")[0].pos <
        report[0].pos,
    "terminal snapshot must stop presence work before starting cache reads",
  );

  const runAuthority = variableFunction(view, "runAuthorityRefresh");
  const terminalGuard = ifStatements(runAuthority).find(
    (node) =>
      calls(node.expression, "isTerminalLocked").some(
        (call) => expressionValue(call.arguments[0]) === "null",
      ) && returnStatements(node.thenStatement).length > 0,
  );
  const roomReads = calls(runAuthority, "readAuthorityRoom");
  const bootstrapReads = calls(runAuthority, "readAuthorityBootstrap");
  const roomPublish = calls(runAuthority, "onAuthoritativeRoom").find(
    (call) => expressionValue(call.arguments[0]) === "roomResult",
  );
  must(
    terminalGuard &&
      terminalGuard.pos < roomReads[0]?.pos &&
      roomReads.length === 1 &&
      bootstrapReads.length === 1 &&
      roomPublish &&
      roomReads[0].pos < roomPublish.pos &&
      roomPublish.pos < bootstrapReads[0].pos,
    "poll/realtime/visibility must perform one owner room read and publish it before any Battle bootstrap tail",
  );
  must(
    latchCheckBetween(runAuthority, roomReads[0], roomPublish) &&
      latchCheckBetween(runAuthority, roomPublish, bootstrapReads[0]) &&
      latchCheckBetween(
        runAuthority,
        bootstrapReads[0],
        variable(runAuthority, "candidates"),
      ),
    "every awaited room/bootstrap boundary must recheck the terminal latch before consuming restored cache or starting a tail",
  );

  const realtime = calls(view, "useBattleRealtime");
  const realtimeOptions =
    realtime.length === 1 ? objectArgument(realtime[0], 0) : null;
  must(
    realtimeOptions &&
      calls(
        objectPropertyExpression(realtimeOptions, "enabled"),
        "isTerminalLocked",
      ).length === 1,
    "terminal latch must synchronously disable realtime polling",
  );

  const refetchAuthority = variableFunction(view, "refetchAuthority");
  must(
    propertyPaths(refetchAuthority).includes("authorityInFlight.current") &&
      calls(refetchAuthority, "runAuthorityRefresh").length === 1 &&
      calls(refetchAuthority, "finally").length === 1 &&
      assignments(refetchAuthority).some(
        (node) =>
          expressionValue(node.left) === "authorityInFlight.current" &&
          expressionValue(node.right) === "task",
      ),
    "visibility/reconnect/realtime authority reads must share one singleflight",
  );
  const foregroundRegistration = calls(
    view,
    "registerForegroundAuthorityRefresh",
  );
  const foregroundOptions =
    foregroundRegistration.length === 1
      ? objectArgument(foregroundRegistration[0], 1)
      : null;
  must(
    foregroundOptions &&
      expressionValue(
        objectPropertyExpression(foregroundOptions, "generation"),
      ) === "sessionGeneration" &&
      expressionValue(
        objectPropertyExpression(foregroundOptions, "pathname"),
      ) === "/game" &&
      sameArray(
        arrayStrings(
          objectPropertyExpression(foregroundOptions, "handledPrefixes"),
        ),
        ["battle"],
      ) &&
      expressionValue(
        objectPropertyExpression(foregroundOptions, "refresh"),
      ) === "refetchAuthority",
    "AppShell foreground refresh must delegate /game authority to the Battle singleflight",
  );

  const markOffline = variableFunction(view, "markOffline");
  must(
    ifStatements(markOffline).some(
      (node) =>
        calls(node.expression, "isTerminalLocked").length === 1 &&
        returnStatements(node.thenStatement).length === 1,
    ),
    "terminal latch must prevent trailing offline commands",
  );
  const prepareRecovery = variableFunction(view, "prepareRecovery");
  must(
    calls(prepareRecovery, "prepareAuthorityRecovery").length === 1 &&
      ["deactivated", "visibility", "pagehide", "offline"].every(
        (name) =>
          calls(variableFunction(view, name), "prepareRecovery").length >= 1,
      ),
    "hidden, deactivated, pagehide, and offline paths must close ordinary observers before recovery",
  );

  const collector = topLevelFunction(source, "terminalObservationsFor");
  const collectorParameters = bindingNames(collector.parameters[0]?.name);
  must(
    sameSet(new Set(collectorParameters), new Set(["rooms", "participations"])),
    "terminal collector may consume only versioned room and participation sources",
  );
  const collectorIdentifiers = new Set(identifiers(collector));
  must(
    ![
      "invite",
      "resultRoomIds",
      "currentResult",
      "battle_result",
      "current_result",
    ].some((name) => collectorIdentifiers.has(name)) &&
      calls(collector, "isBattleAssetTerminal").length === 2,
    "unversioned invite/result signals cannot create terminal batches",
  );
  const observations = objectLiterals(collector).filter(
    (object) =>
      objectPropertyExpression(object, "roomId") &&
      objectPropertyExpression(object, "stateVersion"),
  );
  must(
    observations.length === 2 &&
      observations.every((object) => {
        const roomId = expressionValue(
          objectPropertyExpression(object, "roomId"),
        );
        const stateVersion = expressionValue(
          objectPropertyExpression(object, "stateVersion"),
        );
        const owner = roomId.split(".")[0];
        return (
          (owner === "room" || owner === "participation") &&
          stateVersion === `${owner}.state_version`
        );
      }),
    "every collected terminal observation must preserve its matching state_version",
  );

  const observationKey = variable(view, "terminalObservationKey");
  const observationKeyPaths = new Set(propertyPaths(observationKey));
  must(
    observationKey &&
      observationKeyPaths.has("terminalObservations.map") &&
      observationKeyPaths.has("observation.roomId") &&
      observationKeyPaths.has("observation.stateVersion"),
    "terminal observation effect key must include room_id and state_version",
  );
  must(
    calls(view, "reportTerminal").some(
      (call) => expressionValue(call.arguments[0]) === "observation",
    ),
    "terminal observation effect must publish the versioned collector output",
  );

  const heartbeat = variableFunction(view, "heartbeat");
  const heartbeatPublish = calls(heartbeat, "onAuthoritativeRoom");
  const nonTerminalRead = ifStatements(heartbeat).find(
    (node) =>
      ts.isPrefixUnaryExpression(unwrap(node.expression)) &&
      unwrap(node.expression).operator === ts.SyntaxKind.ExclamationToken &&
      calls(unwrap(node.expression).operand, "isBattleAssetTerminal").length ===
        1 &&
      calls(node.thenStatement, "refetchRef.current").length === 1,
  );
  must(
    heartbeatPublish.length === 1 &&
      expressionValue(heartbeatPublish[0].arguments[0]) === "response.data" &&
      nonTerminalRead,
    "heartbeat must apply its room snapshot and only re-read authority for non-terminal phase changes",
  );
}

function checkCommand(source) {
  must(
    calls(source, "reportTerminal").length === 0,
    "Battle commands must publish snapshots through the single coordinator owner",
  );
  const result = topLevelFunction(source, "applyBattleCommandResult");
  const publish = calls(result, "onAuthoritativeRoom");
  const refresh = calls(result, "refreshRouteScopes");
  must(
    publish.length === 1 &&
      refresh.length === 1 &&
      publish[0].pos < refresh[0].pos &&
      expressionValue(publish[0].arguments[0]) === "snapshot" &&
      enclosingIf(result, refresh[0], (node) =>
        isNegatedCall(node.expression, "isBattleAssetTerminal"),
      ),
    "command success must publish the versioned snapshot before non-terminal scope refresh",
  );
  const failure = topLevelFunction(source, "refreshBattleCommandFailure");
  must(
    calls(failure, "readAuthoritativeRoom").length === 1 &&
      calls(failure, "onAuthoritativeRoom").length === 1,
    "terminal command failures must recover and publish an authoritative room snapshot",
  );
}

function checkRealtime(source) {
  const hook = topLevelFunction(source, "useBattleRealtime");
  const requests = calls(hook, "apiRequest");
  must(
    requests.length >= 1 &&
      requests.every(
        (request) => stringArgument(request, 0) === "battle.realtime_token",
      ) &&
      calls(hook, "fetchApiQuery").length === 0,
    "realtime workflow may request only its token and must delegate authority reads",
  );
  const runRefetch = variableFunction(hook, "runRefetch");
  must(
    calls(runRefetch, "refetchRef.current").length === 1,
    "realtime and fallback polling must share the guarded authority callback",
  );
}

function checkAppShell(source) {
  const hook = topLevelFunction(source, "useForegroundRefresh");
  const refresh = variableFunction(hook, "refresh");
  const restore = variableFunction(hook, "restore");
  const reconnect = variableFunction(hook, "reconnect");
  const foreground = calls(refresh, "refreshForegroundState");
  must(
    foreground.length === 1 &&
      expressionValue(foreground[0].arguments[0]) === "pathname" &&
      calls(refresh, "catch").length === 1,
    "AppShell foreground refresh must use the guarded query coordinator without unhandled rejection",
  );
  must(
    calls(restore, "refresh").length === 1 &&
      binaryExpressions(restore).some(
        (node) =>
          node.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken &&
          [numericValue(node.left), numericValue(node.right)].includes(300_000),
      ),
    "visibility recovery after 300 seconds must use the guarded foreground refresh",
  );
  const onlineListener = calls(hook, "window.addEventListener").find(
    (call) => stringArgument(call, 0) === "online",
  );
  must(
    calls(reconnect, "refresh").length === 1 &&
      onlineListener &&
      expressionValue(onlineListener.arguments[1]) === "reconnect",
    "network reconnect must use the same guarded foreground refresh",
  );
}

function checkObserverConsumers(topAsset, inventory) {
  const topBar = topLevelFunction(topAsset, "TopAssetBar");
  const inventoryView = topLevelFunction(inventory, "InventoryView");
  must(
    apiQueryCall(topBar, "identity.bootstrap") &&
      apiQueryCall(topBar, "vip.get") &&
      apiQueryCall(topBar, "wallet.get"),
    "TopAssetBar must keep its identity/assets observers on the guarded useApiQuery boundary",
  );
  must(
    apiQueryCall(inventoryView, "inventory.list"),
    "mounted or inactive inventory must keep its formal guarded inventory.list observer",
  );
}

function checkExclusiveOwnership(sources) {
  const fetchOwners = Object.entries(sources).flatMap(([name, source]) =>
    calls(source, "fetchApiQuery").map(() => name),
  );
  must(
    fetchOwners.length === 5 &&
      fetchOwners.every((owner) => owner === "coordinator"),
    "only the terminal coordinator may own room, Battle bootstrap, and terminal batch fetches",
  );
  const coordinatorDefinitions = Object.values(sources).flatMap((source) =>
    namedFunctions(source, "useBattleTerminalRefresh"),
  );
  must(
    coordinatorDefinitions.length === 1 &&
      coordinatorDefinitions[0].getSourceFile().fileName === paths.coordinator,
    "exactly one Battle terminal coordinator definition is allowed",
  );
}

function runSelfTests() {
  const fixtures = [
    [
      paths.coordinator,
      "`${generation}:${observation.roomId}:${observation.stateVersion}`",
      "`${generation}:${observation.roomId}`",
      "state_version omitted from singleflight key",
    ],
    [
      paths.coordinator,
      'fetchApiQuery("inventory.list", {}, suppressionOwner.current)',
      'fetchApiQuery("identity.bootstrap", {}, suppressionOwner.current)',
      "inactive inventory read omitted",
    ],
    [
      paths.coordinator,
      'fetchApiQuery("battle.bootstrap", {}, suppressionOwner.current)',
      'fetchApiQuery("battle.current_invite", {}, suppressionOwner.current)',
      "non-authoritative Battle path substituted",
    ],
    [
      paths.coordinator,
      "inFlight.current.delete(key);",
      "completed.current.delete(key);",
      "failed refresh left locked",
    ],
    [
      paths.coordinator,
      `.catch(() => {
          if (
            !mounted.current ||
            getSession()?.generation !== generation ||
            !matchesObservation(active.current, generation, observation)
          )
            return;`,
      `.catch(() => {
          if (false) return;`,
      "stale room or state_version failure leaked into the active UI",
    ],
    [
      paths.coordinator,
      '"battle.current_invite",',
      "",
      "current-invite observer suppression removed",
    ],
    [
      paths.coordinator,
      "terminal.roomId === roomId",
      "terminal.roomId !== roomId",
      "cancelled room rollback allowed to unlock the terminal latch",
    ],
    [
      paths.coordinator,
      "suppressApiQueries(\n          suppressionOwner.current,\n          generation,\n          terminalQueryRoutes,\n        );",
      "releaseApiQuerySuppression(suppressionOwner.current);",
      "terminal key stopped publishing synchronous observer suppression",
    ],
    [
      paths.query,
      "staleTime: 0,",
      "staleTime: 20_000,",
      "fetchQuery allowed fresh cache short-circuit",
    ],
    [
      paths.query,
      "refetchOnReconnect: false,",
      "refetchOnReconnect: true,",
      "TanStack reconnect refetch re-enabled",
    ],
    [
      paths.query,
      "enabled: enabled && !suppressed,",
      "enabled,",
      "terminal observer enabled state bypassed suppression",
    ],
    [
      paths.query,
      "assertApiQueryAllowed(generation, routeId);\n      const result = await apiRequest",
      "const result = await apiRequest",
      "ordinary queryFn network guard removed",
    ],
    [
      paths.query,
      "if (isApiQuerySuppressed(generation, routeId, suppressionOwner))",
      "if (false)",
      "canonical queryFn suppression predicate disconnected",
    ],
    [
      paths.query,
      "hasApiQuerySuppression(generation)",
      "false",
      "foreground refresh ignored an active terminal coordinator",
    ],
    [
      paths.view,
      "const roomResult = await readAuthorityRoom(authorityRoomId);\n        if (isTerminalLocked(null)) return false;",
      "const roomResult = await readAuthorityRoom(authorityRoomId);",
      "awaited room read omitted its latch recheck",
    ],
    [
      paths.view,
      "await onAuthoritativeRoom(roomResult);\n        if (isTerminalLocked(null)) {",
      "await onAuthoritativeRoom(roomResult);\n        if (false) {",
      "published room omitted its pre-bootstrap latch recheck",
    ],
    [
      paths.view,
      "const battleResult = await readAuthorityBootstrap(authorityRoomId);\n        if (isTerminalLocked(null)) return false;",
      "const battleResult = await readAuthorityBootstrap(authorityRoomId);",
      "awaited Battle bootstrap omitted its latch recheck",
    ],
    [
      paths.view,
      "identityTerminalParticipation === null,",
      "true,",
      "re-auth seeded terminal state allowed ordinary Battle bootstrap",
    ],
    [
      paths.view,
      "stateVersion: snapshot.state_version,",
      "stateVersion: 1,",
      "snapshot state_version discarded",
    ],
    [
      paths.view,
      "pageActive && roomId === null && activeTerminal === null,",
      "pageActive && roomId === null,",
      "inactive invite query re-enabled after terminal",
    ],
    [
      paths.appShell,
      'window.addEventListener("online", reconnect);',
      'window.addEventListener("offline", reconnect);',
      "network reconnect bypassed guarded foreground recovery",
    ],
    [
      paths.appShell,
      "if (started !== null && Date.now() - started >= 300_000) refresh();",
      "if (started !== null && Date.now() - started >= 300_000) return;",
      "long visibility recovery bypassed guarded foreground recovery",
    ],
    [
      paths.topAsset,
      'useApiQuery("identity.bootstrap")',
      'useApiQuery("vip.get")',
      "TopAssetBar identity observer left the guarded boundary",
    ],
    [
      paths.inventory,
      'useApiQuery("inventory.list")',
      'useApiQuery("catalog.get")',
      "inactive inventory observer left the formal inventory route",
    ],
  ];
  for (const [fileName, before, after, label] of fixtures) {
    const overrides = new Map();
    const original = fs.readFileSync(fileName, "utf8");
    must(
      original.includes(before),
      `Architecture self-test fixture is stale: ${label}`,
    );
    const mutated = original.replace(before, after);
    const fixture = ts.createSourceFile(
      fileName,
      mutated,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    must(
      fixture.parseDiagnostics.length === 0,
      `Architecture negative fixture is not valid TypeScript: ${label}`,
    );
    overrides.set(fileName, mutated);
    let rejected = false;
    try {
      runChecks(overrides);
    } catch {
      rejected = true;
    }
    must(rejected, `Architecture self-test accepted invalid fixture: ${label}`);
  }
}

function parse(fileName, overrides) {
  return ts.createSourceFile(
    fileName,
    overrides.get(fileName) ?? fs.readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function topLevelFunction(source, name) {
  const matches = namedFunctions(source, name).filter((node) =>
    ts.isFunctionDeclaration(node)
      ? node.parent === source
      : node.parent.parent.parent === source,
  );
  must(matches.length === 1, `Expected one top-level ${name} definition`);
  return matches[0];
}

function namedFunctions(root, name) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body)
      matches.push(node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      isFunction(node.initializer)
    )
      matches.push(unwrap(node.initializer));
  });
  return matches;
}

function variableFunction(root, name) {
  const declaration = variable(root, name);
  let initializer = declaration?.initializer
    ? unwrap(declaration.initializer)
    : null;
  if (
    initializer &&
    ts.isCallExpression(initializer) &&
    initializer.arguments[0]
  )
    initializer = unwrap(initializer.arguments[0]);
  must(
    initializer && isFunction(initializer),
    `Expected ${name} to be a function binding`,
  );
  return initializer;
}

function variable(root, name) {
  let result;
  walk(root, (node) => {
    if (
      !result &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    )
      result = node;
  });
  return result;
}

function apiQueryCall(root, routeId) {
  return calls(root, "useApiQuery").find(
    (call) => stringArgument(call, 0) === routeId,
  );
}

function calls(root, expectedPath) {
  if (!root) return [];
  const matches = [];
  walk(root, (node) => {
    if (ts.isCallExpression(node) && callPath(node.expression) === expectedPath)
      matches.push(node);
  });
  return matches;
}

function forbiddenQueryMethods(root) {
  const forbidden = new Set([
    "queryClient.invalidateQueries",
    "queryClient.refetchQueries",
    "queryClient.ensureQueryData",
    "invalidateQueries",
    "refetchQueries",
    "ensureQueryData",
    "refreshScopes",
    "refreshRouteScopes",
  ]);
  const matches = [];
  walk(root, (node) => {
    if (ts.isCallExpression(node) && forbidden.has(callPath(node.expression)))
      matches.push(node);
  });
  return matches;
}

function callPath(expression) {
  const node = unwrap(expression);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = callPath(node.expression);
    return left ? `${left}.${node.name.text}` : node.name.text;
  }
  if (ts.isElementAccessExpression(node)) {
    const left = callPath(node.expression);
    const argument = expressionValue(node.argumentExpression);
    return left ? `${left}[${argument}]` : `[${argument}]`;
  }
  return "";
}

function objectArgument(call, index) {
  if (!call?.arguments[index]) return null;
  const argument = unwrap(call.arguments[index]);
  return ts.isObjectLiteralExpression(argument) ? argument : null;
}

function objectPropertyExpression(object, name) {
  const property = object?.properties.find(
    (candidate) =>
      (ts.isPropertyAssignment(candidate) ||
        ts.isShorthandPropertyAssignment(candidate) ||
        ts.isMethodDeclaration(candidate)) &&
      propertyName(candidate.name) === name,
  );
  if (!property) return null;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return property.initializer ?? property;
}

function objectPropertyObject(object, name) {
  const expression = objectPropertyExpression(object, name);
  const unwrapped = expression ? unwrap(expression) : null;
  return unwrapped && ts.isObjectLiteralExpression(unwrapped)
    ? unwrapped
    : null;
}

function functionProperty(object, name) {
  const expression = objectPropertyExpression(object, name);
  const unwrapped = expression ? unwrap(expression) : null;
  return unwrapped && isFunction(unwrapped) ? unwrapped : null;
}

function booleanProperty(object, name) {
  const expression = objectPropertyExpression(object, name);
  return expression?.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : expression?.kind === ts.SyntaxKind.FalseKeyword
      ? false
      : undefined;
}

function numberProperty(object, name) {
  const expression = unwrap(objectPropertyExpression(object, name));
  return expression && ts.isNumericLiteral(expression)
    ? Number(expression.text.replaceAll("_", ""))
    : undefined;
}

function objectHasShorthand(object, name) {
  return Boolean(
    object?.properties.some(
      (property) =>
        ts.isShorthandPropertyAssignment(property) &&
        property.name.text === name,
    ),
  );
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : "";
}

function stringArgument(call, index) {
  const argument = unwrap(call?.arguments[index]);
  return argument && ts.isStringLiteralLike(argument) ? argument.text : "";
}

function arrayStrings(expression) {
  const array = unwrap(expression);
  return array && ts.isArrayLiteralExpression(array)
    ? array.elements
        .map((element) => unwrap(element))
        .filter(ts.isStringLiteralLike)
        .map((element) => element.text)
    : [];
}

function expressionValue(expression) {
  if (!expression) return "";
  const node = unwrap(expression);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
    return node.text;
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isPropertyAccessExpression(node)) return callPath(node);
  if (ts.isElementAccessExpression(node))
    return `${expressionValue(node.expression)}[${expressionValue(node.argumentExpression)}]`;
  return node.getText(node.getSourceFile());
}

function propertyPaths(root) {
  const pathsFound = [];
  if (!root) return pathsFound;
  walk(root, (node) => {
    if (ts.isPropertyAccessExpression(node)) pathsFound.push(callPath(node));
  });
  return [...new Set(pathsFound)];
}

function identifiers(root) {
  const names = [];
  if (!root) return names;
  walk(root, (node) => {
    if (ts.isIdentifier(node)) names.push(node.text);
  });
  return names;
}

function bindingNames(binding) {
  if (!binding) return [];
  if (ts.isIdentifier(binding)) return [binding.text];
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding))
    return binding.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingNames(element.name) : [],
    );
  return [];
}

function returnExpressions(root) {
  const expressions = [];
  walk(root, (node) => {
    if (ts.isReturnStatement(node) && node.expression)
      expressions.push(node.expression);
  });
  return expressions;
}

function returnStatements(root) {
  const statements = [];
  walk(root, (node) => {
    if (ts.isReturnStatement(node)) statements.push(node);
  });
  return statements;
}

function throwStatements(root) {
  const statements = [];
  walk(root, (node) => {
    if (ts.isThrowStatement(node)) statements.push(node);
  });
  return statements;
}

function assignments(root) {
  const matches = [];
  walk(root, (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      matches.push(node);
  });
  return matches;
}

function binaryExpressions(root) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isBinaryExpression(node)) matches.push(node);
  });
  return matches;
}

function ifStatements(root) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isIfStatement(node)) matches.push(node);
  });
  return matches;
}

function objectLiterals(root) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isObjectLiteralExpression(node)) matches.push(node);
  });
  return matches;
}

function enclosingIf(root, target, predicate) {
  return ifStatements(root).find(
    (node) => predicate(node) && containsNode(node.thenStatement, target),
  );
}

function containsNode(root, target) {
  if (!root || !target) return false;
  if (root === target) return true;
  let found = false;
  walk(root, (node) => {
    if (node === target) found = true;
  });
  return found;
}

function isNegatedCall(expression, name) {
  const node = unwrap(expression);
  return (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken &&
    calls(node.operand, name).length === 1
  );
}

function isNegatedIdentifier(expression, name) {
  const node = unwrap(expression);
  return (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken &&
    expressionValue(node.operand) === name
  );
}

function latchCheckBetween(root, start, end) {
  if (!start || !end) return false;
  return ifStatements(root).some(
    (node) =>
      node.pos > start.end &&
      node.pos < end.pos &&
      calls(node.expression, "isTerminalLocked").some(
        (call) => expressionValue(call.arguments[0]) === "null",
      ) &&
      returnStatements(node.thenStatement).length >= 1,
  );
}

function numericValue(expression) {
  const node = unwrap(expression);
  return node && ts.isNumericLiteral(node)
    ? Number(node.text.replaceAll("_", ""))
    : undefined;
}

function isRefCollection(initializer, collection) {
  const callsFound = calls(initializer, "useRef");
  if (callsFound.length !== 1) return false;
  const argument = unwrap(callsFound[0].arguments[0]);
  return (
    argument &&
    ts.isNewExpression(argument) &&
    callPath(argument.expression) === collection
  );
}

function isFunction(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function unwrap(expression) {
  let node = expression;
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node))
  )
    node = node.expression;
  return node;
}

function walk(root, visit) {
  if (!root) return;
  visit(root);
  ts.forEachChild(root, (child) => walk(child, visit));
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}
