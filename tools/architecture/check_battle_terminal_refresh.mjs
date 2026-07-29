#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BATTLE = path.join(ROOT, "apps/web/src/domains/battle");
const paths = {
  coordinator: path.join(BATTLE, "useBattleTerminalRefresh.ts"),
  command: path.join(BATTLE, "useBattleCommand.ts"),
  view: path.join(BATTLE, "ui/BattleView.tsx"),
};

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
  const sources = typescriptFiles(BATTLE).map((fileName) =>
    parse(fileName, overrides),
  );
  checkCoordinator(sources);
  checkCommand(parse(paths.command, overrides));
  checkView(parse(paths.view, overrides));
}

function checkCoordinator(sources) {
  const definitions = sources.flatMap((source) =>
    functions(source, "useBattleTerminalRefresh").map((node) => ({
      source,
      node,
    })),
  );
  must(
    definitions.length === 1 &&
      definitions[0].source.fileName === paths.coordinator,
    "exactly one coordinator definition is required",
  );
  const { source, node: coordinator } = definitions[0];
  const reporter = variableFunction(coordinator, "reportTerminal");
  must(
    coordinator.parameters[0]?.name.getText(source) === "sessionGeneration" &&
      isUseRefCollection(
        variable(coordinator, "inFlight")?.initializer,
        "Map",
      ) &&
      isUseRefCollection(
        variable(coordinator, "completed")?.initializer,
        "Set",
      ) &&
      isCall(variable(coordinator, "mounted")?.initializer, "useRef"),
    "coordinator must own generation-scoped in-flight and completed state",
  );
  const key = variable(reporter, "key")?.initializer;
  const keyNames = new Set(identifiers(key));
  must(
    key &&
      ts.isTemplateExpression(key) &&
      keyNames.has("generation") &&
      keyNames.has("terminalRoomId"),
    "singleflight key must combine session generation and room_id",
  );
  for (const [chain, args] of [
    [["completed", "current", "has"], ["key"]],
    [["inFlight", "current", "get"], ["key"]],
    [
      ["inFlight", "current", "set"],
      ["key", "task"],
    ],
    [["completed", "current", "add"], ["key"]],
  ])
    must(
      propertyCalls(reporter, chain).some(
        (call) => call.arguments.map(text).join(",") === args.join(","),
      ),
      `missing ${chain.join(".")}(${args.join(",")})`,
    );
  const existing = ifs(reporter).find(
    (node) =>
      text(node.expression) === "existing" &&
      returns(node.thenStatement).some(
        (statement) => text(statement.expression) === "existing",
      ),
  );
  const refresh = calls(reporter, "refreshScopes");
  const success = methodCalls(reporter, "then").find(
    (call) =>
      propertyCalls(call.arguments[0], ["completed", "current", "add"]).length,
  );
  const failure = methodCalls(reporter, "catch").find(
    (call) => calls(call.arguments[0], "setFailure").length,
  );
  const unlock = methodCalls(reporter, "finally").find(
    (call) =>
      propertyCalls(call.arguments[0], ["inFlight", "current", "delete"])
        .length,
  );
  must(
    existing && refresh.length === 1 && terminalRefresh(refresh[0]),
    "singleflight branch is incomplete",
  );
  must(
    success && failure && unlock,
    "success memory, failure feedback, and failure unlock are required",
  );
  must(
    binaries(coordinator).some(
      (node) =>
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        text(node.left) === "failure?.generation" &&
        text(node.right) === "sessionGeneration",
    ),
    "stale generation failure must stay hidden",
  );
  must(
    assignments(coordinator).some(
      (node) =>
        text(node.left) === "mounted.current" &&
        node.right.kind === ts.SyntaxKind.FalseKeyword,
    ) &&
      methodCalls(reporter, "then").some(
        (call) =>
          propertyReads(call.arguments[0], ["mounted", "current"]).length,
      ) &&
      methodCalls(reporter, "catch").some(
        (call) =>
          propertyReads(call.arguments[0], ["mounted", "current"]).length,
      ),
    "unmounted coordinators must not publish refresh state",
  );
  const owners = sources.flatMap((source) =>
    calls(source, "refreshScopes")
      .filter(terminalRefresh)
      .map(() => source.fileName),
  );
  must(
    owners.length === 1 && owners[0] === paths.coordinator,
    "only the coordinator may refresh Battle, assets, and inventory",
  );
}

function checkCommand(source) {
  const hook = oneFunction(source, "useBattleCommand");
  must(
    text(hook.parameters[1]?.name) === "onAuthoritativeRoom" &&
      assignments(hook).some(
        (node) =>
          text(node.left) === "onAuthoritativeRoomRef.current" &&
          text(node.right) === "onAuthoritativeRoom",
      ),
    "useBattleCommand must receive and keep the authoritative-room callback current",
  );
  const execute = variableFunction(hook, "execute");
  const result = oneFunction(source, "applyBattleCommandResult");
  const resultApplications = calls(execute, "applyBattleCommandResult").filter(
    (call) => !hasStaticallyUnreachableAncestor(call, execute),
  );
  const resultStatements = blockStatements(result);
  const applyIndex = resultStatements.findIndex(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      isCall(statement.expression, "onAuthoritativeRoom") &&
      text(statement.expression.arguments[0]) === "snapshot",
  );
  const refreshIndex = resultStatements.findIndex(
    (statement) => calls(statement, "refreshRouteScopes").length === 1,
  );
  must(
    resultApplications.length === 2 &&
      resultApplications.every(
        (call) =>
          enclosingExecutable(call) === execute &&
          text(call.arguments[4]) === "onAuthoritativeRoomRef.current",
      ) &&
      calls(result, "authoritativeRoomFromResult").length === 1 &&
      applyIndex >= 0 &&
      refreshIndex > applyIndex &&
      calls(resultStatements[refreshIndex], "isBattleAssetTerminal").length ===
        1,
    "initial and recovered success must synchronously publish the authoritative room before any route refresh",
  );

  const failure = oneFunction(source, "refreshBattleCommandFailure");
  const outer = ifs(failure).find(
    (node) => calls(node.expression, "isBattleTerminalFailure").length === 1,
  );
  const byRoom =
    outer &&
    ifs(outer.thenStatement).find(
      (node) =>
        text(node.expression) === "terminalRoomId" &&
        calls(node.thenStatement, "readAuthoritativeRoom").length === 1 &&
        calls(node.thenStatement, "onAuthoritativeRoom").length === 1,
    );
  must(
    outer &&
      byRoom &&
      returns(outer.thenStatement).some((node) => !node.expression) &&
      calls(failure, "readAuthoritativeRoom").length === 1 &&
      calls(failure, "onAuthoritativeRoom").length === 1 &&
      calls(failure, "refetchAuthority").length === 1 &&
      calls(execute, "refreshBattleCommandFailure").length === 2 &&
      calls(execute, "refreshBattleCommandFailure").every(
        (call) =>
          !hasStaticallyUnreachableAncestor(call, execute) &&
          text(call.arguments[4]) === "onAuthoritativeRoomRef.current",
      ),
    "terminal failures must publish a recovered room or perform Battle-only discovery",
  );
  const roomResolver = oneFunction(source, "authoritativeRoomFromResult");
  const directRoutes = new Set(
    stringComparands(ifs(roomResolver)[0]?.expression, "routeId"),
  );
  must(
    sameSet(
      directRoutes,
      new Set(["battle.accept", "battle.action", "battle.forced_switch"]),
    ) &&
      calls(roomResolver, "readAuthoritativeRoom").length === 1 &&
      calls(roomResolver, "readAuthoritativeRoom").some(
        (call) => text(call.arguments[0]) === "commandResult.room_id",
      ),
    "create and cancel must resolve their authoritative room snapshot while snapshot-returning commands stay direct",
  );
  const classifier = oneFunction(source, "isBattleTerminalFailure");
  const include = calls(classifier, "includes");
  const codeArray =
    include.length === 1 && ts.isPropertyAccessExpression(include[0].expression)
      ? include[0].expression.expression
      : null;
  must(
    sameSet(
      new Set(arrayStrings(codeArray)),
      new Set([
        "BATTLE_SHARE_FAILED",
        "BATTLE_ROOM_EXPIRED",
        "BATTLE_ROOM_CANCELLED",
        "BATTLE_VOIDED",
      ]),
    ),
    "terminal failure classification is incomplete",
  );
  must(
    calls(source, "reportTerminal").length === 0 &&
      calls(result, "refreshScopes").length === 0 &&
      calls(failure, "refreshScopes").length === 0,
    "commands can publish authoritative rooms but cannot own the terminal coordinator",
  );
}

function checkView(source) {
  const view = oneFunction(source, "BattleView");
  const coordinator = variables(view).find(
    (node) =>
      ts.isObjectBindingPattern(node.name) &&
      isCall(node.initializer, "useBattleTerminalRefresh"),
  );
  must(
    coordinator &&
      text(coordinator.initializer.arguments[0]) === "sessionGeneration" &&
      bindingNames(coordinator.name).has("reportTerminal") &&
      bindingNames(coordinator.name).has("terminalRefreshFailure"),
    "BattleView must own the session coordinator",
  );
  const authoritative = variableFunction(view, "onAuthoritativeRoom");
  const authoritativeStatements = blockStatements(authoritative);
  const snapshotIndex = authoritativeStatements.findIndex(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      isCall(statement.expression, "applySnapshot") &&
      text(statement.expression.arguments[0]) === "snapshot",
  );
  const coordinatorIndex = authoritativeStatements.findIndex(
    (statement) =>
      calls(statement, "reportTerminal").length === 1 &&
      calls(statement, "isBattleAssetTerminal").length === 1,
  );
  must(
    snapshotIndex >= 0 &&
      coordinatorIndex > snapshotIndex &&
      calls(authoritative, "applySnapshot").length === 1 &&
      calls(authoritative, "reportTerminal").length === 1 &&
      text(calls(authoritative, "reportTerminal")[0].arguments[0]) ===
        "snapshot.room_id" &&
      calls(authoritative, "getSession").length === 1,
    "onAuthoritativeRoom must reject stale generations, apply the snapshot first, and only then start the terminal coordinator",
  );
  const command = calls(view, "useBattleCommand");
  must(
    command.length === 1 &&
      command[0].arguments.map(text).join(",") ===
        "refetchAuthority,onAuthoritativeRoom" &&
      enclosingExecutable(command[0]) === view &&
      !hasStaticallyUnreachableAncestor(command[0], view),
    "BattleView must inject its reachable authoritative-room callback into commands",
  );

  const reports = calls(view, "reportTerminal");
  const observed = reports.find(
    (call) => text(call.arguments[0]) === "terminalRoomId",
  );
  must(
    reports.length === 3 && observed,
    "terminal reports must be limited to the authoritative-room callback, observation, and inline retry",
  );
  const observation = variable(view, "terminalObservationKey")?.initializer;
  const observationArray =
    observation &&
    ts.isCallExpression(observation) &&
    ts.isPropertyAccessExpression(observation.expression) &&
    observation.expression.name.text === "join"
      ? observation.expression.expression
      : null;
  must(
    observationArray &&
      ts.isArrayLiteralExpression(observationArray) &&
      sameSet(
        new Set(observationArray.elements.map(text)),
        new Set([
          "terminalRoomIds",
          "identity.dataUpdatedAt",
          "bootstrap.dataUpdatedAt",
          "roomQuery.dataUpdatedAt",
          "invite.dataUpdatedAt",
        ]),
      ),
    "fresh authority responses must retry failed terminal refreshes",
  );
  const observedEffect = enclosingCall(observed, "useEffect");
  must(
    observedEffect?.arguments[1] &&
      ts.isArrayLiteralExpression(observedEffect.arguments[1]) &&
      observedEffect.arguments[1].elements.some(
        (node) => text(node) === "terminalObservationKey",
      ) &&
      calls(observedEffect.arguments[0], "refetchAuthority").length === 0 &&
      propertyCalls(observedEffect.arguments[0], ["refetchRef", "current"])
        .length === 0,
    "terminal observation cannot append another authority read",
  );
  const collected = calls(view, "terminalRoomIdsFor");
  const terminalIds = directVariable(view, "terminalRoomIds");
  const joined =
    terminalIds?.initializer &&
    isMethodCall(terminalIds.initializer, "join") &&
    terminalIds.initializer.expression.expression;
  const collectionCall =
    joined &&
    ts.isCallExpression(joined) &&
    isCall(joined, "terminalRoomIdsFor")
      ? joined
      : null;
  const collectionInput = collectionCall?.arguments[0];
  const expectedSources = new Map([
    [
      "resultRoomIds",
      new Set([
        "resultRoomId",
        "bootstrap.data?.current_result?.room_id ?? null",
        "identity.data?.battle_result?.room_id ?? null",
      ]),
    ],
    ["rooms", new Set(["room", "bootstrap.data?.room", "roomQuery.data"])],
    [
      "participations",
      new Set([
        "participation",
        "bootstrap.data?.participation",
        "identity.data?.battle_participation",
      ]),
    ],
  ]);
  const formalBindings = new Map(
    [
      "resultRoomId",
      "bootstrap",
      "identity",
      "room",
      "roomQuery",
      "participation",
      "invite",
    ].map((name) => [name, directBindingDeclaration(view, name)]),
  );
  const queryRoutes = new Map([
    ["bootstrap", "battle.bootstrap"],
    ["identity", "identity.bootstrap"],
    ["roomQuery", "battle.room"],
    ["invite", "battle.current_invite"],
  ]);
  must(
    collected.length === 1 &&
      collected[0] === collectionCall &&
      directVariableStatement(view, terminalIds) &&
      collectionInput &&
      ts.isObjectLiteralExpression(collectionInput) &&
      sameSet(
        objectKeys(collectionInput),
        new Set([...expectedSources.keys(), "invite"]),
      ) &&
      [...expectedSources].every(([name, expected]) => {
        const value = objectValue(collectionInput, name);
        return (
          value &&
          ts.isArrayLiteralExpression(value) &&
          value.elements.length === expected.size &&
          value.elements.every(isNonEmptyExpression) &&
          sameSet(new Set(value.elements.map(text)), expected)
        );
      }) &&
      text(objectValue(collectionInput, "invite")) === "invite.data" &&
      isNonEmptyExpression(objectValue(collectionInput, "invite")) &&
      [...formalBindings].every(
        ([name, declaration]) =>
          declaration &&
          bindingNamesIn(view).has(name) &&
          isNonEmptyExpression(declaration.initializer),
      ) &&
      [...queryRoutes].every(([name, routeId]) => {
        const initializer = formalBindings.get(name)?.initializer;
        return (
          isCall(initializer, "useApiQuery") &&
          initializer.arguments[0] &&
          ts.isStringLiteralLike(initializer.arguments[0]) &&
          initializer.arguments[0].text === routeId
        );
      }) &&
      isCall(formalBindings.get("room")?.initializer, "useState") &&
      compactText(formalBindings.get("resultRoomId")?.initializer) ===
        "result?.room_id??null" &&
      compactText(formalBindings.get("participation")?.initializer) ===
        "bootstrap.data?.participation??(bootstrap.data?null:(identity.data?.battle_participation??null))",
    "every formal result, room, participation, and invite expression must be non-empty, bound, and called directly from BattleView",
  );
  const collector = oneFunction(source, "terminalRoomIdsFor");
  must(
    collector.parent === source &&
      calls(collector, "isBattleAssetTerminal").length === 3,
    "terminalRoomIdsFor must be the reachable top-level collector",
  );

  const offline = variableFunction(view, "markOffline");
  const offlineThen = methodCalls(offline, "then").find(
    (call) =>
      calls(call.arguments[0], "onAuthoritativeRoom").length === 1 &&
      propertyCalls(call.arguments[0], ["refetchRef", "current"]).length === 0,
  );
  must(
    hasStringCall(offline, "apiKeepaliveRequest", "battle.offline") &&
      offlineThen,
    "offline success must publish its authoritative snapshot without a trailing Battle refetch",
  );
  const heartbeat = variableFunction(view, "heartbeat");
  const nonTerminalRefetch = ifs(heartbeat).find(
    (node) =>
      calls(node.expression, "isBattleAssetTerminal").length === 1 &&
      node.expression.kind === ts.SyntaxKind.PrefixUnaryExpression &&
      propertyCalls(node.thenStatement, ["refetchRef", "current"]).length ===
        1 &&
      !node.elseStatement,
  );
  must(
    hasStringCall(heartbeat, "apiRequest", "battle.heartbeat") &&
      calls(heartbeat, "onAuthoritativeRoom").length === 1 &&
      text(calls(heartbeat, "onAuthoritativeRoom")[0].arguments[0]) ===
        "response.data" &&
      nonTerminalRefetch &&
      propertyCalls(heartbeat, ["refetchRef", "current"]).length === 1,
    "heartbeat must publish its snapshot and keep terminal and non-terminal refetch paths mutually exclusive",
  );
  const realtime = calls(view, "useBattleRealtime");
  must(
    realtime.length === 1 &&
      text(objectValue(realtime[0].arguments[0], "refetch")) ===
        "refetchAuthority" &&
      propertyCalls(variableFunction(view, "restore"), [
        "refetchRef",
        "current",
      ]).length === 1,
    "fallback poll and visibility/re-auth must re-read authority",
  );
  const retry = reports.find(
    (call) => text(call.arguments[0]) === "terminalRefreshFailure.roomId",
  );
  const retryBranch = retry && enclosing(retry, ts.isIfStatement);
  must(
    retryBranch &&
      text(retryBranch.expression) === "terminalRefreshFailure" &&
      calls(retryBranch.thenStatement, "reportTerminal").length === 1 &&
      retryBranch.elseStatement &&
      calls(retryBranch.elseStatement, "refetchAuthority").length === 1,
    "inline failure retry must reuse the coordinator",
  );
  for (const handlerName of [
    "create",
    "accept",
    "cancel",
    "attack",
    "voluntarySwitch",
    "forcedSwitch",
  ]) {
    const handler = variableFunction(view, handlerName);
    must(
      calls(handler, "execute").length === 1 &&
        calls(handler, "applySnapshot").length === 0,
      `${handlerName} must rely on the single authoritative-room callback`,
    );
  }
  must(
    calls(view, "applySnapshot").length === 1 &&
      calls(source, "refreshRouteScopes").length === 0 &&
      calls(source, "refreshScopes").filter(terminalRefresh).length === 0 &&
      calls(collector, "isBattleAssetTerminal").length === 3,
    "BattleView can observe terminal state but cannot own its refresh",
  );
}

function runSelfTests() {
  const viewSource = parse(paths.view);
  const viewText = fs.readFileSync(paths.view, "utf8");
  const collectorInput = terminalCollectorInput(viewSource);
  const entryNodes = [
    ...["resultRoomIds", "rooms", "participations"].flatMap((name) => {
      const value = objectValue(collectorInput, name);
      must(
        value && ts.isArrayLiteralExpression(value),
        `self-test cannot locate ${name}`,
      );
      return [...value.elements];
    }),
    objectValue(collectorInput, "invite"),
  ];
  entryNodes.forEach((node, index) => {
    must(node, `self-test cannot locate formal entry ${index + 1}`);
    expectRejected(
      `formal entry ${index + 1} cannot be undefined`,
      paths.view,
      replaceRanges(viewText, [
        [node.getStart(viewSource), node.end, "undefined"],
      ]),
    );
  });

  const view = oneFunction(viewSource, "BattleView");
  const resultRoomBinding = directBindingDeclaration(view, "resultRoomId");
  must(
    resultRoomBinding?.initializer,
    "self-test cannot locate result room binding",
  );
  expectRejected(
    "formal entry binding cannot resolve to undefined",
    paths.view,
    replaceRanges(viewText, [
      [
        resultRoomBinding.initializer.getStart(viewSource),
        resultRoomBinding.initializer.end,
        "undefined",
      ],
    ]),
  );
  const terminalIds = directVariable(view, "terminalRoomIds");
  const terminalStatement = terminalIds.parent.parent;
  const terminalInitializer = text(terminalIds.initializer);
  expectRejected(
    "collector cannot move into if(false)",
    paths.view,
    replaceRanges(viewText, [
      [
        terminalStatement.getStart(viewSource),
        terminalStatement.end,
        `let terminalRoomIds = "";\n  if (false) {\n    terminalRoomIds = ${terminalInitializer};\n  }`,
      ],
    ]),
  );
  expectRejected(
    "collector cannot move into an uncalled function",
    paths.view,
    replaceRanges(viewText, [
      [
        terminalStatement.getStart(viewSource),
        terminalStatement.end,
        `const collectTerminalRoomIdsDead = () => ${terminalInitializer};\n  const terminalRoomIds = "";`,
      ],
    ]),
  );

  const authoritative = variableFunction(view, "onAuthoritativeRoom");
  const authoritativeStatements = blockStatements(authoritative);
  const applyStatement = authoritativeStatements.find(
    (statement) => calls(statement, "applySnapshot").length === 1,
  );
  const reportStatement = authoritativeStatements.find(
    (statement) => calls(statement, "reportTerminal").length === 1,
  );
  must(
    applyStatement && reportStatement,
    "self-test cannot locate callback order",
  );
  expectRejected(
    "coordinator cannot run before snapshot application",
    paths.view,
    replaceRanges(viewText, [
      [
        applyStatement.getStart(viewSource),
        applyStatement.end,
        text(reportStatement),
      ],
      [
        reportStatement.getStart(viewSource),
        reportStatement.end,
        text(applyStatement),
      ],
    ]),
  );
  expectRejected(
    "snapshot application cannot be deleted",
    paths.view,
    replaceRanges(viewText, [
      [applyStatement.getStart(viewSource), applyStatement.end, ""],
    ]),
  );

  const heartbeat = variableFunction(view, "heartbeat");
  const heartbeatApply = calls(heartbeat, "onAuthoritativeRoom")[0];
  const heartbeatStatement = enclosing(
    heartbeatApply,
    ts.isExpressionStatement,
  );
  must(
    heartbeatStatement,
    "self-test cannot locate heartbeat snapshot publish",
  );
  expectRejected(
    "terminal heartbeat cannot append a Battle refetch",
    paths.view,
    replaceRanges(viewText, [
      [
        heartbeatStatement.end,
        heartbeatStatement.end,
        "\n        if (isBattleAssetTerminal(response.data.status))\n          await refetchRef.current();",
      ],
    ]),
  );

  const coordinatorSource = parse(paths.coordinator);
  const coordinatorText = fs.readFileSync(paths.coordinator, "utf8");
  const reporter = variableFunction(
    oneFunction(coordinatorSource, "useBattleTerminalRefresh"),
    "reportTerminal",
  );
  const unlock = methodCalls(reporter, "finally")[0];
  must(
    unlock &&
      ts.isPropertyAccessExpression(unlock.expression) &&
      ts.isCallExpression(unlock.expression.expression),
    "self-test cannot locate failure unlock",
  );
  expectRejected(
    "failed refresh must unlock singleflight",
    paths.coordinator,
    replaceRanges(coordinatorText, [
      [
        unlock.getStart(coordinatorSource),
        unlock.end,
        text(unlock.expression.expression),
      ],
    ]),
  );

  const refresh = calls(reporter, "refreshScopes")[0];
  must(refresh, "self-test cannot locate terminal scopes");
  expectAccepted(
    "scope ordering must be irrelevant",
    paths.coordinator,
    replaceRanges(coordinatorText, [
      [
        refresh.arguments[0].getStart(coordinatorSource),
        refresh.arguments[0].end,
        '["inventory", "battle", "assets"]',
      ],
    ]),
  );
}

function terminalCollectorInput(source) {
  const view = oneFunction(source, "BattleView");
  const terminalIds = directVariable(view, "terminalRoomIds");
  const joined =
    terminalIds?.initializer &&
    isMethodCall(terminalIds.initializer, "join") &&
    terminalIds.initializer.expression.expression;
  must(
    joined &&
      ts.isCallExpression(joined) &&
      isCall(joined, "terminalRoomIdsFor") &&
      joined.arguments[0] &&
      ts.isObjectLiteralExpression(joined.arguments[0]),
    "self-test cannot locate terminal collector input",
  );
  return joined.arguments[0];
}

function expectRejected(label, fileName, mutatedText) {
  let rejected = false;
  try {
    runChecks(new Map([[fileName, mutatedText]]));
  } catch {
    rejected = true;
  }
  must(rejected, `negative fixture was accepted: ${label}`);
}

function expectAccepted(label, fileName, mutatedText) {
  try {
    runChecks(new Map([[fileName, mutatedText]]));
  } catch (cause) {
    throw new Error(
      `Battle terminal refresh guard: positive fixture failed: ${label}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}

function replaceRanges(source, replacements) {
  return [...replacements]
    .sort((left, right) => right[0] - left[0])
    .reduce(
      (current, [start, end, replacement]) =>
        `${current.slice(0, start)}${replacement}${current.slice(end)}`,
      source,
    );
}

function parse(fileName, overrides = new Map()) {
  return ts.createSourceFile(
    fileName,
    overrides.get(fileName) ?? fs.readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function typescriptFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory()
        ? typescriptFiles(file)
        : /\.(?:ts|tsx)$/.test(entry.name)
          ? [file]
          : [];
    })
    .sort();
}

function all(node, predicate) {
  if (!node) return [];
  const result = [];
  const visit = (current) => {
    if (predicate(current)) result.push(current);
    current.forEachChild(visit);
  };
  visit(node);
  return result;
}

function functions(node, name) {
  return all(
    node,
    (current) =>
      ts.isFunctionDeclaration(current) && current.name?.text === name,
  );
}

function oneFunction(node, name) {
  const result = functions(node, name);
  must(result.length === 1, `expected one ${name} function`);
  return result[0];
}

function variables(node) {
  return all(node, ts.isVariableDeclaration);
}

function variable(node, name) {
  return variables(node).find(
    (current) => ts.isIdentifier(current.name) && current.name.text === name,
  );
}

function variableFunction(node, name) {
  const initializer = variable(node, name)?.initializer;
  if (
    initializer &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
  )
    return initializer;
  if (initializer && ts.isCallExpression(initializer)) {
    const callback = initializer.arguments.find(
      (argument) =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
    );
    if (callback) return callback;
  }
  throw new Error(`Battle terminal refresh guard: expected executable ${name}`);
}

function callName(node) {
  if (!node || !ts.isCallExpression(node)) return null;
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression))
    return node.expression.name.text;
  return null;
}

function isCall(node, name) {
  return callName(node) === name;
}

function calls(node, name) {
  return all(node, (current) => isCall(current, name));
}

function methodCalls(node, name) {
  return all(
    node,
    (current) =>
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === name,
  );
}

function propertyCalls(node, expected) {
  return all(
    node,
    (current) =>
      ts.isCallExpression(current) &&
      propertyChain(current.expression).join(".") === expected.join("."),
  );
}

function propertyReads(node, expected) {
  return all(
    node,
    (current) =>
      ts.isPropertyAccessExpression(current) &&
      propertyChain(current).join(".") === expected.join("."),
  );
}

function propertyChain(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node))
    return [...propertyChain(node.expression), node.name.text];
  return [];
}

function isMethodCall(node, name) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === name
  );
}

function ifs(node) {
  return all(node, ts.isIfStatement);
}

function returns(node) {
  return all(node, ts.isReturnStatement);
}

function binaries(node) {
  return all(node, ts.isBinaryExpression);
}

function assignments(node) {
  return binaries(node).filter(
    (current) => current.operatorToken.kind === ts.SyntaxKind.EqualsToken,
  );
}

function blockStatements(node) {
  return node?.body && ts.isBlock(node.body) ? [...node.body.statements] : [];
}

function directVariable(node, name) {
  return variables(node).find(
    (current) =>
      ts.isIdentifier(current.name) &&
      current.name.text === name &&
      directVariableStatement(node, current),
  );
}

function directVariableStatement(owner, declaration) {
  return Boolean(
    declaration &&
    ts.isVariableDeclarationList(declaration.parent) &&
    ts.isVariableStatement(declaration.parent.parent) &&
    declaration.parent.parent.parent === owner.body,
  );
}

function bindingNamesIn(node) {
  return new Set(
    blockStatements(node)
      .filter(ts.isVariableStatement)
      .flatMap((statement) =>
        statement.declarationList.declarations.flatMap((declaration) =>
          bindingIdentifiers(declaration.name),
        ),
      ),
  );
}

function directBindingDeclaration(node, name) {
  return blockStatements(node)
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => bindingIdentifiers(declaration.name).includes(name));
}

function bindingIdentifiers(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))
    return node.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingIdentifiers(element.name) : [],
    );
  return [];
}

function isNonEmptyExpression(node) {
  return Boolean(
    node &&
    node.kind !== ts.SyntaxKind.UndefinedKeyword &&
    text(node) !== "undefined" &&
    text(node) !== "void 0",
  );
}

function stringComparands(node, identifier) {
  return binaries(node).flatMap((binary) => {
    if (binary.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken)
      return [];
    if (
      text(binary.left) === identifier &&
      ts.isStringLiteralLike(binary.right)
    )
      return [binary.right.text];
    if (
      text(binary.right) === identifier &&
      ts.isStringLiteralLike(binary.left)
    )
      return [binary.left.text];
    return [];
  });
}

function enclosingExecutable(node) {
  return enclosing(
    node,
    (current) =>
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current),
  );
}

function hasStaticallyUnreachableAncestor(node, boundary) {
  let current = node.parent;
  while (current && current !== boundary) {
    if (
      ts.isIfStatement(current) &&
      current.expression.kind === ts.SyntaxKind.FalseKeyword &&
      containsNode(current.thenStatement, node)
    )
      return true;
    if (
      (ts.isWhileStatement(current) || ts.isDoStatement(current)) &&
      current.expression.kind === ts.SyntaxKind.FalseKeyword
    )
      return true;
    current = current.parent;
  }
  return false;
}

function containsNode(container, target) {
  return target.pos >= container.pos && target.end <= container.end;
}

function identifiers(node) {
  return all(node, ts.isIdentifier).map((current) => current.text);
}

function isUseRefCollection(node, name) {
  return (
    isCall(node, "useRef") &&
    node.arguments.length === 1 &&
    ts.isNewExpression(node.arguments[0]) &&
    ts.isIdentifier(node.arguments[0].expression) &&
    node.arguments[0].expression.text === name
  );
}

function terminalRefresh(node) {
  if (!isCall(node, "refreshScopes") || node.arguments.length !== 2)
    return false;
  const [scopes, options] = node.arguments;
  const declaredScopes = arrayStrings(scopes);
  return (
    declaredScopes.length === 3 &&
    sameSet(
      new Set(declaredScopes),
      new Set(["battle", "assets", "inventory"]),
    ) &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        text(property.name) === "throwOnError" &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword,
    )
  );
}

function arrayStrings(node) {
  return node && ts.isArrayLiteralExpression(node)
    ? node.elements.filter(ts.isStringLiteralLike).map((item) => item.text)
    : [];
}

function objectKeys(node) {
  return new Set(
    node && ts.isObjectLiteralExpression(node)
      ? node.properties.map((property) => text(property.name))
      : [],
  );
}

function objectValue(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const property = node.properties.find(
    (item) => ts.isPropertyAssignment(item) && text(item.name) === name,
  );
  return property?.initializer ?? null;
}

function bindingNames(node) {
  return new Set(
    node.elements.flatMap((item) => [text(item.name), text(item.propertyName)]),
  );
}

function hasStringCall(node, name, value) {
  return calls(node, name).some(
    (call) =>
      call.arguments[0] &&
      ts.isStringLiteralLike(call.arguments[0]) &&
      call.arguments[0].text === value,
  );
}

function enclosingCall(node, name) {
  return enclosing(
    node,
    (current) => ts.isCallExpression(current) && isCall(current, name),
  );
}

function enclosing(node, predicate) {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function text(node) {
  return node?.getText() ?? "";
}

function compactText(node) {
  return text(node).replace(/\s+/g, "");
}

function must(condition, message) {
  if (!condition) throw new Error(`Battle terminal refresh guard: ${message}`);
}
