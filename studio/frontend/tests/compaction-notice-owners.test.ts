// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  compactionNoticeOwners,
  computeCompactionNoticeOwners,
} from "../src/components/assistant-ui/compaction-notice-owners.ts";
import {
  compactionBoundary,
  shouldShowCompactionNotice,
} from "../src/features/chat/utils/context-truncation.ts";

const assistant = (id: string, truncation: unknown) => ({
  id,
  role: "assistant",
  metadata: { custom: { contextTruncation: truncation } },
});
const user = (id: string) => ({ id, role: "user" });

const oracle = (messages: ReadonlyArray<{ id: string; role: string; metadata?: unknown }>): Set<string> => {
  const shown = new Set<string>();
  let previousDropped = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const value = (message.metadata as { custom?: { contextTruncation?: unknown } } | undefined)?.custom
      ?.contextTruncation as Parameters<typeof compactionBoundary>[0];
    const dropped = compactionBoundary(value);
    if (shouldShowCompactionNotice(value, previousDropped)) {
      shown.add(message.id);
      previousDropped = Math.max(previousDropped, dropped);
    }
  }
  return shown;
};

const truncations = [undefined, null, { droppedMessages: 0 }, { droppedMessages: 2 }, { droppedMessages: 2 }, { droppedMessages: 5, checkpoint: true }, { droppedMessages: 5 }];

test("the owners set equals the in-order walk for every assistant message", () => {
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647);
  for (let round = 0; round < 200; round += 1) {
    const messages: ReturnType<typeof assistant | typeof user>[] = [];
    const count = 1 + (next() % 12);
    for (let i = 0; i < count; i += 1) {
      messages.push(next() % 3 === 0 ? user(`u${i}`) : assistant(`a${i}`, truncations[next() % truncations.length]));
    }
    assert.deepEqual([...computeCompactionNoticeOwners(messages)].sort(), [...oracle(messages)].sort());
  }
});

test("the same messages array is one computation", () => {
  const messages = [assistant("a", { droppedMessages: 3 }), user("u"), assistant("b", { droppedMessages: 3 })];
  const first = compactionNoticeOwners(messages);
  assert.equal(compactionNoticeOwners(messages), first);
  assert.notEqual(compactionNoticeOwners([...messages]), first, "a new array is walked again");
  assert.deepEqual([...first], [...oracle(messages)]);
});
