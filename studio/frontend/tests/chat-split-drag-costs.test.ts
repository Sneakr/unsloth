// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc } from "./helpers/kit.ts";

test("the panel library's pointer-events toggle during a split drag stops at each panel's wrapper", () => {
  assert.match(
    readSrc("features/chat/chat-page.tsx"),
    /data-expanded=\{chatDock === "expanded" \? "true" : "false"\}\s*className=\{cn\(\s*"pointer-events-auto flex h-full min-h-0 min-w-0 flex-col overflow-hidden",/,
    "react-resizable-panels sets pointer-events: none on both panels for the whole drag; inherited, it restyled the entire thread on press and again on release",
  );
  const css = readSrc("index.css");
  assert.match(css, /\.chat-artifact-pop-surface \{\s*pointer-events: none;/);
  assert.match(
    css,
    /\.chat-artifact-pop-surface\[data-artifact-surface-visible="true"\] \{\s*pointer-events: auto;/,
    "the browser side's wrapper already sets its own",
  );
});

test("thinking boxes wait for a panel drag to end before re-measuring their rows", () => {
  assert.match(
    readSrc("components/assistant-ui/reasoning-transcript.tsx"),
    /const resettleLater = \(\) => \{\s*settleTimer = 0;\s*if \(panelDragInProgress\(\)\) \{\s*settleTimer = window\.setTimeout\(resettleLater, RESETTLE_DELAY_MS\);\s*return;\s*\}\s*resettleRows\(element\);/,
    "a drag that paused for 150 ms, or met a panel's limit, re-laid every row of every open thinking box in the middle of the drag",
  );
});
