// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { posix } from "node:path";
import type { Plugin } from "vite";

const VIEWPORT_FEATURE =
  /\b(?:(?:min|max)-)?(?:device-)?(?:width|height|aspect-ratio)\b|\borientation\b/i;
const GATED_AT_RULES = new Set([
  "media",
  "supports",
  "layer",
  "container",
  "starting-style",
]);
const PSEUDO_ELEMENT = /^:(?::|(?:before|after|first-line|first-letter)(?![\w-]))/i;
const ATTRIBUTE_PREFIX = "data-mq-";
const BOOT_SCRIPT_NAME = "viewport-media.js";

export type ViewportQuery = { attribute: string; query: string };

type Gate = { attribute: string; present: boolean };

function skipEscape(text: string, at: number): number {
  let end = at + 1;
  if (!/[0-9a-f]/i.test(text[end] ?? "")) return end + 1;
  while (end < at + 7 && /[0-9a-f]/i.test(text[end] ?? "")) end++;
  if (/\s/.test(text[end] ?? "")) end++;
  return end;
}

function skipString(text: string, at: number): number {
  const quote = text[at];
  let end = at + 1;
  while (end < text.length && text[end] !== quote) {
    end = text[end] === "\\" ? end + 2 : end + 1;
  }
  return end + 1;
}

function skipComment(text: string, at: number): number {
  const close = text.indexOf("*/", at + 2);
  return close === -1 ? text.length : close + 2;
}

function preludeEnd(text: string, from: number, to: number): number {
  let depth = 0;
  for (let at = from; at < to; ) {
    const char = text[at];
    if (char === "\\") at = skipEscape(text, at);
    else if (char === '"' || char === "'") at = skipString(text, at);
    else if (char === "/" && text[at + 1] === "*") at = skipComment(text, at);
    else {
      if (char === "(" || char === "[") depth++;
      else if (char === ")" || char === "]") depth--;
      else if (depth === 0 && (char === "{" || char === ";" || char === "}")) return at;
      at++;
    }
  }
  return to;
}

function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; ) {
    const char = text[at];
    if (char === "\\") at = skipEscape(text, at);
    else if (char === '"' || char === "'") at = skipString(text, at);
    else if (char === "/" && text[at + 1] === "*") at = skipComment(text, at);
    else {
      if (char === "{") depth++;
      else if (char === "}" && --depth === 0) return at;
      at++;
    }
  }
  return text.length;
}

function topLevelParts(selector: string): { commas: number[]; firstCombinator: number } {
  const commas: number[] = [];
  let firstCombinator = -1;
  let depth = 0;
  for (let at = 0; at < selector.length; ) {
    const char = selector[at];
    if (char === "\\") {
      at = skipEscape(selector, at);
      continue;
    }
    if (char === '"' || char === "'") {
      at = skipString(selector, at);
      continue;
    }
    if (char === "/" && selector[at + 1] === "*") {
      at = skipComment(selector, at);
      continue;
    }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0) {
      if (char === ",") commas.push(at);
      else if (
        firstCombinator === -1 &&
        (char === ">" || char === "+" || char === "~" || /\s/.test(char))
      ) {
        firstCombinator = at;
      }
    }
    at++;
  }
  return { commas, firstCombinator };
}

function pseudoElementAt(selector: string, to: number): number {
  let depth = 0;
  for (let at = 0; at < to; ) {
    const char = selector[at];
    if (char === "\\") {
      at = skipEscape(selector, at);
      continue;
    }
    if (char === '"' || char === "'") {
      at = skipString(selector, at);
      continue;
    }
    if (char === "/" && selector[at + 1] === "*") {
      at = skipComment(selector, at);
      continue;
    }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0 && char === ":" && PSEUDO_ELEMENT.test(selector.slice(at))) return at;
    at++;
  }
  return -1;
}

function splitSelectorList(list: string): string[] {
  const { commas } = topLevelParts(list);
  const parts: string[] = [];
  let start = 0;
  for (const comma of commas) {
    parts.push(list.slice(start, comma));
    start = comma + 1;
  }
  parts.push(list.slice(start));
  return parts;
}

export function gateSelector(selector: string, root: string): string {
  const trimmed = selector.replace(/^(?:\s|\/\*[\s\S]*?\*\/)*/, "").trimEnd();
  const { firstCombinator } = topLevelParts(trimmed);
  const leftmostEnd = firstCombinator === -1 ? trimmed.length : firstCombinator;
  const pseudo = pseudoElementAt(trimmed, leftmostEnd);
  const at = pseudo === -1 ? leftmostEnd : pseudo;
  return `:where(${root}) ${trimmed},${trimmed.slice(0, at)}:where(${root})${trimmed.slice(at)}`;
}

function gateRoot(gates: readonly Gate[]): string {
  return `html${gates
    .map(({ attribute, present }) => (present ? `[${attribute}]` : `:not([${attribute}])`))
    .join("")}`;
}

function attributeFor(query: string): string {
  const slug = query
    .toLowerCase()
    .replace(/>=/g, "-gte-")
    .replace(/<=/g, "-lte-")
    .replace(/>/g, "-gt-")
    .replace(/</g, "-lt-")
    .replace(/=/g, "-eq-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${ATTRIBUTE_PREFIX}${slug}`;
}

export function viewportGate(condition: string): { query: string; present: boolean } | null {
  const trimmed = condition.trim();
  if (!VIEWPORT_FEATURE.test(trimmed)) return null;
  const negated = /^not\s+all\s+and\s+(\([^()]*\))$/i.exec(trimmed);
  if (negated) return { query: negated[1], present: false };
  return /^\([^()]*\)$/.test(trimmed) ? { query: trimmed, present: true } : null;
}

function gatesEverything(text: string, from: number, to: number): boolean {
  for (let at = from; at < to; ) {
    const char = text[at];
    if (char === "\\") at = skipEscape(text, at);
    else if (char === '"' || char === "'") at = skipString(text, at);
    else if (char === "/" && text[at + 1] === "*") at = skipComment(text, at);
    else if (char === "@") {
      const name = /^@([-\w]+)/.exec(text.slice(at, at + 40))?.[1]?.toLowerCase() ?? "";
      if (!GATED_AT_RULES.has(name)) return false;
      at++;
    } else at++;
  }
  return true;
}

function rewriteRules(
  text: string,
  from: number,
  to: number,
  gates: readonly Gate[],
  queries: Map<string, string>,
): string {
  let out = "";
  let at = from;
  while (at < to) {
    if (/\s/.test(text[at])) {
      out += text[at++];
      continue;
    }
    if (text[at] === "/" && text[at + 1] === "*") {
      const end = skipComment(text, at);
      out += text.slice(at, end);
      at = end;
      continue;
    }
    const stop = preludeEnd(text, at, to);
    if (stop >= to || text[stop] !== "{") {
      const end = Math.min(stop + 1, to);
      out += text.slice(at, end);
      at = end;
      continue;
    }
    const prelude = text.slice(at, stop);
    const close = blockEnd(text, stop);
    if (prelude.startsWith("@")) {
      const name = /^@([-\w]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      const gate = name === "media" ? viewportGate(prelude.slice(6)) : null;
      if (gate && gatesEverything(text, stop + 1, close)) {
        const attribute = queries.get(gate.query) ?? attributeFor(gate.query);
        queries.set(gate.query, attribute);
        const inner = rewriteRules(text, stop + 1, close, [...gates, { attribute, present: gate.present }], queries);
        out += `@media screen{${inner}}`;
        if (gates.length === 0) out += `@media print{${text.slice(at, close + 1)}}`;
      } else if (GATED_AT_RULES.has(name)) {
        out += `${prelude}{${rewriteRules(text, stop + 1, close, gates, queries)}}`;
      } else {
        out += text.slice(at, close + 1);
      }
    } else if (gates.length === 0) {
      out += text.slice(at, close + 1);
    } else {
      const root = gateRoot(gates);
      out += splitSelectorList(prelude)
        .map((selector) => gateSelector(selector, root))
        .join(",");
      out += text.slice(stop, close + 1);
    }
    at = close + 1;
  }
  return out;
}

export function gateViewportMedia(css: string): { css: string; queries: ViewportQuery[] } {
  const queries = new Map<string, string>();
  const next = rewriteRules(css, 0, css.length, [], queries);
  return {
    css: queries.size === 0 ? css : next,
    queries: [...queries].map(([query, attribute]) => ({ attribute, query })),
  };
}

export function viewportBootScript(queries: readonly ViewportQuery[]): string {
  const entries = JSON.stringify(queries.map(({ attribute, query }) => [attribute, query]));
  return `(function(){var root=document.documentElement;var entries=${entries};entries.forEach(function(entry){var list=window.matchMedia(entry[1]);var apply=function(){root.toggleAttribute(entry[0],list.matches)};apply();list.addEventListener("change",apply)});window.addEventListener("resize",function(){entries.forEach(function(entry){root.toggleAttribute(entry[0],window.matchMedia(entry[1]).matches)})})})();\n`;
}

export function viewportMediaGate(): Plugin[] {
  const queries = new Map<string, ViewportQuery>();
  let base = "/";
  return [
    {
      name: "viewport-media-gate",
      apply: "build",
      transform: {
        filter: { id: { include: /\.css(?:$|\?)/, exclude: /[?&](?:inline|raw|url)\b/ }, code: "@media" },
        handler(code) {
          const gated = gateViewportMedia(code);
          if (gated.queries.length === 0) return null;
          for (const query of gated.queries) queries.set(query.query, query);
          return { code: gated.css, map: null };
        },
      },
    },
    {
      name: "viewport-media-boot",
      apply: "build",
      enforce: "post",
      configResolved(config) {
        base = config.base;
      },
      generateBundle(_options, bundle) {
        if (queries.size === 0) return;
        const sorted = [...queries.values()].sort((a, b) => a.attribute.localeCompare(b.attribute));
        const fileName = this.getFileName(
          this.emitFile({ type: "asset", name: BOOT_SCRIPT_NAME, source: viewportBootScript(sorted) }),
        );
        for (const asset of Object.values(bundle)) {
          if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
          const html = String(asset.source);
          const head = html.indexOf("<head");
          const script = head === -1 ? -1 : html.indexOf("<script", head);
          const at = script === -1 ? html.indexOf("</head>") : script;
          const src = base === "./" || base === ""
            ? `./${posix.relative(posix.dirname(asset.fileName), fileName)}`
            : `${base}${fileName}`;
          if (at !== -1) asset.source = `${html.slice(0, at)}<script src="${src.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></script>\n    ${html.slice(at)}`;
        }
      },
    },
  ];
}
