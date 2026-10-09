// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HighlightResult } from "@streamdown/code";
import { useChatRuntimeStore } from "@/features/chat";
import { inputQuietIn, scheduleQuietIdleTask } from "@/lib/schedule-idle-task";
import {
  reasoningHighlightFailure,
  reasoningHighlightReply,
  type ReasoningHighlightMessage,
  type ReasoningHighlightReply,
  type ReasoningHighlightRequest,
} from "./reasoning-highlight";
import {
  mergeLineTokens,
  type ReasoningLineTokens,
} from "./reasoning-line-tokens";
import { createStreamActivity, type StreamActivity } from "./stream-activity";

export type { ReasoningLineTokens } from "./reasoning-line-tokens";

export type HighlightWorkerState =
  | "untested"
  | "ready"
  | "stalled"
  | "unavailable";

export type ReasoningFallbackHighlight = (
  late: (result: HighlightResult) => void,
) => HighlightResult | null;

const READY_TIMEOUT_MS = 5_000;
const REPLY_SILENCE_MS = 15_000;
const IDLE_TEARDOWN_MS = 10_000;
let state: HighlightWorkerState = "untested";
let worker: Worker | null = null;
let boot: { instance: Worker; timer: ReturnType<typeof setTimeout> } | null =
  null;
let idle: ReturnType<typeof setTimeout> | undefined;
let nextClient = 0;
const listeners = new Map<number, (reply: ReasoningHighlightReply) => void>();
const patientClients = new Set<number>();
const awaitingReply = new Set<number>();
const fenceSources = new Map<
  string,
  { worker: Worker; client: number; source: string }
>();
let silence: ReturnType<typeof setTimeout> | undefined;
let activity: StreamActivity | null = null;
let recoveries = 0;
const recoveryListeners = new Set<() => void>();

export const highlightWorkerState = (): HighlightWorkerState => state;

const subscribeRecovery = (listener: () => void): (() => void) => {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
};

const recoveryCount = (): number => recoveries;

const announceRecovery = (): void => {
  recoveries += 1;
  for (const listener of recoveryListeners) listener();
};

export const streamActive = (): boolean =>
  (activity ??= createStreamActivity(useChatRuntimeStore)).active();

const clearBoot = (instance: Worker): void => {
  if (boot?.instance !== instance) return;
  clearTimeout(boot.timer);
  boot = null;
};

const afterQueuedMessages = (callback: () => void): void => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    callback();
  };
  channel.port2.postMessage(0);
};

const flushListeners = (spared?: ReadonlySet<number>): void => {
  const waiting = [...listeners.keys()].filter((id) => !spared?.has(id));
  const deliver = (): void => {
    const id = waiting.shift();
    if (id === undefined) return;
    const listener = listeners.get(id);
    if (listener !== undefined) {
      listeners.delete(id);
      listener(reasoningHighlightFailure(id, 0));
    }
    if (waiting.length > 0) setTimeout(deliver, 0);
  };
  if (waiting.length > 0) setTimeout(deliver, 0);
};

function fail(instance: Worker, reason: string): void {
  if (worker !== instance) return;
  state = "unavailable";
  clearBoot(instance);
  if (idle) clearTimeout(idle);
  worker = null;
  instance.terminate();
  console.warn(
    "[Unsloth Code] highlight worker unavailable, highlighting on the main thread:",
    reason,
  );
  flushListeners();
}

function stall(instance: Worker): void {
  if (worker !== instance || boot?.instance !== instance) return;
  state = "stalled";
  console.warn(
    "[Unsloth Code] highlight worker did not answer within",
    READY_TIMEOUT_MS,
    "ms, highlighting on the main thread until it does",
  );
  flushListeners(patientClients);
}

function silenced(instance: Worker): void {
  if (worker !== instance || boot?.instance === instance) return;
  if (awaitingReply.size === 0) return;
  state = "stalled";
  console.warn(
    "[Unsloth Code] highlight worker sent nothing for",
    REPLY_SILENCE_MS,
    "ms, highlighting on the main thread until it does",
  );
  flushListeners(patientClients);
}

const watchSilence = (instance: Worker): void => {
  if (silence) clearTimeout(silence);
  silence = undefined;
  if (awaitingReply.size === 0) return;
  silence = setTimeout(() => {
    silence = undefined;
    afterQueuedMessages(() => silenced(instance));
  }, REPLY_SILENCE_MS);
};

function getWorker(patient = false): Worker | null {
  if (state === "unavailable") return null;
  if (state === "stalled" && !patient) return null;
  if (idle) clearTimeout(idle);
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    state = "unavailable";
    return null;
  }
  let instance: Worker;
  try {
    instance = new Worker(
      new URL("./reasoning-highlight.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch (error) {
    state = "unavailable";
    console.warn(
      "[Unsloth Code] highlight worker unavailable, highlighting on the main thread:",
      error,
    );
    return null;
  }
  instance.onmessage = ({ data }: MessageEvent<ReasoningHighlightMessage>) => {
    if (instance !== worker) return;
    if ("ready" in data) {
      clearBoot(instance);
      const late = state === "stalled";
      state = "ready";
      watchSilence(instance);
      if (listeners.size === 0) scheduleIdle();
      if (late) announceRecovery();
      return;
    }
    if (state === "stalled" && boot === null) {
      state = "ready";
      announceRecovery();
    }
    listeners.get(data.client)?.(data);
    watchSilence(instance);
  };
  instance.onerror = (event) => fail(instance, event.message || event.type);
  worker = instance;
  boot = {
    instance,
    timer: setTimeout(
      () => afterQueuedMessages(() => stall(instance)),
      READY_TIMEOUT_MS,
    ),
  };
  return instance;
}

function scheduleIdle(): void {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    if (!worker || boot?.instance === worker) return;
    worker.terminate();
    worker = null;
    if (state === "stalled") state = "untested";
  }, IDLE_TEARDOWN_MS);
}

export function requestFullHighlight(
  source: string,
  language: string | null,
  onResult: (result: HighlightResult | null) => void,
  speculative = false,
  patient = !speculative,
): (() => void) | null {
  const instance = getWorker(patient);
  if (!instance) return null;
  const id = ++nextClient;
  if (patient) patientClients.add(id);
  listeners.set(id, (reply) => {
    if (!reply.failed && (reply.revision !== 1 || !reply.result)) return;
    listeners.delete(id);
    patientClients.delete(id);
    awaitingReply.delete(id);
    onResult(reply.failed ? null : (reply.result as HighlightResult));
    if (listeners.size === 0 && worker) scheduleIdle();
  });
  const request: ReasoningHighlightRequest = {
    client: id,
    revision: 1,
    source,
    language,
    lines: [],
    full: true,
    ...(speculative ? { speculative: true } : {}),
  };
  instance.postMessage(request);
  awaitingReply.add(id);
  if (!silence) watchSilence(instance);
  return () => {
    if (!listeners.has(id)) return;
    listeners.delete(id);
    patientClients.delete(id);
    awaitingReply.delete(id);
    worker?.postMessage({ cancel: id });
    if (listeners.size === 0 && worker) scheduleIdle();
  };
}

const requestSource = (
  fence: string,
  instance: Worker,
  client: number,
  source: string,
): ReasoningHighlightRequest["source"] => {
  const held = fenceSources.get(fence);
  const known = held?.worker === instance ? held : undefined;
  const grows = known !== undefined && source.startsWith(known.source);
  if (known === undefined || known.client === client || grows)
    fenceSources.set(fence, { worker: instance, client, source });
  if (grows)
    return {
      base: known.client,
      from: known.source.length,
      text: source.slice(known.source.length),
    };
  if (known?.source.startsWith(source))
    return { base: known.client, from: source.length, text: "" };
  return source;
};

const forgetSources = (client: number): void => {
  for (const [fence, held] of fenceSources)
    if (held.client === client) fenceSources.delete(fence);
};

const fallbackQueue: (() => void)[] = [];
let fallbackPending: (() => void) | null = null;

const drainFallback = (): void => {
  fallbackPending = null;
  if (fallbackQueue.length === 0) return;
  if (streamActive()) {
    const timer = setTimeout(drainFallback, 1000);
    fallbackPending = () => clearTimeout(timer);
    return;
  }
  const quietIn = inputQuietIn();
  if (quietIn > 0) {
    const timer = setTimeout(drainFallback, quietIn);
    fallbackPending = () => clearTimeout(timer);
    return;
  }
  fallbackQueue.shift()?.();
  if (fallbackQueue.length > 0) {
    fallbackPending = scheduleQuietIdleTask(drainFallback, 1000);
  }
};

const queueFallback = (job: () => void): (() => void) => {
  fallbackQueue.push(job);
  if (!fallbackPending) fallbackPending = scheduleQuietIdleTask(drainFallback, 1000);
  return () => {
    const at = fallbackQueue.indexOf(job);
    if (at >= 0) fallbackQueue.splice(at, 1);
  };
};

/** Text is synchronous; expensive grammar work must never hold up chat or scrolling. */
export function useReasoningHighlight(
  fence: string,
  source: string,
  language: string | null,
  lines: number[],
  fallback: ReasoningFallbackHighlight | null,
  exact: boolean,
): ReasoningLineTokens {
  const [tokens, setTokens] = useState<ReasoningLineTokens>(() => new Map());
  const client = useRef<number | null>(null);
  const revision = useRef(0);
  const recovery = useSyncExternalStore(subscribeRecovery, recoveryCount);
  const lineKey = lines.join(",");
  useEffect(() => {
    if (lineKey === "") return;
    const id = (client.current ??= ++nextClient);
    const version = ++revision.current;
    const wanted = lineKey.split(",").filter(Boolean).map(Number);
    const apply = (reply: ReasoningHighlightReply) =>
      setTokens((previous) => mergeLineTokens(previous, reply.lines));
    const runFallback = (): (() => void) | undefined => {
      if (!fallback) return undefined;
      const deliver = (result: HighlightResult) => {
        if (revision.current !== version) return;
        apply(
          reasoningHighlightReply(
            { client: id, revision: version, source, language, lines: wanted },
            result,
          ),
        );
      };
      return queueFallback(() => {
        const now = fallback(deliver);
        if (now) deliver(now);
      });
    };
    const instance = getWorker();
    if (!instance) return runFallback();
    let cancelFallback: (() => void) | undefined;
    listeners.set(id, (reply) => {
      if (reply.failed) {
        forgetSources(id);
        if (revision.current !== version) return;
        cancelFallback = runFallback();
        return;
      }
      if (reply.revision !== version) return;
      apply(reply);
    });
    const request: ReasoningHighlightRequest = {
      client: id,
      revision: version,
      source: requestSource(fence, instance, id, source),
      language,
      lines: wanted,
      ...(exact ? { exact: true } : {}),
    };
    instance.postMessage(request);
    return () => cancelFallback?.();
  }, [fence, source, language, lineKey, fallback, exact, recovery]);
  useEffect(
    () => () => {
      revision.current += 1;
      if (client.current !== null) {
        forgetSources(client.current);
        listeners.delete(client.current);
        worker?.postMessage({ cancel: client.current });
      }
      if (listeners.size === 0 && worker) scheduleIdle();
    },
    [],
  );
  return tokens;
}
