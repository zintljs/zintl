import { expect } from "vite-plus/test";
import type { Lab } from "../environment/lab.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export class LabAssertions {
  private lab: Lab;

  constructor(lab: Lab) {
    this.lab = lab;
  }

  /**
   * Assert an element's text eventually contains `expected`.
   *
   * Prefer this over `locator.waitFor({ state: "visible" })` followed by
   * `textContent()`. That pair looks like it waits, but `waitFor` resolves
   * immediately when the element is *already* visible showing the previous
   * value — so the read races the update and the timeout never engages. Every
   * flaky contract we have traced came from that shape.
   *
   * Polls the live DOM until the text matches or the timeout expires, and
   * reports the last value it saw so a genuine stall is diagnosable.
   */
  async textEventually(
    selector: string,
    expected: string,
    opts?: { timeout?: number; interval?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? 15000;
    const interval = opts?.interval ?? 50;
    const locator = this.lab.page.locator(selector).first();

    try {
      await expect
        .poll(async () => (await locator.textContent().catch(() => null)) ?? "", {
          timeout,
          interval,
        })
        .toContain(expected);
    } catch (err) {
      throw new Error(
        `${(err as Error).message}\n\n${await this.describeStall(selector, expected)}`,
      );
    }
  }

  /**
   * Explain *why* the DOM never reached the expected text.
   *
   * A bare "expected X to contain Y" cannot distinguish an update the dev server
   * never sent, one the client never applied, and one that rendered into a
   * different element. Each of those has a different fix, so the failure needs
   * to carry enough state to tell them apart — otherwise every occurrence costs
   * a fresh investigation.
   */
  async describeStall(selector?: string, expected?: string): Promise<string> {
    const lines: string[] = ["── page diagnosis ──"];

    try {
      const packets = this.lab.ws.recentPackets ?? [];
      const kinds = packets.reduce<Record<string, number>>((acc, p: { type?: string }) => {
        const key = p?.type ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      lines.push(
        `hmr packets: ${packets.length === 0 ? "NONE — the dev server never pushed an update" : JSON.stringify(kinds)}`,
      );
    } catch {
      lines.push("hmr packets: unavailable");
    }

    try {
      const beacon = await this.lab.page.evaluate(
        () => (globalThis as { __zintl_version?: number }).__zintl_version,
      );
      lines.push(
        beacon === undefined
          ? "settle beacon: ABSENT — no Zintl runtime on the page"
          : `settle beacon: ${beacon} (runtime applied ${beacon} update(s))`,
      );
    } catch {
      lines.push("settle beacon: unreadable (page navigating or closed)");
    }

    try {
      const errors = this.lab.console.errors ?? [];
      lines.push(
        errors.length === 0
          ? "console errors: none"
          : `console errors:\n${errors
              .slice(0, 5)
              .map((e: { text: string }) => `    ${e.text}`)
              .join("\n")}`,
      );
    } catch {
      lines.push("console errors: unavailable");
    }

    /**
     * The body outline is what distinguishes "the element is missing" from
     * "the page rendered nothing at all". A `page.click` that never finds its
     * target for 30s usually means the second, and only the page state says so.
     */
    try {
      const body = await this.lab.page.evaluate(() => {
        const b = document.body;
        return {
          length: b?.innerHTML?.length ?? 0,
          buttons: Array.from(document.querySelectorAll("button"))
            .map((el) => (el.textContent ?? "").trim())
            .slice(0, 8),
          text: (b?.innerText ?? "").trim().slice(0, 160),
        };
      });
      lines.push(`body html length: ${body.length}${body.length === 0 ? "  ← PAGE IS EMPTY" : ""}`);
      lines.push(`buttons present: ${body.buttons.length ? JSON.stringify(body.buttons) : "NONE"}`);
      lines.push(`body text: ${body.text || "(empty)"}`);
    } catch {
      lines.push("page state: unreadable (navigating or closed)");
    }

    if (selector) {
      try {
        const html = await this.lab.page
          .locator(selector)
          .first()
          .innerHTML()
          .catch(() => "<not found>");
        lines.push(`selector ${selector} html: ${html.slice(0, 200)}`);
        if (expected !== undefined) lines.push(`expected to contain: ${expected}`);
      } catch {
        lines.push(`selector ${selector}: unreadable`);
      }
    }

    return lines.join("\n  ");
  }

  async noHydrationErrors(): Promise<void> {
    await this.lab.clock.waitForIdle();
    const errors = this.lab.console.errors;
    const hydrationErrors = errors.filter(
      (e) =>
        e.text.includes("hydration") ||
        e.text.includes("Hydration") ||
        e.text.includes("Mismatched"),
    );
    if (hydrationErrors.length > 0) {
      throw new Error(
        `Found ${hydrationErrors.length} hydration errors:\n` +
          hydrationErrors.map((e) => e.text).join("\n"),
      );
    }
  }

  async locale(expected: string): Promise<void> {
    const htmlLang = await this.lab.page.getAttribute("html", "lang");
    if (htmlLang !== expected) {
      throw new Error(`Expected page locale to be "${expected}", but found "${htmlLang}"`);
    }
  }

  async dir(expected: "ltr" | "rtl"): Promise<void> {
    const htmlDir = await this.lab.page.getAttribute("html", "dir");
    if (htmlDir !== expected) {
      throw new Error(`Expected page direction to be "${expected}", but found "${htmlDir}"`);
    }
  }

  async catalogContains(opts: { locale: string; key: string; value: string }): Promise<void> {
    const outputDir = (this.lab.compiler.instance as any)?.options?.outputDir || "locales";
    const catalogPath = join(this.lab.root, outputDir, `${opts.locale}.json`);
    if (!existsSync(catalogPath)) {
      throw new Error(`Catalog file not found on disk at: ${catalogPath}`);
    }
    const content = JSON.parse(await readFile(catalogPath, "utf-8"));
    if (content[opts.key] !== opts.value) {
      throw new Error(
        `Expected catalog key "${opts.key}" to have value "${opts.value}", but got "${content[opts.key]}"`,
      );
    }
  }

  async boundaryExists(id: string): Promise<void> {
    const exists = this.lab.compiler.hasBoundary(id);
    if (!exists) {
      throw new Error(`Boundary "${id}" does not exist in compiler's boundary graph`);
    }
  }

  async textVisible(text: string): Promise<void> {
    expect(this.lab.page.locator("body")).toContain(text);
  }

  async ssrContains(path: string, text: string): Promise<void> {
    const url = `${this.lab.url}${path.startsWith("/") ? path : "/" + path}`;
    const res = await fetch(url);
    const html = await res.text();
    if (!html.includes(text)) {
      throw new Error(`SSR HTML from ${url} does not contain: "${text}"`);
    }
  }

  async snapshot(name: string, value: string): Promise<void> {
    const finalName = `${name}.snap`;
    await expect(value).toMatchFileSnapshot(`./__snapshots__/${finalName}`);
  }

  async snapshotAll(prefix: string, results: Record<string, string>): Promise<void> {
    for (const [file, code] of Object.entries(results)) {
      const finalName = `${file}.snap`;
      await expect(code).toMatchFileSnapshot(`./__snapshots__/${prefix}/${finalName}`);
    }
  }
}
