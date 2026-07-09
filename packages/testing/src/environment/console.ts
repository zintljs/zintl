import type { Page, ConsoleMessage as PWConsoleMessage } from "@playwright/test";

export interface ConsoleMessage {
  type: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  timestamp: number;
}

export interface ConsoleCapture {
  stop(): ConsoleMessage[];
  readonly messages: ReadonlyArray<ConsoleMessage>;
}

export class LabConsole {
  private page: Page;
  private _messages: ConsoleMessage[] = [];
  private activeCaptures: Set<{ messages: ConsoleMessage[] }> = new Set();

  constructor(page: Page) {
    this.page = page;
    this.setupListeners();
  }

  private setupListeners() {
    this.page.on("console", (msg: PWConsoleMessage) => {
      const type = msg.type() as any;
      const text = msg.text();
      const message: ConsoleMessage = {
        type,
        text,
        timestamp: Date.now(),
      };

      this._messages.push(message);

      for (const capture of this.activeCaptures) {
        capture.messages.push(message);
      }
    });

    this.page.on("pageerror", (err: Error) => {
      const message: ConsoleMessage = {
        type: "error",
        text: err.stack || err.message,
        timestamp: Date.now(),
      };
      this._messages.push(message);
      for (const capture of this.activeCaptures) {
        capture.messages.push(message);
      }
    });
  }

  get messages(): ReadonlyArray<ConsoleMessage> {
    return this._messages;
  }

  get errors(): ReadonlyArray<ConsoleMessage> {
    return this._messages.filter(
      (m) => m.type === "error" || m.type === "warn" || m.text.toLowerCase().includes("error"),
    );
  }

  capture(): ConsoleCapture {
    const messages: ConsoleMessage[] = [];
    const captureObj = { messages };
    this.activeCaptures.add(captureObj);

    return {
      stop: () => {
        this.activeCaptures.delete(captureObj);
        return messages;
      },
      get messages() {
        return messages;
      },
    };
  }
}
