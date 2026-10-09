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
    patient?: boolean,
  ) => (() => void) | null;
  highlightWorkerState: () => string;
  useReasoningHighlight: (
    fence: string,
    source: string,
    language: string | null,
    lines: number[],
    fallback: null,
    exact: boolean,
  ) => Map<number, unknown>;
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

const INERT_REACT = {
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: () => [null, () => {}],
};

function setup(t: TestContext, react: object = INERT_REACT): { client: Client; drain: () => void } {
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
      react,
      "@/features/chat": { useChatRuntimeStore: {} },
      "@/lib/schedule-idle-task": { scheduleQuietIdleTask: () => () => {}, inputQuietIn: () => 0 },
      "./reasoning-highlight": MESSAGES,
      "./reasoning-line-tokens": {
        mergeLineTokens: (_: unknown, lines: { line: number; tokens: unknown }[]) =>
          new Map(lines.map(({ line, tokens }) => [line, tokens])),
      },
      "./stream-activity": { createStreamActivity: () => ({ active: () => false }) },
    },
  );
  const drain = (): void => {
    for (let round = 0; round < 10; round += 1) t.mock.timers.tick(1);
  };
  return { client, drain };
}

async function settleChannels(client: Client): Promise<void> {
  for (let turn = 0; turn < 50 && client.highlightWorkerState() !== "stalled"; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function stallBoot(t: TestContext, client: Client): Promise<void> {
  t.mock.timers.tick(5_000);
  await settleChannels(client);
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

test("a fence the main thread could tokenize does not wait out a late boot", async (t) => {
  const { client, drain } = setup(t);
  const short: unknown[] = [];
  const long: unknown[] = [];
  assert.ok(client.requestFullHighlight("<p></p>", "html", (result) => short.push(result), false, false));
  assert.ok(client.requestFullHighlight("<html></html>", "html", (result) => long.push(result)));
  await stallBoot(t, client);
  drain();
  assert.deepEqual(short, [null], "handed back, so it is tokenized on the main thread as it would be without a worker");
  assert.deepEqual(long, [], "a fence too long for the main thread keeps waiting");
  assert.equal(client.requestFullHighlight("<b></b>", "html", () => {}, false, false), null, "while the worker is late, short fences never queue on it");
});

test("a ready worker that sends nothing while a fence waits is treated as late until it answers", async (t) => {
  const { client, drain } = setup(t);
  const short: unknown[] = [];
  const long: unknown[] = [];
  client.requestFullHighlight("<p></p>", "html", (result) => short.push(result), false, false);
  client.requestFullHighlight("<html></html>", "html", (result) => long.push(result));
  const [silent] = FakeWorker.made;
  silent.send({ ready: true });
  t.mock.timers.tick(14_999);
  await settleChannels(client);
  assert.equal(client.highlightWorkerState(), "ready", "fifteen seconds of silence, not less");
  t.mock.timers.tick(1);
  await settleChannels(client);
  assert.equal(client.highlightWorkerState(), "stalled");
  drain();
  assert.deepEqual(short, [null]);
  assert.deepEqual(long, []);
  const [, waiting] = silent.requests();
  silent.send({ client: waiting, revision: 1, lines: [], result: RESULT });
  assert.equal(client.highlightWorkerState(), "ready", "the first word from the worker ends the stall");
  assert.deepEqual(long, [RESULT]);
  assert.equal(silent.terminated, false);
});

test("a busy worker that keeps answering is never declared silent", async (t) => {
  const { client } = setup(t);
  const results: unknown[] = [];
  for (const source of ["<a></a>", "<b></b>", "<i></i>"]) {
    client.requestFullHighlight(source, "html", (result) => results.push(result), false, false);
  }
  const [busy] = FakeWorker.made;
  busy.send({ ready: true });
  for (const id of busy.requests()) {
    t.mock.timers.tick(10_000);
    await settleChannels(client);
    assert.equal(client.highlightWorkerState(), "ready");
    busy.send({ client: id, revision: 1, lines: [], result: RESULT });
  }
  assert.deepEqual(results, [RESULT, RESULT, RESULT]);
  t.mock.timers.tick(30_000);
  await settleChannels(client);
  assert.equal(client.highlightWorkerState(), "ready", "with nothing waiting, silence means nothing");
});

test("a late worker that idles out is replaced, so the next long fence is coloured again", async (t) => {
  const { client } = setup(t);
  const cancel = client.requestFullHighlight("<html></html>", "html", () => {});
  assert.ok(cancel);
  const [late] = FakeWorker.made;
  late.send({ ready: true });
  t.mock.timers.tick(15_000);
  await settleChannels(client);
  assert.equal(client.highlightWorkerState(), "stalled");
  cancel();
  t.mock.timers.tick(5_000);
  assert.equal(client.requestFullHighlight("<p></p>", "html", () => {}, false, false), null);
  t.mock.timers.tick(5_000);
  assert.equal(late.terminated, true, "with nothing left waiting, the late worker idles out, however many callers it turned away meanwhile");
  assert.equal(client.highlightWorkerState(), "untested");
  assert.ok(client.requestFullHighlight("<html></html>", "html", () => {}), "the next long fence gets a worker again");
  assert.equal(FakeWorker.made.length, 2);
});

function hookRunner() {
  let stale = false;
  let slots: unknown[] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  const react = {
    useState: (initial: unknown) => {
      const at = cursor++;
      const own = slots;
      if (!(at in own)) own[at] = typeof initial === "function" ? initial() : initial;
      const set = (next: unknown) => {
        own[at] = typeof next === "function" ? next(own[at]) : next;
      };
      return [own[at], set];
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { cleanup: subscribe(() => (stale = true)) };
      return snapshot();
    },
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const at = cursor++;
      const own = slots;
      const known = own[at] as { deps: unknown[]; cleanup: unknown } | undefined;
      if (known && deps.every((dep, i) => Object.is(dep, known.deps[i]))) return;
      pending.push(() => {
        if (typeof known?.cleanup === "function") known.cleanup();
        own[at] = { deps, cleanup: effect() };
      });
    },
  };
  function mount<T>(hook: () => T) {
    const own: unknown[] = [];
    const render = (): T => {
      slots = own;
      cursor = 0;
      pending = [];
      const rendered = hook();
      for (const run of pending) run();
      return rendered;
    };
    const unmount = () => {
      for (const slot of own) {
        const cleanup = (slot as { cleanup?: unknown } | undefined)?.cleanup;
        if (typeof cleanup === "function") cleanup();
      }
    };
    return { render, unmount };
  }
  return { react, mount, stale: () => stale };
}

test("thinking code the late worker failed or turned away asks again once it answers", async (t) => {
  const hooks = hookRunner();
  const { client, drain } = setup(t, hooks.react);
  const source = "const answer = 42;";
  const asked = hooks.mount(() => client.useReasoningHighlight("m:0:0", source, "javascript", [0], null, true)).render;
  const turnedAway = hooks.mount(() => client.useReasoningHighlight("m:0:0", source, "javascript", [0], null, true)).render;
  asked();
  const [late] = FakeWorker.made;
  await stallBoot(t, client);
  drain();
  turnedAway();
  assert.deepEqual(late.requests(), [1], "a group that mounts while the worker is late is not queued on it");
  assert.equal(hooks.stale(), false);
  late.send({ ready: true });
  assert.equal(hooks.stale(), true, "a fence too long for the main thread had no other way back to colour than a reopen");
  asked();
  turnedAway();
  assert.deepEqual(late.requests(), [1, 1, 2]);
  const tokens = [{ content: source, color: "#c00" }];
  late.send({ client: 1, revision: 2, lines: [{ line: 0, tokens }] });
  assert.deepEqual(asked().get(0), tokens);
});

test("every group of a fence edits the source the worker already holds, so the fence is sent once", (t) => {
  const hooks = hookRunner();
  const { client } = setup(t, hooks.react);
  const head = "const a = 1;\n";
  const grown = `${head}const b = 2;\n`;
  const group = (fence: string, source: string, line: number) =>
    hooks.mount(() => client.useReasoningHighlight(fence, source, "javascript", [line], null, true));
  group("m:0:9", head, 0).render();
  const [instance] = FakeWorker.made;
  const tail = group("m:0:9", grown, 1);
  tail.render();
  group("m:0:9", head, 0).render();
  tail.unmount();
  group("m:0:9", grown, 1).render();
  group("m:0:99", head, 0).render();
  const sources = instance.posted.flatMap((message) => ("source" in message ? [message.source] : []));
  assert.deepEqual(sources, [
    head,
    { base: 1, from: head.length, text: "const b = 2;\n" },
    { base: 2, from: head.length, text: "" },
    grown,
    head,
  ], "a group whose base went away, and another fence, send their whole source");
});

test("a group whose request the worker failed sends its whole source next, since the worker dropped it", (t) => {
  const hooks = hookRunner();
  const { client } = setup(t, hooks.react);
  const head = "const a = 1;\n";
  const grown = `${head}const b = 2;\n`;
  let source = head;
  const group = hooks.mount(() => client.useReasoningHighlight("m:0:9", source, "javascript", [0], null, true));
  group.render();
  const [instance] = FakeWorker.made;
  instance.send({ ready: true });
  instance.send({ client: 1, revision: 1, lines: [], failed: true });
  source = grown;
  group.render();
  const sources = instance.posted.flatMap((message) => ("source" in message ? [message.source] : []));
  assert.deepEqual(sources, [head, grown], "an edit of a source the worker no longer holds is built on an empty one");
});
