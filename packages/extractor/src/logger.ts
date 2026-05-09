const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export type LogLevel = "silent" | "error" | "warn" | "info";

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
};

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  debug?: boolean | string;
}

export class ZintlLogger {
  private level: number;
  private prefix: string;
  private debugEnabled: boolean = false;
  private debugScope: string | null = null;

  private lastDebugTime: number = Date.now();

  constructor(options: LoggerOptions = {}) {
    const envLevel =
      typeof process !== "undefined" ? (process.env?.ZINTL_LOG_LEVEL as LogLevel) : undefined;
    const isTest =
      typeof process !== "undefined" &&
      (process.env?.NODE_ENV === "test" || process.env?.VITEST === "true");

    this.prefix = options.prefix || "Zintl";

    // Handle debug mode first so we can decide if we should be silent
    this.setupDebug(options.debug);

    const resolvedLevel =
      envLevel || options.level || (isTest && !this.debugEnabled ? "silent" : "info");
    this.level = LEVEL_WEIGHTS[resolvedLevel] ?? LEVEL_WEIGHTS.info;
  }

  private setupDebug(debugOption?: boolean | string) {
    const envDebug = (typeof process !== "undefined" ? process.env?.DEBUG : "") || "";
    const isZintlAll = envDebug.includes("zintl:*");
    const isGlobalAll = envDebug === "*";

    if (debugOption === true || isZintlAll || isGlobalAll) {
      this.debugEnabled = true;
      return;
    }

    if (typeof debugOption === "string") {
      this.debugScope = debugOption;
      this.debugEnabled = true;
      return;
    }

    // Check for specific scope in env: DEBUG=zintl:compiler
    const normalizedScope = this.prefix.toLowerCase().split("/").pop();
    if (normalizedScope && envDebug.includes(`zintl:${normalizedScope}`)) {
      this.debugEnabled = true;
    }
  }

  private formatMessage(levelStr: string, color: string, message: string) {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    const tag = `${COLORS.gray}[${timestamp}]${COLORS.reset} ${color}${COLORS.bold}[${this.prefix}/${levelStr}]${COLORS.reset}`;
    return `${tag} ${message}`;
  }

  private formatDebugMessage(message: string) {
    const now = Date.now();
    const diff = now - this.lastDebugTime;
    this.lastDebugTime = now;

    const scope = this.prefix.toLowerCase().replace(/^zintl\//i, "");
    const namespace = `zintl:${scope}`;

    // Color the namespace based on its content (simple hash-based color)
    const colors = [COLORS.magenta, COLORS.cyan, COLORS.blue, COLORS.green, COLORS.yellow];
    const colorIndex = namespace.length % colors.length;
    const color = colors[colorIndex];

    return `  ${color}${namespace}${COLORS.reset} ${message} ${COLORS.gray}+${diff}ms${COLORS.reset}`;
  }

  error(message: string, ...args: any[]) {
    if (this.level >= LEVEL_WEIGHTS.error) {
      console.error(this.formatMessage("ERROR", COLORS.red, message), ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level >= LEVEL_WEIGHTS.warn) {
      console.warn(this.formatMessage("WARN", COLORS.yellow, message), ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level >= LEVEL_WEIGHTS.info) {
      console.info(this.formatMessage("INFO", COLORS.cyan, message), ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (this.debugEnabled) {
      // If scoped, check if prefix matches
      if (this.debugScope && !this.prefix.toLowerCase().includes(this.debugScope.toLowerCase())) {
        return;
      }
      console.debug(this.formatDebugMessage(message), ...args);
    }
  }

  /**
   * Create a sub-logger with a combined prefix.
   */
  withPrefix(subPrefix: string): ZintlLogger {
    const newPrefix = `${this.prefix}/${subPrefix}`;
    const subLogger = new ZintlLogger({
      level: Object.keys(LEVEL_WEIGHTS).find(
        (key) => LEVEL_WEIGHTS[key as LogLevel] === this.level,
      ) as LogLevel,
      prefix: newPrefix,
      debug: this.debugEnabled || this.debugScope || undefined,
    });
    // Sync timing to prevent huge diffs on first sub-logger call
    subLogger.lastDebugTime = this.lastDebugTime;
    return subLogger;
  }

  setLevel(level: LogLevel) {
    this.level = LEVEL_WEIGHTS[level];
  }
}

/** Global default logger */
export const logger = new ZintlLogger();
