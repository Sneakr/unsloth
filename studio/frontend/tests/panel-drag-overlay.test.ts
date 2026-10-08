// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc, registerBundlerResolver } from "./helpers/kit.ts";

type FakeElement = {
  attributes: Map<string, string>;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  remove(): void;
};

const htmlAttributes = new Map<string, string>();
const body: FakeElement[] = [];

function element(): FakeElement {
  const self: FakeElement = {
    attributes: new Map(),
    style: {},
    setAttribute: (name, value) => self.attributes.set(name, value),
    remove: () => {
      const at = body.indexOf(self);
      if (at >= 0) body.splice(at, 1);
    },
  };
  return self;
}

Object.assign(globalThis, {
  document: {
    documentElement: {
      setAttribute: (name: string, value: string) => htmlAttributes.set(name, value),
      removeAttribute: (name: string) => htmlAttributes.delete(name),
    },
    createElement: () => element(),
    body: { appendChild: (child: FakeElement) => body.push(child) },
    querySelector: (selector: string) =>
      body.find(
        (child) =>
          `[data-slot="${child.attributes.get("data-slot")}"]` === selector,
      ) ?? null,
  },
});

registerBundlerResolver();
const { acquireDragOverlay, releaseDragOverlay, panelDragInProgress } =
  await import("../src/components/ui/panel-drag-overlay.ts");

test("a held drag overlay marks the drag in progress until its last owner lets go", () => {
  assert.equal(panelDragInProgress(), false);
  acquireDragOverlay();
  assert.equal(panelDragInProgress(), true);
  assert.equal(htmlAttributes.get("data-panel-resizing"), "true");
  assert.equal(body.length, 1);
  assert.equal(body[0].style.pointerEvents, "auto");

  acquireDragOverlay();
  assert.equal(body.length, 1, "nested owners share one overlay");
  releaseDragOverlay();
  assert.equal(panelDragInProgress(), true);
  assert.equal(body.length, 1);

  releaseDragOverlay();
  assert.equal(panelDragInProgress(), false);
  assert.equal(body.length, 0);
  assert.equal(htmlAttributes.has("data-panel-resizing"), false);

  releaseDragOverlay();
  assert.equal(panelDragInProgress(), false, "an unmatched release is a no-op");
});

test("a native browser page yields to its snapshot while any panel is dragged", () => {
  acquireDragOverlay();
  const slot = body[0].attributes.get("data-slot") ?? "";
  releaseDragOverlay();
  assert.ok(slot.endsWith("-overlay"));
  assert.match(
    readSrc("features/browser/native-view.ts"),
    /const OVERLAY_SELECTOR =\s*'[^']*\[data-slot\$="-overlay"\]/,
    "the overlay counts as covering the page, so the page shows a snapshot the DOM clips instead of a native view that cannot follow the drag",
  );
  for (const [file, pattern] of [
    ["components/ui/panel-resize-handle.tsx", /acquireDragOverlay\(\)/],
    ["features/chat/chat-page.tsx", /acquireDragOverlay\(\);/],
  ] as const) {
    assert.match(readSrc(file), pattern, file);
  }
});
