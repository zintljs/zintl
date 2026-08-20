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

/** One script body the page received, reduced to what the caller asked about. */
export interface DeliveredBody {
  url: string;
  /** The `?t=` it was fetched under, when the host stamps one. */
  t?: string;
  /** Bytes received — enough to tell two versions of one file apart. */
  length: number;
  /** Which of the caller's markers this body contained. */
  found: string[];
}

export interface BodyCapture {
  /** Everything received so far, oldest first. */
  readonly bodies: ReadonlyArray<DeliveredBody>;
  /**
   * Resolve once a received body contains `text`; throw listing what did arrive.
   *
   * The bound is a failure budget, not a measurement: presence is observed as
   * soon as it happens, and only absence has to wait.
   */
  waitForBody(text: string, opts?: { timeout?: number }): Promise<DeliveredBody>;
  stop(): DeliveredBody[];
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

  /**
   * Record the **bodies** the page receives for modules matching `match`.
   *
   * `capture()` above records that a request happened; this records what came
   * back, which is a different question and the one that ends an argument about
   * whether an update reached the browser. Ledger L-080 spent five probes
   * establishing that every step Zintl owns was correct — the file on disk, the
   * watcher event, the bytes handed to the plan, the modules invalidated, the
   * packet on the wire — and the thing that finally settled it was reading what
   * the browser was actually served.
   *
   * `markers` is what makes it host-neutral. On Vite the final content arrives
   * as its own module; on Rspack the same edit reloads the page and the content
   * comes back inside a hashed bundle. Asking "which URL" would be a contract
   * guessing at host-shaped paths, the mistake L-049, L-056 and L-062 each made
   * somewhere else. Asking "which body contained this text" is the same question
   * on both.
   */
  captureBodies(match: string | RegExp, markers: string[]): BodyCapture {
    const bodies: DeliveredBody[] = [];
    let live = true;

    const onResponse = (res: Response) => {
      if (!live) return;
      const url = res.url();
      const hit = typeof match === "string" ? url.includes(match) : match.test(url);
      if (!hit) return;
      void res
        .text()
        .then((body) => {
          if (!live) return;
          /**
           * Reduced on arrival rather than stored.
           *
           * A dev bundle is megabytes and a page fetches many; keeping the text
           * would hold a project's whole graph for the life of a lab. What a
           * caller ever asks is "did this contain X", so that is what is kept.
           */
          bodies.push({
            url,
            t: url.split("?t=")[1]?.split("&")[0],
            length: body.length,
            found: markers.filter((m) => body.includes(m)),
          });
        })
        .catch(() => {
          /* A body the browser discarded is one this cannot report on. */
        });
    };
    this.page.on("response", onResponse);

    const stop = () => {
      live = false;
      this.page.off("response", onResponse);
      return [...bodies];
    };

    return {
      get bodies() {
        return bodies;
      },
      stop,
      async waitForBody(text: string, opts?: { timeout?: number }) {
        const deadline = Date.now() + (opts?.timeout ?? 10_000);
        for (;;) {
          const hit = bodies.find((b) => b.found.includes(text));
          if (hit) return hit;
          if (Date.now() > deadline) {
            const seen = bodies
              .map(
                (b) =>
                  `    ${b.url.split("/").pop()} t=${b.t ?? "(none)"} ${b.length}B ` +
                  `found=[${b.found.join(",")}]`,
              )
              .join("\n");
            throw new Error(
              `The browser never received a module containing ${JSON.stringify(text)}.\n\n` +
                `Bodies received for ${JSON.stringify(match)} (${bodies.length}):\n` +
                `${seen || "    (none)"}`,
            );
          }
          await new Promise((r) => setTimeout(r, 50));
        }
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
