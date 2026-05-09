import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZintlLogger } from "../logger.js";

describe("ZintlLogger", () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = {
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
    // Clear env vars that might interfere
    delete process.env.ZINTL_LOG_LEVEL;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should log info by default (when explicitly set to info)", () => {
    const logger = new ZintlLogger({ level: "info" });
    logger.info("test info");
    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it("should respect logLevel silent", () => {
    const logger = new ZintlLogger({ level: "silent" });
    logger.error("test error");
    expect(consoleSpy.error).not.toHaveBeenCalled();
  });

  it("should log error when level is error", () => {
    const logger = new ZintlLogger({ level: "error" });
    logger.error("test error");
    logger.warn("test warn");
    expect(consoleSpy.error).toHaveBeenCalled();
    expect(consoleSpy.warn).not.toHaveBeenCalled();
  });

  it("should NOT log debug by default", () => {
    const logger = new ZintlLogger();
    logger.debug("test debug");
    expect(consoleSpy.debug).not.toHaveBeenCalled();
  });

  it("should log debug when debug option is true", () => {
    const logger = new ZintlLogger({ debug: true, prefix: "Zintl/Test" });
    logger.debug("test debug");
    expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringMatching(/zintl:test/));
    expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringMatching(/test debug/));
    expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringMatching(/\+\d+ms/));
  });

  it("should respect scoped debug option", () => {
    const logger = new ZintlLogger({ debug: "compiler", prefix: "Zintl/Compiler" });
    logger.debug("test debug compiler");
    expect(consoleSpy.debug).toHaveBeenCalled();

    const otherLogger = new ZintlLogger({ debug: "compiler", prefix: "Zintl/Extractor" });
    otherLogger.debug("test debug extractor");
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1); // Still only 1 from before
  });

  it("should respect DEBUG environment variable", () => {
    process.env.DEBUG = "zintl:*";
    const logger = new ZintlLogger({ level: "info" });
    logger.debug("test debug env");
    expect(consoleSpy.debug).toHaveBeenCalled();
  });

  it("should respect scoped DEBUG environment variable", () => {
    process.env.DEBUG = "zintl:compiler";
    const logger = new ZintlLogger({ prefix: "Zintl/Compiler", level: "info" });
    logger.debug("test debug compiler env");
    expect(consoleSpy.debug).toHaveBeenCalled();

    const otherLogger = new ZintlLogger({ prefix: "Zintl/Extractor", level: "info" });
    otherLogger.debug("test debug extractor env");
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
  });

  it("should propagate debug state to sub-loggers", () => {
    const logger = new ZintlLogger({ debug: true });
    const subLogger = logger.withPrefix("Sub");
    subLogger.debug("test sub debug");
    expect(consoleSpy.debug).toHaveBeenCalled();
  });
});
