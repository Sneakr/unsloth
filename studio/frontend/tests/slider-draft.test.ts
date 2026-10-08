// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import assert from "node:assert/strict";
import test from "node:test";

import { readSrc } from "./helpers/kit.ts";
import { loadWithStubs } from "./helpers/module-stubs.ts";

type Draft = {
  draft: number | null;
  sliderProps: {
    value: number[];
    onPointerDown: () => void;
    onValueChange: (value: number[]) => void;
    onValueCommit: (value: number[]) => void;
    onLostPointerCapture: () => void;
  };
};

function mountDraft(value: number, onDraft?: (value: number | null) => void) {
  const slots: unknown[] = [];
  const synced: unknown[] = [];
  let cursor = 0;
  let flushing = false;
  const react = {
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = initial;
      return [
        slots[at],
        (next: unknown) => {
          slots[at] = next;
          if (flushing) synced.push(next);
        },
      ];
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
  };
  const { useSliderDraft } = loadWithStubs<{
    useSliderDraft: (
      value: number,
      onCommit: (value: number) => void,
      onDraft?: (value: number | null) => void,
    ) => Draft;
  }>(new URL("../src/hooks/use-slider-draft.ts", import.meta.url), {
    react,
    "react-dom": {
      flushSync: (update: () => void) => {
        flushing = true;
        update();
        flushing = false;
      },
    },
  });
  const commits: number[] = [];
  const SliderRow = () => {
    cursor = 0;
    return useSliderDraft(value, (next) => commits.push(next), onDraft);
  };
  return { render: SliderRow, commits, synced };
}

test("a drag moves the thumb locally and hands its owner one settled value", () => {
  const { render, commits } = mountDraft(0.5);
  render().sliderProps.onPointerDown();
  render().sliderProps.onValueChange([0.6]);
  render().sliderProps.onValueChange([0.7]);
  const dragging = render();
  assert.equal(dragging.draft, 0.7);
  assert.deepEqual(dragging.sliderProps.value, [0.7]);
  assert.deepEqual(commits, [], "the owner re-renders once per drag, not once per pointer move");

  dragging.sliderProps.onValueCommit([0.7]);
  dragging.sliderProps.onLostPointerCapture();
  assert.deepEqual(commits, [0.7], "Radix's own commit at release is not a second one");
  assert.equal(render().draft, null);
});

test("a release right behind the last move commits that move", () => {
  const { render, commits } = mountDraft(0.5);
  render().sliderProps.onPointerDown();
  const row = render();
  row.sliderProps.onValueChange([0.6]);
  row.sliderProps.onValueChange([0.9]);
  row.sliderProps.onValueCommit([0.6]);
  row.sliderProps.onLostPointerCapture();
  assert.deepEqual(commits, [0.9], "Radix commits the value its last render saw, a move behind the pointer");
});

test("each move is drawn in the frame it arrives in", () => {
  const { render, synced } = mountDraft(0.5);
  render().sliderProps.onPointerDown();
  render().sliderProps.onValueChange([0.6]);
  render().sliderProps.onValueChange([0.9]);
  assert.deepEqual(synced, [0.6, 0.9], "a plain state update waits for a later task and trails the pointer by a frame");
});

test("a drag that ends where it started commits nothing and leaves no draft", () => {
  const { render, commits } = mountDraft(0.5);
  render().sliderProps.onPointerDown();
  render().sliderProps.onValueChange([0.6]);
  render().sliderProps.onValueChange([0.5]);
  render().sliderProps.onLostPointerCapture();
  assert.equal(render().draft, null);
  assert.deepEqual(commits, []);
});

test("a drag cut short keeps the value it reached, as a native range input does", () => {
  const { render, commits } = mountDraft(0.5);
  render().sliderProps.onPointerDown();
  render().sliderProps.onValueChange([0.8]);
  render().sliderProps.onLostPointerCapture();
  assert.deepEqual(commits, [0.8], "a pointercancel or a stolen capture threw the drag away");
  assert.equal(render().draft, null);
});

test("an owner can follow the drag and hears when it ends", () => {
  const previews: (number | null)[] = [];
  const { render } = mountDraft(10, (next) => previews.push(next));
  render().sliderProps.onPointerDown();
  render().sliderProps.onValueChange([12]);
  render().sliderProps.onValueChange([14]);
  render().sliderProps.onLostPointerCapture();
  assert.deepEqual(previews, [12, 14, null]);
});

test("keyboard steps go straight to the owner", () => {
  const { render, commits } = mountDraft(4);
  render().sliderProps.onValueChange([5]);
  render().sliderProps.onValueCommit([5]);
  assert.equal(render().draft, null);
  assert.deepEqual(commits, [5]);
});

test("the Run settings and model picker sliders drag on a draft", () => {
  for (const [file, rows] of [
    ["features/chat/chat-settings-sheet.tsx", 1],
    ["features/model-picker/components/model-config-page.tsx", 3],
  ] as const) {
    const source = readSrc(file);
    assert.equal(source.match(/= useSliderDraft\(/g)?.length, rows, file);
    assert.doesNotMatch(source, /onValueChange=\{\(\[\w+\]\) => (?:onChange|setContextSliderValue)\(/, file);
  }
});

test("what an owner shows beside its slider follows the drag", () => {
  const picker = readSrc("features/model-picker/components/model-config-page.tsx");
  assert.match(picker, /onDraft=\{setDraftPercent\}/);
  assert.match(picker, /\{shownPercent !== defaultPercent && \(/, "the VRAM advice contradicted the dragged percent");
  assert.match(picker, /displayValue=\{isMlx && windowUnknown && !dragging \? "—" : undefined\}/, "an unknown MLX window showed a dash for the whole drag");
  assert.match(picker, /\{renderWarning\(shown\)\}/);
  const music = readSrc("features/audio/components/music-edit-inputs.tsx");
  assert.match(music, /onDraft=\{setDraggedExtendS\}/);
  assert.match(music, /tailS=\{action === "extend" \? \(draggedExtendS \?\? draft\.extendS\) : 0\}/, "the extend tail stopped growing while Add seconds was dragged");
});
