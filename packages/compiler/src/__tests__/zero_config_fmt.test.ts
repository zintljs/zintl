import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.ts";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import { createTestDir, type TestContext } from "./helpers/fs.js";

vi.mock("node:fs", async () => {
  const actual = (await vi.importActual("node:fs")) as any;
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock("node:child_process", async () => {
  const actual = (await vi.importActual("node:child_process")) as any;
  return {
    ...actual,
    spawn: vi.fn(() => ({
      unref: vi.fn(),
    })),
  };
});

type LocalContext = TestContext;

describe("Zero Config Formatter", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-fmt-test-");
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it("should spawn vp if it exists", async (context: LocalContext) => {
    const { root } = context;
    // Mock vp existence
    (fs.existsSync as any).mockImplementation((path: string) => {
      return path.endsWith("vp");
    });

    const compiler = new ZintlCompiler({}, root, true);
    await (compiler as any).safeWriteFile(join(root, "test.json"), '{"key":"value"}');

    expect(cp.spawn).toHaveBeenCalledWith(
      expect.stringContaining("vp"),
      ["fmt", join(root, "test.json"), "--write"],
      expect.any(Object),
    );
  });

  it("should detect oxfmt if vp is missing", async (context: LocalContext) => {
    const { root } = context;
    // Mock oxfmt existence
    (fs.existsSync as any).mockImplementation((path: string) => {
      return path.endsWith("oxfmt");
    });

    const compiler = new ZintlCompiler({}, root, true);
    await (compiler as any).safeWriteFile(join(root, "test.json"), '{"key":"value"}');

    expect(cp.spawn).toHaveBeenCalledWith(
      expect.stringContaining("oxfmt"),
      [join(root, "test.json"), "--write"],
      expect.any(Object),
    );
  });

  it("should detect prettier if others are missing", async (context: LocalContext) => {
    const { root } = context;
    // Mock prettier existence
    (fs.existsSync as any).mockImplementation((path: string) => {
      return path.endsWith("prettier");
    });

    const compiler = new ZintlCompiler({}, root, true);
    await (compiler as any).safeWriteFile(join(root, "test.json"), '{"key":"value"}');

    expect(cp.spawn).toHaveBeenCalledWith(
      expect.stringContaining("prettier"),
      ["--write", join(root, "test.json")],
      expect.any(Object),
    );
  });

  it("should not spawn anything if no formatter matches", async (context: LocalContext) => {
    const { root } = context;
    (fs.existsSync as any).mockReturnValue(false);

    const compiler = new ZintlCompiler({}, root, true);
    await (compiler as any).safeWriteFile(join(root, "test.json"), '{"key":"value"}');

    expect(cp.spawn).not.toHaveBeenCalled();
  });
});
