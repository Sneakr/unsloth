// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  REASONING_ROW_CONTAINMENT_ATTRIBUTE,
  REASONING_ROW_CONTAINMENT_ON,
  ROW_ESTIMATE_PROPERTY,
  ROW_SETTLED_ATTRIBUTE,
} from "../src/components/assistant-ui/reasoning-row-containment-mode.ts";

import { readSrc } from "./helpers/kit.ts";

const INDEX_CSS = readSrc("index.css");
const TRANSCRIPT = readSrc("components/assistant-ui/reasoning-transcript.tsx");
const ANCHOR = readSrc("components/assistant-ui/reasoning-reading-anchor.ts");
const HIGHLIGHT = readSrc("components/assistant-ui/use-reasoning-highlight.ts");
const MAIN = readSrc("main.tsx");
const CONTAINMENT = readSrc("components/assistant-ui/reasoning-row-containment.ts");

const GATE = `html[${REASONING_ROW_CONTAINMENT_ATTRIBUTE}="${REASONING_ROW_CONTAINMENT_ON}"]`;
const ROWS = '.aui-thread-root [data-slot="reasoning-transcript"] > [data-reasoning-row]';

const layerBounds = (css: string, name: string): [number, number] => {
  const open = css.indexOf(`@layer ${name} {`);
  assert.ok(open >= 0, `PRECONDITION: @layer ${name} exists`);
  let depth = 0;
  for (let i = css.indexOf("{", open); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return [open, i];
    }
  }
  throw new Error(`@layer ${name} never closes`);
};

test("every row records its size before any row can be skipped", () => {
  const at = INDEX_CSS.indexOf(`${ROWS} {`);
  assert.ok(at >= 0, "an ungated rule on every transcript row");
  const rule = INDEX_CSS.slice(at, INDEX_CSS.indexOf("}", at));
  assert.ok(rule.includes(`contain-intrinsic-size: auto var(${ROW_ESTIMATE_PROPERTY})`), "auto, so the engine remembers the rendered size, with the controller's estimate until then");
  assert.equal(rule.includes("content-visibility"), false, "sizing alone: the skipping is gated separately");
  const [open, close] = layerBounds(INDEX_CSS, "utilities");
  assert.ok(at > open && at < close);
});

test("only settled rows are skipped, and only where the engine finds skipped content", () => {
  const rules = INDEX_CSS.split(GATE).slice(1);
  assert.equal(rules.length, 1, "exactly one gated rule");
  const rule = rules[0].slice(0, rules[0].indexOf("}"));
  assert.ok(rule.startsWith(` ${ROWS}[${ROW_SETTLED_ATTRIBUTE}]`), "the settled row, a direct child of the transcript");
  assert.ok(rule.includes("content-visibility: auto;"));
  assert.equal(rule.includes(":has("), false);
  assert.equal(rule.includes("!important"), false);
  const at = INDEX_CSS.indexOf(GATE);
  const [open, close] = layerBounds(INDEX_CSS, "utilities");
  assert.ok(at > open && at < close, "inside @layer utilities");
  const printAt = INDEX_CSS.indexOf("@media print", at);
  assert.ok(printAt > at, "a print override follows");
  const print = INDEX_CSS.slice(printAt, INDEX_CSS.indexOf("}", INDEX_CSS.indexOf("}", printAt) + 1));
  assert.ok(print.includes(ROWS), "and names the transcript rows");
  assert.ok(print.includes("content-visibility: visible !important") && print.includes("contain-intrinsic-size: none !important"));
});

test("the transcript mounts every fragment and never unmounts one for scrolling", () => {
  assert.equal(TRANSCRIPT.includes("@tanstack/react-virtual"), false, "no virtualizer");
  assert.equal(/translateY|getTotalSize|measureElement|rangeExtractor/.test(TRANSCRIPT), false, "no absolute row positioning");
  assert.match(TRANSCRIPT, /const shown = covered \? fragments\.length : limit;/, "rows render in order up to the widening limit");
  assert.match(TRANSCRIPT, /limitRef\.current = isCovered\(rows, all\.length\)\s*\? Number\.POSITIVE_INFINITY\s*: rows;/, "and the limit is dropped for good once it covers the trace");
  assert.match(TRANSCRIPT, /if \(streamingRef\.current\) setLimit\(value\);\s*else startTransition\(\(\) => setLimit\(value\)\);/, "widening yields to input on a settled trace and cannot be starved by a stream");
  assert.match(TRANSCRIPT, /if \(widenFrame === 0\) widenFrame = requestAnimationFrame\(widenAll\);/, "one shared frame drives every open transcript");
  assert.match(TRANSCRIPT, /let budget = WIDEN_CHARACTERS_PER_FRAME;/, "under one shared budget of characters per frame");
  assert.equal(/setLimit\((?!value\))/.test(TRANSCRIPT.replace(/useState\(\(\) => \{[\s\S]*?\n {2}\}\);/, "")), false, "no other path moves the limit");
  assert.match(TRANSCRIPT, /if \(limit > limitRef\.current\) limitRef\.current = limit;/, "a committed limit never moves the requested one backwards");
});

test("a row settles one frame after it has been laid out, so the engine remembers its real size", () => {
  assert.match(TRANSCRIPT, /settleFrame = requestAnimationFrame\(\(\) => \{\s*settleFrame = requestAnimationFrame\(settleRows\);\s*\}\);/, "two frames: the first lays the row out and records it, the second may skip it");
  assert.match(TRANSCRIPT, /row\.setAttribute\(ROW_SETTLED_ATTRIBUTE, ""\)/);
  assert.equal(/data-settled=\{/.test(TRANSCRIPT), false, "settling is never a React prop");
  assert.equal((TRANSCRIPT.match(/removeAttribute\(ROW_SETTLED_ATTRIBUTE\)/g) ?? []).length, 1, "and the only unsettle is the width-change relayout");
  assert.match(TRANSCRIPT, /data-reasoning-row=""/, "both prose rows and code groups are rows");
  assert.match(TRANSCRIPT, /\[ROW_ESTIMATE_PROPERTY\]: `\$\{estimate\}px`/, "each carries its estimate for the time before it has rendered");
});

test("the DOM the rest of the app reads is unchanged", () => {
  for (const token of [
    'data-slot="reasoning-transcript"',
    'data-slot="reasoning-code-fragment"',
    'data-reasoning-code-row=""',
    "data-reasoning-fragment={fragment.key}",
    "data-reasoning-fragment={fragments[index].key}",
    'style={{ overflowAnchor: "none" }}',
    "SearchImagesEnabledContext.Provider value={false}",
    "aui-reasoning-prose-fragment",
  ]) {
    assert.ok(TRANSCRIPT.includes(token), `kept: ${token}`);
  }
  assert.match(TRANSCRIPT, /if \(touches\) detach\(\);/, "a selection or focus inside the trace still parks the autoscroll");
  assert.match(TRANSCRIPT, /for \(let i = shown; i < estimates\.length; i \+= 1\) reserved \+= estimates\[i\];/, "the unmounted tail keeps its estimated height");
  assert.match(TRANSCRIPT, /data-reasoning-reserve=""\s*style=\{\{ height: reserved \}\}/, "as a trailing spacer that shrinks as rows mount, so the thread below never jumps");
  assert.match(TRANSCRIPT, /adjustAbove\(passage\.getBoundingClientRect\(\)\.top - pending\.top\)/, "the threshold handover still restores the reading passage");
  assert.match(TRANSCRIPT, /adjustAbove\(passage\.getBoundingClientRect\(\)\.top - anchor\.top\)/, "and a width change still re-finds it");
  assert.match(TRANSCRIPT, /width = next;\s*resettleRows\(element\);/, "after a width change every row is laid out again before it may be skipped, so no remembered size goes stale");
  assert.match(TRANSCRIPT, /const capture = \(\) => \{\s*frame = 0;\s*if \(element\.getBoundingClientRect\(\)\.width !== width\) return;\s*reading = visibleAnchor\(\);/, "a scroll the engine's own anchoring fires inside the resize frame must not replace the pre-reflow anchor before the width handler has used it");
  assert.match(TRANSCRIPT, /for \(let i = first; i < rows\.length; i \+= 1\) \{\s*const row = rows\[i\];\s*if \(row\.getBoundingClientRect\(\)\.top >= bounds\.bottom\) break;/, "a fold row without capturable text falls through to the next visible row");
  assert.match(TRANSCRIPT, /row\.removeAttribute\(ROW_SETTLED_ATTRIBUTE\);\s*scheduleSettle\(row\);/, "re-settling goes through the same two-frame path as the first settle");
  assert.match(TRANSCRIPT, /observer\.disconnect\(\);\s*setReached\(true\);/, "a code group latches its highlighting one way");
});

test("the per-frame reading capture reuses one Range", () => {
  assert.match(ANCHOR, /const range = \(probe \?\?= document\.createRange\(\)\);/, "one live Range for every capture: the engine walks every attached Range on each node removal, so a Range per text node per scrolled frame made the fence windows' span churn an order of magnitude dearer");
  assert.equal((ANCHOR.match(/document\.createRange\(\)/g) ?? []).length, 2, "the only other Range is the one a caller asked for by position");
});

test("the highlight worker is not asked for nothing", () => {
  assert.match(HIGHLIGHT, /useEffect\(\(\) => \{\s*if \(lineKey === ""\) return;/);
});

test("startup arms the attribute after the code-block one", () => {
  const code = MAIN.indexOf("watchCodeBlockContainmentOverride();");
  const apply = MAIN.indexOf("applyReasoningRowContainment();");
  const watch = MAIN.indexOf("watchReasoningRowContainmentOverride();");
  assert.ok(code >= 0 && apply > code && watch > apply && watch < MAIN.indexOf("function renderApp()"));
  assert.ok(CONTAINMENT.includes('import { engineFindsSkippedContent } from "./math-block-containment";'));
  assert.ok(CONTAINMENT.includes("import.meta.env.VITE_UNSLOTH_REASONING_ROW_CONTAINMENT"));
  assert.ok(CONTAINMENT.includes("root.removeAttribute(REASONING_ROW_CONTAINMENT.attribute)"));
});
