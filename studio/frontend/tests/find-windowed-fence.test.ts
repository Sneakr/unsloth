// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc } from "./helpers/kit.ts";

test("stepping onto a match whose text a line window swapped out rebuilds the index first", () => {
  const hook = readSrc("features/find-in-page/hooks/use-find-in-page.ts");
  const step = hook.slice(
    hook.indexOf("const step = useCallback("),
    hook.indexOf("const next = useCallback("),
  );
  assert.match(
    step,
    /if \(staleRef\.current\) \{\s*const range = rangeForMatch\(indexRef\.current, target\);\s*if \(!\(range\?\.startContainer\.isConnected && range\.endContainer\.isConnected\)\) \{\s*activeStartRef\.current = target\.start;\s*search\(true, reindex\(\)\);\s*return;\s*\}\s*\}\s*apply\(true\);/,
    "a windowed fence swaps a line between one text node and its token spans as the reader moves, and the throttled rebuild came too late for a quick Enter",
  );
});
