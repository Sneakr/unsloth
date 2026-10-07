// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc, readText } from "./helpers/kit.ts";

test("the chat split never installs the library's universal cursor rule", () => {
  const page = readSrc("features/chat/chat-page.tsx");
  assert.match(page, /<ResizablePanelGroup[\s\S]*?\bdisableCursor\b[\s\S]*?<ResizablePanel\b/);
  const css = readSrc("index.css");
  assert.match(css, /:root\[data-chat-split-resizing\] \*,\s*:root\[data-chat-split-resizing\] \*:hover \{\s*cursor: col-resize !important;/, "the whole-document cursor rule exists only for the duration of a drag");
  assert.ok(page.includes('document.documentElement.setAttribute("data-chat-split-resizing", "")'));
  assert.ok(page.includes('document.documentElement.removeAttribute("data-chat-split-resizing")'));
  assert.match(page, /window\.addEventListener\("blur", release\);\s*window\.addEventListener\("pointermove", released\);/, "a drag whose release never reaches the page, because the window lost the pointer, still clears the cursor rule");
  assert.match(page, /const released = \(move: PointerEvent\) => \{\s*if \(move\.buttons === 0\) release\(\);\s*\};/, "the same buttons === 0 check react-resizable-panels uses to end its own drag");
});

test("the handle is out of the hit test exactly while it is 0 px wide", () => {
  const page = readSrc("features/chat/chat-page.tsx");
  const open = page.indexOf("<ResizableHandle");
  const handle = page.slice(open, page.indexOf("/>", open));
  assert.match(handle, /disabled=\{!artifactLayoutActive \|\| browserFullView\}/);
  assert.match(handle, /\(!artifactLayoutActive \|\| browserFullView\) &&\s*"pointer-events-none -ml-0 -mr-0 w-0"/, "the width collapse and the hit test read the same condition");
  assert.equal((handle.match(/artifactLayoutActive/g) ?? []).length, 2);
});

test("react-resizable-panels still exposes the props the fix rests on", () => {
  const dts = readText("../node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts");
  assert.match(dts, /disableCursor\?: boolean \| undefined;/);
  assert.match(dts, /disableDoubleClick\?: boolean/);
  assert.match(dts, /export declare type SeparatorProps[\s\S]*?disabled\?: boolean \| undefined;/);
});
