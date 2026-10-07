// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { ReasoningHighlightReply } from "./reasoning-highlight";

export type ReasoningLineTokens = Map<
  number,
  ReasoningHighlightReply["lines"][number]["tokens"]
>;

export const lineContent = (
  tokens: ReasoningHighlightReply["lines"][number]["tokens"],
): string => {
  let text = "";
  for (const token of tokens) text += token.content;
  return text;
};

export const mergeLineTokens = (
  previous: ReasoningLineTokens,
  lines: ReasoningHighlightReply["lines"],
): ReasoningLineTokens => {
  const next: ReasoningLineTokens = new Map();
  let changed = false;
  for (const { line, tokens } of lines) {
    const known = previous.get(line);
    const kept =
      known !== undefined && lineContent(known) === lineContent(tokens)
        ? known
        : tokens;
    if (kept !== known) changed = true;
    next.set(line, kept);
  }
  return !changed && next.size === previous.size ? previous : next;
};
