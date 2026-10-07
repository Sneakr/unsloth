// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { loadWithStubs } from "./helpers/module-stubs.ts";

type Client = {
  requestFullHighlight: (
    source: string,
    language: string | null,
    onResult: (result: unknown) => void,
    speculative?: boolean,
  ) => (() => void) | null;
  highlightWorkerState: () => string;
};

class FakeWorker {
  static made: FakeWorker[] = [];
  posted: Record<string, unknown>[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; type: string }) => void) | null = null;

  constructor() {
    FakeWorker.made.push(this);
  }

  postMessage(data: Record<string, unknown>): void {
    this.posted.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  send(data: unknown): void {
    this.onmessage?.({ data });
  }

  requests(): number[] {
    return this.posted.flatMap((message) =>
      typeof message.client === "number" ? [message.client] : [],
    );
  }
}

const RESULT = { tokens: [[]], fg: "#000", bg: "#fff" };

const MESSAGES = loadWithStubs<Record<string, unknown>>(
  new URL("../src/components/assistant-ui/reasoning-highlight.ts", import.meta.url),
  {},
);

function setup(t: TestContext): { client: Client; drain: () => void } {
  FakeWorker.made = [];
  const scope = globalThis as { Worker?: unknown };
  scope.Worker = FakeWorker;
  t.after(() => {
    delete scope.Worker;
  });
  t.mock.method(console, "warn", () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = loadWithStubs<Client>(
    new URL("../src/components/assistant-ui/use-reasoning-highlight.ts", import.meta.url),
    {
      react: { useEffect: () => {}, useRef: () => ({ current: null }), useState: () => [null, () => {}] },
      "@/features/chat": { useChatRuntimeStore: {} },
      "@/lib/schedule-idle-task": { scheduleIdleTask: () => () => {} },
      "./reasoning-highlight": MESSAGES,
      "./reasoning-line-tokens": { mergeLineTokens: () => new Map() },
      "./stream-activity": { createStreamActivity: () => ({ active: () => false }) },
    },
  );
  const drain = (): void => {
    for (let round = 0; round < 10; round += 1) t.mock.timers.tick(1);
  };
  return { client, drain };
}

async function stallBoot(t: TestContext, client: Client): Promise<void> {
  t.mock.timers.tick(5_000);
  for (let turn = 0; turn < 50 && client.highlightWorkerState() !== "stalled"; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(client.highlightWorkerState(), "stalled");
}

test("a whole-fence request waits out a slow boot and the worker that was late answers it", async (t) => {
  const { client, drain } = setup(t);
  const fence: unknown[] = [];
  const speculation: unknown[] = [];
  assert.ok(client.requestFullHighlight("<html></html>", "html", (result) => fence.push(result)));
  assert.ok(client.requestFullHighlight("<p></p>", "html", (result) => speculation.push(result), true));
  const [booting] = FakeWorker.made;
  await stallBoot(t, client);
  drain();
  assert.deepEqual(speculation, [null], "the speculator hears of the stall, so it can pause");
  assert.deepEqual(fence, [], "the fence is not failed over to the main thread");
  const mounted: unknown[] = [];
  assert.ok(
    client.requestFullHighlight("<div></div>", "html", (result) => mounted.push(result)),
    "a fence that mounts during the stall queues on the same worker",
  );
  assert.equal(client.requestFullHighlight("<b></b>", "html", () => {}, true), null, "speculation is not sent to a late worker");
  assert.equal(FakeWorker.made.length, 1);
  booting.send({ ready: true });
  assert.equal(client.highlightWorkerState(), "ready");
  const [waited, , queued] = booting.requests();
  booting.send({ client: waited, revision: 1, lines: [], result: RESULT });
  booting.send({ client: queued, revision: 1, lines: [], result: RESULT });
  assert.deepEqual(fence, [RESULT]);
  assert.deepEqual(mounted, [RESULT]);
  t.mock.timers.tick(10_000);
  assert.equal(booting.terminated, true, "with nothing left waiting, the recovered worker idles out");
});

test("a whole-fence request cancelled during the stall is never answered and lets the worker idle", async (t) => {
  const { client, drain } = setup(t);
  const fence: unknown[] = [];
  const cancel = client.requestFullHighlight("<html></html>", "html", (result) => fence.push(result));
  assert.ok(cancel);
  const [booting] = FakeWorker.made;
  await stallBoot(t, client);
  drain();
  cancel();
  assert.deepEqual(booting.posted.at(-1), { cancel: booting.requests()[0] });
  booting.send({ ready: true });
  booting.send({ client: booting.requests()[0], revision: 1, lines: [], result: RESULT });
  assert.deepEqual(fence, []);
  t.mock.timers.tick(10_000);
  assert.equal(booting.terminated, true);
});

test("a crashed worker fails every waiting request, whole-fence ones included, and is never rebuilt", (t) => {
  const { client, drain } = setup(t);
  const fence: unknown[] = [];
  client.requestFullHighlight("<html></html>", "html", (result) => fence.push(result));
  const [crashed] = FakeWorker.made;
  crashed.onerror?.({ message: "boom", type: "error" });
  assert.equal(client.highlightWorkerState(), "unavailable");
  assert.equal(crashed.terminated, true);
  drain();
  assert.deepEqual(fence, [null]);
  assert.equal(client.requestFullHighlight("<html></html>", "html", () => {}), null);
  assert.equal(FakeWorker.made.length, 1);
});

test("a worker that fails a whole-fence request answers it once with a failure", (t) => {
  const { client, drain } = setup(t);
  const fence: unknown[] = [];
  client.requestFullHighlight("<html></html>", "html", (result) => fence.push(result));
  const [ready] = FakeWorker.made;
  ready.send({ ready: true });
  const [id] = ready.requests();
  ready.send({ client: id, revision: 1, lines: [], failed: true });
  ready.send({ client: id, revision: 1, lines: [], result: RESULT });
  drain();
  assert.deepEqual(fence, [null]);
  assert.equal(client.highlightWorkerState(), "ready");
});
