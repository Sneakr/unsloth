// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { ReasoningFragment } from "./reasoning-transcript-index.ts";

export type FragmentGeometry = {
  width: number;
  lineHeight: number;
  fontPixels: number;
};

export const INITIAL_VIEWPORTS = 1;
export const INITIAL_CHARACTERS = 4_096;
export const WIDEN_CHARACTERS_PER_FRAME = 24_000;
export const WIDEN_FRAGMENTS_PER_FRAME = 64;
export const SETTLE_MS = 300;
export const SETTLING_DIVISOR = 4;

export const frameBudget = (
  sinceMountMs: number,
): { characters: number; fragments: number } =>
  sinceMountMs < SETTLE_MS
    ? {
        characters: Math.ceil(WIDEN_CHARACTERS_PER_FRAME / SETTLING_DIVISOR),
        fragments: Math.ceil(WIDEN_FRAGMENTS_PER_FRAME / SETTLING_DIVISOR),
      }
    : {
        characters: WIDEN_CHARACTERS_PER_FRAME,
        fragments: WIDEN_FRAGMENTS_PER_FRAME,
      };

export const estimateFragmentHeight = (
  fragment: Pick<ReasoningFragment, "text" | "code" | "first" | "last" | "hidden">,
  geometry: FragmentGeometry,
): number => {
  if (fragment.hidden) return 0;
  const code = fragment.code;
  const columns = Math.max(
    12,
    Math.floor(
      (geometry.width - (code ? 32 : 0)) /
        (geometry.fontPixels * (code ? 0.58 : 0.48)),
    ),
  );
  const lines = fragment.text
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)),
      0,
    );
  return code
    ? lines * geometry.lineHeight +
        (fragment.first ? 40 : 0) +
        (fragment.last ? 16 : 0)
    : Math.max(1, lines - 2) * geometry.lineHeight +
        (fragment.first ? 16 : 0);
};

export const initialRows = (
  estimates: readonly number[],
  budgetPx: number,
  mustInclude: number,
  sizes?: readonly number[],
  budgetChars: number = INITIAL_CHARACTERS,
): number => {
  if (estimates.length === 0) return 0;
  let rows = Math.min(estimates.length, Math.max(0, mustInclude));
  let covered = 0;
  let spent = 0;
  while (
    rows < estimates.length
    && (rows <= mustInclude || (covered < budgetPx && spent < budgetChars))
  ) {
    covered += estimates[rows];
    spent += sizes?.[rows] ?? 0;
    rows += 1;
  }
  return Math.max(1, rows);
};

export const widenRows = (
  mounted: number,
  total: number,
  step: number,
): number => (mounted >= total ? total : Math.min(total, mounted + Math.max(1, step)));

export const widenBudget = (
  sizes: readonly number[],
  mounted: number,
  budget: number,
  maxRows: number = WIDEN_FRAGMENTS_PER_FRAME,
): { rows: number; spent: number } => {
  let rows = mounted;
  let spent = 0;
  while (
    rows < sizes.length
    && (spent === 0 || (spent + sizes[rows] <= budget && rows - mounted < maxRows))
  ) {
    spent += sizes[rows];
    rows += 1;
  }
  return { rows, spent };
};

export const isCovered = (mounted: number, total: number): boolean =>
  mounted >= total;
