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
  const sources = typescriptFiles(BATTLE).map(parse);
  checkCoordinator(sources);
  checkCommand(parse(paths.command));
  checkView(parse(paths.view));
  process.stdout.write(
    "Battle terminal refresh ownership is structurally valid\n",
  );
} catch (cause) {
  process.stderr.write(
    `${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exit(1);
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
      ),
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
    text(hook.parameters[1]?.name) === "reportTerminal" &&
      assignments(hook).some(
        (node) =>
          text(node.left) === "reportTerminalRef.current" &&
          text(node.right) === "reportTerminal",
      ),
    "useBattleCommand must receive and keep the coordinator current",
  );
  const result = oneFunction(source, "refreshBattleCommandResult");
  const terminalResult = ifs(result).find(
    (node) =>
      text(node.expression) === "terminalRoomId" &&
      returns(node.thenStatement).some(
        (statement) =>
          isCall(statement.expression, "reportTerminal") &&
          text(statement.expression.arguments[0]) === "terminalRoomId",
      ),
  );
  const routeRefresh = calls(source, "refreshRouteScopes");
  must(
    calls(result, "terminalRoomIdFromBattleResult").length === 1 &&
      terminalResult &&
      routeRefresh.length === 1 &&
      enclosingFunction(routeRefresh[0])?.name?.text ===
        "refreshBattleCommandResult" &&
      calls(source, "refreshBattleCommandResult").length === 2,
    "initial and recovered success must route terminal results before route refresh",
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
        calls(node.thenStatement, "reportTerminal").length === 1 &&
        node.elseStatement &&
        calls(node.elseStatement, "refetchAuthority").length === 1,
    );
  must(
    outer &&
      byRoom &&
      returns(outer.thenStatement).some((node) => !node.expression) &&
      calls(failure, "reportTerminal").length === 1 &&
      calls(failure, "refetchAuthority").length === 1 &&
      calls(source, "refreshBattleCommandFailure").length === 2,
    "terminal failures must coordinate by room or perform Battle-only discovery",
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
    calls(result, "refreshScopes").length === 0 &&
      calls(failure, "refreshScopes").length === 0,
    "command terminal routing cannot own a scope refresh",
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
  const command = calls(view, "useBattleCommand");
  must(
    command.length === 1 &&
      command[0].arguments.map(text).join(",") ===
        "refetchAuthority,reportTerminal",
    "BattleView must inject the coordinator into commands",
  );

  const reports = calls(view, "reportTerminal");
  const observed = reports.find(
    (call) => text(call.arguments[0]) === "terminalRoomId",
  );
  must(
    reports.length === 4 && observed,
    "terminal reports must be limited to observation, offline, heartbeat, and retry",
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
  must(
    collected.length === 1 &&
      sameSet(
        objectKeys(collected[0].arguments[0]),
        new Set(["resultRoomIds", "rooms", "participations", "invite"]),
      ),
    "result, bootstrap/room, participation, and invite sources must converge",
  );

  const offline = variableFunction(view, "markOffline");
  const offlineThen = methodCalls(offline, "then").find(
    (call) =>
      calls(call.arguments[0], "reportTerminal").length === 1 &&
      propertyCalls(call.arguments[0], ["refetchRef", "current"]).length === 0,
  );
  must(
    hasStringCall(offline, "apiKeepaliveRequest", "battle.offline") &&
      offlineThen,
    "offline terminal success cannot append a Battle refetch",
  );
  const heartbeat = variableFunction(view, "heartbeat");
  const terminalBranch = ifs(heartbeat).find(
    (node) =>
      calls(node.expression, "isBattleAssetTerminal").length === 1 &&
      calls(node.thenStatement, "reportTerminal").length === 1 &&
      node.elseStatement &&
      propertyCalls(node.elseStatement, ["refetchRef", "current"]).length === 1,
  );
  must(
    hasStringCall(heartbeat, "apiRequest", "battle.heartbeat") &&
      terminalBranch &&
      calls(heartbeat, "reportTerminal").length === 1 &&
      propertyCalls(heartbeat, ["refetchRef", "current"]).length === 1,
    "heartbeat terminal and non-terminal paths must be mutually exclusive",
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
  must(
    calls(source, "refreshRouteScopes").length === 0 &&
      calls(source, "refreshScopes").filter(terminalRefresh).length === 0 &&
      calls(oneFunction(source, "terminalRoomIdsFor"), "isBattleAssetTerminal")
        .length === 3,
    "BattleView can observe terminal state but cannot own its refresh",
  );
}

function parse(fileName) {
  return ts.createSourceFile(
    fileName,
    fs.readFileSync(fileName, "utf8"),
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

function propertyChain(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node))
    return [...propertyChain(node.expression), node.name.text];
  return [];
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
  return (
    arrayStrings(scopes).join(",") === "battle,assets,inventory" &&
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

function enclosingFunction(node) {
  return enclosing(node, ts.isFunctionDeclaration);
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

function must(condition, message) {
  if (!condition) throw new Error(`Battle terminal refresh guard: ${message}`);
}
