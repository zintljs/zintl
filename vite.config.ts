import { defineConfig } from "vite-plus";
import { configDefaults } from "vite-plus/test/config";
export default defineConfig({
  run: {
    tasks: {
      "install:clean": {
        command: [
          "find . -name 'node_modules' -type d",
          "-not -path './.git/*'",
          "-prune -exec rm -rf {} +",
          "&& rm -f pnpm-lock.yaml",
          "&& pnpm install",
        ].join(" "),
        cache: false,
      },
      "build:clean": {
        command: [
          "find . -name 'dist' -o -name '.next' -type d",
          "-o -name '*.tsbuildinfo' -type f",
          "-not -path './.git/*'",
          "-prune -exec rm -rf {} +",
          "&& vp run build",
        ].join(" "),
        cache: false,
      },
    },
  },
  fmt: {
    ignorePatterns: [],
  },
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
  },
  /**
   * The runtime's build-time sentinels. `getRuntimeCode()` substitutes them to
   * literals before serving, but unit tests import the runtime modules directly
   * and bypass that, so they must be defined here.
   *
   * Both carry their **dev** values, because that is the environment a unit test
   * importing the runtime is standing in. The production folding is asserted
   * where it actually happens, against `getRuntimeCode`'s output, rather than
   * approximated here.
   */
  define: {
    __ZINTL_DEV__: "true",
    __ZINTL_PSEUDO__: "true",
  },
  test: {
    exclude: [...configDefaults.exclude, "**/__tests__/examples/**", "tests/**"],
    coverage: {
      exclude: [
        ...configDefaults.exclude,
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.bench.ts",
        "**/*.d.ts",
        "coverage/**",
        "**/types/**",
        "**/types.ts",
        "**/__tests__/**",
        "**/__bench__/**",
      ],
    },
    benchmark: {
      include: ["**/__bench__/*.bench.ts"],
      reporters: ["default", "./scripts/budget-reporter.ts"],
      // outputJson: "./bench-baseline.json",
      compare: "./bench-baseline.json",
    },
  },
});
