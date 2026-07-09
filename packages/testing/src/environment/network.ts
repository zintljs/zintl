import type { Page, Request, Response } from "@playwright/test";

export interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  timestamp: number;
}

export interface NetworkCapture {
  stop(): CapturedRequest[];
  readonly requests: ReadonlyArray<CapturedRequest>;
}

export class LabNetwork {
  private page: Page;
  private _requests: CapturedRequest[] = [];
  private activeCaptures: Set<{ requests: CapturedRequest[] }> = new Set();
  private requestMap = new Map<Request, CapturedRequest>();

  constructor(page: Page) {
    this.page = page;
    this.setupListeners();
  }

  private setupListeners() {
    this.page.on("request", (req: Request) => {
      const captured: CapturedRequest = {
        url: req.url(),
        method: req.method(),
        timestamp: Date.now(),
      };
      this.requestMap.set(req, captured);
      this._requests.push(captured);

      for (const capture of this.activeCaptures) {
        capture.requests.push(captured);
      }
    });

    this.page.on("response", (res: Response) => {
      const req = res.request();
      const captured = this.requestMap.get(req);
      if (captured) {
        captured.status = res.status();
        const headers = res.headers();
        captured.contentType = headers["content-type"];
      }
    });
  }

  get requests(): ReadonlyArray<CapturedRequest> {
    return this._requests;
  }

  capture(): NetworkCapture {
    const requests: CapturedRequest[] = [];
    const captureObj = { requests };
    this.activeCaptures.add(captureObj);

    return {
      stop: () => {
        this.activeCaptures.delete(captureObj);
        return requests;
      },
      get requests() {
        return requests;
      },
    };
  }

  async waitForRequest(
    pattern: string | RegExp | ((req: Request) => boolean),
    opts?: { timeout?: number },
  ): Promise<Request> {
    const timeout = opts?.timeout ?? 10000;
    return await this.page.waitForEvent("request", {
      predicate: (req: Request) => {
        if (typeof pattern === "string") {
          return req.url().includes(pattern);
        } else if (pattern instanceof RegExp) {
          return pattern.test(req.url());
        } else if (typeof pattern === "function") {
          return pattern(req);
        }
        return false;
      },
      timeout,
    });
  }
}
