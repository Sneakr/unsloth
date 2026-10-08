// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc } from "./helpers/kit.ts";

test("a desktop zoom shows skipped content until WebKit has measured it at the new zoom", () => {
  const store = readSrc("features/settings/stores/interface-scale-store.ts");
  assert.match(store, /holdContainmentAcrossZoom\(\);\s*try \{\s*await getCurrentWebview\(\)\.setZoom\(zoom\);\s*\} finally \{\s*releaseContainmentAfterZoom\(\);\s*\}/);
  assert.match(store, /const holdsContainmentAcrossZoom = !\(\s*typeof navigator !== "undefined" && navigator\.userAgent\.includes\("Windows"\)\s*\);/, "WebView2 rescales remembered sizes itself");
  assert.match(store, /const ZOOMING_RELEASE_MS = 300;/);
  const css = readSrc("index.css");
  assert.match(css, /html\[data-interface-zooming\] \.aui-thread-root \[data-slot="reasoning-transcript"\] > \[data-reasoning-chunk\],\s*html\[data-interface-zooming\] \.aui-thread-root \[data-streamdown="code-block-body"\]\[data-unsloth-fence-windowed\],\s*html\[data-interface-zooming\] \.aui-thread-root \.aui-math-block,\s*html\[data-interface-zooming\] \.aui-thread-root \.aui-math-display \{\s*content-visibility: visible !important;\s*\}/, "WebKit keeps contain-intrinsic-size: auto sizes in the old zoom's units, maths blocks included");
  assert.match(store, /interfaceScaleApplicationQueue = Promise\.resolve\(\);\s*releaseContainmentAfterZoom\(\);\s*resolve\(\);/, "a setZoom that never settles must not leave every skipped block rendered");
});

test("the Windows thread gutter follows the native thin bar, which page zoom does not scale", () => {
  const runtime = readSrc("features/settings/lib/interface-scale-runtime.ts");
  assert.match(runtime, /appliedInterfaceZoom = zoom;\s*document\.documentElement\.style\.setProperty\("--studio-interface-zoom", String\(zoom\)\);/);
  assert.match(readSrc("index.css"), /:root\.client-windows \{\s*--thread-scrollbar-gutter: calc\(10px \/ var\(--studio-interface-zoom, 1\)\);\s*\}/);
});
