// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

/* eslint-disable no-restricted-imports -- Match the app's entry order through the chat cycle. */
import "@/features/chat/stores/sidebar-organization-store";
import { useChatPreferencesStore } from "@/features/chat";
/* eslint-enable no-restricted-imports */
import { Thread } from "@/components/assistant-ui/thread";
import { applyReasoningRowContainment } from "@/components/assistant-ui/reasoning-row-containment";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  useAui,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./src/index.css";

// A real Thread/runtime, deterministic bytes, no backend, authentication, or model.
const fetchOriginal = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (/\/api\/skills(?:\?|$)/.test(url))
    return Promise.resolve(Response.json({ skills: [] }));
  if (/\/api\/chat\/threads\/[^/]+\/forks$/.test(url))
    return Promise.resolve(Response.json({ counts: {} }));
  if (/\/api\/chat\/projects(?:\?|$)/.test(url))
    return Promise.resolve(Response.json({ projects: [] }));
  if (/\/api\/rag\/knowledge-bases(?:\?|$)/.test(url))
    return Promise.resolve(Response.json({ knowledge_bases: [] }));
  return fetchOriginal(input, init);
};
useChatPreferencesStore.setState({ thinkingVisibility: "expanded" });

type Options = {
  size?: number;
  kind?: "mixed" | "code" | "line";
  chunk?: number;
  gap?: number;
  userPrompt?: string;
  text?: string;
};
let source = "";
let config: Required<Options> = {
  size: 100000,
  kind: "mixed",
  chunk: 4096,
  gap: 16,
  userPrompt: "Create a Flappy Bird game in HTML.",
  text: "",
};
let started = 0;
let finished = 0;
let frames: number[] = [];

function fixture(size: number, kind: Options["kind"]): string {
  let text =
    "I’ll build a **Flappy Bird game** with a small canvas, simple physics, and keyboard controls.\n\n";
  if (kind === "code" || kind === "line") {
    text += "```javascript\n";
    let line = 0;
    while (text.length < size - 60) {
      text +=
        kind === "line"
          ? "constellation"
          : `const bird${line} = { x: 80, y: ${line++}, velocity: 0 };\n`;
    }
    text += "\n```\n\nThe code is ready. **REASONING_END**";
    return text;
  }
  let i = 0;
  while (text.length < size - 200) {
    text += `**Thought ${i++}.** The bird needs gravity and a gentle upward impulse. Keep the game loop independent of frame rate so it feels consistent.\n\n`;
    if (i % 6 === 0)
      text +=
        "```javascript\nconst dt = Math.min(elapsed / 1000, 0.05);\nbird.velocity += gravity * dt;\nbird.y += bird.velocity * dt;\n```\n\n";
  }
  return text + "**REASONING_END** — ready to write the answer.";
}

const adapter: ChatModelAdapter = {
  async *run({ abortSignal }) {
    started = performance.now();
    for (
      let end = config.chunk;
      end < source.length + config.chunk;
      end += config.chunk
    ) {
      if (abortSignal.aborted) return;
      yield { content: [{ type: "reasoning", text: source.slice(0, end) }] };
      await new Promise((resolve) => setTimeout(resolve, config.gap));
    }
    finished = performance.now();
  },
};

function Api() {
  const aui = useAui();
  useEffect(() => {
    let previous = 0;
    let frame = requestAnimationFrame(function sample(time) {
      if (started && !finished && previous >= started)
        frames.push(time - previous);
      previous = time;
      frame = requestAnimationFrame(sample);
    });
    const api = {
      run(options: Options = {}) {
        config = {
          size: 100000,
          kind: "mixed",
          chunk: 4096,
          gap: 16,
          userPrompt: "Create a Flappy Bird game in HTML.",
          text: "",
          ...options,
        };
        source = config.text || fixture(config.size, config.kind);
        started = 0;
        finished = 0;
        frames = [];
        rowSteps.length = 0;
        aui.thread().import(ExportedMessageRepository.fromArray([]));
        aui.thread().append({
          role: "user",
          content: [{ type: "text", text: config.userPrompt }],
        });
      },
      seed(options: Options = {}) {
        rowSteps.length = 0;
        source =
          options.text ??
          fixture(options.size ?? 100000, options.kind ?? "mixed");
        aui.thread().import(
          ExportedMessageRepository.fromArray([
            {
              id: "fixture-user",
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    options.userPrompt ?? "Create a Flappy Bird game in HTML.",
                },
              ],
            },
            {
              id: "fixture-assistant",
              role: "assistant",
              content: [{ type: "reasoning", text: source }],
            },
          ]),
        );
      },
      source: () => source,
      stats: () => {
        const sorted = [...frames].sort((a, b) => a - b);
        return {
          done: finished > 0,
          duration: finished - started,
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          worst: sorted.at(-1) ?? 0,
          mounted:
            document.querySelector('[data-slot="reasoning-text"]')?.textContent
              ?.length ?? 0,
          fragments: document.querySelectorAll("[data-reasoning-fragment]")
            .length,
          rows: document.querySelectorAll("[data-reasoning-row]").length,
          reserve: [
            ...document.querySelectorAll<HTMLElement>("[data-reasoning-reserve]"),
          ].reduce((sum, spacer) => sum + spacer.offsetHeight, 0),
          steps: [...rowSteps],
          removed: rowsRemoved,
          rendered:
            document.querySelectorAll("[data-reasoning-row]").length -
            [...skippedChunks]
              .filter((chunk) => chunk.isConnected)
              .reduce(
                (sum, chunk) =>
                  sum + chunk.querySelectorAll("[data-reasoning-row]").length,
                0,
              ),
          contained:
            document.documentElement.getAttribute(
              "data-reasoning-row-containment",
            ) === "on",
        };
      },
    };
    Object.assign(window, { __reasoning: api });
    return () => cancelAnimationFrame(frame);
  }, [aui]);
  return null;
}

const skippedChunks = new Set<Element>();
const rowSteps: number[] = [];
let rowsRemoved = 0;
const watchSkippedRows = (root: Element): void => {
  const attach = (chunk: Element) => {
    chunk.addEventListener("contentvisibilityautostatechange", (event) => {
      if ((event as Event & { skipped: boolean }).skipped && chunk.isConnected)
        skippedChunks.add(chunk);
      else skippedChunks.delete(chunk);
    });
  };
  for (const chunk of root.querySelectorAll("[data-reasoning-chunk]")) attach(chunk);
  new MutationObserver((records) => {
    let added = 0;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("[data-reasoning-chunk]")) attach(node);
        for (const chunk of node.querySelectorAll("[data-reasoning-chunk]")) attach(chunk);
        if (node.matches("[data-reasoning-row]")) added += 1;
        added += node.querySelectorAll("[data-reasoning-row]").length;
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("[data-reasoning-row]")) rowsRemoved += 1;
        rowsRemoved += node.querySelectorAll("[data-reasoning-row]").length;
        skippedChunks.delete(node);
        for (const chunk of node.querySelectorAll("[data-reasoning-chunk]")) skippedChunks.delete(chunk);
      }
    }
    if (added > 0) rowSteps.push(added);
  }).observe(root, { childList: true, subtree: true });
};
if (typeof document !== "undefined") {
  applyReasoningRowContainment();
  watchSkippedRows(document.documentElement);
}

function Harness() {
  const runtime = useLocalRuntime(adapter);
  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <Api />
        <div className="flex h-dvh flex-col">
          <Thread hideWelcome />
        </div>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

const route = createRootRoute({ component: Harness });
const router = createRouter({
  routeTree: route,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router as never} />,
);
