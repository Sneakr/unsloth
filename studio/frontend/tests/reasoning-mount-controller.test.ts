// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_VIEWPORTS,
  SETTLE_MS,
  WIDEN_CHARACTERS_PER_FRAME,
  WIDEN_FRAGMENTS_PER_FRAME,
  estimateFragmentHeight,
  frameBudget,
  initialRows,
  isCovered,
  widenBudget,
  widenRows,
} from "../src/components/assistant-ui/reasoning-mount-controller.ts";
import {
  REASONING_ROW_CONTAINMENT,
  REASONING_ROW_CONTAINMENT_ATTRIBUTE,
  ROW_ESTIMATE_PROPERTY,
  ROW_SETTLED_ATTRIBUTE,
  SHIP_DEFAULT,
} from "../src/components/assistant-ui/reasoning-row-containment-mode.ts";
import { defineContainmentFlag } from "../src/components/assistant-ui/containment-flag.ts";

import { readSrc } from "./helpers/kit.ts";

const geometry = { width: 640, lineHeight: 24, fontPixels: 15 };

test("a hidden fragment has no height and prose loses its paragraph gap", () => {
  assert.equal(estimateFragmentHeight({ text: "x", first: true, last: false, hidden: true }, geometry), 0);
  const prose = estimateFragmentHeight({ text: "one\ntwo\nthree\nfour", first: false, last: false }, geometry);
  assert.equal(prose, 2 * 24, "four lines of prose estimate as the lines minus the two blank separators");
  const first = estimateFragmentHeight({ text: "one\ntwo\nthree\nfour", first: true, last: false }, geometry);
  assert.equal(first, prose + 16, "the first fragment carries the pane's top padding");
});

test("a code fragment is sized per line with its header and footer", () => {
  const code = { source: "a\nb", incomplete: false, language: "ts", lines: [] };
  const middle = estimateFragmentHeight({ text: "a\nb", first: false, last: false, code }, geometry);
  assert.equal(middle, 2 * 24);
  const whole = estimateFragmentHeight({ text: "a\nb", first: true, last: true, code }, geometry);
  assert.equal(whole, 2 * 24 + 40 + 16);
});

test("long lines wrap into the estimate at the measured column count", () => {
  const columns = Math.floor(640 / (15 * 0.48));
  const text = "x".repeat(columns * 6);
  const single = estimateFragmentHeight({ text: "x", first: false, last: false }, geometry);
  const wrapped = estimateFragmentHeight({ text, first: false, last: false }, geometry);
  assert.ok(wrapped > single, "a wrapped line costs more than a short one");
});

test("the first commit covers the budget and always includes the anchor row", () => {
  const estimates = [100, 100, 100, 100, 100, 100, 100, 100];
  assert.equal(initialRows(estimates, 250, -1), 3, "three rows cover 250px");
  assert.equal(initialRows(estimates, 250, 5), 8, "the anchor row, everything above it, and the budget below it so the reader's position survives the hand-over");
  assert.equal(initialRows(estimates, 250, 7), 8, "an anchor near the end mounts to the end");
  assert.equal(initialRows(estimates, 10_000, -1), 8, "and never more than there are");
  assert.equal(initialRows(estimates, 10_000, -1, Array(8).fill(1500)), 3, "and never more characters than one frame can parse, so a reopen stays inside the collapse scroll lock");
  assert.equal(initialRows(estimates, 10_000, -1, Array(8).fill(9000)), 1, "one oversized fragment still mounts alone");
  assert.equal(initialRows(estimates, 10_000, 6, Array(8).fill(9000)), 7, "unless the anchor row needs more");
  assert.equal(initialRows(estimates, 0, -1), 1, "at least one row, so an opened pane is never empty");
  assert.equal(initialRows([], 250, -1), 0, "an empty trace has nothing to mount");
});

test("widening only grows, by the step, and stops at the end", () => {
  assert.equal(widenRows(3, 10, 3), 6);
  assert.equal(widenRows(9, 10, 3), 10);
  assert.equal(widenRows(10, 10, 3), 10);
  assert.equal(widenRows(12, 10, 3), 10, "a shrunken trace is clamped, never unmounted below what exists");
  assert.equal(widenRows(3, 10, 0), 4, "a zero step still makes progress");
  assert.equal(isCovered(10, 10), true);
  assert.equal(isCovered(9, 10), false);
  let mounted = initialRows(Array(40).fill(100), 2 * 900, -1);
  let steps = 0;
  while (!isCovered(mounted, 40)) {
    mounted = widenRows(mounted, 40, 3);
    steps += 1;
    assert.ok(steps < 100, "widening converges");
  }
  assert.ok(steps <= Math.ceil(40 / 3) + 1);
  assert.equal(INITIAL_VIEWPORTS, 1);
});

test("widening stays light while the collapse animation and its scroll lock run", () => {
  const settling = frameBudget(0);
  const steady = frameBudget(SETTLE_MS);
  assert.ok(settling.characters < steady.characters && settling.fragments < steady.fragments);
  assert.equal(steady.characters, WIDEN_CHARACTERS_PER_FRAME);
  assert.equal(steady.fragments, WIDEN_FRAGMENTS_PER_FRAME);
  assert.ok(SETTLE_MS >= 200, "at least the collapsible's animation");
});

test("a frame's widening is budgeted by characters, never by fragment count", () => {
  const sizes = [200, 200, 8000, 8000, 200, 200];
  assert.deepEqual(widenBudget(sizes, 0, 1000), { rows: 2, spent: 400 }, "small fragments fill the budget together");
  assert.deepEqual(widenBudget(sizes, 2, 1000), { rows: 3, spent: 8000 }, "an oversized fragment still mounts, alone");
  assert.deepEqual(widenBudget(sizes, 3, 24_000), { rows: 6, spent: 8400 }, "the rest fits in one frame");
  assert.deepEqual(widenBudget(sizes, 6, 24_000), { rows: 6, spent: 0 }, "nothing left");
  assert.ok(WIDEN_CHARACTERS_PER_FRAME >= 8_192, "at least one full fragment per frame");
  const tiny = Array(500).fill(10);
  assert.deepEqual(widenBudget(tiny, 0, 24_000), { rows: 64, spent: 640 }, "many tiny fragments are capped per frame too");
  assert.deepEqual(widenBudget(tiny, 0, 24_000, 8), { rows: 8, spent: 80 });
});

test("the reasoning-row flag is a containment flag with its own names", () => {
  assert.equal(SHIP_DEFAULT, "contain");
  assert.equal(REASONING_ROW_CONTAINMENT_ATTRIBUTE, "data-reasoning-row-containment");
  assert.equal(REASONING_ROW_CONTAINMENT.global, "__UNSLOTH_REASONING_ROW_CONTAINMENT__");
  assert.equal(ROW_ESTIMATE_PROPERTY, "--unsloth-row-estimate");
  assert.equal(ROW_SETTLED_ATTRIBUTE, "data-settled");
  assert.equal(REASONING_ROW_CONTAINMENT.resolve(undefined, ""), "contain");
  assert.equal(REASONING_ROW_CONTAINMENT.resolve(undefined, "typo"), "off");
  assert.equal(REASONING_ROW_CONTAINMENT.mode(undefined, "", false), "off", "gated on the engine");
  assert.equal(REASONING_ROW_CONTAINMENT.mode(true, "", false), "contain", "unless forced from the console");
});

test("the flag factory resolves, gates and watches independently per instance", () => {
  const a = defineContainmentFlag({ attribute: "data-a", global: "__A__" });
  const b = defineContainmentFlag({ attribute: "data-b", global: "__B__", shipDefault: "off" });
  assert.equal(a.resolve(undefined, ""), "contain");
  assert.equal(b.resolve(undefined, ""), "off");
  assert.equal(b.resolve("contain", ""), "contain");
  assert.equal(a.resolve(false, "contain"), "off");
  assert.equal(a.mode("contain", "", false), "contain");
  assert.equal(a.mode(undefined, "contain", false), "off");
  const scope: Record<string, unknown> = {};
  const applied: string[] = [];
  assert.equal(a.installWatcher(scope, () => { applied.push("a"); return "off"; }), true);
  assert.equal(b.installWatcher(scope, () => { applied.push("b"); return "off"; }), true);
  scope.__A__ = "off";
  scope.__B__ = true;
  assert.deepEqual(applied, ["a", "b"]);
  assert.equal(scope.__A__, "off");
  assert.equal(scope.__B__, true);
  assert.equal(a.installWatcher(Object.freeze({}) as Record<string, unknown>, () => "off"), false);
});

test("the controller and flag modules are plain TypeScript", () => {
  for (const file of [
    "components/assistant-ui/reasoning-mount-controller.ts",
    "components/assistant-ui/reasoning-row-containment-mode.ts",
    "components/assistant-ui/containment-flag.ts",
  ]) {
    const source = readSrc(file);
    assert.ok(!/<\/?[a-z]+[\s>]/i.test(source.replace(/^\s*[/*].*$/gm, "")), `${file}: no JSX`);
    assert.ok(!/\bfrom\s+["']react["']/.test(source), `${file}: no react import`);
    assert.ok(!source.includes("import.meta"), `${file}: no import.meta`);
  }
});
