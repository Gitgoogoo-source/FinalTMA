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
  persistentPages: path.join(
    ROOT,
    "apps/web/src/app/router/PersistentPages.tsx",
  ),
  topAsset: path.join(ROOT, "apps/web/src/app/shell/TopAssetBar.tsx"),
  inventory: path.join(
    ROOT,
    "apps/web/src/domains/inventory/ui/InventoryView.tsx",
  ),
};
const protectedRoutes = new Set([
  "battle.room",
  "battle.bootstrap",
  "identity.bootstrap",
  "inventory.list",
]);
const terminalStatuses = new Set([
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
]);
const terminalBatchRoutes = new Set([
  "battle.bootstrap",
  "identity.bootstrap",
  "inventory.list",
]);
const postAcknowledgeBatchRoutes = new Set([
  "battle.bootstrap",
  "identity.bootstrap",
]);
const authorityCancellationRoutes = new Set([
  "battle.bootstrap",
  "battle.room",
  "battle.current_invite",
  "battle.team_options",
]);

try {
  runChecks();
  if (process.argv.includes("--self-test")) runSelfTests();
  process.stdout.write(
    `Battle terminal authority ownership is structurally valid${
      process.argv.includes("--self-test")
        ? " and syntax-valid negative fixtures are effective"
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
  const webSources = sourceFiles(path.join(ROOT, "apps/web/src"), overrides);
  checkNoDirectProtectedReads(webSources);
  checkQueryBoundary(sources.query);
  checkCoordinator(sources.coordinator);
  checkView(sources.view);
  checkCommand(sources.command);
  checkRealtime(sources.realtime);
  checkRouteLifecycle(sources.persistentPages);
  checkAppShell(sources.appShell);
  checkObserverConsumers(sources.topAsset, sources.inventory);
  checkExclusiveOwnership(webSources);
}

function checkNoDirectProtectedReads(sources) {
  const bypasses = sources.flatMap((source) =>
    calls(source, "apiRequest")
      .filter((call) => protectedRoutes.has(stringArgument(call, 0)))
      .map((call) => `${source.fileName}:${lineOf(call)}`),
  );
  must(
    bypasses.length === 0,
    `Protected Battle authority reads bypass the formal owner boundary: ${bypasses.join(", ")}`,
  );
  const roomObserverBypasses = sources.flatMap((source) =>
    ["useApiQuery", "fetchApiQuery", "prefetchApiQuery"].flatMap((callee) =>
      calls(source, callee)
        .filter((call) => stringArgument(call, 0) === "battle.room")
        .map((call) => `${source.fileName}:${lineOf(call)}`),
    ),
  );
  must(
    roomObserverBypasses.length === 0,
    `battle.room may only be read by the authority owner batch: ${roomObserverBypasses.join(", ")}`,
  );
}

function checkQueryBoundary(source) {
  const client = variable(source, "queryClient");
  const constructor =
    client?.initializer && ts.isNewExpression(client.initializer)
      ? client.initializer
      : null;
  const defaults = objectPropertyObject(
    objectArgument(constructor, 0),
    "defaultOptions",
  );
  const queryDefaults = objectPropertyObject(defaults, "queries");
  must(
    booleanProperty(queryDefaults, "retry") === false &&
      booleanProperty(queryDefaults, "refetchOnWindowFocus") === false &&
      booleanProperty(queryDefaults, "refetchOnReconnect") === false,
    "TanStack retry, focus refetch, and reconnect refetch must stay disabled",
  );

  const ownerBatch = topLevelFunction(source, "fetchApiQueryBatchAsOwner");
  const ownerRegistration = calls(ownerBatch, "ownedApiQueries.set");
  const ownerRequests = calls(ownerBatch, "executeApiQueryRequest");
  const ownerCancellation = calls(ownerBatch, "cancelApiQueries");
  const cancellation = variable(ownerBatch, "cancellation");
  const cancellationAwait = awaitExpressions(ownerBatch).find(
    (node) => expressionValue(node.expression) === "cancellation",
  );
  const conflictWait = awaitExpressions(ownerBatch).find(
    (node) => calls(node.expression, "conflict.task.catch").length === 1,
  );
  const resultBatch = calls(ownerBatch, "Promise.all").find(
    (call) => calls(call, "executeApiQueryRequest").length === 1,
  );
  const cacheWrites = calls(ownerBatch, "queryClient.setQueryData");
  must(
    ownerRegistration.length === 1 &&
      ownerRequests.length === 1 &&
      ownerCancellation.length === 1 &&
      cancellation?.initializer === ownerCancellation[0] &&
      cancellationAwait &&
      conflictWait &&
      ownerRegistration[0].pos < ownerCancellation[0]?.pos &&
      ownerCancellation[0].pos < cancellationAwait.pos &&
      cancellationAwait.pos < conflictWait.pos &&
      conflictWait.pos < ownerRequests[0].pos &&
      resultBatch &&
      cacheWrites.length === 1 &&
      resultBatch.pos < cacheWrites[0].pos,
    "owned batches must reserve every key, synchronously start old-observer cancellation before handoff waits, then execute one formal Promise.all and write formal caches",
  );
  must(
    propertyPaths(ownerBatch).includes("conflict.task") &&
      calls(ownerBatch, "conflict.task.catch").length === 1 &&
      calls(ownerBatch, "throwIfAborted").length >= 2 &&
      calls(ownerBatch, "assertCurrentSession").length >= 2,
    "owned batch handoff must wait prior owners only after cancellation has started and recheck abort plus generation around asynchronous boundaries",
  );

  const ownerCancellationFunction = topLevelFunction(
    source,
    "cancelApiQueryOwner",
  );
  must(
    calls(ownerCancellationFunction, "batch.controller.abort").length === 1,
    "only an explicit owner cancellation may abort an owned network batch",
  );

  const formalQuery = topLevelFunction(source, "executeApiQuery");
  const ownedWait = awaitExpressions(formalQuery).find(
    (node) => expressionValue(node.expression) === "owned.task",
  );
  const successorRead = calls(formalQuery, "ownedApiQueries.get").at(-1);
  const ownedCacheRead = calls(formalQuery, "getApiQueryData");
  const ordinaryGate = calls(formalQuery, "assertApiQueryAllowed");
  const ordinaryRequest = calls(formalQuery, "executeApiQueryRequest");
  must(
    ownedWait &&
      successorRead &&
      ordinaryGate.length === 1 &&
      ordinaryRequest.length === 1 &&
      ownedCacheRead.length === 1 &&
      ownedWait.pos < successorRead.pos &&
      successorRead.pos < ownedCacheRead[0].pos &&
      successorRead.pos < ordinaryGate[0].pos &&
      ordinaryGate[0].pos < ordinaryRequest[0].pos,
    "ordinary queryFns must await the current owner and every handoff before they may perform network I/O",
  );
  must(
    propertyPaths(formalQuery).includes("signal.aborted") === false &&
      calls(formalQuery, "throwIfAborted").length === 1,
    "observer cancellation must only stop the waiter after owner completion, never control the owner signal",
  );

  const network = topLevelFunction(source, "executeApiQueryRequest");
  const networkRequests = calls(network, "apiRequest");
  must(
    networkRequests.length === 1 &&
      expressionValue(networkRequests[0].arguments[0]) === "routeId" &&
      expressionValue(networkRequests[0].arguments[1]) === "input" &&
      objectHasShorthand(objectArgument(networkRequests[0], 2), "signal") &&
      calls(network, "assertCurrentSession").length === 1,
    "all formal query network reads must share one API/session-guarded executor",
  );

  for (const functionName of [
    "prefetchApiQuery",
    "fetchApiQuery",
    "useApiQuery",
  ])
    must(
      calls(topLevelFunction(source, functionName), "executeApiQuery")
        .length === 1,
      `${functionName} must use the owner-aware formal query executor`,
    );

  const observer = topLevelFunction(source, "useApiQuery");
  const observerQuery = calls(observer, "useQuery");
  const observerOptions = objectArgument(observerQuery[0], 0);
  const enabled = unwrap(objectPropertyExpression(observerOptions, "enabled"));
  const guardedRefetch = variableFunction(observer, "refetch");
  const refetchCall = calls(guardedRefetch, "query.refetch");
  must(
    calls(observer, "useSyncExternalStore").length === 1 &&
      enabled &&
      ts.isBinaryExpression(enabled) &&
      expressionValue(enabled.left) === "enabled" &&
      isNegatedIdentifier(enabled.right, "suppressed") &&
      booleanProperty(observerOptions, "refetchOnReconnect") === false,
    "ordinary observers must subscribe to route suppression and remain disabled behind it",
  );
  must(
    refetchCall.length === 1 &&
      booleanProperty(objectArgument(refetchCall[0], 0), "cancelRefetch") ===
        false,
    "manual observer refetch must never use cancelRefetch=true",
  );

  for (const call of [
    ...calls(source, "queryClient.invalidateQueries"),
    ...calls(source, "queryClient.refetchQueries"),
  ])
    must(
      booleanProperty(objectArgument(call, 1), "cancelRefetch") === false,
      `ordinary invalidate/refetch must use cancelRefetch=false at ${source.fileName}:${lineOf(call)}`,
    );

  const invalidator = topLevelFunction(source, "invalidateApiQueries");
  must(
    calls(invalidator, "isApiQuerySuppressed").length === 1,
    "exact-route invalidation must respect active route suppression",
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
      `${functionName} must exclude route-suppressed queries`,
    );
}

function checkCoordinator(source) {
  must(
    sameSet(
      new Set(arrayStrings(variable(source, "terminalStatuses")?.initializer)),
      terminalStatuses,
    ),
    "terminal predicate must keep the exact five authoritative terminal states",
  );
  must(
    sameSet(
      new Set(
        requestArrayRoutes(variable(source, "terminalRequests")?.initializer),
      ),
      terminalBatchRoutes,
    ),
    "terminal batch must contain exactly Battle bootstrap, identity bootstrap, and inventory",
  );
  must(
    sameSet(
      new Set(
        requestArrayRoutes(
          variable(source, "postAcknowledgeRequests")?.initializer,
        ),
      ),
      postAcknowledgeBatchRoutes,
    ),
    "post-ack authority proof must read exactly Battle and identity bootstrap without repeating inventory",
  );
  must(
    sameSet(
      new Set(
        arrayStrings(
          variable(source, "authorityCancellationRoutes")?.initializer,
        ),
      ),
      authorityCancellationRoutes,
    ),
    "authority recovery must cancel every Battle observer tail",
  );
  const terminalCancellation = variable(
    source,
    "terminalCancellationRoutes",
  )?.initializer;
  must(
    spreadIdentifiers(terminalCancellation).includes(
      "authorityCancellationRoutes",
    ) &&
      sameSet(
        new Set(arrayStrings(terminalCancellation)),
        new Set(["identity.bootstrap", "inventory.list"]),
      ),
    "terminal latch cancellation must extend authority tails with identity and inventory",
  );

  const hook = topLevelFunction(source, "useBattleTerminalRefresh");
  const externalStore = calls(hook, "useSyncExternalStore")[0];
  const getSnapshot = externalStore?.arguments[1];
  must(
    sameArray(
      hook.parameters.map((parameter) => expressionValue(parameter.name)),
      ["sessionGeneration", "routeActive"],
    ) &&
      calls(hook, "useSyncExternalStore").length === 1 &&
      calls(hook, "useLayoutEffect").length === 2 &&
      calls(hook, "setRouteActive").length >= 2 &&
      calls(getSnapshot, "coordinatorVersion").length === 1 &&
      calls(getSnapshot, "coordinatorFor").length === 0 &&
      calls(hook, "coordinatorFor").length === 0 &&
      calls(hook, "coordinators.set").length === 0,
    "React must subscribe to one external coordinator and bind suppression to the real route-active lifecycle",
  );
  const routeCalls = calls(hook, "setRouteActive");
  must(
    routeCalls.some(
      (call) => expressionValue(call.arguments[2]) === "routeActive",
    ) &&
      routeCalls.some((call) => expressionValue(call.arguments[2]) === "false"),
    "route activation must be published and cleanup must explicitly release it",
  );

  const routeSetter = topLevelFunction(source, "setRouteActive");
  must(
    calls(routeSetter, "syncRouteSuppression").length === 1 &&
      calls(routeSetter, "cancelApiQueryOwner").length === 0 &&
      calls(routeSetter, "coordinatorFor").length === 1 &&
      calls(routeSetter, "coordinators.get").length === 1 &&
      calls(routeSetter, "isCurrentGeneration").length === 1 &&
      calls(routeSetter, "state.completed.clear").length === 0 &&
      calls(routeSetter, "state.completed.delete").length === 0,
    "route activation may create a coordinator, but route cleanup cannot recreate stale generation state, cancel owners, or erase terminal success memory",
  );
  const subscription = topLevelFunction(source, "subscribeCoordinator");
  must(
    calls(subscription, "isCurrentGeneration").length === 1 &&
      calls(subscription, "coordinatorFor").length === 1,
    "subscription effects may create only the current session generation coordinator",
  );
  const suppression = topLevelFunction(source, "syncRouteSuppression");
  const suppressionIdentifiers = new Set(identifiers(suppression));
  must(
    calls(suppression, "suppressApiQueries").length === 1 &&
      calls(suppression, "releaseApiQuerySuppression").length === 1 &&
      ["routeOwners", "active", "recoveryRoomId"].every((name) =>
        suppressionIdentifiers.has(name),
      ) &&
      calls(suppression, "cancelApiQueryOwner").length === 0,
    "route-scoped suppression must depend on active route plus authority state and never own network cancellation",
  );

  const reporter = topLevelFunction(source, "reportTerminalObservation");
  const key = variable(reporter, "key")?.initializer;
  const activeWrite = assignments(reporter).find(
    (node) => expressionValue(node.left) === "state.active",
  );
  const completed = calls(reporter, "state.completed.has");
  const completedBeforeActive = completed.find(
    (call) => activeWrite && call.pos < activeWrite.pos,
  );
  const completedAfterActive = completed.find(
    (call) => activeWrite && call.pos > activeWrite.pos,
  );
  const existing = calls(
    variable(reporter, "existing")?.initializer,
    "state.terminalInFlight.get",
  );
  const batch = calls(reporter, "fetchApiQueryBatchAsOwner");
  const inFlightWrite = calls(reporter, "state.terminalInFlight.set");
  must(
    calls(reporter, "Number.isSafeInteger").length === 1 &&
      calls(reporter, "isCurrentGeneration").length >= 1 &&
      key &&
      calls(key, "terminalRefreshKey").length === 1,
    "terminal observations must validate generation/state_version and use the canonical versioned key",
  );
  must(
    activeWrite &&
      completedBeforeActive &&
      completedAfterActive &&
      existing.length === 1 &&
      batch.length === 1 &&
      inFlightWrite.length === 1 &&
      completedBeforeActive.pos < activeWrite.pos &&
      activeWrite.pos < completedAfterActive.pos &&
      completedAfterActive.pos < existing[0].pos &&
      existing[0].pos < batch[0].pos &&
      batch[0].pos < inFlightWrite[0].pos &&
      expressionValue(batch[0].arguments[0]) === "terminalOwner" &&
      expressionValue(batch[0].arguments[1]) === "terminalRequests" &&
      expressionValue(
        objectPropertyExpression(objectArgument(batch[0], 2), "cancelRouteIds"),
      ) === "terminalCancellationRoutes",
    "completed terminal memory must prevent stale relatching while an active terminal still latches before singleflight and its protected batch",
  );
  const thenCallback = callbackOfCall(calls(reporter, "batch.then")[0]);
  const catchCallback = callbackOfCall(calls(reporter, "catch")[0]);
  const finallyCallback = callbackOfCall(calls(reporter, "finally")[0]);
  const terminalBattleProof = calls(thenCallback, "getApiQueryData").find(
    (call) => stringArgument(call, 1) === "battle.bootstrap",
  );
  const terminalIdentityProof = calls(thenCallback, "getApiQueryData").find(
    (call) => stringArgument(call, 1) === "identity.bootstrap",
  );
  const resultlessActiveClear = assignments(thenCallback).find(
    (node) =>
      expressionValue(node.left) === "state.active" &&
      expressionValue(node.right) === "null",
  );
  must(
    calls(thenCallback, "isCurrentObservation").length === 1 &&
      calls(thenCallback, "state.completed.add").length === 1 &&
      terminalBattleProof &&
      terminalIdentityProof &&
      resultlessActiveClear &&
      calls(thenCallback, "syncRouteSuppression").length === 1 &&
      calls(catchCallback, "isCurrentObservation").length === 1 &&
      calls(catchCallback, "state.completed.add").length === 0 &&
      assignments(catchCallback).some(
        (node) => expressionValue(node.left) === "state.failure",
      ) &&
      calls(finallyCallback, "state.terminalInFlight.delete").length === 1,
    "only a current all-success batch may be remembered; authoritative resultless terminals must release active suppression while failure remains retryable",
  );

  const prepareAcknowledge = topLevelFunction(source, "prepareAcknowledgement");
  const terminalRetry = calls(prepareAcknowledge, "reportTerminalObservation");
  const prepareCompleted = calls(prepareAcknowledge, "state.completed.has");
  must(
    terminalRetry.length === 1 &&
      awaitExpressions(prepareAcknowledge).some((node) =>
        containsNode(node, terminalRetry[0]),
      ) &&
      prepareCompleted.length === 1 &&
      terminalRetry[0].pos < prepareCompleted[0].pos &&
      calls(prepareAcknowledge, "isCurrentObservation").length === 1,
    "acknowledge cannot be submitted until the current generation/room/version terminal batch has completed successfully",
  );

  const acknowledge = topLevelFunction(source, "confirmAcknowledgedResult");
  const acknowledgeCompleted = calls(acknowledge, "state.completed.has");
  const acknowledgeBatch = calls(acknowledge, "fetchApiQueryBatchAsOwner");
  const acknowledgeThen = callbackOfCall(calls(acknowledge, "batch.then")[0]);
  const battleProof = calls(acknowledgeThen, "getApiQueryData").find(
    (call) => stringArgument(call, 1) === "battle.bootstrap",
  );
  const identityProof = calls(acknowledgeThen, "getApiQueryData").find(
    (call) => stringArgument(call, 1) === "identity.bootstrap",
  );
  const activeClear = assignments(acknowledgeThen).find(
    (node) =>
      expressionValue(node.left) === "state.active" &&
      expressionValue(node.right) === "null",
  );
  must(
    acknowledgeCompleted.length === 1 &&
      acknowledgeBatch.length === 1 &&
      acknowledgeCompleted[0].pos < acknowledgeBatch[0].pos &&
      expressionValue(acknowledgeBatch[0].arguments[1]) ===
        "postAcknowledgeRequests" &&
      calls(
        variable(acknowledge, "existing")?.initializer,
        "state.acknowledgeInFlight.get",
      ).length === 1 &&
      calls(acknowledge, "state.acknowledgeInFlight.set").length === 1,
    "post-ack recovery must retain successful terminal memory and singleflight a distinct authoritative bootstrap proof",
  );
  must(
    battleProof &&
      identityProof &&
      activeClear &&
      battleProof.pos < activeClear.pos &&
      identityProof.pos < activeClear.pos &&
      calls(acknowledgeThen, "isCurrentObservation").length === 1 &&
      calls(acknowledgeThen, "syncRouteSuppression").length === 1 &&
      calls(acknowledgeThen, "publishCoordinator").length === 1 &&
      calls(acknowledge, "state.completed.clear").length === 0 &&
      calls(acknowledge, "state.completed.delete").length === 0,
    "only a generation/room/version-current post-ack bootstrap proof may clear active suppression, and completed terminal memory must remain intact",
  );

  const roomReader = topLevelFunction(source, "readCoordinatorRoom");
  const roomBatch = calls(roomReader, "fetchApiQueryBatchAsOwner");
  const roomRequest = arrayArgument(roomBatch[0], 1);
  const roomThen = callbackOfCall(calls(roomReader, "then")[0]);
  const roomCatch = callbackOfCall(calls(roomReader, "catch")[0]);
  const roomExisting = calls(
    variable(roomReader, "existing")?.initializer,
    "state.roomInFlight.get",
  );
  must(
    roomBatch.length === 1 &&
      requestArrayRoutes(roomRequest).length === 1 &&
      requestArrayRoutes(roomRequest)[0] === "battle.room" &&
      expressionValue(roomBatch[0].arguments[0]) === "state.discoveryOwner" &&
      roomExisting.length === 1 &&
      calls(roomReader, "state.roomInFlight.set").length === 1 &&
      calls(roomReader, "apiRequest").length === 0,
    "every room recovery must use one coordinator-owned room singleflight without a direct network path",
  );
  must(
    calls(roomThen, "isCurrentGeneration").length === 1 &&
      propertyPaths(roomThen).includes("state.active") &&
      propertyPaths(roomThen).includes("state.recoveryRoomId") &&
      calls(roomThen, "getApiQueryData").length === 1,
    "room owner completion must recheck generation, terminal latch, and room lifecycle before consuming cache",
  );
  must(
    calls(roomCatch, "finishCoordinatorRecovery").length === 1 &&
      throwStatements(roomCatch).length === 1,
    "a genuine room owner failure must release recovery suppression and remain retryable",
  );

  const recovery = topLevelFunction(source, "beginCoordinatorRecovery");
  const discoveryCancellation = calls(recovery, "cancelApiQueryOwner").find(
    (call) => expressionValue(call.arguments[0]) === "state.discoveryOwner",
  );
  must(
    propertyPaths(recovery).includes("state.active.roomId") &&
      calls(recovery, "cancelTerminalOwners").length === 1 &&
      Boolean(discoveryCancellation) &&
      assignments(recovery).some(
        (node) => expressionValue(node.left) === "state.recoveryRoomId",
      ),
    "a different room must supersede old discovery and terminal ownership while the same terminal room stays locked",
  );
  for (const functionName of [
    "setRouteActive",
    "syncRouteSuppression",
    "finishCoordinatorRecovery",
    "confirmAcknowledgedResult",
  ]) {
    const fn = topLevelFunction(source, functionName);
    must(
      calls(fn, "state.completed.clear").length === 0 &&
        calls(fn, "state.completed.delete").length === 0,
      `${functionName} cannot erase same-terminal success memory`,
    );
  }

  const keyFunction = topLevelFunction(source, "terminalRefreshKey");
  const keyReturn = returnExpressions(keyFunction)[0];
  must(
    keyReturn &&
      ts.isTemplateExpression(unwrap(keyReturn)) &&
      identifiers(keyReturn).includes("generation") &&
      propertyPaths(keyReturn).includes("observation.roomId") &&
      propertyPaths(keyReturn).includes("observation.stateVersion"),
    "terminal success key must be generation + room_id + terminal state_version",
  );
}

function checkView(source) {
  const view = topLevelFunction(source, "BattleView");
  const coordinator = calls(view, "useBattleTerminalRefresh");
  must(
    coordinator.length === 1 &&
      sameArray(
        coordinator[0].arguments.map((argument) => expressionValue(argument)),
        ["sessionGeneration", "pageActive"],
      ),
    "BattleView must bind the shared coordinator to the persistent page's real active state",
  );

  const authority = variableFunction(view, "runAuthorityRefresh");
  const authorityRoomId = variable(view, "authorityRoomId")?.initializer;
  const roomRead = calls(authority, "readAuthorityRoom");
  const roomPublish = calls(authority, "onAuthoritativeRoom").find(
    (call) => expressionValue(call.arguments[0]) === "roomResult",
  );
  const terminalRetry = calls(authority, "reportTerminal").find(
    (call) => expressionValue(call.arguments[0]) === "activeTerminal",
  );
  must(
    authorityRoomId &&
      identifiers(authorityRoomId).includes("room") &&
      identifiers(authorityRoomId).includes("roomId") &&
      !identifiers(authorityRoomId).includes("inviteRoom") &&
      terminalRetry &&
      awaitExpressions(authority).some((node) =>
        containsNode(node, terminalRetry),
      ) &&
      latchCheckBetween(authority, terminalRetry, roomRead[0]) &&
      roomRead.length === 1 &&
      roomPublish &&
      calls(authority, "readAuthorityBootstrap").length === 0 &&
      roomRead[0].pos < roomPublish.pos &&
      latchCheckBetween(authority, roomRead[0], roomPublish) &&
      latchCheckBetween(
        authority,
        roomPublish,
        assignments(authority).find(
          (node) =>
            node.pos > roomPublish.end &&
            expressionValue(node.left) === "authorityHealthy.current",
        ),
      ),
    "only participant-proven room state may select the room authority path; authority triggers must retry the current terminal owner, then use one room GET with latch rechecks and no bootstrap tail",
  );
  const discoveryBatch = calls(authority, "Promise.all");
  const discoveryAwait = discoveryBatch[0];
  must(
    discoveryBatch.length === 1 &&
      calls(discoveryAwait, "refetchBootstrap").length === 1 &&
      calls(discoveryAwait, "refetchInvite").length === 1 &&
      ifStatements(authority).some(
        (node) =>
          node.pos > discoveryAwait.pos &&
          calls(node.expression, "isTerminalLocked").length === 1,
      ),
    "no-room discovery must retain bootstrap/invite and recheck the terminal latch after its await",
  );

  const command = calls(view, "useBattleCommand");
  must(
    command.length === 1 &&
      sameArray(
        command[0].arguments.map((argument) => expressionValue(argument)),
        ["refetchAuthorityVoid", "onAuthoritativeRoom", "readAuthorityRoom"],
      ),
    "command create/cancel/failure recovery must receive the same room owner reader",
  );
  const bootstrapObserver = calls(view, "useApiQuery").find(
    (call) => stringArgument(call, 0) === "battle.bootstrap",
  );
  const identityObserver = calls(view, "useApiQuery").find(
    (call) => stringArgument(call, 0) === "identity.bootstrap",
  );
  const inviteObserver = calls(view, "useApiQuery").find(
    (call) => stringArgument(call, 0) === "battle.current_invite",
  );
  const bootstrapEnabledIdentifiers = new Set(
    identifiers(bootstrapObserver?.arguments[2]),
  );
  must(
    calls(view, "getApiQueryData").length === 2 &&
      calls(
        variable(view, "cachedTerminalPresent")?.initializer,
        "terminalObservationsFor",
      ).length === 1 &&
      ["activeTerminal", "cachedTerminalPresent"].every((name) =>
        identifiers(identityObserver?.arguments[2]).includes(name),
      ) &&
      ["activeTerminal", "cachedTerminalPresent"].every((name) =>
        identifiers(inviteObserver?.arguments[2]).includes(name),
      ) &&
      [
        "activeTerminal",
        "cachedTerminalPresent",
        "identityTerminalParticipation",
      ].every((name) => bootstrapEnabledIdentifiers.has(name)),
    "formal cached terminal snapshots must disable ordinary identity, Battle bootstrap, and invite observers before effects run",
  );
  must(
    calls(view, "registerForegroundAuthorityRefresh").length === 1 &&
      calls(
        variableFunction(view, "prepareRecovery"),
        "prepareAuthorityRecovery",
      ).length === 1,
    "foreground, reconnect, visibility, and presence recovery must enter the shared authority boundary",
  );
  const pageInactiveEffects = calls(view, "finishAuthorityRecovery").filter(
    (call) =>
      enclosingIf(view, call, (node) =>
        identifiers(node.expression).includes("pageActive"),
      ),
  );
  must(
    pageInactiveEffects.length === 0,
    "leaving /game cannot finish or cancel an in-flight authority owner",
  );

  const realtime = calls(view, "useBattleRealtime");
  const realtimeOptions = objectArgument(realtime[0], 0);
  must(
    realtime.length === 1 &&
      calls(
        objectPropertyExpression(realtimeOptions, "enabled"),
        "isTerminalLocked",
      ).length === 1 &&
      expressionValue(objectPropertyExpression(realtimeOptions, "refetch")) ===
        "refetchAuthorityVoid",
    "realtime and poll must use the same latch-protected authority callback",
  );

  const heartbeat = variableFunction(view, "heartbeat");
  must(
    calls(heartbeat, "onAuthoritativeRoom").some(
      (call) => expressionValue(call.arguments[0]) === "response.data",
    ),
    "presence responses must publish their authoritative snapshot before any recovery",
  );
  const observationEffect = calls(view, "reportTerminal");
  must(
    observationEffect.some(
      (call) => expressionValue(call.arguments[0]) === "observation",
    ),
    "seeded/bootstrap/room terminal observations must enter the same reporter",
  );

  const acknowledge = variableFunction(view, "acknowledge");
  const acknowledgeRequest = calls(acknowledge, "apiRequest").find(
    (call) => stringArgument(call, 0) === "battle.acknowledge_result",
  );
  const acknowledgeProof = calls(acknowledge, "confirmTerminalAcknowledged");
  const acknowledgePreparation = calls(
    acknowledge,
    "prepareTerminalAcknowledgement",
  );
  const dismiss = calls(acknowledge, "setDismissedResult");
  must(
    acknowledgeRequest &&
      acknowledgePreparation.length === 1 &&
      acknowledgeProof.length === 1 &&
      dismiss.length === 1 &&
      acknowledgePreparation[0].pos < acknowledgeRequest.pos &&
      acknowledgeRequest.pos < acknowledgeProof[0].pos &&
      acknowledgeProof[0].pos < dismiss[0].pos &&
      calls(acknowledge, "refetchAuthority").length === 0 &&
      calls(acknowledge, "setRoom").length === 1,
    "acknowledge must complete the old terminal batch before submission, then perform post-ack authority proof before dismissing the result and matching local room",
  );
}

function checkCommand(source) {
  const hook = topLevelFunction(source, "useBattleCommand");
  must(
    sameArray(
      hook.parameters.map((parameter) => expressionValue(parameter.name)),
      ["refetchAuthority", "onAuthoritativeRoom", "readAuthoritativeRoom"],
    ) && calls(hook, "useRef").length >= 3,
    "Battle commands must receive and retain the shared authority reader",
  );
  const resultReader = topLevelFunction(source, "authoritativeRoomFromResult");
  const resultRead = calls(resultReader, "readAuthoritativeRoom");
  must(
    resultRead.length === 1 &&
      stringArgument(resultRead[0], 0) === "" &&
      expressionValue(resultRead[0].arguments[0]) === "commandResult.room_id" &&
      awaitExpressions(resultReader).some((node) =>
        containsNode(node, resultRead[0]),
      ) &&
      calls(resultReader, "assertGeneration").length === 1,
    "create/cancel result recovery must await the injected room owner and recheck generation",
  );
  const failure = topLevelFunction(source, "refreshBattleCommandFailure");
  const acceptGuard = ifStatements(failure).find(
    (node) =>
      findBinaryComparison(
        node.expression,
        "routeId",
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        "battle.accept",
      ) && calls(node.thenStatement, "readAuthoritativeRoom").length === 1,
  );
  must(
    calls(failure, "readAuthoritativeRoom").length === 1 &&
      calls(failure, "onAuthoritativeRoom").length === 1 &&
      acceptGuard &&
      calls(failure, "refetchAuthority").length === 1,
    "participant terminal failures may use the room reader, but accept failures must bypass it and return through current-invite discovery",
  );
  const apply = topLevelFunction(source, "applyBattleCommandResult");
  const publish = calls(apply, "onAuthoritativeRoom");
  const refresh = calls(apply, "refreshRouteScopes");
  must(
    publish.length === 1 &&
      refresh.length === 1 &&
      publish[0].pos < refresh[0].pos &&
      enclosingIf(apply, refresh[0], (node) =>
        isNegatedCall(node.expression, "isBattleAssetTerminal"),
      ),
    "command snapshots must publish/latch before any non-terminal scope refresh",
  );
}

function checkRealtime(source) {
  const hook = topLevelFunction(source, "useBattleRealtime");
  must(
    calls(hook, "apiRequest").every(
      (call) => stringArgument(call, 0) === "battle.realtime_token",
    ) &&
      calls(variableFunction(hook, "runRefetch"), "refetchRef.current")
        .length === 1,
    "realtime may fetch only its token and must delegate all authority reads",
  );
}

function checkRouteLifecycle(source) {
  const component = topLevelFunction(source, "PersistentPages");
  const pages = variable(source, "pages")?.initializer;
  must(
    requestArrayPropertyValues(pages, "path").includes("/game") &&
      propertyPaths(component).includes("visitState.visited.has") &&
      calls(component, "PageActivityProvider").length === 0 &&
      jsxElements(component, "PageActivityProvider").length === 1,
    "the /game page must remain mounted and receive explicit PageActivityProvider state",
  );
  const provider = jsxElements(component, "PageActivityProvider")[0];
  must(
    jsxAttributeValue(provider, "active") === "active" &&
      jsxAttributeValue(provider, "path") === "path",
    "persistent pages must bind route activity explicitly instead of relying on unmount",
  );
}

function checkAppShell(source) {
  const hook = topLevelFunction(source, "useForegroundRefresh");
  const refresh = variableFunction(hook, "refresh");
  const restore = variableFunction(hook, "restore");
  const reconnect = variableFunction(hook, "reconnect");
  must(
    calls(refresh, "refreshForegroundState").length === 1 &&
      calls(refresh, "catch").length === 1 &&
      calls(restore, "refresh").length === 1 &&
      numericLiterals(restore).includes(300_000) &&
      calls(reconnect, "refresh").length === 1 &&
      calls(hook, "window.addEventListener").some(
        (call) =>
          stringArgument(call, 0) === "online" &&
          expressionValue(call.arguments[1]) === "reconnect",
      ),
    "AppShell 300-second visibility and reconnect refresh must remain intact",
  );
}

function checkObserverConsumers(topAsset, inventory) {
  must(
    calls(topLevelFunction(topAsset, "TopAssetBar"), "useApiQuery").some(
      (call) => stringArgument(call, 0) === "identity.bootstrap",
    ) &&
      calls(topLevelFunction(inventory, "InventoryView"), "useApiQuery").some(
        (call) => stringArgument(call, 0) === "inventory.list",
      ),
    "top assets and inactive inventory must remain formal query consumers",
  );
}

function checkExclusiveOwnership(sources) {
  const ownerCalls = sources.flatMap((source) =>
    calls(source, "fetchApiQueryBatchAsOwner").map(() => source.fileName),
  );
  must(
    ownerCalls.length === 3 &&
      ownerCalls.every((fileName) => fileName === paths.coordinator),
    "only the Battle coordinator may create protected authority batches",
  );
}

function runSelfTests() {
  const fixtures = [
    fixture(paths.command, "direct command room GET", (source, text) => {
      const fn = topLevelFunction(source, "applyBattleCommandResult");
      return insertIntoFunction(
        text,
        fn,
        'void apiRequest("battle.room", { room_id: "fixture" });',
      );
    }),
    fixture(paths.query, "observer cancelRefetch takeover", (source, text) => {
      const fn = variableFunction(
        topLevelFunction(source, "useApiQuery"),
        "refetch",
      );
      const property = objectProperty(
        objectArgument(calls(fn, "query.refetch")[0], 0),
        "cancelRefetch",
      );
      return replaceNode(text, property.initializer, "true");
    }),
    fixture(
      paths.coordinator,
      "route cleanup fails to release",
      (source, text) => {
        const hook = topLevelFunction(source, "useBattleTerminalRefresh");
        const call = calls(hook, "setRouteActive").find(
          (candidate) => expressionValue(candidate.arguments[2]) === "false",
        );
        return replaceNode(text, call.arguments[2], "true");
      },
    ),
    fixture(paths.coordinator, "route leave cancels owner", (source, text) => {
      const fn = topLevelFunction(source, "setRouteActive");
      return insertIntoFunction(
        text,
        fn,
        "cancelApiQueryOwner(state.discoveryOwner);",
      );
    }),
    fixture(
      paths.coordinator,
      "route return repeats terminal batch",
      (source, text) => {
        const fn = topLevelFunction(source, "setRouteActive");
        return insertIntoFunction(text, fn, "state.completed.clear();");
      },
    ),
    fixture(
      paths.coordinator,
      "same terminal success memory removed",
      (source, text) => {
        const fn = topLevelFunction(source, "reportTerminalObservation");
        const guard = ifStatements(fn).find(
          (node) => calls(node.expression, "state.completed.has").length === 1,
        );
        return replaceNode(text, guard.expression, "false");
      },
    ),
    fixture(
      paths.coordinator,
      "inventory owner read duplicated",
      (source, text) => {
        const array = unwrap(variable(source, "terminalRequests").initializer);
        const inventory = array.elements.find(
          (element) =>
            stringProperty(unwrap(element), "routeId") === "inventory.list",
        );
        const route = objectProperty(unwrap(inventory), "routeId");
        return replaceNode(text, route.initializer, '"identity.bootstrap"');
      },
    ),
    fixture(
      paths.coordinator,
      "failed batch remembered as success",
      (source, text) => {
        const fn = topLevelFunction(source, "reportTerminalObservation");
        const catchCallback = callbackOfCall(calls(fn, "catch")[0]);
        return insertIntoFunction(
          text,
          catchCallback,
          "state.completed.add(key);",
        );
      },
    ),
    fixture(
      paths.coordinator,
      "resultless terminal keeps active latch",
      (source, text) => {
        const fn = topLevelFunction(source, "reportTerminalObservation");
        const callback = callbackOfCall(calls(fn, "batch.then")[0]);
        const clear = assignments(callback).find(
          (node) =>
            expressionValue(node.left) === "state.active" &&
            expressionValue(node.right) === "null",
        );
        return replaceNode(text, clear, "void state.active");
      },
    ),
    fixture(
      paths.query,
      "owner key protection registered too late",
      (source, text) => {
        const fn = topLevelFunction(source, "fetchApiQueryBatchAsOwner");
        const loop = forOfStatements(fn).find(
          (node) => calls(node.statement, "ownedApiQueries.set").length === 1,
        );
        return replaceNode(text, loop, "void queryHashes;");
      },
    ),
    fixture(paths.query, "ordinary query skips owner wait", (source, text) => {
      const fn = topLevelFunction(source, "executeApiQuery");
      const wait = awaitExpressions(fn).find(
        (node) => expressionValue(node.expression) === "owned.task",
      );
      return replaceNode(text, wait.expression, "Promise.resolve()");
    }),
    fixture(
      paths.query,
      "handoff delays cancellation until after prior owner",
      (source, text) => {
        const fn = topLevelFunction(source, "fetchApiQueryBatchAsOwner");
        const cancellation = variable(fn, "cancellation");
        const conflictIf = ifStatements(fn).find(
          (node) =>
            calls(node.thenStatement, "conflict.task.catch").length === 1,
        );
        const withLateCancellation = insertAfterNode(
          text,
          conflictIf,
          "\nawait cancelApiQueries(cancelRouteIds, generation);",
        );
        return replaceNode(
          withLateCancellation,
          cancellation.initializer,
          "Promise.resolve()",
        );
      },
    ),
    fixture(paths.view, "room await omits latch recheck", (source, text) => {
      const fn = variableFunction(
        topLevelFunction(source, "BattleView"),
        "runAuthorityRefresh",
      );
      const read = calls(fn, "readAuthorityRoom")[0];
      const guard = ifStatements(fn).find(
        (node) =>
          node.pos > read.end &&
          calls(node.expression, "isTerminalLocked").length === 1,
      );
      return replaceNode(text, guard.expression, "false");
    }),
    fixture(
      paths.view,
      "seeded terminal enables Battle bootstrap",
      (source, text) => {
        const view = topLevelFunction(source, "BattleView");
        const bootstrapObserver = calls(view, "useApiQuery").find(
          (call) => stringArgument(call, 0) === "battle.bootstrap",
        );
        return replaceNode(
          text,
          bootstrapObserver.arguments[2],
          "pageActive && activeTerminal === null && identityTerminalParticipation === null",
        );
      },
    ),
    fixture(
      paths.view,
      "invite preview selects participant room authority",
      (source, text) => {
        const view = topLevelFunction(source, "BattleView");
        const authorityRoomId = variable(view, "authorityRoomId");
        return replaceNode(
          text,
          authorityRoomId.initializer,
          `${authorityRoomId.initializer.getText()} ?? inviteRoom?.room_id`,
        );
      },
    ),
    fixture(
      paths.view,
      "cached terminal enables identity observer",
      (source, text) => {
        const view = topLevelFunction(source, "BattleView");
        const identityObserver = calls(view, "useApiQuery").find(
          (call) => stringArgument(call, 0) === "identity.bootstrap",
        );
        return replaceNode(
          text,
          identityObserver.arguments[2],
          "pageActive && activeTerminal === null",
        );
      },
    ),
    fixture(
      paths.view,
      "acknowledge submits before terminal batch completion",
      (source, text) => {
        const view = topLevelFunction(source, "BattleView");
        const acknowledge = variableFunction(view, "acknowledge");
        const preparation = calls(
          acknowledge,
          "prepareTerminalAcknowledgement",
        )[0];
        return replaceNode(text, preparation, "Promise.resolve(true)");
      },
    ),
    fixture(
      paths.command,
      "accept failure attempts participant room fallback",
      (source, text) => {
        const fn = topLevelFunction(source, "refreshBattleCommandFailure");
        const guard = ifStatements(fn).find((node) =>
          findBinaryComparison(
            node.expression,
            "routeId",
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            "battle.accept",
          ),
        );
        const comparison = findBinaryComparison(
          guard.expression,
          "routeId",
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          "battle.accept",
        );
        return replaceNode(text, comparison.operatorToken, "===");
      },
    ),
    fixture(
      paths.command,
      "command disconnects shared room reader",
      (source, text) => {
        const fn = topLevelFunction(source, "authoritativeRoomFromResult");
        const read = calls(fn, "readAuthoritativeRoom")[0];
        return replaceNode(text, read, "Promise.resolve(null)");
      },
    ),
    fixture(
      paths.coordinator,
      "room completion skips generation isolation",
      (source, text) => {
        const fn = topLevelFunction(source, "readCoordinatorRoom");
        const callback = callbackOfCall(calls(fn, "then")[0]);
        const check = calls(callback, "isCurrentGeneration")[0];
        return replaceNode(text, check, "true");
      },
    ),
    fixture(
      paths.coordinator,
      "room failure leaves recovery locked",
      (source, text) => {
        const fn = topLevelFunction(source, "readCoordinatorRoom");
        const callback = callbackOfCall(calls(fn, "catch")[0]);
        const finish = calls(callback, "finishCoordinatorRecovery")[0];
        return replaceNode(text, finish.parent, "void cause;");
      },
    ),
    fixture(
      paths.coordinator,
      "different room retains stale discovery owner",
      (source, text) => {
        const fn = topLevelFunction(source, "beginCoordinatorRecovery");
        const cancel = calls(fn, "cancelApiQueryOwner").find(
          (call) =>
            expressionValue(call.arguments[0]) === "state.discoveryOwner",
        );
        return replaceNode(text, cancel, "void state.discoveryOwner");
      },
    ),
    fixture(
      paths.coordinator,
      "post-ack bootstrap leaves active latch",
      (source, text) => {
        const fn = topLevelFunction(source, "confirmAcknowledgedResult");
        const callback = callbackOfCall(calls(fn, "batch.then")[0]);
        const clear = assignments(callback).find(
          (node) =>
            expressionValue(node.left) === "state.active" &&
            expressionValue(node.right) === "null",
        );
        return replaceNode(text, clear, "void state.active");
      },
    ),
    fixture(
      paths.coordinator,
      "post-ack bootstrap erases completed memory",
      (source, text) => {
        const fn = topLevelFunction(source, "confirmAcknowledgedResult");
        const callback = callbackOfCall(calls(fn, "batch.then")[0]);
        return insertIntoFunction(
          text,
          callback,
          "state.completed.delete(key);",
        );
      },
    ),
    fixture(
      paths.coordinator,
      "render snapshot creates shared coordinator",
      (source, text) => {
        const hook = topLevelFunction(source, "useBattleTerminalRefresh");
        const externalStore = calls(hook, "useSyncExternalStore")[0];
        const snapshot = externalStore.arguments[1];
        const read = calls(snapshot, "coordinatorVersion")[0];
        return replaceNode(
          text,
          read,
          "coordinatorFor(sessionGeneration).version",
        );
      },
    ),
  ];

  for (const { fileName, label, mutate } of fixtures) {
    const original = fs.readFileSync(fileName, "utf8");
    const source = parseText(fileName, original);
    const mutated = mutate(source, original);
    const fixtureSource = parseText(fileName, mutated);
    must(
      fixtureSource.parseDiagnostics.length === 0,
      `Architecture negative fixture is not valid TypeScript: ${label}`,
    );
    const overrides = new Map([[fileName, mutated]]);
    let rejected = false;
    try {
      runChecks(overrides);
    } catch {
      rejected = true;
    }
    must(rejected, `Architecture self-test accepted invalid fixture: ${label}`);
  }
}

function fixture(fileName, label, mutate) {
  return { fileName, label, mutate };
}

function parse(fileName, overrides) {
  return parseText(
    fileName,
    overrides.get(fileName) ?? fs.readFileSync(fileName, "utf8"),
  );
}

function parseText(fileName, text) {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function sourceFiles(directory, overrides) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target, overrides);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [parse(target, overrides)] : [];
  });
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
      isFunction(unwrap(node.initializer))
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
  must(initializer && isFunction(initializer), `Expected function ${name}`);
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

function calls(root, expectedPath) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isCallExpression(node) && callPath(node.expression) === expectedPath)
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
  if (ts.isElementAccessExpression(node))
    return `${callPath(node.expression)}[${expressionValue(node.argumentExpression)}]`;
  return "";
}

function objectArgument(call, index) {
  const argument = unwrap(call?.arguments[index]);
  return argument && ts.isObjectLiteralExpression(argument) ? argument : null;
}

function arrayArgument(call, index) {
  const argument = unwrap(call?.arguments[index]);
  return argument && ts.isArrayLiteralExpression(argument) ? argument : null;
}

function objectProperty(object, name) {
  return object?.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property)) &&
      propertyName(property.name) === name,
  );
}

function objectPropertyExpression(object, name) {
  const property = objectProperty(object, name);
  if (!property) return null;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return property.initializer ?? property;
}

function objectPropertyObject(object, name) {
  const expression = unwrap(objectPropertyExpression(object, name));
  return expression && ts.isObjectLiteralExpression(expression)
    ? expression
    : null;
}

function booleanProperty(object, name) {
  const expression = unwrap(objectPropertyExpression(object, name));
  return expression?.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : expression?.kind === ts.SyntaxKind.FalseKeyword
      ? false
      : undefined;
}

function stringProperty(object, name) {
  const expression = unwrap(objectPropertyExpression(object, name));
  return expression && ts.isStringLiteralLike(expression)
    ? expression.text
    : "";
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

function spreadIdentifiers(expression) {
  const array = unwrap(expression);
  return array && ts.isArrayLiteralExpression(array)
    ? array.elements
        .filter(ts.isSpreadElement)
        .map((element) => expressionValue(element.expression))
    : [];
}

function requestArrayRoutes(expression) {
  const array = unwrap(expression);
  return array && ts.isArrayLiteralExpression(array)
    ? array.elements
        .map((element) => stringProperty(unwrap(element), "routeId"))
        .filter(Boolean)
    : [];
}

function requestArrayPropertyValues(expression, property) {
  const array = unwrap(expression);
  return array && ts.isArrayLiteralExpression(array)
    ? array.elements
        .map((element) => stringProperty(unwrap(element), property))
        .filter(Boolean)
    : [];
}

function callbackOfCall(call) {
  const callback = unwrap(call?.arguments[0]);
  must(callback && isFunction(callback), "Expected call callback");
  return callback;
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
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return callPath(node);
  return node.getText(node.getSourceFile());
}

function propertyPaths(root) {
  const pathsFound = [];
  walk(root, (node) => {
    if (ts.isPropertyAccessExpression(node)) pathsFound.push(callPath(node));
  });
  return [...new Set(pathsFound)];
}

function identifiers(root) {
  const names = [];
  walk(root, (node) => {
    if (ts.isIdentifier(node)) names.push(node.text);
  });
  return names;
}

function returnExpressions(root) {
  const expressions = [];
  walk(root, (node) => {
    if (ts.isReturnStatement(node) && node.expression)
      expressions.push(node.expression);
  });
  return expressions;
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

function throwStatements(root) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isThrowStatement(node)) matches.push(node);
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

function forOfStatements(root) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isForOfStatement(node)) matches.push(node);
  });
  return matches;
}

function awaitExpressions(root) {
  const matches = [];
  walk(root, (node) => {
    if (ts.isAwaitExpression(node)) matches.push(node);
  });
  return matches;
}

function numericLiterals(root) {
  const values = [];
  walk(root, (node) => {
    if (ts.isNumericLiteral(node))
      values.push(Number(node.text.replaceAll("_", "")));
  });
  return values;
}

function jsxElements(root, tagName) {
  const matches = [];
  walk(root, (node) => {
    if (
      ts.isJsxElement(node) &&
      expressionValue(node.openingElement.tagName) === tagName
    )
      matches.push(node);
  });
  return matches;
}

function jsxAttributeValue(element, name) {
  const attribute = element.openingElement.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  const initializer =
    attribute && ts.isJsxAttribute(attribute) ? attribute.initializer : null;
  return initializer && ts.isJsxExpression(initializer)
    ? expressionValue(initializer.expression)
    : "";
}

function enclosingIf(root, target, predicate) {
  return ifStatements(root).find(
    (node) => predicate(node) && containsNode(node.thenStatement, target),
  );
}

function containsNode(root, target) {
  if (!root || !target) return false;
  let found = root === target;
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

function findBinaryComparison(root, left, operator, right) {
  let result;
  walk(root, (node) => {
    if (
      !result &&
      ts.isBinaryExpression(node) &&
      expressionValue(node.left) === left &&
      node.operatorToken.kind === operator &&
      expressionValue(node.right) === right
    )
      result = node;
  });
  return result;
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
      returnExpressions(node.thenStatement).length >= 1,
  );
}

function insertIntoFunction(text, fn, statement) {
  const body = fn.body;
  must(body && ts.isBlock(body), "Fixture target must have a block body");
  return `${text.slice(0, body.getStart() + 1)}\n${statement}\n${text.slice(body.getStart() + 1)}`;
}

function replaceNode(text, node, replacement) {
  must(node, "Fixture target node is missing");
  return `${text.slice(0, node.getStart())}${replacement}${text.slice(node.end)}`;
}

function insertAfterNode(text, node, addition) {
  must(node, "Fixture target node is missing");
  return `${text.slice(0, node.end)}${addition}${text.slice(node.end)}`;
}

function lineOf(node) {
  return (
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1
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
