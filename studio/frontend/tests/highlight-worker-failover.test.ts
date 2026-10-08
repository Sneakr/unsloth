// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc } from "./helpers/kit.ts";

const HOOK = readSrc("components/assistant-ui/use-reasoning-highlight.ts");
const WORKER = readSrc("components/assistant-ui/reasoning-highlight.worker.ts");
const MARKDOWN = readSrc("components/assistant-ui/markdown-text.tsx");
const TRANSCRIPT = readSrc("components/assistant-ui/reasoning-transcript.tsx");

test("the worker announces itself last, after its handler and highlighter exist", () => {
  const ready = WORKER.lastIndexOf("self.postMessage({ ready: true }");
  const handler = WORKER.indexOf("self.onmessage ??= ");
  assert.ok(handler >= 0 && ready > handler, "a second evaluation of the entry, which WebKit runs when a grammar chunk imports it back, keeps the first handler and its sources");
  assert.ok(ready > WORKER.indexOf("const highlighter = createCodePlugin("));
  assert.equal(WORKER.slice(ready).trim().split("\n").length, 1, "nothing follows the ready message");
  assert.ok(WORKER.includes("orderHighlightRequests([...pending.values()])"));
  assert.match(WORKER, /catch \{\s*if \(current\(\)\) \{\s*self\.postMessage\(\s*reasoningHighlightFailure\(request\.client, request\.revision\),/);
});

test("a failed worker is never rebuilt and every waiting caller hears about it once", () => {
  assert.equal((HOOK.match(/new Worker\(/g) ?? []).length, 1);
  const refused = HOOK.indexOf('if (state === "unavailable") return null;');
  assert.ok(refused >= 0 && refused < HOOK.indexOf("new Worker("));
  const fail = HOOK.slice(HOOK.indexOf("function fail("), HOOK.indexOf("function stall("));
  assert.ok(fail.includes('state = "unavailable";'));
  assert.ok(fail.includes("flushListeners();"));
  const flush = HOOK.slice(HOOK.indexOf("const flushListeners = "), HOOK.indexOf("function fail("));
  assert.equal(flush.includes("listeners.clear()"), false, "a listener cancelled after the snapshot is never called");
  assert.match(flush, /const listener = listeners\.get\(id\);\s*if \(listener !== undefined\) \{\s*listeners\.delete\(id\);\s*listener\(reasoningHighlightFailure\(id, 0\)\);/);
  assert.equal((flush.match(/setTimeout\(deliver, 0\)/g) ?? []).length, 2, "every failure, the first included, is its own task");
  const stall = HOOK.slice(HOOK.indexOf("function stall("), HOOK.indexOf("function getWorker("));
  assert.ok(stall.includes('state = "stalled";') && !stall.includes("terminate()"), "a worker that is late keeps running and recovers on its ready message");
  assert.ok(stall.includes("flushListeners(patientClients);"), "a late worker fails every caller except the whole-fence requests waiting on it");
  assert.match(HOOK, /if \(state === "stalled"\) return patient \? worker : null;/, "a whole-fence request queues on a late worker; every other caller highlights on the main thread while it is late");
  assert.match(HOOK, /speculative = false,\s*patient = !speculative,\s*\): \(\(\) => void\) \| null \{\s*const instance = getWorker\(patient\);\s*if \(!instance\) return null;\s*const id = \+\+nextClient;\s*if \(patient\) patientClients\.add\(id\);/);
  assert.equal((HOOK.match(/patientClients\.delete\(id\);/g) ?? []).length, 2, "an answered or cancelled request stops waiting");
  assert.match(HOOK, /idle = setTimeout\(\(\) => \{\s*if \(!worker \|\| boot\?\.instance === worker\) return;\s*worker\.terminate\(\);/, "and the idle teardown never kills a worker that is still booting, so the late ready can arrive");
  assert.match(HOOK, /clearBoot\(instance\);\s*state = "ready";\s*watchSilence\(instance\);\s*if \(listeners\.size === 0\) scheduleIdle\(\);/, "a worker that recovered with nothing waiting is torn down when idle like any other");
  const writes = HOOK.match(/state = "unavailable";/g) ?? [];
  assert.equal(writes.length, 3, "fail() and the two constructor guards; a stall is not a failure");
  const idle = HOOK.slice(HOOK.indexOf("function scheduleIdle("), HOOK.indexOf("export function requestFullHighlight("));
  assert.equal(idle.includes("state ="), false, "the idle teardown never changes the state");
  assert.ok(HOOK.includes("afterQueuedMessages(() => stall(instance))"));
  assert.ok(HOOK.includes("new MessageChannel()"));
  assert.match(HOOK, /const READY_TIMEOUT_MS = 5_000;/);
  assert.match(HOOK, /const IDLE_TEARDOWN_MS = 10_000;/);
});

test("a fence too long for the main thread stays plain without the worker, and the line callers fall back", () => {
  const hook = MARKDOWN.slice(MARKDOWN.indexOf("function useFenceTokens("), MARKDOWN.indexOf("function StreamingFenceBlock("));
  assert.match(hook, /const failover = !tokenizesOffThread\(body, streaming\);/, "only a fence short enough for the main thread may fail over to it");
  assert.match(hook, /cancel = requestFullHighlight\(\s*body,\s*languageToken,\s*\(result\) => \{\s*if \(result === null\) \{\s*if \(failover && wanted\.current === body\) \{\s*setTokens\(highlight\(body, late\)\);\s*\}\s*return;\s*\}/, "a failed whole-fence reply for a long fence is never failed over to the main thread");
  assert.match(hook, /setTokens\(result\);\s*\},\s*false,\s*!failover,\s*\);/, "only a fence too long for the main thread waits out a late or silent worker");
  assert.match(hook, /if \(cancel === null && failover\) \{\s*settled = highlight\(body, late\);\s*\} else \{\s*highlight\("", \(\) => \{\}\);\s*settled = code\.cover\(options\)\.result;\s*\}\s*release = awaitWorker\(body\.length, \(\) => \{/, "with or without a worker, an uncached long fence waits for one or for a print, showing whatever the main thread already coloured");
  assert.equal((hook.match(/highlight\(body, late\)/g) ?? []).length, 3, "a short fence is tokenized on the main thread only without the worker's help");
  assert.ok(hook.lastIndexOf("highlight(body, late)") > hook.lastIndexOf("} else {"));
  assert.equal((hook.match(/code\.highlight\(/g) ?? []).length, 1);
  assert.match(hook, /const result = code\.highlightExact\(\s*fenceHighlightOptions\(body, languageToken\),\s*late,\s*\);/, "a print tokenizes the whole fence now, never the throttled approximation with a plain tail");
  assert.match(WORKER, /const result = request\.full\s*\? highlighter\.highlightExact\(options, publish\)\s*: highlighter\.highlight\(options, publish\);/, "a whole-fence reply is exact, since the main thread seeds it as a permanent cache entry");
  assert.match(HOOK, /useEffect\(\(\) => \{\s*if \(lineKey === ""\) return;/);
  assert.ok(HOOK.includes("if (!instance) return runFallback();"));
  assert.match(HOOK, /if \(reply\.failed\) \{\s*sent\.current = null;\s*if \(revision\.current !== version\) return;\s*cancelFallback = runFallback\(\);\s*return;\s*\}/);
  assert.match(HOOK, /\(\) => \(\) => \{\s*revision\.current \+= 1;/, "an unmounted group never queues a fallback");
  assert.ok(TRANSCRIPT.includes("highlightFenceSource(code.source, code.language, late)"), "the fallback tokenizes exactly the string the worker tokenizes");
  assert.match(WORKER, /if \(request\.full && result !== null\) forget\(\);/, "a finished whole-fence request leaves nothing behind in the worker");
  assert.match(WORKER, /if \(request\.full && result === null && current\(\)\) \{\s*guard = setTimeout\(\(\) => \{\s*guard = null;\s*if \(!current\(\)\) return;\s*self\.postMessage\(\s*reasoningHighlightFailure\(request\.client, request\.revision\),\s*\);\s*forget\(\);\s*\}, FULL_REPLY_GUARD_MS\);/, "a whole-fence request whose grammar never loads is answered with a failure, so the speculator's slot is freed and the worker can idle");
  assert.match(WORKER, /const FULL_REPLY_GUARD_MS = 15_000;/);
  assert.match(TRANSCRIPT, /code\.incomplete \|\| code\.source\.length > MAIN_THREAD_HIGHLIGHT_CHARS\s*\? null\s*: fallback,/);
  assert.match(TRANSCRIPT, /const withoutIdleCallback =\s*typeof window !== "undefined" &&\s*typeof window\.requestIdleCallback !== "function";\s*const MAIN_THREAD_HIGHLIGHT_CHARS = withoutIdleCallback\s*\? 2_000\s*: MAX_HIGHLIGHT_CHARS;/, "JavaScriptCore interprets the grammars' lookbehind regexes, so WebKit tokenizes far less on the main thread");
  assert.match(TRANSCRIPT, /import \{[^}]*\bMAX_HIGHLIGHT_CHARS\b[^}]*\} from "@\/lib\/markdown-plugins";/);
});

test("the stream signal is read lazily, never at module scope", () => {
  assert.match(HOOK, /\(activity \?\?= createStreamActivity\(useChatRuntimeStore\)\)\.active\(\)/);
  assert.equal(/^const activity = createStreamActivity/m.test(HOOK), false);
  assert.match(HOOK, /if \(streamActive\(\)\) \{\s*const timer = setTimeout\(drainFallback, 1000\);/);
});
