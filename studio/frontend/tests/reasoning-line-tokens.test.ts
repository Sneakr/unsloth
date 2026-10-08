// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  lineContent,
  mergeLineTokens,
  type ReasoningLineTokens,
} from "../src/components/assistant-ui/reasoning-line-tokens.ts";

const line = (text: string, color = "red") => [{ content: text, color, offset: 0 }];

test("a line whose text did not change keeps its token array identity", () => {
  const first = line("const a = 1;");
  const previous: ReasoningLineTokens = new Map([[0, first]]);
  const merged = mergeLineTokens(previous, [
    { line: 0, tokens: line("const a = 1;", "blue") },
    { line: 1, tokens: line("const b = 2;") },
  ]);
  assert.notEqual(merged, previous);
  assert.equal(merged.get(0), first);
  assert.equal(lineContent(merged.get(1)!), "const b = 2;");
});

test("nothing changed returns the previous map", () => {
  const previous: ReasoningLineTokens = new Map([[4, line("x")], [5, line("y")]]);
  const merged = mergeLineTokens(previous, [
    { line: 4, tokens: line("x") },
    { line: 5, tokens: line("y") },
  ]);
  assert.equal(merged, previous);
});

test("lines missing from the reply are dropped and changed text replaces its tokens", () => {
  const previous: ReasoningLineTokens = new Map([[0, line("old")], [1, line("gone")]]);
  const replacement = line("new");
  const merged = mergeLineTokens(previous, [{ line: 0, tokens: replacement }]);
  assert.equal(merged.size, 1);
  assert.equal(merged.get(0), replacement);
  assert.equal(merged.has(1), false);
});

test("a plain approximation of a line gives way to its colored tokens, and never the reverse", () => {
  const plain = [{ content: "const a = 1;", offset: 0 }];
  const colored = line("const a = 1;");
  const upgraded = mergeLineTokens(new Map([[0, plain]]), [{ line: 0, tokens: colored }]);
  assert.equal(upgraded.get(0), colored, "the throttled plain tail is replaced once the colors arrive");
  const kept = mergeLineTokens(upgraded, [{ line: 0, tokens: plain }]);
  assert.equal(kept, upgraded, "a later plain approximation of the same text never strips the colors");
  const styled = [{ content: "const a = 1;", offset: 0, htmlStyle: { color: "#fff", "--shiki-dark": "#000" } }];
  assert.equal(mergeLineTokens(new Map([[0, plain]]), [{ line: 0, tokens: styled }]).get(0), styled, "dual-theme tokens count as colored");
});

test("a code row re-renders when any of its lines changes, not only its first", () => {
  const transcript = readFileSync(new URL("../src/components/assistant-ui/reasoning-transcript.tsx", import.meta.url), "utf8");
  assert.match(transcript, /a\.code!\.lines\.every\(\s*\(\{ line \}\) => previous\.result\.get\(line\) === next\.result\.get\(line\),\s*\)/);
  assert.equal(transcript.includes("previous.result.get(a.code!.lines[0].line)"), false);
});
