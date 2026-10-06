// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

type Part = { readonly type: string; readonly text?: string };

type Derived = {
  readonly textKey: string;
  readonly textBlob: string;
  readonly texts: readonly string[];
};

const PART_SEPARATOR = "\u0000";

const derived = new WeakMap<object, Derived>();

const textsOf = (parts: readonly Part[]): string[] => {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type !== "text") continue;
    const text = part.text;
    if (typeof text === "string") texts.push(text);
  }
  return texts;
};

export const derivedForParts = (parts: readonly Part[]): Derived => {
  const known = derived.get(parts);
  if (known !== undefined) return known;
  let texts: readonly string[] | undefined;
  let textKey: string | undefined;
  let textBlob: string | undefined;
  const entry: Derived = {
    get texts() {
      texts ??= textsOf(parts);
      return texts;
    },
    get textKey() {
      textKey ??= JSON.stringify(this.texts);
      return textKey;
    },
    get textBlob() {
      textBlob ??= this.texts.join(PART_SEPARATOR);
      return textBlob;
    },
  };
  derived.set(parts, entry);
  return entry;
};

const memoByArrayAndKey = new WeakMap<object, Map<unknown, unknown>>();

export const memoOnArray = <K, V>(
  array: readonly unknown[],
  key: K,
  compute: () => V,
): V => {
  let byKey = memoByArrayAndKey.get(array);
  if (byKey === undefined) {
    byKey = new Map();
    memoByArrayAndKey.set(array, byKey);
  }
  if (byKey.has(key)) return byKey.get(key) as V;
  const value = compute();
  byKey.set(key, value);
  return value;
};
