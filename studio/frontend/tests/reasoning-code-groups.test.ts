// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { readSrc } from "./helpers/kit.ts";
import { loadWithStubs } from "./helpers/module-stubs.ts";

const plugin = await import("../src/components/assistant-ui/code-plugin.ts");
const themes = await import("../src/components/assistant-ui/code-themes.ts");
const TRANSCRIPT = readSrc("components/assistant-ui/reasoning-transcript.tsx");
const HOOK = readSrc("components/assistant-ui/use-reasoning-highlight.ts");
const messages = loadWithStubs<Record<string, unknown>>(
  new URL("../src/components/assistant-ui/reasoning-highlight.ts", import.meta.url),
  {},
);

type Token = { content: string; color?: string; htmlStyle?: Record<string, string> };
type Reply = { client?: number; revision?: number; lines?: { line: number; tokens: Token[] }[] };

function startWorker(t: TestContext) {
  const replies: Reply[] = [];
  const scope = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (data: Reply) => replies.push(data),
  };
  const global = globalThis as { self?: unknown };
  const saved = global.self;
  global.self = scope;
  t.after(() => {
    global.self = saved;
  });
  loadWithStubs(new URL("../src/components/assistant-ui/reasoning-highlight.worker.ts", import.meta.url), {
    "./code-plugin": plugin,
    "./code-themes": themes,
    "./reasoning-highlight": messages,
  });
  const latest = (client: number) => {
    const tokens = new Map<number, Token[]>();
    for (const reply of replies) {
      if (reply.client !== client) continue;
      for (const { line, tokens: row } of reply.lines ?? []) tokens.set(line, row);
    }
    return tokens;
  };
  return { send: (data: Record<string, unknown>) => scope.onmessage!({ data }), replies, latest };
}

const code = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => `const value${from + i} = compute(${from + i}, "padding");`).join("\n");
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const coloured = (row: Token[] | undefined) =>
  row !== undefined && row.some((token) => token.color !== undefined || token.htmlStyle !== undefined);
const until = async (done: () => boolean) => {
  for (let wait = 0; wait < 400 && !done(); wait += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

test("a thinking code group the stream has moved past gets every line coloured, while the tail keeps its refresh", async (t) => {
  const worker = startWorker(t);
  const opened = code(0, 80);
  assert.ok(opened.length > plugin.MIN_INCREMENTAL_CHARS, "large enough for the throttled path to answer");
  worker.send({ client: 1, revision: 1, source: opened, language: "javascript", lines: range(0, 80) });
  await until(() => range(0, 80).every((line) => coloured(worker.latest(1).get(line))));
  assert.ok(range(0, 80).every((line) => coloured(worker.latest(1).get(line))));

  const moved = `${code(0, 120)}\n${code(120, 1)}`;
  worker.send({ client: 1, revision: 2, source: moved, language: "javascript", lines: range(0, 120), exact: true });
  worker.send({ client: 2, revision: 1, source: moved, language: "javascript", lines: [120] });
  worker.send({ client: 2, revision: 2, source: `${moved}\n${code(121, 1)}`, language: "javascript", lines: [120, 121] });
  await new Promise((resolve) => setTimeout(resolve, 600));

  const settled = worker.latest(1);
  const plain = range(0, 120).filter((line) => !coloured(settled.get(line)));
  assert.deepEqual(plain, [], "a group no later request will refresh is answered exactly, never with a plain tail");
  const tail = worker.latest(2);
  assert.ok([120, 121].every((line) => coloured(tail.get(line))), "the growing tail still receives its queued refresh");
});

test("a code group's first request edits the source another group of its fence already sent", async (t) => {
  const worker = startWorker(t);
  const head = code(0, 40);
  const grown = `${head}\n${code(40, 20)}`;
  worker.send({ client: 1, revision: 1, source: head, language: "javascript", lines: range(0, 40), exact: true });
  worker.send({ client: 2, revision: 1, source: { base: 1, from: head.length, text: grown.slice(head.length) }, language: "javascript", lines: range(40, 20), exact: true });
  worker.send({ client: 3, revision: 1, source: { base: 2, from: head.length, text: "" }, language: "javascript", lines: range(30, 10), exact: true });
  const shown = (client: number, line: number) => (worker.latest(client).get(line) ?? []).map((token) => token.content).join("");
  const expected = (line: number) => code(line, 1);
  const done = () => range(40, 20).every((line) => shown(2, line) === expected(line)) && range(30, 10).every((line) => shown(3, line) === expected(line));
  await until(done);
  assert.ok(done(), "the worker rebuilt each group's source from the one it already held");
  assert.ok(range(40, 20).every((line) => coloured(worker.latest(2).get(line))));
});

test("an edit of a source the worker no longer holds fails instead of colouring a guess", async (t) => {
  const worker = startWorker(t);
  const head = code(0, 40);
  worker.send({ client: 1, revision: 1, source: head, language: "javascript", lines: range(0, 40), exact: true });
  worker.send({ cancel: 1 });
  worker.send({ client: 2, revision: 3, source: { base: 1, from: head.length, text: `\n${code(40, 1)}` }, language: "javascript", lines: [40], exact: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const replies = worker.replies.filter((reply) => reply.client === 2);
  assert.deepEqual(replies, [{ client: 2, revision: 3, lines: [], failed: true }], "the sibling's source was gone, so its edit was applied to an empty string");
});

test("only the growing tail of a fence may take the throttled colours, and a finished fence shares one source", () => {
  assert.match(TRANSCRIPT, /const growing = streaming && code\.incomplete;\s*const frozen = growing && !last\.last;/);
  assert.match(TRANSCRIPT, /if \(frozen \? stableSource\?\.key !== last\.key : stableSource !== null\)\s*setStableSource\(frozen \? \{ key: last\.key, source: code\.source \} : null\);/, "a group keeps the prefix it finished with only while the fence grows, then drops it");
  assert.match(TRANSCRIPT, /: fallback,\s*!growing \|\| !last\.last,\s*\);/, "every other group asks for exact colours, since no later request of its own would refresh them");
  assert.match(HOOK, /lines: wanted,\s*\.\.\.\(exact \? \{ exact: true \} : \{\}\),\s*\};/);
  assert.match(HOOK, /\}, \[fence, source, language, lineKey, fallback, exact, recovery\]\);/);
});

test("a code group the fence continues past owns the line break after it, in a block that is not a <pre>", () => {
  assert.match(TRANSCRIPT, /const breaksAfter =\s*!last\.last &&\s*fragments\[indices\[indices\.length - 1\] \+ 1\]\?\.code\?\.lines\[0\]\?\.column === 0;/);
  assert.match(TRANSCRIPT, /\{breaksAfter && "\\n"\}\s*<\/code>\s*<\/div>/, "a blank last line needs a break after it to take up its row, and a copy across the seam keeps it");
  assert.equal(TRANSCRIPT.includes('<pre className="!m-0 min-h-[1lh]'), false, "Firefox copies a blank line between two <pre> blocks");
});

test("a code group's block still reads as a passage and takes the chosen code size, as its <pre> did", () => {
  assert.match(
    readSrc("components/assistant-ui/reasoning-reading-anchor.ts"),
    /const passages =\s*"p, pre, \.aui-reasoning-code-lines, li, /,
    "with only thinking code on screen, a width change moved the reader by the whole height the trace above it gained",
  );
  assert.match(
    readSrc("index.css"),
    /html\[data-code-font-size\] :is\(pre, code, kbd, samp\),\nhtml\[data-code-font-size\] \.aui-reasoning-code-lines \{\n\tfont-size: var\(--custom-code-font-size\) !important;/,
    "a smaller code font kept the block's default line spacing",
  );
});
