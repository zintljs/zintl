import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

export interface LabBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

let sharedBrowser: Browser | null = null;

export async function createLabBrowser(headless: boolean = true): Promise<LabBrowser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  const context = await sharedBrowser.newContext();
  const page = await context.newPage();

  return {
    browser: sharedBrowser,
    context,
    page,
    async close() {
      await page.close();
      await context.close();
    },
  };
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
