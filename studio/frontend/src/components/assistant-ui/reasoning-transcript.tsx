// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  type CSSProperties,
  Fragment as InlineFragment,
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CodeBlockActions,
  MarkdownTextSource,
  SearchImagesEnabledContext,
} from "./markdown-text";
import { FenceLine } from "./code-fence-defer";
import {
  useReasoningHighlight,
  type ReasoningLineTokens,
} from "./use-reasoning-highlight";
import {
  ReasoningTranscriptIndex,
  resolveReasoningAnchor,
  type ReasoningReadingAnchor,
  type ReasoningFragment,
} from "./reasoning-transcript-index";
import {
  captureReasoningAnchor,
  reasoningTextRange,
} from "./reasoning-reading-anchor";
import {
  useAdjustForContentInsertedAbove,
  useDetachThreadFromBottom,
} from "./use-intent-aware-autoscroll";
import {
  estimateFragmentHeight,
  type FragmentGeometry,
  frameBudget,
  INITIAL_VIEWPORTS,
  initialRows,
  isCovered,
  WIDEN_CHARACTERS_PER_FRAME,
  widenBudget,
} from "./reasoning-mount-controller";
import {
  ROW_ESTIMATE_PROPERTY,
  ROW_SETTLED_ATTRIBUTE,
} from "./reasoning-row-containment-mode";
import { cn } from "@/lib/utils";

type Props = {
  initialAnchor?: ReasoningReadingAnchor;
  documents: readonly string[];
  messageId: string;
  messageHasRenderableRenderHtmlTool: boolean;
  streaming: boolean;
};

const settling = new Set<HTMLElement>();
let settleFrame = 0;

const settleRows = (): void => {
  settleFrame = 0;
  for (const row of settling) {
    if (row.isConnected) row.setAttribute(ROW_SETTLED_ATTRIBUTE, "");
  }
  settling.clear();
};

const scheduleSettle = (row: HTMLElement): void => {
  settling.add(row);
  if (settleFrame !== 0) return;
  settleFrame = requestAnimationFrame(() => {
    settleFrame = requestAnimationFrame(settleRows);
  });
};

const forgetSettle = (row: HTMLElement): void => {
  settling.delete(row);
};

const resettleRows = (root: HTMLElement): void => {
  for (const row of root.querySelectorAll<HTMLElement>(
    `[${ROW_SETTLED_ATTRIBUTE}]`,
  )) {
    row.removeAttribute(ROW_SETTLED_ATTRIBUTE);
    scheduleSettle(row);
  }
};

const wideners = new Set<(budget: number) => number>();
let widenFrame = 0;

const widenAll = (): void => {
  widenFrame = 0;
  let budget = WIDEN_CHARACTERS_PER_FRAME;
  for (const widen of [...wideners]) {
    if (budget <= 0) break;
    const share = Math.ceil(budget / wideners.size);
    const spent = widen(share);
    if (spent === 0) wideners.delete(widen);
    else budget -= spent;
  }
  if (wideners.size > 0) widenFrame = requestAnimationFrame(widenAll);
};

const requestWiden = (widen: (budget: number) => number): void => {
  wideners.add(widen);
  if (widenFrame === 0) widenFrame = requestAnimationFrame(widenAll);
};

const cancelWiden = (widen: (budget: number) => number): void => {
  wideners.delete(widen);
};

function useSettledRow(
  row: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const element = row.current;
    if (!element || !active) return;
    scheduleSettle(element);
    return () => {
      forgetSettle(element);
    };
  }, [row, active]);
}

const CodeFragment = memo(
  function CodeFragment({
    fragment,
    result,
  }: { fragment: ReasoningFragment; result: ReasoningLineTokens }) {
    const code = fragment.code!;
    return (
      <>
        {code.lines.map(({ line, column, text }) => {
          const tokens = result.get(line);
          // A delayed grammar must never display the previous, shorter source.
          if (
            !tokens ||
            tokens
              .map((token) => token.content)
              .join("")
              .slice(column, column + text.length) !== text
          ) {
            return (
              <InlineFragment key={`${line}:${column}`}>
                {column === 0 && line > 0 ? "\n" : ""}
                {text}
              </InlineFragment>
            );
          }
          let offset = 0;
          const clipped = tokens.flatMap((token) => {
            const start = offset;
            offset += token.content.length;
            const content = token.content.slice(
              Math.max(0, column - start),
              Math.max(
                0,
                Math.min(token.content.length, column + text.length - start),
              ),
            );
            return content ? [{ ...token, content }] : [];
          });
          return (
            <InlineFragment key={`${line}:${column}`}>
              {column === 0 && line > 0 ? "\n" : ""}
              <FenceLine line={clipped} windowed inline />
            </InlineFragment>
          );
        })}
      </>
    );
  },
  (previous, next) => {
    // Appending later lines cannot change this fragment's grammar or text. Keep its
    // highlighted subtree and selection alive instead of repainting it for every token.
    const a = previous.fragment;
    const b = next.fragment;
    return (
      a.key === b.key &&
      a.text === b.text &&
      a.first === b.first &&
      a.last === b.last &&
      a.code?.language === b.code?.language &&
      previous.result.get(a.code!.lines[0].line) ===
        next.result.get(b.code!.lines[0].line)
    );
  },
);

function Row({
  index,
  fragment,
  estimate,
  children,
}: {
  index: number;
  fragment: ReasoningFragment;
  estimate: number;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  useSettledRow(row, !fragment.hidden);
  if (fragment.hidden) return null;
  return (
    <div
      ref={row}
      data-index={index}
      data-reasoning-fragment={fragment.key}
      data-reasoning-row=""
      className="min-w-0"
      style={{ [ROW_ESTIMATE_PROPERTY]: `${estimate}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}

function CodeGroup({
  indices,
  fragments,
  estimate,
  streaming,
}: {
  indices: number[];
  fragments: readonly ReasoningFragment[];
  estimate: number;
  streaming: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useSettledRow(surface, true);
  const [reached, setReached] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const code = fragments[indices[0]].code!;
  useEffect(() => {
    const element = surface.current;
    if (!element || reached || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setReached(true);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reached]);
  const lines = useMemo(() => {
    if (!reached) return [];
    const all: number[] = [];
    for (const index of indices) {
      for (const line of fragments[index].code!.lines) all.push(line.line);
    }
    return all;
  }, [reached, indices, fragments]);
  const result = useReasoningHighlight(code.source, code.language, lines);
  const first = fragments[indices[0]];
  const last = fragments[indices[indices.length - 1]];
  return (
    <div
      ref={surface}
      data-slot="reasoning-code-fragment"
      data-language={code.language ?? undefined}
      data-reasoning-row=""
      className={cn(
        "aui-reasoning-code-fragment min-w-0",
        first.first && "aui-reasoning-code-first",
        last.last && "aui-reasoning-code-last",
      )}
      style={{ [ROW_ESTIMATE_PROPERTY]: `${estimate}px` } as CSSProperties}
    >
      {first.first && (
        <CodeBlockActions
          disabled={streaming && code.incomplete}
          language={code.language}
          source={code.source}
        />
      )}
      {first.first && (
        <div className="mb-2 min-h-4 pr-20 text-xs text-muted-foreground">
          {code.language}
        </div>
      )}
      <pre className="!m-0 min-h-[1lh] whitespace-pre-wrap [overflow-wrap:anywhere] font-mono">
        <code>
          {indices.map((index) => (
            <span
              key={fragments[index].key}
              data-index={index}
              data-reasoning-fragment={fragments[index].key}
              data-reasoning-code-row=""
            >
              <CodeFragment fragment={fragments[index]} result={result} />
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

const Fragment = memo(function Fragment({
  fragment,
  messageId,
  messageHasRenderableRenderHtmlTool,
  streaming,
}: Omit<Props, "documents"> & { fragment: ReasoningFragment }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Continuation containers preserve indentation/numbering but must not paint
    // another bullet for the same item. Later, real siblings retain their markers.
    const items: HTMLElement[] = [];
    let container: Element | null | undefined = root.current?.firstElementChild;
    for (
      let depth = 0;
      depth < (fragment.listContinuationDepth ?? 0);
      depth += 1
    ) {
      while (
        container?.firstElementChild &&
        ["DIV", "BLOCKQUOTE"].includes(container.firstElementChild.tagName)
      )
        container = container.firstElementChild;
      const item: HTMLElement | null | undefined = container?.querySelector(
        ":scope > :is(ol, ul):first-child > li:first-child",
      );
      if (!item) break;
      item.dataset.reasoningListContinuation = "";
      items.push(item);
      container = item;
    }
    return () => {
      for (const item of items) delete item.dataset.reasoningListContinuation;
    };
  }, [fragment]);
  if (fragment.hidden) return null;
  return (
    <div
      ref={root}
      data-table-continuation={fragment.tableContinuation || undefined}
      className={cn("aui-reasoning-prose-fragment", fragment.first && "pt-4")}
    >
      <MarkdownTextSource
        messageId={messageId}
        messageHasRenderableRenderHtmlTool={messageHasRenderableRenderHtmlTool}
        sourceText={fragment.renderText ?? fragment.text}
        streaming={streaming}
      />
    </div>
  );
});

const DEFAULT_GEOMETRY: FragmentGeometry = {
  width: 640,
  lineHeight: 24,
  fontPixels: 15,
};

export function ReasoningTranscript({
  initialAnchor,
  documents,
  messageId,
  messageHasRenderableRenderHtmlTool,
  streaming,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [index] = useState(() => new ReasoningTranscriptIndex());
  const fragments = useMemo(() => index.update(documents), [documents, index]);
  const fragmentsRef = useRef(fragments);
  const [geometry, setGeometry] = useState(DEFAULT_GEOMETRY);
  const estimates = useMemo(
    () => fragments.map((fragment) => estimateFragmentHeight(fragment, geometry)),
    [fragments, geometry],
  );
  const [restore, setRestore] = useState(() => {
    const anchor =
      initialAnchor && resolveReasoningAnchor(fragments, initialAnchor);
    return anchor && anchor.index >= 0 ? anchor : null;
  });
  const [limit, setLimit] = useState(() => {
    const rows = initialRows(
      estimates,
      INITIAL_VIEWPORTS * (typeof window === "undefined" ? 900 : window.innerHeight),
      restore?.index ?? -1,
      fragments.map((fragment) => fragment.text.length),
    );
    return isCovered(rows, fragments.length) ? Number.POSITIVE_INFINITY : rows;
  });
  const limitRef = useRef(limit);
  const streamingRef = useRef(streaming);
  const mountedAt = useRef(0);
  useLayoutEffect(() => {
    mountedAt.current = performance.now();
  }, []);
  useLayoutEffect(() => {
    fragmentsRef.current = fragments;
    streamingRef.current = streaming;
    if (limit > limitRef.current) limitRef.current = limit;
  });
  const adjustAbove = useAdjustForContentInsertedAbove();
  const detach = useDetachThreadFromBottom();
  const covered = isCovered(limit, fragments.length);

  useEffect(() => {
    if (covered) return;
    const widen = (budget: number): number => {
      const all = fragmentsRef.current;
      const current = limitRef.current;
      if (isCovered(current, all.length)) return 0;
      const allowed = frameBudget(performance.now() - mountedAt.current);
      const { rows, spent } = widenBudget(
        all.map((fragment) => fragment.text.length),
        current,
        Math.min(budget, allowed.characters),
        allowed.fragments,
      );
      limitRef.current = isCovered(rows, all.length)
        ? Number.POSITIVE_INFINITY
        : rows;
      const value = limitRef.current;
      if (streamingRef.current) setLimit(value);
      else startTransition(() => setLimit(value));
      return spent;
    };
    requestWiden(widen);
    return () => cancelWiden(widen);
  }, [covered]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const width = element.getBoundingClientRect().width;
    if (!width) return;
    const next = {
      width,
      lineHeight: Number.parseFloat(style.lineHeight) || DEFAULT_GEOMETRY.lineHeight,
      fontPixels: Number.parseFloat(style.fontSize) || DEFAULT_GEOMETRY.fontPixels,
    };
    setGeometry((old) =>
      old.width === next.width &&
      old.lineHeight === next.lineHeight &&
      old.fontPixels === next.fontPixels
        ? old
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const pending = restore;
    const element = root.current;
    if (!pending || !element) return;
    const row = element.querySelector(`[data-index="${pending.index}"]`);
    if (!row) return;
    setRestore(null);
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const passage = reasoningTextRange(row, pending.text, pending.occurrence);
      if (passage)
        adjustAbove(passage.getBoundingClientRect().top - pending.top);
    });
  }, [restore, limit, adjustAbove]);

  useLayoutEffect(() => {
    const element = root.current;
    const scroll = element?.closest<HTMLElement>(".aui-thread-viewport");
    if (!element || !scroll) return;
    let width = element.getBoundingClientRect().width;
    let frame = 0;
    let reading: (ReasoningReadingAnchor & { key: string }) | undefined;
    const visibleAnchor = ():
      | (ReasoningReadingAnchor & { key: string })
      | undefined => {
      const rows = element.querySelectorAll<HTMLElement>(
        "[data-reasoning-fragment]",
      );
      const bounds = scroll.getBoundingClientRect();
      let low = 0;
      let high = rows.length - 1;
      let first = rows.length;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (rows[middle].getBoundingClientRect().bottom > bounds.top) {
          first = middle;
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }
      for (let i = first; i < rows.length; i += 1) {
        const row = rows[i];
        if (row.getBoundingClientRect().top >= bounds.bottom) break;
        const key = row.dataset.reasoningFragment;
        const captured = captureReasoningAnchor(row, scroll);
        if (captured && key !== undefined) return { ...captured, key };
      }
      return undefined;
    };
    const capture = () => {
      frame = 0;
      if (element.getBoundingClientRect().width !== width) return;
      reading = visibleAnchor();
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(capture);
    };
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (!next || next === width) return;
      width = next;
      resettleRows(element);
      const anchor = reading;
      if (!anchor) return;
      const row = element.querySelector(
        `[data-reasoning-fragment="${CSS.escape(anchor.key)}"]`,
      );
      const passage =
        row && reasoningTextRange(row, anchor.text, anchor.occurrence);
      if (passage)
        adjustAbove(passage.getBoundingClientRect().top - anchor.top);
    });
    observer.observe(element);
    scroll.addEventListener("scroll", schedule, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [adjustAbove]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const protect = () => {
      const active = document.activeElement;
      let touches = Boolean(active && element.contains(active));
      const selection = window.getSelection();
      if (!touches && selection && !selection.isCollapsed) {
        for (let i = 0; i < selection.rangeCount && !touches; i += 1)
          touches = selection.getRangeAt(i).intersectsNode(element);
      }
      if (touches) detach();
    };
    document.addEventListener("selectionchange", protect);
    element.addEventListener("focusin", protect);
    return () => {
      document.removeEventListener("selectionchange", protect);
      element.removeEventListener("focusin", protect);
    };
  }, [detach]);

  const shown = covered ? fragments.length : limit;
  let reserved = 0;
  for (let i = shown; i < estimates.length; i += 1) reserved += estimates[i];
  const groups: { key: string; code: boolean; indices: number[] }[] = [];
  for (let i = 0; i < shown; i += 1) {
    const fragment = fragments[i];
    const key = fragment.code
      ? `${fragment.document}:${fragment.start}`
      : fragment.key;
    const previous = groups[groups.length - 1];
    if (previous?.key === key) previous.indices.push(i);
    else groups.push({ key, code: Boolean(fragment.code), indices: [i] });
  }

  return (
    <SearchImagesEnabledContext.Provider value={false}>
      <div
        ref={root}
        data-slot="reasoning-transcript"
        className="relative min-w-0"
        style={{ overflowAnchor: "none" }}
      >
        {groups.map((group) => {
          if (group.code)
            return (
              <CodeGroup
                key={group.key}
                indices={group.indices}
                fragments={fragments}
                estimate={group.indices.reduce(
                  (sum, i) => sum + estimates[i],
                  0,
                )}
                streaming={streaming}
              />
            );
          const i = group.indices[0];
          const fragment = fragments[i];
          return (
            <Row key={fragment.key} index={i} fragment={fragment} estimate={estimates[i]}>
              <Fragment
                fragment={fragment}
                messageId={messageId}
                messageHasRenderableRenderHtmlTool={
                  messageHasRenderableRenderHtmlTool
                }
                streaming={streaming && i === fragments.length - 1}
              />
            </Row>
          );
        })}
        {reserved > 0 && (
          <div
            aria-hidden="true"
            data-reasoning-reserve=""
            style={{ height: reserved }}
          />
        )}
      </div>
    </SearchImagesEnabledContext.Provider>
  );
}
