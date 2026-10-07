// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

// Run with playwright-cli run-code --filename=tests/studio/reasoning-transcript-checks.js
// after opening smoke-reasoning-transcript.html in a named browser session.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const keyWarnings = [];
  page.on("console", (message) => { if (message.type() === "error" && /same key/.test(message.text())) keyWarnings.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => window.__reasoning);
  await page.evaluate(() => window.__reasoning.seed({ size: 100000 }));
  await page.waitForTimeout(600);
  check(await page.locator('[data-slot="reasoning-transcript"]').count() === 1, "long reasoning is not windowed");
  check(await page.locator('[data-slot="reasoning-page-navigation"], [data-slot="reasoning-oversized-code"]').count() === 0, "pagination chrome remains");
  await page.waitForFunction(() => (document.querySelector('[data-slot="reasoning-text"]')?.textContent ?? "").includes("REASONING_END"), null, { timeout: 5000 }).catch(() => {});
  check((await page.locator('[data-slot="reasoning-text"]').evaluate((node) => node.textContent)).includes("REASONING_END"), "latest reasoning is missing");
  const seeded = await page.evaluate(() => window.__reasoning.stats());
  check(seeded.rows >= 8, "saved trace did not mount its fragments");
  check(!seeded.contained || seeded.rendered < seeded.rows, "saved trace renders every row although the engine can skip them");
  await page.waitForFunction(() => window.__reasoning.stats().reserve === 0, null, { timeout: 10000 });
  const bounded = await page.evaluate(() => window.__reasoning.stats().steps);
  check(bounded.length > 1 && Math.max(...bounded.slice(1)) <= 128, "a widening commit exceeded the frame budget");
  await page.evaluate(() => window.__reasoning.seed({ size: 250000 }));
  await page.waitForFunction(() => window.__reasoning.stats().reserve > 0, null, { timeout: 5000 }).catch(() => {});
  check((await page.evaluate(() => window.__reasoning.stats())).reserve > 0, "a replaced document did not restart its bounded mount");
  await page.emulateMedia({ media: "print" });
  let printed = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const look = () => {
      const stats = window.__reasoning.stats();
      if (stats.reserve === 0 || ++frames > 2) resolve({ ...stats, end: (document.querySelector('[data-slot="reasoning-text"]')?.textContent ?? "").includes("REASONING_END"), spacers: [...document.querySelectorAll("[data-reasoning-reserve]")].filter((node) => node.offsetHeight > 0).length });
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }));
  check(printed.reserve === 0 && printed.spacers === 0, "the print media query left the tail as a blank spacer");
  check(printed.end, "the print media query did not mount the tail");
  await page.emulateMedia({ media: null });
  await page.waitForTimeout(100);
  check((await page.evaluate(() => window.__reasoning.stats())).rows === printed.rows, "afterprint unmounted rows");
  await page.evaluate(() => window.__reasoning.seed({ size: 260000 }));
  await page.waitForFunction(() => window.__reasoning.stats().reserve > 0, null, { timeout: 5000 }).catch(() => {});
  check((await page.evaluate(() => window.__reasoning.stats())).reserve > 0, "a replaced document did not restart its bounded mount before beforeprint");
  printed = await page.evaluate(() => {
    window.dispatchEvent(new Event("beforeprint"));
    return { ...window.__reasoning.stats(), end: (document.querySelector('[data-slot="reasoning-text"]')?.textContent ?? "").includes("REASONING_END") };
  });
  check(printed.reserve === 0, "beforeprint left the tail unmounted in the task the page is captured in");
  check(printed.end, "beforeprint did not mount the tail");
  await page.evaluate(() => document.querySelector(".aui-thread-viewport").scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__reasoning.seed({ size: 270000 }));
  await page.waitForFunction(() => window.__reasoning.stats().reserve > 0, null, { timeout: 5000 }).catch(() => {});
  check((await page.evaluate(() => window.__reasoning.stats())).reserve > 0, "a replaced document did not restart its bounded mount before the jump");
  const removedBeforeJump = (await page.evaluate(() => window.__reasoning.stats())).removed;
  const jump = await page.evaluate(() => new Promise((resolve) => {
    const viewport = document.querySelector(".aui-thread-viewport");
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
    let frames = 0;
    const look = () => {
      frames += 1;
      const bounds = viewport.getBoundingClientRect();
      const row = [...document.querySelectorAll("[data-reasoning-fragment]")].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      });
      if (row || frames >= 8) resolve({ frames, key: row ? row.dataset.reasoningFragment : null, top: row ? row.getBoundingClientRect().top : null });
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }));
  check(jump.key !== null && jump.frames <= 4, "a jump into the unmounted tail left the viewport blank");
  await page.mouse.move(550, 350);
  await page.mouse.wheel(0, -300);
  await page.evaluate(() => new Promise((resolve) => {
    const viewport = document.querySelector(".aui-thread-viewport");
    let last = viewport.scrollTop;
    let still = 0;
    let frames = 0;
    const look = () => {
      still = viewport.scrollTop === last ? still + 1 : 0;
      last = viewport.scrollTop;
      if (still >= 3 || ++frames > 120) resolve();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }));
  const reader = await page.evaluate(() => {
    const bounds = document.querySelector(".aui-thread-viewport").getBoundingClientRect();
    const row = [...document.querySelectorAll("[data-reasoning-fragment]")].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.top >= bounds.top + 100 && rect.bottom <= bounds.bottom - 100;
    });
    return row ? { key: row.dataset.reasoningFragment, top: row.getBoundingClientRect().top } : null;
  });
  check(reader !== null, "no passage to read after scrolling up in the tail");
  await page.waitForFunction(() => window.__reasoning.stats().reserve === 0, null, { timeout: 20000 });
  const settledTop = await page.evaluate((key) => document.querySelector(`[data-reasoning-fragment="${CSS.escape(key)}"]`)?.getBoundingClientRect().top ?? null, reader.key);
  check(settledTop !== null && Math.abs(settledTop - reader.top) < 3, "filling the trace above the reader moved what they were reading");
  check((await page.evaluate(() => window.__reasoning.stats())).removed === removedBeforeJump, "mounting the rest of the trace unmounted rows the reader had");
  await page.evaluate(() => window.__reasoning.seed({ size: 100000 }));
  await page.waitForTimeout(600);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy reasoning", exact: true }).click();
  check(await page.evaluate(async () => await navigator.clipboard.readText() === window.__reasoning.source()), "copy lost source bytes");
  const trigger = page.locator('[data-slot="reasoning-trigger"]');
  await trigger.click();
  await page.waitForTimeout(400);
  check(await page.locator('[data-slot="reasoning-transcript"]').count() === 0, "collapsed reasoning stayed mounted");
  const headerTop = (await trigger.boundingBox()).y;
  await trigger.click();
  await page.waitForTimeout(400);
  check(Math.abs((await trigger.boundingBox()).y - headerTop) < 3, "reopening moved the header");
  check((await page.locator('[data-slot="reasoning-text"]').evaluate((node) => node.textContent)).includes("Flappy Bird game"), "reopening did not expose the beginning");
  await page.screenshot({ path: ".playwright-cli/reasoning-inline-desktop.png" });

  await page.evaluate(() => window.__reasoning.run({ size: 24000, chunk: 1024, gap: 120 }));
  await page.waitForFunction(() => (document.querySelector('[data-slot="reasoning-text"]')?.textContent.length ?? 0) > 8000);
  await page.mouse.move(550, 350);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(200);
  const thresholdAnchor = await page.locator('[data-slot="reasoning-text"] p').evaluateAll((nodes) => {
    const node = nodes.find((node) => node.getBoundingClientRect().top > 100 && node.getBoundingClientRect().bottom < 600);
    return { text: node.textContent, top: node.getBoundingClientRect().top };
  });
  await page.waitForSelector('[data-slot="reasoning-transcript"]');
  await page.waitForTimeout(300);
  const afterThreshold = page.locator('[data-slot="reasoning-text"] p').filter({ hasText: thresholdAnchor.text }).first();
  check(await afterThreshold.count() === 1, "threshold activation lost the reading passage");
  check(Math.abs((await afterThreshold.boundingBox()).y - thresholdAnchor.top) < 30, "threshold activation moved the reading passage");
  await page.waitForFunction(() => window.__reasoning.stats().done);

  await page.evaluate(() => window.__reasoning.run({ size: 250000, kind: "mixed", chunk: 1024, gap: 30,
    userPrompt: "Create a dynamic demonstration with electrical arcs and interactive objects. ".repeat(30),
  }));
  await page.waitForSelector('[data-slot="reasoning-transcript"]');
  await page.waitForFunction(() => {
    const viewport = document.querySelector(".aui-thread-viewport");
    return viewport.scrollTop > 2000 && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2;
  }, null, { timeout: 15000 });
  await page.mouse.move(550, 350);
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(300);
  const anchor = await page.evaluate(() => {
    const viewport = document.querySelector(".aui-thread-viewport").getBoundingClientRect();
    const row = [...document.querySelectorAll("[data-reasoning-fragment]")].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= viewport.top && rect.bottom < viewport.bottom - 180;
    });
    if (!row) throw new Error("no visible anchor");
    return { key: row.dataset.reasoningFragment, top: row.getBoundingClientRect().top, text: row.textContent };
  });
  await page.waitForTimeout(900);
  const anchored = page.locator(`[data-reasoning-fragment="${anchor.key}"]`);
  check(await anchored.count() === 1, "reading anchor was recycled during streaming");
  check(Math.abs((await anchored.boundingBox()).y - anchor.top) < 3, "streaming moved the reading anchor");
  check(await anchored.textContent() === anchor.text, "streaming changed an earlier thought");
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(300);
  check(await anchored.count() === 1, "resizing lost the reading passage");
  check(Math.abs((await anchored.boundingBox()).y - anchor.top) < 100, "resizing jumped to another passage");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await anchored.evaluate((node) => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  const selected = await page.evaluate(() => window.getSelection().toString());
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window.getSelection().toString()) === selected, "recycling destroyed selection");
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await trigger.click();
  await page.waitForTimeout(300);
  const liveHeaderTop = (await trigger.boundingBox()).y;
  await trigger.click();
  await page.waitForTimeout(400);
  check(Math.abs((await trigger.boundingBox()).y - liveHeaderTop) < 3, "reopening live reasoning moved its header");
  check((await page.locator('[data-slot="reasoning-text"]').evaluate((node) => node.textContent)).includes("Flappy Bird game"), "live reopening reused a stale reading anchor");
  await page.getByRole("button", { name: "Scroll to bottom", exact: true }).click();
  await page.waitForFunction(() => window.__reasoning.stats().done, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  check((await page.locator('[data-slot="reasoning-text"]').evaluate((node) => node.textContent)).includes("REASONING_END"), "following did not resume");
  const atBottom = () => page.evaluate(() => {
    const viewport = document.querySelector(".aui-thread-viewport");
    return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2;
  });
  check(await atBottom(), "following resumed but the view stopped short of the bottom");
  await page.evaluate(() => window.__reasoning.run({ size: 150000, chunk: 1024, gap: 30 }));
  await page.waitForFunction(() => window.__reasoning.stats().done, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  check(await atBottom(), "an untouched stream stopped following the bottom");

  await page.evaluate(() => window.__reasoning.seed({
    size: 100000,
    userPrompt: "Create a dynamic demonstration with electrical arcs and interactive objects. ".repeat(30),
  }));
  await page.waitForTimeout(500);
  await trigger.click();
  await page.waitForTimeout(300);
  const longPromptHeaderTop = (await trigger.boundingBox()).y;
  await trigger.click();
  await page.waitForTimeout(400);
  check(Math.abs((await trigger.boundingBox()).y - longPromptHeaderTop) < 3, "long prompt reopening moved the header");
  await page.mouse.move(550, 350);
  await page.mouse.wheel(0, 100000);
  await page.waitForTimeout(300);
  await page.mouse.move(550, 350);
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(400);
  const narrowAnchor = await page.locator('[data-slot="reasoning-text"] p').evaluateAll((nodes) => {
    const node = nodes.find((node) => node.getBoundingClientRect().top > 100 && node.getBoundingClientRect().top < 400);
    if (!node) throw new Error("no resize passage");
    return { text: node.textContent, top: node.getBoundingClientRect().top };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const narrowPassage = page.locator('[data-slot="reasoning-text"] p').filter({ hasText: narrowAnchor.text }).first();
  check(await narrowPassage.count() === 1, "long prompt reflow recycled the reading passage");
  check(Math.abs((await narrowPassage.boundingBox()).y - narrowAnchor.top) < 100, "long prompt reflow lost the reading position");
  await page.evaluate(() => window.__reasoning.seed({ size: 140000, kind: "code" }));
  await page.waitForTimeout(500);
  check(await page.locator('[data-slot="reasoning-code-fragment"]').count() > 0, "large fence has no code rendering");
  check(await page.evaluate(() => [...document.querySelectorAll('[data-slot="reasoning-code-fragment"].aui-reasoning-code-first')].every((group) => {
    const button = group.querySelector('button[title="Copy code"]');
    if (!button) return true;
    const outer = group.getBoundingClientRect();
    const inner = button.getBoundingClientRect();
    return inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right;
  })), "a reasoning code block draws its copy actions outside itself");
  await page.waitForFunction(() => window.__reasoning.stats().reserve === 0, null, { timeout: 20000 });
  const fenceRows = await page.evaluate(() => {
    const keys = [...document.querySelectorAll("[data-reasoning-fragment]")].map((node) => node.dataset.reasoningFragment);
    return { total: keys.length, unique: new Set(keys).size };
  });
  check(fenceRows.total > 0 && fenceRows.unique === fenceRows.total, "a long fence rendered some of its lines twice");
  check(await page.locator(".aui-thread-viewport").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), "reasoning overflows the narrow viewport");
  await page.screenshot({ path: ".playwright-cli/reasoning-inline-mobile.png" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: ".playwright-cli/reasoning-inline-mobile-dark.png" });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.__reasoning.seed({ text:
    "Earlier paragraph.\n\n".repeat(1000) + "[Link][ref]\n\n> [ref]: https://example.org",
  }));
  await page.mouse.move(550, 350); await page.mouse.wheel(0, 100000);
  await page.waitForTimeout(500);
  check(await page.getByRole("link", { name: "Link", exact: true }).getAttribute("href") === "https://example.org/", "fragmented reference lost its document definition");
  for (const marker of ["1. ", "- Parent\n  1. ", "> 1. "]) {
    await page.evaluate((marker) => window.__reasoning.seed({ text: marker + "Long item ".repeat(3000) + "\n2. Second item" }), marker);
    await page.mouse.wheel(0, 100000);
    await page.waitForTimeout(500);
    const continuation = page.locator("li[data-reasoning-list-continuation]").last();
    check(await continuation.count() === 1, "long list item lost its continuation container");
    check(await continuation.evaluate((node) => getComputedStyle(node).listStyleType) === "none", "continuation repeated its marker");
    const sibling = page.locator("li").filter({ hasText: /^Second item$/ }).last();
    check(await sibling.count() === 1, "continuation swallowed a genuine sibling item");
    check(await sibling.evaluate((node) => getComputedStyle(node).listStyleType) !== "none", "real sibling lost its marker");
  }
  await page.screenshot({ path: ".playwright-cli/reasoning-review-formatting.png" });
  check(keyWarnings.length === 0, `React reported two transcript children with one key: ${keyWarnings[0] ?? ""}`);
  return { passed: true, checks: ["bounded saved trace", "no pagination chrome", "bounded commits", "print mounts the tail", "jump into the tail", "no unmount while widening", "canonical copy", "collapse/reopen", "live collapse/reopen", "threshold anchor", "streaming anchor", "resize anchor", "long prompt reflow", "selection", "resume following", "untouched stream follows", "narrow code", "light/dark", "document reference links", "list continuation markers"] };
}
