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
      booleanProperty(queries, "refetchOnWindowFocus") === false,
    "TanStack queries must keep automatic retry and focus refetch disabled",
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
  must(
    requests.length === 1 &&
      expressionValue(requests[0].arguments[0]) === "routeId" &&
      expressionValue(requests[0].arguments[1]) === "input" &&
      objectHasShorthand(objectArgument(requests[0], 2), "signal") &&
      calls(queryFn, "assertCurrentSession").length === 1,
    "fetchApiQuery must use the formal API client, Query signal, and generation guard",
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
      calls(variable(hook, "active")?.initializer, "useRef").length === 1,
    "coordinator must own in-flight, completed, and active terminal state",
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

  const cancel = calls(reporter, "cancelApiQueries");
  must(
    cancel.length === 1 &&
      sameSet(
        new Set(arrayStrings(cancel[0].arguments[0])),
        terminalTailRoutes,
      ),
    "terminal latch must cancel stale required reads plus room, current-invite, and team-option tails",
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
        .length === 1,
    "terminal batch must read exactly battle.bootstrap, identity.bootstrap, and inventory.list",
  );
  must(
    forbiddenQueryMethods(reporter).length === 0,
    "terminal coordinator cannot invalidate, refetch, or ensure cached scopes",
  );

  const activeAssignment = assignments(reporter).find(
    (node) => expressionValue(node.left) === "active.current",
  );
  const completedHas = calls(reporter, "completed.current.has")[0];
  const inFlightGet = calls(reporter, "inFlight.current.get")[0];
  const task = variable(reporter, "task");
  const inFlightSet = calls(reporter, "inFlight.current.set")[0];
  must(
    activeAssignment &&
      completedHas &&
      inFlightGet &&
      task &&
      inFlightSet &&
      activeAssignment.pos < completedHas.pos &&
      completedHas.pos < inFlightGet.pos &&
      inFlightGet.pos < task.pos &&
      task.pos < inFlightSet.pos &&
      sameArray(
        inFlightSet.arguments.map((argument) => expressionValue(argument)),
        ["key", "task"],
      ),
    "terminal latch must activate before completed/singleflight checks and task publication",
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
  must(
    assignments(hook).some(
      (node) =>
        expressionValue(node.left) === "mounted.current" &&
        expressionValue(node.right) === "false",
    ) && propertyPaths(reporter).includes("mounted.current"),
    "unmounted terminal coordinators must not publish completion or failure state",
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

  const roomQuery = apiQueryCall(view, "battle.room");
  const inviteQuery = apiQueryCall(view, "battle.current_invite");
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
  must(
    apply.length === 1 &&
      report.length === 1 &&
      apply[0].pos < report[0].pos &&
      expressionValue(apply[0].arguments[0]) === "snapshot",
    "terminal room snapshot must land before its refresh batch starts",
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

  const refetchAuthority = variableFunction(view, "refetchAuthority");
  const terminalGuard = ifStatements(refetchAuthority).find(
    (node) =>
      calls(node.expression, "isTerminalLocked").some(
        (call) => expressionValue(call.arguments[0]) === "roomId",
      ) && returnStatements(node.thenStatement).length > 0,
  );
  const bootstrapReads = calls(refetchAuthority, "refetchBootstrap");
  const roomReads = calls(refetchAuthority, "refetchRoom");
  const inviteReads = calls(refetchAuthority, "refetchInvite");
  const normalReads = [...bootstrapReads, ...roomReads, ...inviteReads];
  const terminalRoomBranch = ifStatements(refetchAuthority).find(
    (node) =>
      calls(node.expression, "isBattleAssetTerminal").some(
        (call) =>
          expressionValue(call.arguments[0]) === "roomResult.data.status",
      ) &&
      calls(node.thenStatement, "onAuthoritativeRoom").some(
        (call) => expressionValue(call.arguments[0]) === "roomResult.data",
      ) &&
      returnStatements(node.thenStatement).length === 1,
  );
  must(
    terminalGuard &&
      bootstrapReads.length === 2 &&
      roomReads.length === 1 &&
      inviteReads.length === 1 &&
      normalReads.every((call) => terminalGuard.pos < call.pos) &&
      terminalRoomBranch &&
      roomReads[0].pos < terminalRoomBranch.pos &&
      terminalRoomBranch.end <
        Math.min(...bootstrapReads.map((call) => call.pos)),
    "poll/realtime/visibility reads must stop behind the latch and publish a terminal room before bootstrap can enable invite tails",
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

  const markOffline = variableFunction(view, "markOffline");
  must(
    ifStatements(markOffline).some(
      (node) =>
        calls(node.expression, "isTerminalLocked").length === 1 &&
        returnStatements(node.thenStatement).length === 1,
    ),
    "terminal latch must prevent trailing offline commands",
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

function checkExclusiveOwnership(sources) {
  const fetchOwners = Object.entries(sources).flatMap(([name, source]) =>
    calls(source, "fetchApiQuery").map(() => name),
  );
  must(
    fetchOwners.length === 3 &&
      fetchOwners.every((owner) => owner === "coordinator"),
    "only the terminal coordinator may own Battle terminal fetches",
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
      'fetchApiQuery("inventory.list")',
      'fetchApiQuery("identity.bootstrap")',
      "inactive inventory read omitted",
    ],
    [
      paths.coordinator,
      'fetchApiQuery("battle.bootstrap")',
      'fetchApiQuery("battle.current_invite")',
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
      "!matchesObservation(active.current, generation, observation)",
      "false",
      "stale room or state_version failure leaked into the active UI",
    ],
    [
      paths.coordinator,
      '"battle.current_invite",',
      "",
      "current-invite tail cancellation removed",
    ],
    [
      paths.query,
      "staleTime: 0,",
      "staleTime: 20_000,",
      "fetchQuery allowed fresh cache short-circuit",
    ],
    [
      paths.view,
      "if (isTerminalLocked(roomId)) {",
      "if (false) {",
      "authority tail guard removed",
    ],
    [
      paths.view,
      "onAuthoritativeRoom(roomResult.data);\n          return;",
      "onAuthoritativeRoom(roomResult.data);",
      "terminal room allowed bootstrap to enable an invite tail",
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
  ];
  for (const [fileName, before, after, label] of fixtures) {
    const overrides = new Map();
    const original = fs.readFileSync(fileName, "utf8");
    must(
      original.includes(before),
      `Architecture self-test fixture is stale: ${label}`,
    );
    overrides.set(fileName, original.replace(before, after));
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
