// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
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
