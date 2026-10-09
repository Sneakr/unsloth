// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  derivedForParts,
  memoOnArray,
} from "../src/components/assistant-ui/message-derived.ts";
import { readSrc } from "./helpers/kit.ts";

const parts = [
  { type: "reasoning", text: "thinking" },
  { type: "text", text: "hello" },
  { type: "tool-call", toolName: "x" },
  { type: "text", text: "world" },
];

test("the same parts array yields one record, computed lazily and once", () => {
  const a = derivedForParts(parts);
  const b = derivedForParts(parts);
  assert.equal(a, b, "keyed on the array's identity");
  assert.deepEqual(a.texts, ["hello", "world"]);
  assert.equal(a.textKey, JSON.stringify(["hello", "world"]));
  assert.equal(a.textBlob, "hello\u0000world");
  assert.equal(a.texts, b.texts, "the texts array is computed once");
});

test("a new parts array is a new record, so an edit is never served stale", () => {
  const edited = [...parts, { type: "text", text: "!" }];
  assert.notEqual(derivedForParts(edited), derivedForParts(parts));
  assert.equal(derivedForParts(edited).textBlob, "hello\u0000world\u0000!");
});

test("nothing is computed until a field is read", () => {
  let reads = 0;
  const spied = [
    {
      type: "text",
      get text() {
        reads += 1;
        return "x";
      },
    },
  ];
  const record = derivedForParts(spied);
  assert.equal(reads, 0, "creating the record reads no part");
  assert.equal(record.textKey, '["x"]');
  assert.equal(record.textBlob, "x");
  assert.equal(reads, 1, "and the texts are read once for both fields");
});

test("memoOnArray caches per array and per key", () => {
  const messages = [{ id: "a" }, { id: "b" }];
  let computed = 0;
  const first = memoOnArray(messages, "k", () => {
    computed += 1;
    return new Set(["a"]);
  });
  const again = memoOnArray(messages, "k", () => {
    computed += 1;
    return new Set(["b"]);
  });
  assert.equal(first, again);
  assert.equal(computed, 1);
  const other = memoOnArray(messages, "other", () => {
    computed += 1;
    return 1;
  });
  assert.equal(other, 1);
  assert.equal(computed, 2);
  assert.notEqual(memoOnArray([...messages], "k", () => new Set()), first, "a new array computes anew");
});

test("a message with search images lists its texts while it runs, so a card placed later stops an earlier part repeating it", () => {
  assert.match(
    readSrc("components/assistant-ui/markdown-text.tsx"),
    /const messageTextKey = useAuiState\(\(\{ message \}\) =>\s*allowSearchImages &&\s*memoOnArray\(message\.parts, "searchImages", \(\) =>\s*searchImagesSignature\(message\.parts\),\s*\) !== ""\s*\? derivedForParts\(message\.parts\)\.textKey\s*: "\[\]",\s*\);/,
    "without images the texts change nothing, so only then may a running reply skip serialising them",
  );
});
