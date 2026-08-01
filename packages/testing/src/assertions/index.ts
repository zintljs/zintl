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

    await expect
      .poll(async () => (await locator.textContent().catch(() => null)) ?? "", {
        timeout,
        interval,
      })
      .toContain(expected);
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
