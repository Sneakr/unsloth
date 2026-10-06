// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  type ContextTruncation,
  compactionBoundary,
  shouldShowCompactionNotice,
} from "../../features/chat/utils/context-truncation.ts";

type NoticeMessage = {
  readonly id: string;
  readonly role: string;
  readonly metadata?: unknown;
};

const owners = new WeakMap<object, ReadonlySet<string>>();

const truncationOf = (message: NoticeMessage): ContextTruncation | undefined =>
  (
    message.metadata as
      | { custom?: { contextTruncation?: unknown } }
      | undefined
  )?.custom?.contextTruncation as ContextTruncation | undefined;

export const computeCompactionNoticeOwners = (
  messages: readonly NoticeMessage[],
): ReadonlySet<string> => {
  const shown = new Set<string>();
  let previousDropped = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const value = truncationOf(message);
    const dropped = compactionBoundary(value);
    if (shouldShowCompactionNotice(value, previousDropped)) {
      shown.add(message.id);
      previousDropped = Math.max(previousDropped, dropped);
    }
  }
  return shown;
};

export const compactionNoticeOwners = (
  messages: readonly NoticeMessage[],
): ReadonlySet<string> => {
  const known = owners.get(messages);
  if (known !== undefined) return known;
  const computed = computeCompactionNoticeOwners(messages);
  owners.set(messages, computed);
  return computed;
};
