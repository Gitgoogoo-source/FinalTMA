#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import {
  englishGameContent,
  englishGameContentById,
  gameContentLocalizationCounts,
  simplifiedChineseGameContentById,
} from "../../packages/api-contracts/src/localization.ts";
import { errorCodes } from "../../packages/api-contracts/src/common/error-codes.ts";
import { englishCopy } from "../../apps/web/src/platform/i18n/en.ts";
import { englishErrorCopy } from "../../apps/web/src/platform/i18n/error-copy.ts";

const root = path.resolve("apps/web/src");
const sourceFiles = collectSourceFiles(root);
const failures: string[] = [];
const activeLocalizedSources = new Set<string>();

for (const file of sourceFiles) inspectSourceFile(file);

for (const [source, english] of Object.entries(englishCopy)) {
  if (containsHan(english))
    failures.push(
      `English copy still contains Chinese: ${JSON.stringify(source)}`,
    );
}

for (const code of errorCodes) {
  const copy = englishErrorCopy[code];
  if (!copy) failures.push(`Missing English error copy: ${code}`);
  else if (containsHan(copy))
    failures.push(`English error copy still contains Chinese: ${code}`);
}

inspectFrozenGameContent();

const expectedCounts = {
  pets: 210,
  chains: 70,
  battleSkills: 50,
  taskFields: 34,
  other: 3,
} as const;
for (const [kind, expected] of Object.entries(expectedCounts)) {
  const actual =
    gameContentLocalizationCounts[kind as keyof typeof expectedCounts];
  if (actual !== expected)
    failures.push(
      `Game-content localization count drift for ${kind}: ${actual}/${expected}`,
    );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `i18n check passed: ${sourceFiles.length} source files, ${activeLocalizedSources.size} active copy keys, ${gameContentLocalizationCounts.pets} pets, ${gameContentLocalizationCounts.battleSkills} Battle skills`,
);

if (process.env.I18N_REPORT === "1") {
  for (const source of [...activeLocalizedSources].sort()) {
    console.log(
      `${JSON.stringify(source)}\t${JSON.stringify(englishCopy[source] ?? englishGameContent(source))}`,
    );
  }
}

function inspectSourceFile(file: string): void {
  const sourceText = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  visit(sourceFile);

  function visit(node: ts.Node): void {
    const value = stringValue(node);
    if (value !== null && containsHan(value)) {
      const localization = localizationBoundary(node, value);
      if (!localization)
        failures.push(
          `${relativePosition(sourceFile, node)} Chinese literal is not localized: ${JSON.stringify(value)}`,
        );
      else if (localization !== "tr" && localization !== "label") {
        activeLocalizedSources.add(value);
        if (!englishCopy[value] && !englishGameContent(value))
          failures.push(
            `${relativePosition(sourceFile, node)} missing English copy: ${JSON.stringify(value)}`,
          );
      }
    }
    ts.forEachChild(node, visit);
  }
}

function inspectFrozenGameContent(): void {
  const catalog = JSON.parse(
    fs.readFileSync("generated/catalog/catalog-v1.json", "utf8"),
  ) as {
    chains: { id: string; theme: string }[];
    templates: { id: string; name: string }[];
  };
  const battle = JSON.parse(
    fs.readFileSync("generated/battle/battle-v1.json", "utf8"),
  ) as { skills: { id: string; name: string }[] };
  for (const item of [
    ...catalog.templates.map(({ id, name }) => ({ id, source: name })),
    ...catalog.chains.map(({ id, theme }) => ({ id, source: theme })),
    ...battle.skills.map(({ id, name }) => ({ id, source: name })),
  ]) {
    inspectFrozenEntry(item.id, item.source);
  }

  const tasksSource = fs.readFileSync("tools/product_data/tasks.py", "utf8");
  for (const match of tasksSource.matchAll(
    /^\s*\("([a-z0-9_]+)",\s*\d+,\s*"[a-z]+",\s*"([^"]+)",\s*"([^"]+)"/gm,
  )) {
    inspectFrozenEntry(`${match[1]}.title`, match[2]);
    inspectFrozenEntry(`${match[1]}.description`, match[3]);
  }

  const gachaSource = fs.readFileSync("tools/product_data/gacha.py", "utf8");
  for (const match of gachaSource.matchAll(
    /^\s*\('(normal|rare|legendary)',\s*'([^']+)'/gm,
  )) {
    inspectFrozenEntry(`box.${match[1]}`, match[2]);
  }
}

function inspectFrozenEntry(id: string, source: string): void {
  if (!englishGameContentById(id))
    failures.push(`Missing frozen English game content: ${id}`);
  const registeredSource = simplifiedChineseGameContentById(id);
  if (registeredSource !== source)
    failures.push(
      `Frozen game-content source drift for ${id}: ${JSON.stringify(registeredSource)} != ${JSON.stringify(source)}`,
    );
}

function localizationBoundary(
  node: ts.Node,
  value: string,
): "label" | "localized" | "t" | "tp" | "tr" | null {
  if (value === "简体中文") return "label";
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor) {
    if (ts.isCallExpression(ancestor) && ts.isIdentifier(ancestor.expression)) {
      const call = ancestor.expression.text;
      if (call === "localized") return "localized";
      if (
        call === "tr" &&
        ancestor.arguments.some((argument) => isWithin(node, argument))
      )
        return "tr";
      if (
        (call === "t" || call === "tp") &&
        ancestor.arguments[0] &&
        isWithin(node, ancestor.arguments[0])
      )
        return call;
    }
    ancestor = ancestor.parent;
  }
  return null;
}

function isWithin(node: ts.Node, rootNode: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current && current !== rootNode) current = current.parent;
  return current === rootNode;
}

function stringValue(node: ts.Node): string | null {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isJsxText(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
    return node.text;
  return null;
}

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (file.endsWith(`${path.sep}platform${path.sep}i18n`)) continue;
      files.push(...collectSourceFiles(file));
    } else if (/\.tsx?$/.test(entry.name)) files.push(file);
  }
  return files;
}

function relativePosition(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return `${path.relative(process.cwd(), sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`;
}

function containsHan(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value);
}
