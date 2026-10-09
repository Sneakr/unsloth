// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function useSliderDraft(
  value: number,
  onCommit: (value: number) => void,
  onDraft?: (value: number | null) => void,
) {
  const [draft, setDraft] = useState<number | null>(null);
  const pointers = useRef(new Set<number>());
  const dragged = useRef<number | null>(null);
  const show = (next: number | null) => {
    setDraft(next);
    onDraft?.(next);
  };
  const end = () => {
    const next = dragged.current;
    pointers.current.clear();
    dragged.current = null;
    show(null);
    if (next !== null && next !== value) onCommit(next);
  };
  const endOnUnmount = useEffectEvent(() => {
    if (pointers.current.size > 0) end();
  });
  useLayoutEffect(() => () => endOnUnmount(), []);
  return {
    draft,
    sliderProps: {
      value: [draft ?? value],
      onPointerDown: ({ pointerId }: { pointerId: number }) => {
        pointers.current.add(pointerId);
      },
      onValueChange: ([next]: number[]) => {
        if (pointers.current.size === 0) return;
        dragged.current = next;
        flushSync(() => show(next));
      },
      onValueCommit: ([next]: number[]) => {
        if (pointers.current.size === 0) onCommit(next);
      },
      onLostPointerCapture: ({ pointerId }: { pointerId: number }) => {
        pointers.current.delete(pointerId);
        if (pointers.current.size === 0) end();
      },
    },
  };
}
