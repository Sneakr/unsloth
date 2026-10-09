// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function useSliderDraft(
  value: number,
  onCommit: (value: number) => void,
  onDraft?: (value: number | null) => void,
) {
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  const dragged = useRef<number | null>(null);
  const show = (next: number | null) => {
    setDraft(next);
    onDraft?.(next);
  };
  const end = () => {
    const next = dragged.current;
    dragging.current = false;
    dragged.current = null;
    show(null);
    if (next !== null && next !== value) onCommit(next);
  };
  const endOnUnmount = useEffectEvent(() => {
    if (dragging.current) end();
  });
  useEffect(() => () => endOnUnmount(), []);
  return {
    draft,
    sliderProps: {
      value: [draft ?? value],
      onPointerDown: () => {
        dragging.current = true;
      },
      onValueChange: ([next]: number[]) => {
        if (!dragging.current) return;
        dragged.current = next;
        flushSync(() => show(next));
      },
      onValueCommit: ([next]: number[]) => {
        if (!dragging.current) onCommit(next);
      },
      onLostPointerCapture: end,
    },
  };
}
