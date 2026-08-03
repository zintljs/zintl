import type { Page } from "@playwright/test";

export class LabClock {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async install(opts?: { now?: number | Date }): Promise<void> {
    await this.page.clock.install(opts ? { time: opts.now } : undefined);
  }

  async tick(ms: number | string): Promise<void> {
    await this.page.clock.runFor(ms);
  }

  async pause(): Promise<void> {
    await this.page.clock.pauseAt(Date.now());
  }

  async resume(): Promise<void> {
    await this.page.clock.resume();
  }

  /**
   * Yield one paint, and nothing more.
   *
   * For use after a *causal* signal has already confirmed the store applied the
   * change: at that point the only thing still outstanding is the framework
   * rendering, which is one frame away. `waitForIdle` additionally waits for
   * 500 ms of network silence and then a further fixed 100 ms — a real cost on
   * every mutation, and pure superstition once something reliable has said the
   * work is done.
   */
  async waitForPaint(): Promise<void> {
    try {
      await this.page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
      );
    } catch (e: any) {
      if (
        !e.message.includes("destroyed") &&
        !e.message.includes("navigation") &&
        !e.message.includes("context")
      ) {
        throw e;
      }
    }
  }

  async waitForIdle(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? 10000;
    try {
      await this.page.waitForLoadState("networkidle", { timeout });
    } catch {
      // Ignore networkidle timeout if it fails (sometimes some constant long polling happens)
    }
    // Wait a brief moment for animation frames and event loop ticks to settle
    try {
      await this.page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))),
      );
    } catch (e: any) {
      if (
        !e.message.includes("destroyed") &&
        !e.message.includes("navigation") &&
        !e.message.includes("context")
      ) {
        throw e;
      }
    }
  }
}
